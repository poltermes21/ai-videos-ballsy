// Shared path-building for rendered videos under out/ — the one place that
// decides the on-disk (and served-URL) layout, so index.mjs and player.mjs
// never compute it two slightly different ways. The frontend never
// recomputes any of this itself: every API response that reports a video's
// presence includes the ready-to-use `videoUrl`, built from these same
// segments, and the frontend just uses it verbatim.
//
// Layout:
//   out/matches/<tournament>/<season>/<round>/<runId>.mp4  (runId = matchId
//     for the default run, "<matchId>-<focusSlug>" for a focused one — see
//     scripts/lib/run-paths.mjs — so different focuses of the same match
//     never overwrite each other's render)
//   out/players/<playerId>/<runId>.mp4                     (runId = date for
//     the default run of that day, "<date>-<focusSlug>" for a focused one —
//     a player's form genuinely changes week to week, so each generation is
//     its own dated video rather than overwriting the last one)
//   out/prematch/<tournament>/<matchId>/<runSlug>.mp4      (a fixture PREVIEW
//     — its own top-level kind, never under matches/, so a preview and the
//     eventual recap of the same fixture can both exist)

import {slugify} from '../lib/run-paths.mjs';

export {slugify};

// Path segments (not yet joined) for a match video — tournament/season/round
// come from the script's own saved matchInfo, never a fresh SofaScore call,
// so this stays free even when called once per History row. `runId` is the
// full run id (see run-paths.mjs's buildMatchRunId), not necessarily the
// bare match id.
export function matchVideoSegments(matchInfo, runId) {
  const tournament = slugify(matchInfo?.tournament);
  const season = slugify(matchInfo?.season);
  const round = matchInfo?.round != null ? `round-${matchInfo.round}` : 'unknown-round';
  return [tournament, season, round, `${runId}.mp4`];
}

// `runId` is the date for the default run of a day, "<date>-<focusSlug>" for
// a focused one (see run-paths.mjs's buildPlayerRunId, minus its
// "player-<id>-" prefix which this folder layout already provides via the
// playerId segment).
export function playerVideoSegments(playerId, runId) {
  return [String(playerId), `${runId}.mp4`];
}

// Path segments for a fixture-PREVIEW video. Keyed by the real match id (one
// folder per fixture, holding its default run and any focused takes), under
// the tournament slug so browsing out/prematch/ by hand means something —
// same reasoning as matchVideoSegments, minus season/round, which a preview
// of a single upcoming fixture doesn't need to be findable by. `runSlug` is
// the run's own slug ('default' or a focus slug), not the full run id, since
// the matchId segment already carries the fixture.
export function prematchVideoSegments(matchInfo, matchId, runSlug) {
  const tournament = slugify(matchInfo?.tournament);
  return [tournament, String(matchId), `${runSlug}.mp4`];
}
