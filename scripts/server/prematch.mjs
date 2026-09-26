// Pre-match preview routes for Ballsy Studio — type the two teams, resolve
// the fixture between them, review the generated preview script, then run the
// rest of the pipeline. Mounted at /api/prematch by index.mjs.
// Self-contained on purpose, same reasoning as player.mjs and the two
// publish routers: everything preview-specific (its own id validation, its
// own SSE helper, its own fixture-id pointer) lives in this one file, so
// index.mjs only ever has to mount it.
//
// Mirrors the match routes in index.mjs step for step — a two-team search
// replaces the league/season/matchday drill-down, everything after "generate
// script" is the same shape — with one deliberate difference that runs all
// the way down: a preview's fixture id is "prematch-<matchId>", a genuinely
// separate id space from the same fixture's eventual recap (a bare
// "<matchId>"). One match can get a preview before it's played and a recap
// after, and neither may ever overwrite the other's script, audio or video
// (see scripts/lib/run-paths.mjs).
//
// Publishing (YouTube/TikTok) is shared with matches and players: it runs off
// run-ref.mjs, so nothing preview-specific is needed here.

import {execFile, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import express from 'express';
import {searchTeams, getNextFixture, getPrematch} from '../lib/match-source.mjs';
import {prematchVideoSegments} from './video-paths.mjs';
import {markBusy, pipelineArtifactsOf, planGeneration, runSummary} from './run-ref.mjs';
import {
  DEFAULT_RUN_SLUG,
  buildPrematchRunId,
  isValidRunSlug,
  prematchOutputPath,
} from '../lib/run-paths.mjs';

const execFileAsync = promisify(execFile);

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, '..', '..');
const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
const PREMATCH_OUTPUT_DIR = join(SCRIPTS_DIR, 'output', 'prematch');
const PUBLIC_AUDIO_DIR = join(REPO_ROOT, 'public', 'audio');
// out/prematch/<tournament>/<matchId>/<runSlug>.mp4 — its own subfolder,
// sibling to index.mjs's out/matches/ and player.mjs's out/players/, so a
// fixture's preview never lands in the same tree as its recap.
const OUT_DIR = join(REPO_ROOT, 'out');
const PREMATCH_OUT_DIR = join(OUT_DIR, 'prematch');
const BALLSY_PREMATCH_TSX = join(REPO_ROOT, 'src', 'ballsyPrematch.tsx');

const router = express.Router();

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// The bare SofaScore event id of the fixture being previewed — validated
// BEFORE it's ever combined into a fixture id for file paths. Deliberately
// its own validator, never shared with index.mjs's isValidMatchId: these
// two are the same kind of number but address different id spaces, and
// keeping the checks separate is what stops one file's assumptions leaking
// into the other's paths.
function isValidPrematchMatchId(matchId) {
  return /^\d+$/.test(String(matchId));
}

function isValidTeamId(teamId) {
  return /^\d+$/.test(String(teamId));
}

// The full fixture id for ONE preview run — see run-paths.mjs's
// buildPrematchRunId.
function fixtureId(matchId, runSlug) {
  return buildPrematchRunId(matchId, runSlug);
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

async function readScriptFile(matchId, runSlug) {
  return JSON.parse(await readFile(prematchOutputPath(matchId, runSlug), 'utf8'));
}

// Points the preview-render pipeline at this run — same idea as index.mjs's
// setFixtureId(), targeting PREMATCH_FIXTURE_ID in src/ballsyPrematch.tsx.
async function setPrematchFixtureId(matchId, runSlug) {
  const contents = await readFile(BALLSY_PREMATCH_TSX, 'utf8');
  const pattern = /export const PREMATCH_FIXTURE_ID = '[^']*';/;
  if (!pattern.test(contents)) {
    throw new Error('Could not find PREMATCH_FIXTURE_ID assignment in src/ballsyPrematch.tsx to update.');
  }
  const updated = contents.replace(
    pattern,
    `export const PREMATCH_FIXTURE_ID = '${fixtureId(matchId, runSlug)}';`,
  );
  await writeFile(BALLSY_PREMATCH_TSX, updated);
}

// Which pipeline artifacts already exist on disk for one preview run — same
// role index.mjs's pipelineArtifacts() plays for matches. `matchInfo`
// (tournament) decides the video's nested path, so pass the caller's
// already-loaded copy rather than re-fetching it; this stays a free
// filesystem check, never a SofaScore call.
function pipelineArtifacts(matchId, runSlug, matchInfo) {
  return pipelineArtifactsOf({kind: 'prematch', matchId, runSlug}, matchInfo);
}

// Every run (default + focused) saved for one fixture's preview, newest
// first — scripts/output/prematch/<matchId>/*.json, excluding the
// *-alignment.json sidecar files.
async function listPrematchRuns(matchId) {
  const runDir = join(PREMATCH_OUTPUT_DIR, String(matchId));
  let files;
  try {
    files = await readdir(runDir);
  } catch {
    return [];
  }
  const runFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('-alignment.json'));
  const runs = await Promise.all(
    runFiles.map(async (file) => {
      const runSlug = file.replace(/\.json$/, '');
      const filePath = join(runDir, file);
      const saved = JSON.parse(await readFile(filePath, 'utf8'));
      if (!saved.script) return null;
      const {mtime} = await stat(filePath);
      return {
        kind: 'prematch',
        matchId: String(matchId),
        matchInfo: saved.matchInfo ?? null,
        ...runSummary({kind: 'prematch', matchId: String(matchId), runSlug}, saved, mtime, saved.matchInfo),
      };
    }),
  );
  return runs.filter(Boolean).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

// Every preview run across every fixture — /api/library's preview-side data
// source, so index.mjs never has to know this file's own on-disk layout.
async function listAllPrematchRuns() {
  let matchDirs;
  try {
    matchDirs = await readdir(PREMATCH_OUTPUT_DIR, {withFileTypes: true});
  } catch {
    return [];
  }
  const nested = await Promise.all(
    matchDirs.filter((d) => d.isDirectory()).map((dir) => listPrematchRuns(dir.name)),
  );
  return nested.flat().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

// Search teams by name — the preview equivalent of /api/player/search. Used
// twice on the preview home page (team A and team B).
router.get('/search-team', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    res.json(searchTeams(q));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// The next scheduled fixture between two picked teams, or null. This is what
// replaces the match flow's league/season/matchday drill-down entirely — you
// name the two teams, this finds the actual upcoming event id.
router.get('/next-fixture', (req, res) => {
  const {teamAId, teamBId} = req.query;
  if (!isValidTeamId(teamAId) || !isValidTeamId(teamBId)) {
    return res.status(400).json({error: 'Invalid team ids'});
  }
  if (String(teamAId) === String(teamBId)) {
    return res.status(400).json({error: 'Pick two different teams'});
  }
  try {
    res.json(getNextFixture(teamAId, teamBId));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Full pre-match report (form, table, h2h, streaks) — the same data
// generate-prematch-script.mjs sends the model, surfaced so you can see it
// before spending anything. Free. Errors if the fixture isn't 'notstarted'
// (the sidecar refuses it — see cmd_prematch).
router.get('/info/:matchId', (req, res) => {
  const {matchId} = req.params;
  if (!isValidPrematchMatchId(matchId)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  try {
    res.json(getPrematch(matchId));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Every preview run that exists for this fixture, newest first — the
// overview page's "past videos" list, mirroring GET /api/runs/:matchId.
router.get('/runs/:matchId', async (req, res) => {
  const {matchId} = req.params;
  if (!isValidPrematchMatchId(matchId)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  try {
    res.json(await listPrematchRuns(matchId));
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Reads back an already-generated preview script without regenerating it
// (free) — mirrors GET /api/script/:matchId/:runSlug.
router.get('/script/:matchId/:runSlug', async (req, res) => {
  const {matchId, runSlug} = req.params;
  if (!isValidPrematchMatchId(matchId) || !isValidRunSlug(runSlug)) {
    return res.status(400).json({error: 'Invalid match id or run'});
  }
  try {
    const saved = await readScriptFile(matchId, runSlug);
    if (!saved.script) {
      return res.status(404).json({error: 'No script saved for this run'});
    }
    res.json({
      script: saved.script,
      prediction: saved.prediction ?? null,
      publishMetadata: saved.publishMetadata ?? null,
      reviewStatus: saved.reviewStatus,
      matchInfo: saved.matchInfo ?? null,
      focusPrompt: saved.focusPrompt ?? null,
      label: saved.label ?? null,
      createdAt: saved.createdAt ?? null,
      runSlug,
      ...pipelineArtifacts(matchId, runSlug, saved.matchInfo),
      youtube: saved.youtube ?? null,
      tiktok: saved.tiktok ?? null,
    });
  } catch (err) {
    res.status(404).json({error: err.message});
  }
});

// Segment counts per block — same shape-guard as index.mjs's segmentShape(),
// just reading `stats` instead of `events` per key_moment (TaggedPreview vs
// TaggedEvent) since only the segments count actually matters for this check.
function segmentShape(script) {
  return [
    script.hook.segments.length,
    ...script.key_moments.map((m) => m.segments.length),
    ...(script.controversy ? [script.controversy.segments.length] : []),
    script.result.segments.length,
    script.outro.segments.length,
  ];
}

router.post('/script/:matchId/:runSlug', async (req, res) => {
  const {matchId, runSlug} = req.params;
  const {script} = req.body;
  if (!isValidPrematchMatchId(matchId) || !isValidRunSlug(runSlug)) {
    return res.status(400).json({error: 'Invalid match id or run'});
  }
  if (!script || typeof script !== 'object') {
    return res.status(400).json({error: 'script is required'});
  }
  try {
    const filePath = prematchOutputPath(matchId, runSlug);
    const saved = await readScriptFile(matchId, runSlug);
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

// Generates a preview script for a fixture. Same focus as a preview that
// already exists is a conflict (409, checked before anything is spawned —
// free) the user resolves by choosing to overwrite it or to add a new version
// next to it; a different focus is simply a new run (see run-paths.mjs).
router.post('/generate-script', async (req, res) => {
  const {matchId, focusPrompt, runSlug: requestedSlug, mode} = req.body;
  if (!matchId) return res.status(400).json({error: 'matchId is required'});
  const id = String(matchId);
  if (!isValidPrematchMatchId(id)) {
    return res.status(400).json({error: 'Invalid match id'});
  }
  const plan = planGeneration({focusPrompt, runSlug: requestedSlug, mode}, (slug) =>
    existsSync(prematchOutputPath(id, slug)),
  );
  if (plan.error) return res.status(400).json({error: plan.error});
  if (plan.conflict) {
    const existing = await readScriptFile(id, plan.slug).catch(() => ({}));
    return res.status(409).json({
      exists: true,
      runSlug: plan.slug,
      reviewStatus: existing.reviewStatus ?? null,
      hasVideo: pipelineArtifacts(id, plan.slug, existing.matchInfo).hasVideo,
    });
  }
  const runSlug = plan.slug;
  const key = fixtureId(id, runSlug);
  try {
    let job = inFlightGenerations.get(key);
    if (!job) {
      const args = [id];
      if (focusPrompt && String(focusPrompt).trim()) args.push(String(focusPrompt).trim());
      job = runScript('generate-prematch-script.mjs', args, {BALLSY_RUN_SLUG: runSlug}).finally(() =>
        inFlightGenerations.delete(key),
      );
      inFlightGenerations.set(key, job);
    }
    await job;
    const saved = await readScriptFile(id, runSlug);
    res.json({script: saved.script, runSlug, focusPrompt: saved.focusPrompt ?? null});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

router.post('/approve-script', async (req, res) => {
  const {matchId, runSlug: rawRunSlug} = req.body;
  const runSlug = rawRunSlug || DEFAULT_RUN_SLUG;
  if (!matchId) return res.status(400).json({error: 'matchId is required'});
  if (!isValidPrematchMatchId(matchId) || !isValidRunSlug(runSlug)) {
    return res.status(400).json({error: 'Invalid match id or run'});
  }
  try {
    const filePath = prematchOutputPath(matchId, runSlug);
    const saved = await readScriptFile(matchId, runSlug);
    saved.reviewStatus = 'approved';
    saved.reviewedAt = new Date().toISOString();
    await writeFile(filePath, JSON.stringify(saved, null, 2));
    res.json({ok: true});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Runs every remaining step over SSE — mirrors GET /api/run-pipeline, just
// generate-prematch-timeline.mjs standing in for
// generate-graphics-timeline.mjs (the rest — audio/visemes/expressions/
// avatar/captions — are the exact same scripts, fully fixtureId-generic,
// called with this run's full "prematch-<matchId>[-<slug>]" fixture id).
router.get('/run-pipeline', async (req, res) => {
  const matchId = String(req.query.matchId || '');
  const runSlug = String(req.query.runSlug || DEFAULT_RUN_SLUG);
  if (!isValidPrematchMatchId(matchId) || !isValidRunSlug(runSlug)) {
    res.status(400).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const id = fixtureId(matchId, runSlug);
  const release = markBusy(id, 'pipeline');
  const steps = [
    ['generate-audio.mjs', 'Generating audio (ElevenLabs)...'],
    ['generate-visemes.mjs', 'Generating lip-sync (Rhubarb)...'],
    ['generate-expressions.mjs', 'Computing expressions...'],
    ['generate-prematch-timeline.mjs', 'Computing preview cards...'],
    ['generate-avatar-timeline.mjs', 'Computing Ballsy position...'],
    ['generate-captions.mjs', 'Generating captions...'],
  ];

  try {
    for (const [script, label] of steps) {
      sendEvent(res, {type: 'step', label});
      await runScript(script, [id]);
    }
    await setPrematchFixtureId(matchId, runSlug);
    sendEvent(res, {type: 'done', matchId, runSlug});
  } catch (err) {
    sendEvent(res, {type: 'error', message: err.message});
  } finally {
    release();
    res.end();
  }
});

// Final render to out/prematch/<tournament>/<matchId>/<runSlug>.mp4 —
// mirrors GET /api/render, rendering the PrematchBallsy composition.
router.get('/render', async (req, res) => {
  const matchId = String(req.query.matchId || '');
  const runSlug = String(req.query.runSlug || DEFAULT_RUN_SLUG);
  if (!isValidPrematchMatchId(matchId) || !isValidRunSlug(runSlug)) {
    res.status(400).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const release = markBusy(fixtureId(matchId, runSlug), 'render');
  try {
    await setPrematchFixtureId(matchId, runSlug);
    // The tournament segment comes straight off the already-saved script,
    // the same source pipelineArtifacts() uses, so a render always lands
    // exactly where hasVideo will later look.
    const saved = await readScriptFile(matchId, runSlug);
    const videoSegments = prematchVideoSegments(saved.matchInfo, matchId, runSlug);
    const outPath = join(PREMATCH_OUT_DIR, ...videoSegments);
    await mkdir(dirname(outPath), {recursive: true});

    await new Promise((resolve, reject) => {
      const child = spawn('npx', ['remotion', 'render', 'PrematchBallsy', outPath, '--concurrency=1'], {
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

    sendEvent(res, {type: 'done', path: outPath, videoUrl: `/videos/prematch/${videoSegments.join('/')}`});
  } catch (err) {
    sendEvent(res, {type: 'error', message: err.message});
  } finally {
    release();
    res.end();
  }
});

export default router;
export {isValidPrematchMatchId, pipelineArtifacts, listAllPrematchRuns, fixtureId as prematchFixtureId};
