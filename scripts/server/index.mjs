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
  const updated = contents.replace(
    /export const FIXTURE_ID = '[^']*';/,
    `export const FIXTURE_ID = '${fixtureId}';`,
  );
  if (updated === contents) {
    throw new Error('Could not find FIXTURE_ID assignment in src/ballsy.tsx to update.');
  }
  await writeFile(BALLSY_TSX, updated);
}

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

const app = express();
app.use(express.json());
app.use(express.static(join(SERVER_DIR, 'public')));

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
        let {matchInfo} = saved;
        if (!matchInfo) {
          try {
            const match = getMatch(matchId);
            matchInfo = {
              home: match.home,
              away: match.away,
              homeScore: match.homeScore,
              awayScore: match.awayScore,
              tournament: match.tournament,
              season: match.season,
              date: match.date,
            };
          } catch {
            matchInfo = null;
          }
        }
        const {mtime} = await stat(filePath);
        return {
          matchId,
          matchInfo,
          reviewStatus: saved.reviewStatus,
          reviewedAt: saved.reviewedAt,
          hasAudio: existsSync(join(PUBLIC_AUDIO_DIR, `${matchId}.mp3`)),
          hasVideo: existsSync(join(OUT_DIR, `${matchId}.mp4`)),
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
// used by the "Mis guiones" library to re-open something you generated
// earlier without spending on Anthropic again.
app.get('/api/script/:matchId', async (req, res) => {
  try {
    const saved = await readScriptFile(req.params.matchId);
    res.json({script: saved.script, reviewStatus: saved.reviewStatus});
  } catch (err) {
    res.status(404).json({error: err.message});
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

// Generates (or regenerates) the script for a match — the one paid step the
// user reviews before anything else runs. Returns the parsed script so the
// frontend can render it for approval.
app.post('/api/generate-script', async (req, res) => {
  const {matchId} = req.body;
  if (!matchId) return res.status(400).json({error: 'matchId is required'});
  try {
    await runScript('generate-script.mjs', String(matchId));
    const saved = await readScriptFile(matchId);
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
  if (!matchId) {
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
  if (!matchId) {
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
      const child = spawn('npx', ['remotion', 'render', 'Ballsy', outPath], {
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

// SPA fallback: any GET that isn't an API call or a static asset gets
// index.html, so the client-side router can read location.pathname itself.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(join(SERVER_DIR, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Ballsy match selector: http://localhost:${PORT}`);
});
