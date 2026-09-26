// Provider-agnostic match-data source for Ballsy.
//
// Backed by the SofaScore Python sidecar (scripts/sofascore/sofascore.py), which
// handles the Cloudflare-bypass request and emits a neutral event shape. If the
// source ever changes, only the sidecar changes — callers keep this interface.

import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SIDECAR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sofascore');
const SIDECAR = join(SIDECAR_DIR, 'sofascore.py');
const PUBLIC_DIR = join(SIDECAR_DIR, '..', '..', 'public');

// Prefer the sidecar's own venv; fall back to a system python on PATH.
const VENV_PYTHON =
  process.platform === 'win32'
    ? join(SIDECAR_DIR, '.venv', 'Scripts', 'python.exe')
    : join(SIDECAR_DIR, '.venv', 'bin', 'python');
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python';

function runSidecar(args) {
  let stdout;
  try {
    stdout = execFileSync(PYTHON, [SIDECAR, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const detail = err.stderr || err.message;
    throw new Error(`SofaScore sidecar failed (${args.join(' ')}):\n${detail}`);
  }
  return JSON.parse(stdout);
}

/**
 * Fetch one match's normalized data + events.
 * @param {string|number} matchId SofaScore event id.
 * @returns {{fixtureId:string, home:string, away:string, homeId:number,
 *   awayId:number, tournamentId:number, homeColors:object, awayColors:object,
 *   homeScore:number, awayScore:number, status:string, date:number,
 *   tournament:string, season:string, events:Array<object>}}
 */
export function getMatch(matchId) {
  return runSidecar(['fetch', String(matchId)]);
}

/**
 * List finished matches of a league round (for match selection).
 * @returns {Array<{id:number, home:string, away:string, homeScore:number,
 *   awayScore:number, status:string, round:number, date:number}>}
 */
export function listRound(tournamentId, seasonId, round) {
  return runSidecar(['list', String(tournamentId), String(seasonId), String(round)]);
}

/**
 * The curated league list the picker opens on (scripts/sofascore/leagues.json).
 * @returns {Array<{id:number, name:string, category:string}>}
 */
export function getLeagues() {
  return runSidecar(['leagues']);
}

/**
 * Search leagues/tournaments by free-text name (e.g. "premier league"),
 * most-followed first.
 * @returns {Array<{id:number, name:string, category:string, userCount:number}>}
 */
export function searchTournaments(query) {
  return runSidecar(['search', query]);
}

/**
 * Seasons of a tournament, newest first, plus the newest one that actually has
 * finished matches (the newest season is often not started yet).
 * @returns {{seasons: Array<{id:number, name:string, year:string}>,
 *   defaultSeasonId: number|null}}
 */
export function getSeasons(tournamentId) {
  return runSidecar(['seasons', String(tournamentId)]);
}

/**
 * Finished matches of one round of a season, plus the season's round list.
 * Omit `roundKey` to get the most recently played round.
 * @returns {{rounds: Array<{key:string, round:number, name:string|null,
 *   slug:string|null, prefix:string|null, label:string}>,
 *   selectedRound: string|null,
 *   matches: Array<{id:number, home:string, away:string, homeScore:number,
 *     awayScore:number, round:number, date:number}>}}
 */
export function getSeasonMatches(tournamentId, seasonId, roundKey) {
  const args = ['matches', String(tournamentId), String(seasonId)];
  if (roundKey) args.push(String(roundKey));
  return runSidecar(args);
}

/**
 * Search players by free-text name (for the player-video picker),
 * most-followed first.
 * @returns {Array<{id:number, name:string, position:string,
 *   jerseyNumber:number, country:string, teamId:number, team:string}>}
 */
export function searchPlayers(query) {
  return runSidecar(['search-player', query]);
}

/**
 * Every tournament/season pair this player has stats for, each with its
 * seasons newest-first — lets a caller default to his current competition
 * instead of guessing one.
 * @returns {Array<{tournamentId:number, tournament:string,
 *   seasons: Array<{id:number, name:string, year:string}>}>}
 */
export function getPlayerSeasons(playerId) {
  return runSidecar(['player-seasons', String(playerId)]);
}

/**
 * A player's current hot/cold form, standalone (no anchor match) — the data
 * source for a player-focused video. `competitions` (optional) is one or
 * more {tournamentId, seasonId} pairs to pool form from AT ONCE (e.g. league
 * + Champions League together, for the Studio UI's multi-select picker) —
 * appearances from every one are merged into true chronological order
 * before any streak is counted, and season-cumulative stats are summed (or,
 * for rating, weighted-averaged by appearances) across the same set. Omit
 * it to default to the player's current club's current competition alone
 * (team is always read off the player's own profile, never passed in).
 * @param {Array<{tournamentId:number, seasonId:number}>} [competitions]
 * @returns {{profile:object, team:object,
 *   competitions:Array<{tournamentId:number, seasonId:number,
 *     tournament:string, seasonName:string}>, competition:string,
 *   appearances:number, withGoalOrAssist:number, withGoal:number,
 *   goals:number, assists:number, consecutiveWithGoalOrAssist:number,
 *   consecutiveWithGoal:number, recent:Array<{date:string, opponent:string,
 *     competition:string, goals:number, assists:number}>,
 *   missedMatchesInWindow:boolean, seasonStats:object,
 *   upcomingFixture:object|null}}
 */
export function getPlayerForm(playerId, competitions) {
  const args = ['player-form', String(playerId)];
  if (competitions && competitions.length > 0) {
    args.push(JSON.stringify(competitions));
  }
  return runSidecar(args);
}

/**
 * Search teams by free-text name (for the pre-match preview picker),
 * most-followed first.
 * @returns {Array<{id:number, name:string, code:string, color:string,
 *   country:string, userCount:number}>}
 */
export function searchTeams(query) {
  return runSidecar(['search-team', query]);
}

/**
 * The next scheduled fixture between two teams, found by paging team A's own
 * upcoming events — null if they aren't scheduled to meet any time soon.
 * @returns {{matchId:number, home:string, away:string, homeId:number,
 *   awayId:number, tournament:string, tournamentId:number, round:number|null,
 *   status:string, date:number}|null}
 */
export function getNextFixture(teamAId, teamBId) {
  return runSidecar(['next-fixture', String(teamAId), String(teamBId)]);
}

/**
 * One UPCOMING fixture plus the grounded pre-match context (form, h2h, team
 * streaks, table positions, personal angle) — the data source for a preview
 * video. Throws if the match isn't `notstarted`: previewing a match that has
 * already been played is a different video type (getMatch + a recap script).
 * @returns {{fixtureId:string, home:string, away:string, homeId:number,
 *   awayId:number, homeCode:string, awayCode:string, tournamentId:number,
 *   homeColors:object, awayColors:object, status:string, date:number,
 *   tournament:string, season:string, round:number|null, context:object}}
 */
export function getPrematch(matchId) {
  return runSidecar(['prematch', String(matchId)]);
}

// Badge/photo/logo images — downloaded once per id and cached to disk under
// public/ (Remotion reads public/ at render time; it can't fetch anything
// itself, so these must exist before a render starts). Each returns the path
// relative to public/ that staticFile() expects, or null if this id simply
// has no image on SofaScore (not every player/team does) or has no id at all
// (e.g. a script saved before homeId/awayId existed).
function ensureImage(kind, id, dir) {
  if (id == null) return null;
  const relPath = `${dir}/${id}.png`;
  const absPath = join(PUBLIC_DIR, relPath);
  if (existsSync(absPath)) return relPath;
  const result = runSidecar(['fetch-image', kind, String(id), absPath]);
  return result.ok ? relPath : null;
}

/** @returns {string|null} path relative to public/, or null if unavailable. */
export function ensureTeamBadge(teamId) {
  return ensureImage('team', teamId, 'badges');
}

/** @returns {string|null} path relative to public/, or null if unavailable. */
export function ensurePlayerPhoto(playerId) {
  return ensureImage('player', playerId, 'players');
}

/** @returns {string|null} path relative to public/, or null if unavailable. */
export function ensureTournamentLogo(tournamentId) {
  return ensureImage('tournament', tournamentId, 'competitions');
}
