// Player-video routes for Ballsy Studio — search a player, review the
// generated form-check script, then run the rest of the pipeline. Mounted
// at /api/player by index.mjs. Self-contained on purpose, same reasoning as
// publish-youtube.mjs/publish-tiktok.mjs: everything player-video-specific
// (its own id validation, its own SSE helper, its own fixture-id pointer)
// lives in this one file, so index.mjs only ever has to mount it. Mirrors
// the match routes in index.mjs step for step — search/pick replaces
// league/season/matchday drill-down, everything after "generate script" is
// the same shape, with two additions: a player's form genuinely changes
// week to week, so every generation is its own dated RUN (playerId + date)
// instead of a single video per player that a later run would overwrite;
// and within one day, a distinct focus prompt is ALSO its own run (playerId
// + date + runSlug) rather than overwriting that day's other take — same
// "runs" concept index.mjs now applies to matches (see run-paths.mjs).

import {execFile, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import express from 'express';
import {searchPlayers, getPlayerSeasons, getPlayerForm} from '../lib/match-source.mjs';
import {playerVideoSegments} from './video-paths.mjs';
import {markBusy, pipelineArtifactsOf, planGeneration, runSummary} from './run-ref.mjs';
import {
  DEFAULT_RUN_SLUG,
  buildPlayerRunId,
  isValidRunSlug,
  playerOutputPath,
} from '../lib/run-paths.mjs';

const execFileAsync = promisify(execFile);

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, '..', '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const PLAYERS_OUTPUT_DIR = join(SCRIPTS_DIR, 'output', 'players');
const PUBLIC_AUDIO_DIR = join(REPO_ROOT, 'public', 'audio');
// out/players/<id>/<date-or-date-slug>.mp4 — its own subfolder, sibling to
// index.mjs's out/matches/, so the two video kinds never mingle in one flat
// folder, and one player's own past runs sit together instead of scattered
// by filename.
const OUT_DIR = join(REPO_ROOT, 'out');
const PLAYERS_OUT_DIR = join(OUT_DIR, 'players');
const BALLSY_PLAYER_TSX = join(REPO_ROOT, 'src', 'ballsyPlayer.tsx');

const router = express.Router();

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// The bare SofaScore player id — validated BEFORE it's ever combined into a
// fixture id for file paths. Deliberately its own validator, never shared
// with index.mjs's isValidMatchId — a match id and a player id must never be
// interchangeable just because both happen to be numeric strings.
function isValidPlayerId(playerId) {
  return /^\d+$/.test(String(playerId));
}

// A run date is always YYYY-MM-DD (see todayStr()) — validated before it's
// ever interpolated into a path, same discipline as the id check above.
function isValidRunDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// The full fixture id for ONE run: a player's dated (optionally focused)
// generation — see run-paths.mjs's buildPlayerRunId.
function fixtureId(playerId, date, runSlug) {
  return buildPlayerRunId(playerId, date, runSlug);
}

async function runScript(scriptName, args, env) {
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  try {
    const {stdout} = await execFileAsync('node', [scriptPath, ...args], {
      cwd: REPO_ROOT,
      maxBuffer: 16 * 1024 * 1024,
      env: env ? {...process.env, ...env} : process.env,
    });
    return stdout;
  } catch (err) {
    throw new Error(`${scriptName} failed:\n${err.stderr || err.message}`);
  }
}

async function readScriptFile(playerId, date, runSlug) {
  return JSON.parse(await readFile(playerOutputPath(playerId, date, runSlug), 'utf8'));
}

// Points the player-render pipeline at this run — same idea as index.mjs's
// setFixtureId(), targeting PLAYER_FIXTURE_ID in src/ballsyPlayer.tsx
// instead of FIXTURE_ID in src/ballsy.tsx.
async function setPlayerFixtureId(playerId, date, runSlug) {
  const contents = await readFile(BALLSY_PLAYER_TSX, 'utf8');
  const pattern = /export const PLAYER_FIXTURE_ID = '[^']*';/;
  if (!pattern.test(contents)) {
    throw new Error('Could not find PLAYER_FIXTURE_ID assignment in src/ballsyPlayer.tsx to update.');
  }
  const updated = contents.replace(
    pattern,
    `export const PLAYER_FIXTURE_ID = '${fixtureId(playerId, date, runSlug)}';`,
  );
  await writeFile(BALLSY_PLAYER_TSX, updated);
}

// Which pipeline artifacts already exist on disk for one dated (optionally
// focused) run — same role index.mjs's pipelineArtifacts() plays for
// matches. videoRunId is the out/players/<id>/<...>.mp4 filename segment
// (date, or "date-slug" for a focused run — see video-paths.mjs).
function pipelineArtifacts(playerId, date, runSlug) {
  return pipelineArtifactsOf({kind: 'player', playerId, date, runSlug});
}

// Every run (across every date and every focus) saved for one player,
// newest first — scripts/output/players/<playerId>/*.json, excluding the
// *-alignment.json sidecar files.
async function listPlayerRuns(playerId) {
  const runDir = join(PLAYERS_OUTPUT_DIR, String(playerId));
  let files;
  try {
    files = await readdir(runDir);
  } catch {
    return [];
  }
  const runFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('-alignment.json'));
  const runs = await Promise.all(
    runFiles.map(async (file) => {
      const stem = file.replace(/\.json$/, '');
      const m = /^(\d{4}-\d{2}-\d{2})(?:-([a-z0-9-]+))?$/.exec(stem);
      if (!m) return null;
      const [, date, runSlug = DEFAULT_RUN_SLUG] = m;
      const filePath = join(runDir, file);
      const saved = JSON.parse(await readFile(filePath, 'utf8'));
      if (!saved.script) return null;
      const {mtime} = await stat(filePath);
      return {
        kind: 'player',
        playerId: String(playerId),
        date,
        playerInfo: saved.playerInfo ?? null,
        ...runSummary({kind: 'player', playerId: String(playerId), date, runSlug}, saved, mtime),
      };
    }),
  );
  return runs.filter(Boolean).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

// Every run across every player — /api/library's player-side data source,
// so index.mjs never has to know this file's own on-disk layout.
async function listAllPlayerRuns() {
  let playerDirs;
  try {
    playerDirs = await readdir(PLAYERS_OUTPUT_DIR, {withFileTypes: true});
  } catch {
    return [];
  }
  const nested = await Promise.all(
    playerDirs.filter((d) => d.isDirectory()).map((dir) => listPlayerRuns(dir.name)),
  );
  return nested.flat().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

// Search players by name — the player-video equivalent of /api/leagues?q=.
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    res.json(searchPlayers(q));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Every tournament/season pair this player has stats for — lets the picker
// default to (or offer a choice of) his current competition.
router.get('/seasons/:playerId', (req, res) => {
  const {playerId} = req.params;
  if (!isValidPlayerId(playerId)) {
    return res.status(400).json({error: 'Invalid player id'});
  }
  try {
    res.json(getPlayerSeasons(playerId));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Full current form report — the same data generate-player-script.mjs sends
// the model, surfaced so you can see it before spending anything. Free.
// `competitions` (optional query param) is a JSON array of
// [{tournamentId, seasonId}, ...] — the Studio UI's competition picker is
// multi-select, so more than one can be requested at once (pooled — see
// getPlayerForm). Omit it to default to the player's current club
// competition alone.
router.get('/form/:playerId', (req, res) => {
  const {playerId} = req.params;
  if (!isValidPlayerId(playerId)) {
    return res.status(400).json({error: 'Invalid player id'});
  }
  try {
    const {competitions} = req.query;
    res.json(getPlayerForm(playerId, competitions ? JSON.parse(competitions) : undefined));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Every run (every date, every focus) that exists for this player, newest
// first — the player overview page's "past videos" list, and how it decides
// whether to offer "generate today's video" or "you already have one for
// today" (checking the default-slug run specifically).
router.get('/runs/:playerId', async (req, res) => {
  const {playerId} = req.params;
  if (!isValidPlayerId(playerId)) {
    return res.status(400).json({error: 'Invalid player id'});
  }
  try {
    res.json(await listPlayerRuns(playerId));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Reads back an already-generated script without regenerating it (free) —
// mirrors GET /api/script/:matchId/:runSlug.
router.get('/script/:playerId/:date/:runSlug', async (req, res) => {
  const {playerId, date, runSlug} = req.params;
  if (!isValidPlayerId(playerId) || !isValidRunDate(date) || !isValidRunSlug(runSlug)) {
    return res.status(400).json({error: 'Invalid player id, date, or run'});
  }
  try {
    const saved = await readScriptFile(playerId, date, runSlug);
    if (!saved.script) {
      return res.status(404).json({error: 'No script saved for this run'});
    }
    res.json({
      script: saved.script,
      publishMetadata: saved.publishMetadata ?? null,
      reviewStatus: saved.reviewStatus,
      playerInfo: saved.playerInfo ?? null,
      focusPrompt: saved.focusPrompt ?? null,
      label: saved.label ?? null,
      createdAt: saved.createdAt ?? null,
      date,
      runSlug,
      ...pipelineArtifacts(playerId, date, runSlug),
      youtube: saved.youtube ?? null,
      tiktok: saved.tiktok ?? null,
    });
  } catch (err) {
    res.status(404).json({error: err.message});
  }
});

// Segment counts per block — same shape-guard as index.mjs's segmentShape(),
// just reading `stats` instead of `events` per key_moment (TaggedStat vs
// TaggedEvent) since only the segments count (not their tagged content)
// actually matters for this check.
function segmentShape(script) {
  return [
    script.hook.segments.length,
    ...script.key_moments.map((m) => m.segments.length),
    ...(script.controversy ? [script.controversy.segments.length] : []),
    script.result.segments.length,
    script.outro.segments.length,
  ];
}

router.post('/script/:playerId/:date/:runSlug', async (req, res) => {
  const {playerId, date, runSlug} = req.params;
  const {script} = req.body;
  if (!isValidPlayerId(playerId) || !isValidRunDate(date) || !isValidRunSlug(runSlug)) {
    return res.status(400).json({error: 'Invalid player id, date, or run'});
  }
  if (!script || typeof script !== 'object') {
    return res.status(400).json({error: 'script is required'});
  }
  try {
    const filePath = playerOutputPath(playerId, date, runSlug);
    const saved = await readScriptFile(playerId, date, runSlug);
    if (!saved.script) {
      return res.status(404).json({error: 'No script saved for this run'});
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

// Generations already running, keyed by the full run id — same backstop
// index.mjs's inFlightGenerations provides for match scripts.
const inFlightGenerations = new Map();

// Starts (or re-attaches to) a run for this player. A brand-new video is
// always dated today (a past run is a record of the player's form back then);
// regenerating an already-open run passes its own `date` + `runSlug` and
// `mode: 'overwrite'`. Same focus as a video that already exists for that day
// is a conflict (409, checked before anything is spawned — free) the user
// resolves by choosing to overwrite it or to add a new version next to it.
router.post('/generate-script', async (req, res) => {
  const {playerId, focusPrompt, competitions, date: requestedDate, runSlug: requestedSlug, mode} = req.body;
  if (!playerId) return res.status(400).json({error: 'playerId is required'});
  const id = String(playerId);
  if (!isValidPlayerId(id)) {
    return res.status(400).json({error: 'Invalid player id'});
  }
  const date = requestedDate ? String(requestedDate) : todayStr();
  if (!isValidRunDate(date)) return res.status(400).json({error: 'Invalid date'});
  const plan = planGeneration({focusPrompt, runSlug: requestedSlug, mode}, (slug) =>
    existsSync(playerOutputPath(id, date, slug)),
  );
  if (plan.error) return res.status(400).json({error: plan.error});
  if (plan.conflict) {
    const existing = await readScriptFile(id, date, plan.slug).catch(() => ({}));
    return res.status(409).json({
      exists: true,
      runSlug: plan.slug,
      date,
      reviewStatus: existing.reviewStatus ?? null,
      hasVideo: pipelineArtifacts(id, date, plan.slug).hasVideo,
    });
  }
  const runSlug = plan.slug;
  const key = fixtureId(id, date, runSlug);
  try {
    let job = inFlightGenerations.get(key);
    if (!job) {
      const args = [id, date];
      const trimmedFocus = typeof focusPrompt === 'string' ? focusPrompt.trim() : '';
      const hasCompetitions = Array.isArray(competitions) && competitions.length > 0;
      // Positional — generate-player-script.mjs reads competitionsJson and
      // focusPrompt off fixed argv slots, so a placeholder has to go in even
      // when only focusPrompt (not competitions) was given.
      if (hasCompetitions || trimmedFocus) args.push(hasCompetitions ? JSON.stringify(competitions) : '');
      if (trimmedFocus) args.push(trimmedFocus);
      job = runScript('generate-player-script.mjs', args, {BALLSY_RUN_SLUG: runSlug}).finally(() =>
        inFlightGenerations.delete(key),
      );
      inFlightGenerations.set(key, job);
    }
    await job;
    const saved = await readScriptFile(id, date, runSlug);
    res.json({script: saved.script, date, runSlug, focusPrompt: saved.focusPrompt ?? null});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

router.post('/approve-script', async (req, res) => {
  const {playerId, date, runSlug: rawRunSlug} = req.body;
  const runSlug = rawRunSlug || DEFAULT_RUN_SLUG;
  if (!playerId || !date) return res.status(400).json({error: 'playerId and date are required'});
  if (!isValidPlayerId(playerId) || !isValidRunDate(date) || !isValidRunSlug(runSlug)) {
    return res.status(400).json({error: 'Invalid player id, date, or run'});
  }
  try {
    const filePath = playerOutputPath(playerId, date, runSlug);
    const saved = await readScriptFile(playerId, date, runSlug);
    saved.reviewStatus = 'approved';
    saved.reviewedAt = new Date().toISOString();
    await writeFile(filePath, JSON.stringify(saved, null, 2));
    res.json({ok: true});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Runs every remaining step over SSE — mirrors GET /api/run-pipeline, just
// generate-player-timeline.mjs standing in for generate-graphics-timeline.mjs
// (the rest — audio/visemes/expressions/avatar/captions — are the exact same
// scripts, fully fixtureId-generic, called with this run's full fixture id).
router.get('/run-pipeline', async (req, res) => {
  const playerId = String(req.query.playerId || '');
  const date = String(req.query.date || '');
  const runSlug = String(req.query.runSlug || DEFAULT_RUN_SLUG);
  if (!isValidPlayerId(playerId) || !isValidRunDate(date) || !isValidRunSlug(runSlug)) {
    res.status(400).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const id = fixtureId(playerId, date, runSlug);
  const release = markBusy(id, 'pipeline');
  const steps = [
    ['generate-audio.mjs', 'Generating audio (ElevenLabs)...'],
    ['generate-visemes.mjs', 'Generating lip-sync (Rhubarb)...'],
    ['generate-expressions.mjs', 'Computing expressions...'],
    ['generate-player-timeline.mjs', 'Computing stat-card timeline...'],
    ['generate-avatar-timeline.mjs', 'Computing Ballsy position...'],
    ['generate-captions.mjs', 'Generating captions...'],
  ];

  try {
    for (const [script, label] of steps) {
      sendEvent(res, {type: 'step', label});
      // Every one of these scripts is fixtureId-generic (they don't care
      // whether the id is a bare match id or "player-<id>-<date>[-<slug>]")
      // — see generate-player-timeline.mjs's own comment for how it
      // recovers the player id/tournament/season it needs from the saved
      // script instead of a second CLI argument.
      await runScript(script, [id]);
    }
    await setPlayerFixtureId(playerId, date, runSlug);
    sendEvent(res, {type: 'done', playerId, date, runSlug});
  } catch (err) {
    sendEvent(res, {type: 'error', message: err.message});
  } finally {
    release();
    res.end();
  }
});

// Final render to out/players/<id>/<date-or-date-slug>.mp4 — mirrors
// GET /api/render, rendering the PlayerBallsy composition instead of Ballsy.
router.get('/render', async (req, res) => {
  const playerId = String(req.query.playerId || '');
  const date = String(req.query.date || '');
  const runSlug = String(req.query.runSlug || DEFAULT_RUN_SLUG);
  if (!isValidPlayerId(playerId) || !isValidRunDate(date) || !isValidRunSlug(runSlug)) {
    res.status(400).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const release = markBusy(fixtureId(playerId, date, runSlug), 'render');
  try {
    await setPlayerFixtureId(playerId, date, runSlug);
    const videoRunId = runSlug === DEFAULT_RUN_SLUG ? date : `${date}-${runSlug}`;
    const videoSegments = playerVideoSegments(playerId, videoRunId);
    const outPath = join(PLAYERS_OUT_DIR, ...videoSegments);
    await mkdir(dirname(outPath), {recursive: true});

    await new Promise((resolve, reject) => {
      const child = spawn('npx', ['remotion', 'render', 'PlayerBallsy', outPath, '--concurrency=1'], {
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

    sendEvent(res, {type: 'done', path: outPath, videoUrl: `/videos/players/${videoSegments.join('/')}`});
  } catch (err) {
    sendEvent(res, {type: 'error', message: err.message});
  } finally {
    release();
    res.end();
  }
});

export default router;
export {isValidPlayerId, isValidRunDate, pipelineArtifacts, listAllPlayerRuns, fixtureId as playerFixtureId};
