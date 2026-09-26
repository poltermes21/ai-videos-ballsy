// Rename / delete ONE video (run) of any kind — mounted at /api/run by
// index.mjs. Kind-agnostic on purpose: every path comes from run-ref.mjs's
// resolver, so match, player and preview runs share this one implementation.
//
//   POST /api/run/label   {…ref, label}          -> {ok, label}
//   POST /api/run/delete  {…ref, dryRun?: true}  -> {files, published} (dryRun)
//                                                   {deleted}          (real)
//
// Delete removes ONLY this run's own files (script + alignment, the exact
// audio/timeline sidecars, the mp4) — a sibling run whose id merely shares a
// prefix is never touched, and nothing already uploaded to YouTube/TikTok is
// (the UI says so before confirming).

import {readdir, readFile, rmdir, unlink, writeFile} from 'node:fs/promises';
import {dirname, relative} from 'node:path';
import express from 'express';
import {
  OUTPUT_ROOT,
  OUT_ROOT,
  PUBLIC_AUDIO_DIR,
  busyLabel,
  fixtureIdOf,
  parseRunRef,
  runFiles,
  scriptPathOf,
} from './run-ref.mjs';

const router = express.Router();

const MAX_LABEL_LENGTH = 80;

async function readSaved(ref) {
  return JSON.parse(await readFile(scriptPathOf(ref), 'utf8'));
}

router.post('/label', async (req, res) => {
  const ref = parseRunRef(req.body);
  if (!ref) return res.status(400).json({error: 'Invalid run'});
  const raw = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  if (raw.length > MAX_LABEL_LENGTH) {
    return res.status(400).json({error: `Label is limited to ${MAX_LABEL_LENGTH} characters`});
  }
  try {
    const saved = await readSaved(ref);
    // Empty clears the label (the run goes back to showing its focus/version).
    saved.label = raw || null;
    await writeFile(scriptPathOf(ref), JSON.stringify(saved, null, 2));
    res.json({ok: true, label: saved.label});
  } catch (err) {
    res.status(404).json({error: err.message});
  }
});

router.post('/delete', async (req, res) => {
  const ref = parseRunRef(req.body);
  if (!ref) return res.status(400).json({error: 'Invalid run'});
  const dryRun = req.body.dryRun === true;
  let saved;
  try {
    saved = await readSaved(ref);
  } catch {
    return res.status(404).json({error: 'This video does not exist (anymore)'});
  }
  const busy = busyLabel(fixtureIdOf(ref));
  if (busy) {
    return res.status(409).json({error: `This video is busy (${busy} running) — wait for it to finish first.`});
  }
  const files = runFiles(ref, saved.matchInfo);
  const published = {youtube: saved.youtube ?? null, tiktok: saved.tiktok ?? null};
  if (dryRun) {
    const roots = {[OUTPUT_ROOT]: 'scripts/output', [PUBLIC_AUDIO_DIR]: 'public/audio', [OUT_ROOT]: 'out'};
    return res.json({
      files: files.map(({file, root, what}) => ({
        what,
        path: `${roots[root]}/${relative(root, file).split('\\').join('/')}`,
      })),
      published,
    });
  }
  try {
    for (const {file} of files) await unlink(file);
    // Leave no empty entity folder behind (scripts/output/matches/<id>/ once
    // its last run is gone) — rmdir only ever removes an EMPTY directory.
    await rmdir(dirname(scriptPathOf(ref))).catch(() => {});
    res.json({deleted: files.length, remaining: await remainingSiblings(ref)});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// How many videos the entity (match / player / preview) still has, so the
// client knows whether to go back to the entity page or to History.
async function remainingSiblings(ref) {
  try {
    const names = await readdir(dirname(scriptPathOf(ref)));
    return names.filter((f) => f.endsWith('.json') && !f.endsWith('-alignment.json')).length;
  } catch {
    return 0;
  }
}

export default router;
