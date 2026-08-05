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
 * @returns {{fixtureId:string, home:string, away:string, homeScore:number,
 *   awayScore:number, status:string, date:number, tournament:string,
 *   season:string, events:Array<object>}}
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
