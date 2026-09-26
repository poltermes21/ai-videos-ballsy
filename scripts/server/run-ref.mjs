// One resolver for "a video" (a RUN) of any kind — match, player or preview.
// Everything that used to be copy-pasted per kind (where the script json
// lives, what the fixture id is, where the mp4 goes, what the audio/timeline
// files are called, where to send the browser back to after an OAuth trip) is
// answered here once from a plain `ref`, so the publish routers, the
// rename/delete routes and the run listings never have to know a kind's
// on-disk layout themselves.
//
// A ref is:
//   {kind: 'match',    matchId, runSlug}
//   {kind: 'player',   playerId, date, runSlug}
//   {kind: 'prematch', matchId, runSlug}

import {existsSync} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  DEFAULT_RUN_SLUG,
  buildMatchRunId,
  buildPlayerRunId,
  buildPrematchRunId,
  isValidRunSlug,
  matchOutputPath,
  nextFreeRunSlug,
  playerOutputPath,
  prematchOutputPath,
  runSlugFor,
} from '../lib/run-paths.mjs';
import {matchVideoSegments, playerVideoSegments, prematchVideoSegments} from './video-paths.mjs';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SERVER_DIR, '..', '..');
export const OUTPUT_ROOT = join(REPO_ROOT, 'scripts', 'output');
export const PUBLIC_AUDIO_DIR = join(REPO_ROOT, 'public', 'audio');
export const OUT_ROOT = join(REPO_ROOT, 'out');

export const RUN_KINDS = ['match', 'player', 'prematch'];

const isNumericId = (v) => /^\d+$/.test(String(v));
const isRunDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

// Pipeline sidecars written next to the audio in public/audio/ — the exact
// suffix list, so deleting one run's files can never match a sibling run's
// (a bare `123` run must not touch `123-some-focus-*`).
const AUDIO_DIR_FILE_SUFFIXES = [
  '.mp3',
  '.wav',
  '-visemes.json',
  '-expressions.json',
  '-graphics.json',
  '-timeline.json',
  '-avatar.json',
  '-captions.json',
];

// Normalizes whatever a request carried (body, query, or path params) into a
// validated ref, or returns null. The one place ids/dates/slugs are checked
// before they can reach a path.
export function parseRunRef(input) {
  const kind = input?.kind || 'match';
  const runSlug = input?.runSlug || DEFAULT_RUN_SLUG;
  if (!RUN_KINDS.includes(kind) || !isValidRunSlug(runSlug)) return null;
  if (kind === 'player') {
    if (!isNumericId(input.playerId) || !isRunDate(input.date)) return null;
    return {kind, playerId: String(input.playerId), date: String(input.date), runSlug};
  }
  if (!isNumericId(input.matchId)) return null;
  return {kind, matchId: String(input.matchId), runSlug};
}

// The full fixture id (what audio/timeline files and the Remotion FIXTURE_ID
// constants are keyed by).
export function fixtureIdOf(ref) {
  if (ref.kind === 'player') return buildPlayerRunId(ref.playerId, ref.date, ref.runSlug);
  if (ref.kind === 'prematch') return buildPrematchRunId(ref.matchId, ref.runSlug);
  return buildMatchRunId(ref.matchId, ref.runSlug);
}

export function scriptPathOf(ref, suffix = '') {
  if (ref.kind === 'player') return playerOutputPath(ref.playerId, ref.date, ref.runSlug, suffix);
  if (ref.kind === 'prematch') return prematchOutputPath(ref.matchId, ref.runSlug, suffix);
  return matchOutputPath(ref.matchId, ref.runSlug, suffix);
}

// Where the browser goes back to after an OAuth round trip / where a run's
// workspace lives.
export function runHrefOf(ref) {
  if (ref.kind === 'player') return `/player/${ref.playerId}/${ref.date}/${ref.runSlug}`;
  if (ref.kind === 'prematch') return `/prematch/${ref.matchId}/${ref.runSlug}`;
  return `/match/${ref.matchId}/${ref.runSlug}`;
}

// The kind's overview page (the entity, not one video).
export function entityHrefOf(ref) {
  if (ref.kind === 'player') return `/player/${ref.playerId}`;
  if (ref.kind === 'prematch') return `/prematch/${ref.matchId}`;
  return `/match/${ref.matchId}`;
}

// Mp4 location as {absolute path, url}. Only the saved script's own
// matchInfo (tournament/season/round) decides a match/preview path, so this
// stays a free filesystem question — pass `matchInfo` from the loaded json.
export function videoLocationOf(ref, matchInfo) {
  if (ref.kind === 'player') {
    const videoRunId = ref.runSlug === DEFAULT_RUN_SLUG ? ref.date : `${ref.date}-${ref.runSlug}`;
    const segments = playerVideoSegments(ref.playerId, videoRunId);
    return {path: join(OUT_ROOT, 'players', ...segments), url: `/videos/players/${segments.join('/')}`};
  }
  if (ref.kind === 'prematch') {
    const segments = prematchVideoSegments(matchInfo, ref.matchId, ref.runSlug);
    return {path: join(OUT_ROOT, 'prematch', ...segments), url: `/videos/prematch/${segments.join('/')}`};
  }
  const segments = matchVideoSegments(matchInfo, buildMatchRunId(ref.matchId, ref.runSlug));
  return {path: join(OUT_ROOT, 'matches', ...segments), url: `/videos/matches/${segments.join('/')}`};
}

// {hasAudio, hasVideo, videoUrl} for one run.
export function pipelineArtifactsOf(ref, matchInfo) {
  const video = videoLocationOf(ref, matchInfo);
  const hasVideo = existsSync(video.path);
  return {
    hasAudio: existsSync(join(PUBLIC_AUDIO_DIR, `${fixtureIdOf(ref)}.mp3`)),
    hasVideo,
    videoUrl: hasVideo ? video.url : null,
  };
}

// The listing row every kind shares (the per-kind routers add their own
// identity fields: matchInfo/playerInfo, plus the ref's ids). `mtime` is the
// script file's — the "last activity" stamp. `matchInfo` is the caller's
// already-resolved copy (only match/preview paths need it).
export function runSummary(ref, saved, mtime, matchInfo) {
  return {
    runSlug: ref.runSlug,
    focusPrompt: saved.focusPrompt ?? null,
    label: saved.label ?? null,
    createdAt: saved.createdAt ?? null,
    reviewStatus: saved.reviewStatus,
    reviewedAt: saved.reviewedAt ?? null,
    ...pipelineArtifactsOf(ref, matchInfo),
    youtube: saved.youtube ?? null,
    tiktok: saved.tiktok ?? null,
    updatedAt: mtime.toISOString(),
  };
}

export async function loadRun(ref) {
  const scriptPath = scriptPathOf(ref);
  const saved = JSON.parse(await readFile(scriptPath, 'utf8'));
  const {mtime} = await stat(scriptPath);
  return {ref, saved, mtime, scriptPath};
}

// Every file this run owns on disk — script json, its alignment sidecar, the
// audio-dir artifacts and the mp4 — filtered to those that exist. Each path is
// re-checked to sit inside the directory it's supposed to live in, so a bad
// ref can never make delete reach outside scripts/output, public/audio or out.
export function runFiles(ref, matchInfo) {
  const id = fixtureIdOf(ref);
  const candidates = [
    {file: scriptPathOf(ref), root: OUTPUT_ROOT, what: 'script'},
    {file: scriptPathOf(ref, '-alignment'), root: OUTPUT_ROOT, what: 'alignment'},
    ...AUDIO_DIR_FILE_SUFFIXES.map((suffix) => ({
      file: join(PUBLIC_AUDIO_DIR, `${id}${suffix}`),
      root: PUBLIC_AUDIO_DIR,
      what: suffix.replace(/^[-.]/, '').replace('.json', ''),
    })),
    {file: videoLocationOf(ref, matchInfo).path, root: OUT_ROOT, what: 'video'},
  ];
  return candidates.filter(({file, root}) => {
    const rel = relative(resolve(root), resolve(file));
    return existsSync(file) && rel && !rel.startsWith('..') && !rel.split(sep).includes('..');
  });
}

// Decides which run slug a "generate script" request lands on, WITHOUT
// spawning anything (so the check is free):
//   - `runSlug` given (regenerating an open run) -> that run, else the slug the
//     focus text produces (`runSlugFor`);
//   - nothing saved there yet -> just that slug;
//   - something already saved: `mode: 'overwrite'` replaces it in place,
//     `mode: 'new-version'` takes the next free `-vN` slug next to it, and no
//     mode is a conflict the caller must ask the user about (a paid generation
//     must never silently replace an approved script).
// `exists(slug)` says whether a run with that slug is already saved.
export function planGeneration({focusPrompt, runSlug, mode}, exists) {
  const base = runSlug || runSlugFor(focusPrompt);
  if (!isValidRunSlug(base)) return {error: 'Invalid run'};
  if (!exists(base)) return {slug: base};
  if (mode === 'overwrite') return {slug: base};
  if (mode === 'new-version') return {slug: nextFreeRunSlug(base, exists)};
  return {conflict: true, slug: base};
}

// Runs currently being produced (pipeline or render) — a delete must never
// pull files out from under a step that is still writing them. Keyed by
// fixture id; entries are registered by the SSE routes for their duration.
const busyRuns = new Map();

export function markBusy(fixtureId, label) {
  busyRuns.set(fixtureId, label);
  return () => busyRuns.delete(fixtureId);
}

export function busyLabel(fixtureId) {
  return busyRuns.get(fixtureId) ?? null;
}

// A ref as a compact string for an OAuth `state` — `match:<id>:<slug>`,
// `prematch:<id>:<slug>`, `player:<id>:<date>:<slug>`. Slugs/ids/dates never
// contain a colon (they are validated), so a plain split round-trips it.
export function encodeRunRef(ref) {
  return ref.kind === 'player'
    ? `player:${ref.playerId}:${ref.date}:${ref.runSlug}`
    : `${ref.kind}:${ref.matchId}:${ref.runSlug}`;
}

// Inverse of encodeRunRef, tolerant of the older 2-part `<matchId>:<slug>`
// state (a match run) so an authorisation started before this change still
// lands on the right page. Returns null for anything invalid.
export function decodeRunRef(state) {
  const parts = String(state || '').split(':');
  if (parts.length === 2) return parseRunRef({kind: 'match', matchId: parts[0], runSlug: parts[1]});
  if (parts[0] === 'player' && parts.length === 4) {
    return parseRunRef({kind: 'player', playerId: parts[1], date: parts[2], runSlug: parts[3]});
  }
  if ((parts[0] === 'match' || parts[0] === 'prematch') && parts.length === 3) {
    return parseRunRef({kind: parts[0], matchId: parts[1], runSlug: parts[2]});
  }
  return null;
}

// What a video is called on a platform when the script agent's own
// publishMetadata.title is missing.
export function fallbackHeadline(saved, ref) {
  if (ref.kind === 'player') {
    const name = saved?.playerInfo?.name;
    return name ? `${name} form check — Ballsy` : `Ballsy player form check ${ref.playerId}`;
  }
  const info = saved?.matchInfo;
  if (ref.kind === 'prematch') {
    return info?.home && info?.away
      ? `${info.home} vs ${info.away} preview — Ballsy`
      : `Ballsy match preview ${ref.matchId}`;
  }
  if (!info?.home || !info?.away) return `Ballsy recap — match ${ref.matchId}`;
  return `${info.home} ${info.homeScore ?? '?'}-${info.awayScore ?? '?'} ${info.away} — Ballsy recap`;
}
