// Shared "where do things live on disk" logic for match/player fixture RUNS.
// A run is either a match's default (no-focus) generation, a match's
// generation with a particular focus prompt, or a player's dated generation
// (itself optionally focused) — every one of these gets its own script file,
// audio, timeline, and rendered video, so regenerating with a different (or
// no) focus never silently overwrites a run someone already approved.
//
// Fixture ids (the opaque string every generate-audio.mjs-style per-step
// script takes as its one CLI arg, and that becomes FIXTURE_ID/
// PLAYER_FIXTURE_ID in the Remotion compositions):
//   <matchId>                          - a match's default run
//   <matchId>-<focusSlug>              - a match run generated with a focus
//   player-<playerId>-<date>           - a player's default run for that day
//   player-<playerId>-<date>-<focusSlug> - a focused run for that day
//   prematch-<matchId>                 - a fixture preview's default run
//   prematch-<matchId>-<focusSlug>     - a focused preview run
//
// scripts/output/ is organized by kind, mirroring out/'s own matches/players/
// prematch split (see scripts/server/video-paths.mjs):
//   scripts/output/matches/<matchId>/<runSlug>.json
//   scripts/output/players/<playerId>/<date-or-date-slug>.json
//   scripts/output/prematch/<matchId>/<runSlug>.json
// so every run for one match (or one player's one day) sits together, and a
// match's real numeric id is never ambiguous with a player's.
//
// A preview and a recap of the SAME SofaScore fixture are deliberately
// different id spaces: a match can get a preview before it's played and a
// recap after, and neither may ever overwrite the other's script, audio or
// rendered video. That's the whole reason for the `prematch-` prefix rather
// than reusing the bare match id with a focus slug.

import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');

export const DEFAULT_RUN_SLUG = 'default';

// "Raphinha's renewal!" -> "raphinha-s-renewal". Free text (a user-typed
// focus prompt) must never reach the filesystem as-is — same reasoning and
// same implementation video-paths.mjs already uses for tournament/season
// names, re-exported from there so both call sites never drift apart.
export function slugify(value) {
  return (
    String(value ?? '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

// The run slug a script is saved/looked-up under — 'default' with no focus,
// otherwise the slugified focus text. Two different focus prompts that
// happen to slugify identically collide on purpose (rare, and regenerating
// with "the same" focus is meant to overwrite that run, not fork it again).
export function runSlugFor(focusPrompt) {
  const trimmed = focusPrompt?.trim();
  return trimmed ? slugify(trimmed) : DEFAULT_RUN_SLUG;
}

// The first free version slug after `baseSlug` — `default` -> `v2`, `v3`...;
// a focused `x` -> `x-v2`, `x-v3`... `exists(slug)` says whether a run with
// that slug is already saved. Lets a second generation for the same focus
// (or two no-focus generations) sit next to the first instead of replacing it.
export function nextFreeRunSlug(baseSlug, exists) {
  for (let n = 2; ; n++) {
    const candidate = baseSlug === DEFAULT_RUN_SLUG ? `v${n}` : `${baseSlug}-v${n}`;
    if (!exists(candidate)) return candidate;
  }
}

export function isValidRunSlug(slug) {
  return slug === DEFAULT_RUN_SLUG || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(slug));
}

export function isValidMatchId(matchId) {
  return /^\d+$/.test(String(matchId));
}

// The fixture id used everywhere downstream (public/audio/<id>*,
// out/matches/.../<id>.mp4, FIXTURE_ID) — plain matchId for the default run
// (so it lines up with every already-existing default-run artifact with zero
// migration), "<matchId>-<slug>" for a focused one.
export function buildMatchRunId(matchId, runSlug) {
  return runSlug === DEFAULT_RUN_SLUG ? String(matchId) : `${matchId}-${runSlug}`;
}

// Convenience for callers that only have the raw focus text, not an
// already-computed slug (generate-script.mjs).
export function matchRunId(matchId, focusPrompt) {
  return buildMatchRunId(matchId, runSlugFor(focusPrompt));
}

// Recovers the real SofaScore match id from a match run id. The numeric
// prefix is always exactly the match id — slugify() never produces a slug
// that could be mistaken for more digits of the same number, since any slug
// component always follows a hyphen. Used by generate-graphics-timeline.mjs,
// the one downstream step that still needs to re-fetch the real match
// (event list, badges) rather than just replay the saved script.
export function baseMatchId(runId) {
  const match = /^(\d+)/.exec(String(runId));
  if (!match) throw new Error(`Not a match run id: ${runId}`);
  return match[1];
}

// scripts/output/matches/<matchId>/<runSlug>.json (+ suffix before .json,
// e.g. "-alignment") — every run for a match sits together.
export function matchOutputPath(matchId, runSlug, suffix = '') {
  return join(OUTPUT_DIR, 'matches', String(matchId), `${runSlug}${suffix}.json`);
}

export function matchOutputDir(matchId) {
  return join(OUTPUT_DIR, 'matches', String(matchId));
}

// The fixture id used everywhere downstream for a player's dated (optionally
// focused) run.
export function buildPlayerRunId(playerId, date, runSlug) {
  return runSlug === DEFAULT_RUN_SLUG
    ? `player-${playerId}-${date}`
    : `player-${playerId}-${date}-${runSlug}`;
}

export function playerRunId(playerId, date, focusPrompt) {
  return buildPlayerRunId(playerId, date, runSlugFor(focusPrompt));
}

// scripts/output/players/<playerId>/<date>.json for the default run of that
// day, scripts/output/players/<playerId>/<date>-<runSlug>.json for a focused
// one — the date already disambiguates by day, the slug only needs to
// disambiguate WITHIN a day.
export function playerOutputPath(playerId, date, runSlug, suffix = '') {
  const filename = runSlug === DEFAULT_RUN_SLUG ? date : `${date}-${runSlug}`;
  return join(OUTPUT_DIR, 'players', String(playerId), `${filename}${suffix}.json`);
}

export function playerOutputDir(playerId) {
  return join(OUTPUT_DIR, 'players', String(playerId));
}

// The fixture id used everywhere downstream for a fixture PREVIEW run —
// prefixed so it can never collide with the same match's eventual recap run
// (a bare match id), which is a different video about the same fixture.
export function buildPrematchRunId(matchId, runSlug) {
  return runSlug === DEFAULT_RUN_SLUG ? `prematch-${matchId}` : `prematch-${matchId}-${runSlug}`;
}

export function prematchRunId(matchId, focusPrompt) {
  return buildPrematchRunId(matchId, runSlugFor(focusPrompt));
}

// scripts/output/prematch/<matchId>/<runSlug>.json — same per-match folder
// shape matchOutputPath uses, under its own kind directory so a preview and
// a recap of the same fixture never share a file.
export function prematchOutputPath(matchId, runSlug, suffix = '') {
  return join(OUTPUT_DIR, 'prematch', String(matchId), `${runSlug}${suffix}.json`);
}

export function prematchOutputDir(matchId) {
  return join(OUTPUT_DIR, 'prematch', String(matchId));
}

// Recovers the real SofaScore match id from a prematch run id — the
// prematch sibling of baseMatchId, used by generate-prematch-timeline.mjs to
// re-fetch the fixture (badges, logo) rather than trusting what was embedded
// at generation time.
export function basePrematchMatchId(runId) {
  const match = /^prematch-(\d+)/.exec(String(runId));
  if (!match) throw new Error(`Not a prematch run id: ${runId}`);
  return match[1];
}

const PLAYER_FIXTURE_PATTERN = /^player-(\d+)-(\d{4}-\d{2}-\d{2})(?:-([a-z0-9-]+))?$/;
const PREMATCH_FIXTURE_PATTERN = /^prematch-(\d+)(?:-([a-z0-9-]+))?$/;
const MATCH_FIXTURE_PATTERN = /^(\d+)(?:-([a-z0-9-]+))?$/;

// Generic per-step scripts (generate-audio.mjs, generate-visemes.mjs, ...)
// only ever get a single opaque fixture id on argv[2] and don't care whether
// it names a match run or a player run — this is the one place that decides
// which nested folder a given fixture id's json/alignment files live under,
// so every one of those scripts can stay fixture-id-generic.
export function fixtureOutputPath(fixtureId, suffix = '') {
  const playerMatch = PLAYER_FIXTURE_PATTERN.exec(String(fixtureId));
  if (playerMatch) {
    const [, playerId, date, slug] = playerMatch;
    return playerOutputPath(playerId, date, slug ?? DEFAULT_RUN_SLUG, suffix);
  }
  const prematchMatch = PREMATCH_FIXTURE_PATTERN.exec(String(fixtureId));
  if (prematchMatch) {
    const [, matchId, slug] = prematchMatch;
    return prematchOutputPath(matchId, slug ?? DEFAULT_RUN_SLUG, suffix);
  }
  const matchMatch = MATCH_FIXTURE_PATTERN.exec(String(fixtureId));
  if (!matchMatch) throw new Error(`Unrecognized fixture id: ${fixtureId}`);
  const [, matchId, slug] = matchMatch;
  return matchOutputPath(matchId, slug ?? DEFAULT_RUN_SLUG, suffix);
}

export function fixtureOutputDir(fixtureId) {
  return dirname(fixtureOutputPath(fixtureId));
}
