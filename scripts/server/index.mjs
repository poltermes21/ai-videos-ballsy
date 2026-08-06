// Step 11 — frontend match selector. Local web UI: search a league, pick a
// season + match, review the generated script, then run the rest of the
// pipeline automatically. Run with `npm run selector` (needs .env for the
// paid steps — same env the CLI scripts already use).
//
// The frontend is a small client-rendered app (scripts/server/src/app.ts,
// compiled to public/app.js) with its own history-API router — the fallback
// route below serves index.html for any non-API GET so a direct load or
// refresh of e.g. /history or /match/123 works, not just in-app navigation.
//
// Usage: node --env-file=.env scripts/server/index.mjs

import {execFile, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import http from 'node:http';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import express from 'express';
import {
  getMatch,
  getLeagues,
  searchTournaments,
  getSeasons,
  getSeasonMatches,
} from '../lib/match-source.mjs';

const execFileAsync = promisify(execFile);

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, '..', '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(REPO_ROOT, 'public', 'audio');
const OUT_DIR = join(REPO_ROOT, 'out');
const BALLSY_TSX = join(REPO_ROOT, 'src', 'ballsy.tsx');

const PORT = process.env.SELECTOR_PORT || 4321;
// Remotion Studio's own default dev-server port (no custom port is set in
// remotion.config.ts) — `npm run dev` already runs `remotion studio` on it.
const STUDIO_PORT = process.env.STUDIO_PORT || 3000;
const STUDIO_URL = `http://localhost:${STUDIO_PORT}`;

// Runs a pipeline step exactly like the CLI would (`node scripts/x.mjs <id>`),
// inheriting this process's env — so run this server with `--env-file=.env`
// the same way the individual scripts are normally invoked.
async function runScript(scriptName, fixtureId) {
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  try {
    const {stdout} = await execFileAsync('node', [scriptPath, fixtureId], {
      cwd: REPO_ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    throw new Error(`${scriptName} failed:\n${err.stderr || err.message}`);
  }
}

async function readScriptFile(fixtureId) {
  const filePath = join(OUTPUT_DIR, `${fixtureId}.json`);
  return JSON.parse(await readFile(filePath, 'utf8'));
}

// Points the render pipeline at this fixture — same edit you'd otherwise make
// by hand in src/ballsy.tsx after picking a new match.
async function setFixtureId(fixtureId) {
  const contents = await readFile(BALLSY_TSX, 'utf8');
  const pattern = /export const FIXTURE_ID = '[^']*';/;
  // Checked separately from the replace() call below: re-pointing at the
  // fixture that's already current produces a byte-identical string, so
  // comparing before/after strings can't distinguish that from "pattern not
  // found" — test the pattern itself instead.
  if (!pattern.test(contents)) {
    throw new Error('Could not find FIXTURE_ID assignment in src/ballsy.tsx to update.');
  }
  const updated = contents.replace(pattern, `export const FIXTURE_ID = '${fixtureId}';`);
  await writeFile(BALLSY_TSX, updated);
}

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// True if something is already answering on Remotion Studio's port.
function isStudioRunning() {
  return new Promise((resolve) => {
    const req = http.get({host: 'localhost', port: STUDIO_PORT, path: '/', timeout: 1500}, (res) => {
      res.destroy();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Starts `npm run dev` (== `remotion studio`) detached from this process, so
// it keeps running (and you can keep using it) after this request — and
// after this selector server itself — exits. Bundling takes a few seconds
// the first time, so the caller polls isStudioRunning() rather than assuming
// it's up the instant the process spawns.
function launchStudio() {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    shell: true,
  });
  child.unref();
}

// Which pipeline artifacts already exist on disk for a match. The History page
// and the match page both need this to know where a match left off, so it
// lives in one place — if the audio/render output paths ever move, they move
// here once.
function pipelineArtifacts(matchId) {
  return {
    hasAudio: existsSync(join(PUBLIC_AUDIO_DIR, `${matchId}.mp3`)),
    hasVideo: existsSync(join(OUT_DIR, `${matchId}.mp4`)),
  };
}

// Match ids are SofaScore event ids (always numeric) and are used to build
// file paths, so anything else is rejected rather than joined into a path.
function isValidMatchId(matchId) {
  return /^\d+$/.test(String(matchId));
}

// Team names/score for the pre-matchInfo files (see /api/library). Cached for
// the life of the process so browsing the library doesn't re-spawn the Python
// sidecar — and hit the network — on every single page load.
const matchInfoCache = new Map();

function backfillMatchInfo(matchId) {
  if (matchInfoCache.has(matchId)) return matchInfoCache.get(matchId);
  let info = null;
  try {
    const match = getMatch(matchId);
    info = {
      home: match.home,
      away: match.away,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      tournament: match.tournament,
      season: match.season,
      date: match.date,
    };
  } catch {
    // Offline or an id SofaScore no longer knows: the card still renders,
    // just with the match id instead of team names. Not cached, so it can
    // succeed on a later load.
    return null;
  }
  matchInfoCache.set(matchId, info);
  return info;
}

const app = express();
app.use(express.json());
app.use(express.static(join(SERVER_DIR, 'public')));
// Rendered videos (out/<matchId>.mp4) — served so the match page can play or
// link to them directly instead of just reporting a filesystem path.
app.use('/videos', express.static(OUT_DIR));

// Without ?q= this is the curated league list you browse (leagues.json); with
// one it searches SofaScore for anything not on that list.
app.get('/api/leagues', (req, res) => {
  const q = String(req.query.q || '').trim();
  try {
    res.json(q ? searchTournaments(q) : getLeagues());
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

app.get('/api/leagues/:id/seasons', (req, res) => {
  try {
    res.json(getSeasons(req.params.id));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Every match a script has ever been generated for, newest activity first —
// so a generated script survives closing the tab; you don't have to
// re-search/re-pick to find it again. Reads straight off scripts/output/*.json
// (no SofaScore calls needed) except for the rare pre-this-feature file that
// was saved without matchInfo, where it falls back to one free sidecar call.
app.get('/api/library', async (req, res) => {
  try {
    const files = (await readdir(OUTPUT_DIR)).filter((f) => /^\d+\.json$/.test(f));
    const entries = await Promise.all(
      files.map(async (file) => {
        const matchId = file.replace(/\.json$/, '');
        const filePath = join(OUTPUT_DIR, file);
        const saved = JSON.parse(await readFile(filePath, 'utf8'));
        if (!saved.script) {
          // Pre-reviewStatus-wrapper leftovers from before the SofaScore
          // migration — not a usable script in the current pipeline shape.
          return null;
        }
        const matchInfo = saved.matchInfo ?? backfillMatchInfo(matchId);
        const {mtime} = await stat(filePath);
        return {
          matchId,
          matchInfo,
          reviewStatus: saved.reviewStatus,
          reviewedAt: saved.reviewedAt,
          ...pipelineArtifacts(matchId),
          updatedAt: mtime.toISOString(),
        };
      }),
    );
    const usable = entries.filter(Boolean);
    usable.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(usable);
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Reads back an already-generated script without regenerating it (free) —
// used when re-opening a match from History so you don't spend on Anthropic
// again. Also reports which pipeline artifacts already exist, so the match
// page can offer the *next* step instead of blindly re-running the paid audio
// step on a match that already has audio.
app.get('/api/script/:matchId', async (req, res) => {
  const {matchId} = req.params;
  if (!isValidMatchId(matchId)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  try {
    const saved = await readScriptFile(matchId);
    if (!saved.script) {
      // Pre-reviewStatus-wrapper leftover — treat as "no script yet" so the
      // page offers to generate one rather than rendering an undefined script.
      return res.status(404).json({error: 'No script saved for this match'});
    }
    res.json({
      script: saved.script,
      reviewStatus: saved.reviewStatus,
      matchInfo: saved.matchInfo ?? backfillMatchInfo(matchId),
      ...pipelineArtifacts(matchId),
    });
  } catch (err) {
    res.status(404).json({error: err.message});
  }
});

// Segment counts per block, in traversal order — used to check an edited
// script hasn't added/removed/reordered lines, which would break the
// key_moments[].events[].segmentIndex -> segment link the graphics timeline
// depends on. Editing text/expression in place is always safe; changing the
// shape isn't supported by this UI on purpose.
function segmentShape(script) {
  return [
    script.hook.segments.length,
    ...script.key_moments.map((m) => m.segments.length),
    ...(script.controversy ? [script.controversy.segments.length] : []),
    script.result.segments.length,
    script.outro.segments.length,
  ];
}

// Saves hand-edited segment text/expression back to the script the rest of
// the pipeline reads — lets you fix a line before approving instead of
// paying for a whole new generation over one wrong word.
app.post('/api/script/:matchId', async (req, res) => {
  const {matchId} = req.params;
  const {script} = req.body;
  if (!isValidMatchId(matchId)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  if (!script || typeof script !== 'object') {
    return res.status(400).json({error: 'script is required'});
  }
  try {
    const filePath = join(OUTPUT_DIR, `${matchId}.json`);
    const saved = await readScriptFile(matchId);
    if (!saved.script) {
      return res.status(404).json({error: 'No script saved for this match'});
    }
    const before = segmentShape(saved.script);
    const after = segmentShape(script);
    if (before.length !== after.length || before.some((n, i) => n !== after[i])) {
      return res.status(400).json({
        error: 'Edited script has a different number of lines than the original — only editing existing lines is supported.',
      });
    }
    saved.script = script;
    await writeFile(filePath, JSON.stringify(saved, null, 2));
    res.json({ok: true});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Full match report (score, event timeline, pre-match form/h2h, match stats)
// — the same data generate-script.mjs sends the model, surfaced so you can
// see what actually happened before spending anything on a script. Free:
// this just re-reads the same SofaScore sidecar call, no paid API involved.
app.get('/api/match-info/:matchId', (req, res) => {
  const {matchId} = req.params;
  if (!isValidMatchId(matchId)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  try {
    res.json(getMatch(matchId));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// One round of a season at a time, plus that season's round list for the
// picker. Omitting `round` returns the most recently played round.
app.get('/api/matches', (req, res) => {
  const {tournamentId, seasonId, round} = req.query;
  if (!tournamentId || !seasonId) {
    return res.status(400).json({error: 'tournamentId and seasonId are required'});
  }
  try {
    res.json(getSeasonMatches(tournamentId, seasonId, round));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Generations already running, keyed by match id. Backstop for the frontend's
// own in-flight tracking: a second tab, a page reload mid-generation, or a
// double-click all reach this endpoint independently, and each one spawning
// its own generate-script.mjs would be a second Anthropic bill for a script
// that is already being written (the last writer would win anyway). Late
// callers wait on the run that's already going.
const inFlightGenerations = new Map();

// Generates (or regenerates) the script for a match — the one paid step the
// user reviews before anything else runs. Returns the parsed script so the
// frontend can render it for approval.
app.post('/api/generate-script', async (req, res) => {
  const {matchId} = req.body;
  if (!matchId) return res.status(400).json({error: 'matchId is required'});
  const id = String(matchId);
  if (!isValidMatchId(id)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  try {
    let job = inFlightGenerations.get(id);
    if (!job) {
      job = runScript('generate-script.mjs', id).finally(() => inFlightGenerations.delete(id));
      inFlightGenerations.set(id, job);
    }
    await job;
    const saved = await readScriptFile(id);
    res.json({script: saved.script});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Marks the currently-saved script approved (same write review-script.mjs
// does on 'y') — the gate between the paid script step and the paid audio
// step, now driven by a button instead of a terminal prompt.
app.post('/api/approve-script', async (req, res) => {
  const {matchId} = req.body;
  if (!matchId) return res.status(400).json({error: 'matchId is required'});
  if (!isValidMatchId(matchId)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  try {
    const filePath = join(OUTPUT_DIR, `${matchId}.json`);
    const saved = await readScriptFile(matchId);
    saved.reviewStatus = 'approved';
    saved.reviewedAt = new Date().toISOString();
    await writeFile(filePath, JSON.stringify(saved, null, 2));
    res.json({ok: true});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Runs every remaining step (audio through captions) in order over
// Server-Sent Events, so the page can show live progress instead of one long
// blocking request. Only reachable after /api/approve-script.
app.get('/api/run-pipeline', async (req, res) => {
  const matchId = String(req.query.matchId || '');
  if (!isValidMatchId(matchId)) {
    res.status(400).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const steps = [
    ['generate-audio.mjs', 'Generating audio (ElevenLabs)...'],
    ['generate-visemes.mjs', 'Generating lip-sync (Rhubarb)...'],
    ['generate-expressions.mjs', 'Computing expressions...'],
    ['generate-graphics-timeline.mjs', 'Computing event graphics...'],
    ['generate-avatar-timeline.mjs', 'Computing Ballsy position...'],
    ['generate-captions.mjs', 'Generating captions...'],
  ];

  try {
    for (const [script, label] of steps) {
      sendEvent(res, {type: 'step', label});
      await runScript(script, matchId);
    }
    await setFixtureId(matchId);
    sendEvent(res, {type: 'done', matchId});
  } catch (err) {
    sendEvent(res, {type: 'error', message: err.message});
  } finally {
    res.end();
  }
});

// Final render to an actual .mp4 in out/<matchId>.mp4 — a separate, explicit
// step (not part of /api/run-pipeline) since it can take a couple of minutes
// and isn't needed just to preview in Studio. Streams remotion's own CLI
// output live since a silent multi-minute wait is bad UX.
app.get('/api/render', async (req, res) => {
  const matchId = String(req.query.matchId || '');
  if (!isValidMatchId(matchId)) {
    res.status(400).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    await setFixtureId(matchId);
    await mkdir(OUT_DIR, {recursive: true});
    const outPath = join(OUT_DIR, `${matchId}.mp4`);

    await new Promise((resolve, reject) => {
      // shell:true so `npx` resolves correctly on Windows via spawn.
      // --concurrency=1: without it, Remotion's parallel rendering can make
      // Ballsy's idle animation (driven by Rive's stateful advanceAndApply())
      // stutter at the seams between processes. Slower, but no seams.
      const child = spawn('npx', ['remotion', 'render', 'Ballsy', outPath, '--concurrency=1'], {
        cwd: REPO_ROOT,
        shell: true,
      });
      child.stdout.on('data', (chunk) => sendEvent(res, {type: 'log', line: chunk.toString()}));
      child.stderr.on('data', (chunk) => sendEvent(res, {type: 'log', line: chunk.toString()}));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`remotion render exited with code ${code}`));
      });
    });

    sendEvent(res, {type: 'done', path: outPath});
  } catch (err) {
    sendEvent(res, {type: 'error', message: err.message});
  } finally {
    res.end();
  }
});

// Ensures Remotion Studio is running (starting it if not) and only responds
// once it's actually answering requests, so the frontend can safely
// window.open() the moment this returns instead of racing a blank tab
// against Studio's own bundling time. Free — this is local compute, no API.
const STUDIO_START_TIMEOUT_MS = 30000;
const STUDIO_POLL_INTERVAL_MS = 500;

app.post('/api/studio/launch', async (req, res) => {
  try {
    if (await isStudioRunning()) {
      return res.json({ok: true, alreadyRunning: true});
    }
    launchStudio();
    const deadline = Date.now() + STUDIO_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(STUDIO_POLL_INTERVAL_MS);
      if (await isStudioRunning()) {
        return res.json({ok: true, alreadyRunning: false});
      }
    }
    res.status(504).json({error: 'Timed out waiting for Remotion Studio to start.'});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// SPA fallback: any GET that isn't an API call or a static asset gets
// index.html, so the client-side router can read location.pathname itself.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(join(SERVER_DIR, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Ballsy match selector: http://localhost:${PORT}`);
});
