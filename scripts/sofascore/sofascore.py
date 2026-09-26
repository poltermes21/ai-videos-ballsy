"""
SofaScore sidecar for Ballsy — minimal, headless, provider-agnostic output.

Distilled from the request technique of the tunjayoff/sofascore_scraper repo
(MIT). We keep ONLY the Cloudflare-bypass request layer (curl_cffi + Chrome
impersonation) and the three event endpoints; everything is normalized to a
neutral shape the Node pipeline consumes. No UI, no CSV, no local store.

Usage:
  python sofascore.py fetch <matchId>
      -> normalized match + events JSON to stdout
  python sofascore.py list <tournamentId> <seasonId> <round>
      -> finished matches of that round (id/teams/score/date) to stdout
  python sofascore.py leagues
      -> the curated league list (leagues.json) to stdout
  python sofascore.py search <query>
      -> leagues/tournaments matching the name (id/name/category) to stdout
  python sofascore.py seasons <tournamentId>
      -> {seasons: [...newest first], defaultSeasonId} to stdout
  python sofascore.py matches <tournamentId> <seasonId> [roundKey]
      -> {rounds, selectedRound, matches} for one round of that season
  python sofascore.py fetch-image <team|player|tournament> <id> <outPath>
      -> downloads that badge/photo/logo to outPath; {"ok": true/false} to stdout
  python sofascore.py search-player <query>
      -> players matching the name (id/name/team/position) to stdout
  python sofascore.py player-seasons <playerId>
      -> [{tournamentId, tournament, seasons: [...newest first]}] to stdout
  python sofascore.py player-form <playerId> [competitionsJson]
      -> standalone hot/cold form report for a player video (no anchor match);
         competitionsJson (optional) is a JSON array of
         [{"tournamentId":, "seasonId":}, ...] to pool form from several
         competitions at once (e.g. league + Champions League); omitted,
         defaults to the player's current club's current competition alone
  python sofascore.py search-team <query>
      -> teams matching the name (id/name/code/country) to stdout
  python sofascore.py next-fixture <teamAId> <teamBId>
      -> the next scheduled fixture between those two teams, or null
  python sofascore.py prematch <matchId>
      -> an UPCOMING fixture + pre-match context (form/h2h/streaks/standings)
         for a preview video; errors if the match isn't 'notstarted'

Requires: curl_cffi  (pip install -r requirements.txt)
"""

import json
import os
import random
import re
import sys
import time
from urllib.parse import quote

from curl_cffi import requests as cffi

BASE = "https://www.sofascore.com/api/v1"

# Curated leagues the picker opens on — the reference scraper browses a fixed
# list of tournament ids (its config/leagues.txt) instead of relying on a fuzzy
# text search, which is both faster and immune to search ranking changes.
LEAGUES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "leagues.json")

HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.sofascore.com/",
    "Origin": "https://www.sofascore.com",
    # Without this XHR marker SofaScore returns 403 {"reason":"challenge"}.
    "X-Requested-With": "XMLHttpRequest",
}

# curl_cffi TLS-fingerprint profiles (bump these if Cloudflare tightens).
IMPERSONATE = ["chrome131", "chrome136", "chrome142", "chrome145"]

MAX_RETRIES = 4


def api_get(path):
    """GET a SofaScore API path with Chrome impersonation + backoff on 403/429."""
    url = f"{BASE}{path}"
    for attempt in range(MAX_RETRIES):
        try:
            r = cffi.get(
                url,
                headers=HEADERS,
                impersonate=random.choice(IMPERSONATE),
                timeout=25,
            )
        except Exception as e:  # network / curl error
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 * (attempt + 1))
            continue

        if r.status_code == 200:
            return r.json()
        if r.status_code == 404:
            return None
        if r.status_code in (403, 429, 503):
            # Cloudflare / rate limit — back off and retry with a fresh profile.
            time.sleep(min(30, 5 * (2 ** attempt)))
            continue
        # other 4xx/5xx
        if attempt == MAX_RETRIES - 1:
            raise RuntimeError(f"HTTP {r.status_code} for {path}")
        time.sleep(2 * (attempt + 1))
    return None


def fetch_image_bytes(path):
    """GET a SofaScore image path (team/player/tournament badge) — same
    Cloudflare-bypass as api_get, but raw bytes instead of JSON. Returns None
    on 404 (id has no image) rather than raising, same convention as api_get.
    """
    url = f"{BASE}{path}"
    for attempt in range(MAX_RETRIES):
        try:
            r = cffi.get(
                url,
                headers=HEADERS,
                impersonate=random.choice(IMPERSONATE),
                timeout=25,
            )
        except Exception:
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(2 * (attempt + 1))
            continue

        if r.status_code == 200:
            return r.content
        if r.status_code == 404:
            return None
        if r.status_code in (403, 429, 503):
            time.sleep(min(30, 5 * (2 ** attempt)))
            continue
        if attempt == MAX_RETRIES - 1:
            raise RuntimeError(f"HTTP {r.status_code} for {path}")
        time.sleep(2 * (attempt + 1))
    return None


# ---------------------------------------------------------------------------
# Normalization: SofaScore incidents -> neutral event shape
# ---------------------------------------------------------------------------

def _pname(obj):
    return (obj or {}).get("name")


def _to_int(n):
    try:
        return int(n) if n is not None else None
    except (ValueError, TypeError):
        return n


def _to_float(n):
    try:
        return float(n) if n is not None else None
    except (ValueError, TypeError):
        return n


def _number(player, numbers=None):
    """Shirt number from a player object, falling back to the lineups map by id."""
    p = player or {}
    n = p.get("jerseyNumber")
    if n is None and numbers is not None:
        n = numbers.get(p.get("id"))
    return _to_int(n)


def build_number_map(lineups):
    """Map player id -> shirt number from the lineups endpoint (fills gaps)."""
    numbers = {}
    if not isinstance(lineups, dict):
        return numbers
    for side in ("home", "away"):
        for entry in (lineups.get(side) or {}).get("players") or []:
            pl = entry.get("player") or {}
            num = entry.get("shirtNumber") or pl.get("jerseyNumber")
            if pl.get("id") is not None and num is not None:
                numbers[pl["id"]] = num
    return numbers


def build_team_map(lineups, home_id, away_id):
    """Map player id -> the team id he played for IN THIS MATCH.

    The incident feed's `isHome` marks which side an incident *benefits*, which
    is the wrong team for an own goal — the lineups give the real allegiance.
    Note it's the *side* a player is listed under that says who he played for:
    each entry's own `teamId` is his club TODAY, so on an older fixture it
    reads back as whoever he has since transferred to.
    """
    teams = {}
    if not isinstance(lineups, dict):
        return teams
    for side, team_id in (("home", home_id), ("away", away_id)):
        for entry in (lineups.get(side) or {}).get("players") or []:
            pl = entry.get("player") or {}
            if pl.get("id") is not None:
                teams[pl["id"]] = team_id
    return teams


# ---------------------------------------------------------------------------
# Pre-match + match "context" for the script (grounded facts the LLM can cite)
# ---------------------------------------------------------------------------

# SofaScore statistics key -> compact name we expose. Curated to what tells the
# story of a match (verified key strings against real statistics.json).
STAT_KEYS = {
    "ballPossession": "possession",
    "totalShotsOnGoal": "shots",       # SofaScore's "Total shots"
    "shotsOnGoal": "shotsOnTarget",    # "Shots on target"
    "expectedGoals": "xg",
    "cornerKicks": "corners",
    "goalkeeperSaves": "saves",
}


def build_stats(stats_json):
    """Curated match totals {name: {home, away}} from the statistics endpoint."""
    if not isinstance(stats_json, dict):
        return None
    periods = stats_json.get("statistics") or []
    allp = next((p for p in periods if p.get("period") == "ALL"), None)
    if allp is None and periods:
        allp = periods[0]
    if not allp:
        return None
    out = {}
    for group in allp.get("groups") or []:
        for it in group.get("statisticsItems") or []:
            name = STAT_KEYS.get(it.get("key"))
            if name and name not in out:
                out[name] = {"home": it.get("homeValue"), "away": it.get("awayValue")}
    return out or None


def build_form(form_json):
    """Each team's pre-match form: position, points, last-5, avg rating."""
    if not isinstance(form_json, dict):
        return None

    def side(t):
        if not isinstance(t, dict):
            return None
        return {
            "position": t.get("position"),
            "points": _to_int(t.get("value")),
            "last5": "".join(t.get("form") or []),
            "rating": _to_float(t.get("avgRating")),
        }

    home, away = side(form_json.get("homeTeam")), side(form_json.get("awayTeam"))
    return {"home": home, "away": away} if (home or away) else None


def build_h2h(h2h_json):
    """Head-to-head record between the two teams."""
    td = h2h_json.get("teamDuel") if isinstance(h2h_json, dict) else None
    if not isinstance(td, dict):
        return None
    return {
        "homeWins": td.get("homeWins"),
        "draws": td.get("draws"),
        "awayWins": td.get("awayWins"),
    }


# ---------------------------------------------------------------------------
# Player streaks: was a scorer/assister here already on a run coming in?
# ---------------------------------------------------------------------------
#
# /player/{id}/events/last/0 returns a player's recent matches across EVERY
# competition he appears in — league, cup, Champions League and full
# international duty all in one list. A raw "last N matches" run off that list
# is meaningless (it would blend a World Cup goal into a LaLiga streak), so
# every appearance is filtered down to the same competition, same season and
# same club as the match being narrated before anything is counted.
#
# The same payload carries three side maps keyed by event id, which is why one
# request per player is enough: `statisticsMap` (rating/minutesPlayed — absent
# for an unused sub or a match he wasn't in), `playedForTeamMap` (which club
# he turned out for, so a transfer can't carry a streak over) and
# `incidentsMap` ({goals, assists, penaltyGoals, ownGoals, yellowCards}).

STREAK_WINDOW = 6             # appearances looked back over
STREAK_MIN_APPEARANCES = 3    # below this there isn't enough history to judge
STREAK_MIN_RUN = 3            # consecutive involvements that count as a run
# ...or, without needing to be consecutive, this many involvements inside the
# window — catches a player who's clearly hot but has a blank game mixed in
# (goal, blank, goal, blank, goal is nobody's "streak" by the strict count,
# but it's still 3 goal involvements out of his last 6 and worth mentioning).
STREAK_MIN_INVOLVED = 3
# Anything older than this is stale form, not a current run. Belt-and-braces
# with the same-season filter: it also kills a streak stitched across a
# mid-season injury lay-off or a long international break.
STREAK_MAX_AGE_DAYS = 90
# events/last/{page} returns 30 matches, newest page first. A recent fixture
# needs only page 0, but this pipeline is regularly run against older test
# fixtures whose window sits entirely behind page 0 — so page back until the
# window is covered, with a hard cap.
STREAK_MAX_PAGES = 4


def _ymd(ts):
    return time.strftime("%Y-%m-%d", time.gmtime(ts)) if ts else None


def match_contributors(raw_incidents, team_map, home_id, away_id):
    """Players with a real goal or assist in THIS match: [{id, name, teamId}].

    Own goals are skipped — nobody is "on a run" of scoring past his own
    keeper, and the scorer plays for the side the goal is credited against.
    """
    found = {}

    def add(player, fallback_team):
        pid = (player or {}).get("id")
        if pid is not None and pid not in found:
            found[pid] = {
                "id": pid,
                "name": player.get("name"),
                "teamId": team_map.get(pid, fallback_team),
            }

    for it in raw_incidents or []:
        if it.get("incidentType") != "goal" or it.get("incidentClass") == "ownGoal":
            continue
        scored_for = home_id if it.get("isHome") else away_id
        add(it.get("player"), scored_for)
        add(it.get("assist1"), scored_for)
    return list(found.values())


def _player_appearances(player_id, team_id, tournament_id, season_id, before_ts, limit=STREAK_WINDOW):
    """This player's last few appearances before `before_ts`, newest first.

    Restricted to the same competition, season and club — see the note above.
    `limit=None` returns the full window uncapped, used when merging several
    competitions together (see _merge_player_appearances) where the final
    trim has to happen AFTER merging, not per-competition.
    """
    cutoff = before_ts - STREAK_MAX_AGE_DAYS * 86400
    rows = []
    for page in range(STREAK_MAX_PAGES):
        data = api_get(f"/player/{player_id}/events/last/{page}")
        if not isinstance(data, dict):
            break
        stats = data.get("statisticsMap") or {}
        played_for = data.get("playedForTeamMap") or {}
        incidents = data.get("incidentsMap") or {}
        page_events = data.get("events") or []

        for e in page_events:
            ts, key = e.get("startTimestamp"), str(e.get("id"))
            if not ts or ts >= before_ts or ts < cutoff:
                continue  # the match itself, anything after it, or stale form
            ut = (e.get("tournament") or {}).get("uniqueTournament") or {}
            if ut.get("id") != tournament_id:
                continue
            if (e.get("season") or {}).get("id") != season_id:
                continue
            if played_for.get(key) != team_id:
                continue
            if not (stats.get(key) or {}).get("minutesPlayed"):
                continue  # named in the squad but didn't actually feature
            inc = incidents.get(key) or {}
            home, away = e.get("homeTeam") or {}, e.get("awayTeam") or {}
            opponent = away if home.get("id") == team_id else home
            rows.append({
                "date": _ymd(ts),
                "timestamp": ts,
                "opponent": _pname(opponent),
                "competition": ut.get("name"),
                # `goals` excludes own goals (SofaScore keys those separately).
                "goals": _to_int(inc.get("goals")) or 0,
                "assists": _to_int(inc.get("assists")) or 0,
            })

        # Pages run newest-first, so once one reaches past the cutoff every
        # later page does too — the window is fully covered, stop requesting.
        oldest = min((e.get("startTimestamp") or 0) for e in page_events) if page_events else 0
        if oldest < cutoff or not data.get("hasNextPage"):
            break

    rows.sort(key=lambda r: r["timestamp"], reverse=True)
    return rows[:limit] if limit else rows


def _merge_player_appearances(player_id, team_id, competitions, before_ts, limit=STREAK_WINDOW):
    """Same shape as _player_appearances, but pooled across MULTIPLE
    competitions (e.g. league + Champions League selected together) and
    re-sorted into true chronological order before trimming — so a
    consecutive-run count spans real match order across competitions instead
    of each competition's own last few games being stitched together
    end-to-end.
    """
    rows = []
    for c in competitions:
        rows.extend(
            _player_appearances(player_id, team_id, c["tournamentId"], c["seasonId"], before_ts, limit=None)
        )
    rows.sort(key=lambda r: r["timestamp"], reverse=True)
    return rows[:limit] if limit else rows


def _absence_in_window(player_id, start_ts, end_ts):
    """True if the player was injured or missed a match inside the window.

    A calendar gap between two appearances is usually just the fixture list (an
    international break, a midweek round he was rested for), so it's a bad
    injury signal. /player/{id}/last-year-summary is the real one: it
    interleaves explicit "injury" and "missing" entries with the rated "event"
    entries. Only called for players who already cleared the notability bar.
    """
    data = api_get(f"/player/{player_id}/last-year-summary")
    for it in (data or {}).get("summary") or []:
        if it.get("type") not in ("injury", "missing"):
            continue
        ts = it.get("timestamp")
        if ts and start_ts < ts < end_ts:
            return True
    return False


# events/last/{page} for a TEAM returns 30 raw events per page across EVERY
# competition that team plays (league, cups, continental, friendlies) —
# same-tournament matches are a fraction of each page, not all of it, so
# finding a full season's worth of just-the-league results needs more pages
# than the player-streak window does. High enough that a real double-digit
# win/loss streak (or a team that's played the whole season unbeaten) is
# never cut short by running out of pages before hasNextPage says to stop.
TEAM_STREAK_MAX_PAGES = 8


def _team_results(team_id, tournament_id, season_id, before_ts):
    """This team's match results in the SAME competition+season, before
    `before_ts`, newest first — ["W", "L", "D", ...].

    /event/{id}/pregame-form's own "form" field (used for the general
    "how did they come in" context) is capped at exactly 5 entries by
    SofaScore itself and isn't guaranteed to be scoped to this competition —
    real streaks longer than 5 (win OR loss), or a competition-specific run
    (e.g. 7 wins in a row in the league while also playing Champions League
    in between), are invisible to it. This walks the team's own match history
    instead, same same-competition/same-season discipline as
    _player_appearances, so a streak claim can be a real counted number
    instead of "however many of the 5 happen to be wins" — and can be
    negative news (a losing/winless run) just as easily as a good one.
    """
    rows = []
    for page in range(TEAM_STREAK_MAX_PAGES):
        data = api_get(f"/team/{team_id}/events/last/{page}")
        if not isinstance(data, dict):
            break
        for e in data.get("events") or []:
            ts = e.get("startTimestamp")
            if not ts or ts >= before_ts:
                continue  # this match itself, or anything after it
            ut = (e.get("tournament") or {}).get("uniqueTournament") or {}
            if ut.get("id") != tournament_id:
                continue
            if (e.get("season") or {}).get("id") != season_id:
                continue
            home, away = e.get("homeTeam") or {}, e.get("awayTeam") or {}
            hs = (e.get("homeScore") or {}).get("current")
            aws = (e.get("awayScore") or {}).get("current")
            if hs is None or aws is None:
                continue  # not actually finished/scored
            is_home = home.get("id") == team_id
            gf, ga = (hs, aws) if is_home else (aws, hs)
            result = "W" if gf > ga else "L" if gf < ga else "D"
            rows.append((ts, result))
        if not data.get("hasNextPage"):
            break
    rows.sort(key=lambda r: r[0], reverse=True)
    return [r[1] for r in rows]


def _current_streak(results, predicate):
    """How many of `results` (newest first) satisfy `predicate`, counting
    from the front until the first one that doesn't."""
    count = 0
    for r in results:
        if not predicate(r):
            break
        count += 1
    return count


def build_team_streaks(event, home_id, away_id):
    """Each team's real current run in the SAME competition and season,
    counting backward from (not including) this match — see _team_results
    for why this exists instead of just using form.last5. Reports both
    directions (win/unbeaten AND loss/winless) since the real story might be
    either — a team can just as easily be telling a bad-form story as a good
    one, and this must never quietly only look for good news.
    """
    before_ts = event.get("startTimestamp")
    tournament_id = (((event.get("tournament") or {}).get("uniqueTournament")) or {}).get("id")
    season_id = (event.get("season") or {}).get("id")
    if not (before_ts and tournament_id and season_id):
        return None

    def side(team_id):
        if not team_id:
            return None
        results = _team_results(team_id, tournament_id, season_id, before_ts)
        if not results:
            return None
        return {
            "matchesConsidered": len(results),
            "winStreak": _current_streak(results, lambda r: r == "W"),
            "unbeatenStreak": _current_streak(results, lambda r: r != "L"),
            "lossStreak": _current_streak(results, lambda r: r == "L"),
            "winlessStreak": _current_streak(results, lambda r: r != "W"),
        }

    home, away = side(home_id), side(away_id)
    return {"home": home, "away": away} if (home or away) else None


def build_player_streaks(raw_incidents, lineups, event):
    """Notable pre-match goal/assist runs for this match's scorers/assisters.

    Returns a list (one entry per player) or None. Only players who actually
    contributed a goal or assist HERE are looked up — a run only earns a
    mention when it's the backstory to something being narrated — and only
    runs clearing STREAK_MIN_RUN / STREAK_MIN_INVOLVED are returned, so an
    unremarkable player simply doesn't appear.
    """
    before_ts = event.get("startTimestamp")
    tournament_id = (((event.get("tournament") or {}).get("uniqueTournament")) or {}).get("id")
    season_id = (event.get("season") or {}).get("id")
    home, away = event.get("homeTeam") or {}, event.get("awayTeam") or {}
    if not (before_ts and tournament_id and season_id):
        return None

    team_map = build_team_map(lineups, home.get("id"), away.get("id"))
    names = {home.get("id"): _pname(home), away.get("id"): _pname(away)}
    competition = (((event.get("tournament") or {}).get("uniqueTournament")) or {}).get("name")

    out = []
    for player in match_contributors(raw_incidents, team_map, home.get("id"), away.get("id")):
        apps = _player_appearances(
            player["id"], player["teamId"], tournament_id, season_id, before_ts
        )
        if len(apps) < STREAK_MIN_APPEARANCES:
            continue

        involved = [a for a in apps if a["goals"] or a["assists"]]
        run = 0
        for a in apps:  # newest first, so this is the run leading INTO this match
            if not (a["goals"] or a["assists"]):
                break
            run += 1
        scoring_run = 0
        for a in apps:
            if not a["goals"]:
                break
            scoring_run += 1

        if run < STREAK_MIN_RUN and len(involved) < STREAK_MIN_INVOLVED:
            continue  # not genuinely notable — don't hand the model filler

        out.append({
            "player": player["name"],
            "team": names.get(player["teamId"]),
            "competition": competition,
            "appearances": len(apps),
            "withGoalOrAssist": len(involved),
            "withGoal": sum(1 for a in apps if a["goals"]),
            "goals": sum(a["goals"] for a in apps),
            "assists": sum(a["assists"] for a in apps),
            "consecutiveWithGoalOrAssist": run,
            "consecutiveWithGoal": scoring_run,
            "recent": [
                {k: a[k] for k in ("date", "opponent", "goals", "assists")} for a in apps
            ],
            "missedMatchesInWindow": _absence_in_window(
                player["id"], apps[-1]["timestamp"], before_ts
            ),
        })

    # Strongest run first, so the model reads the most tellable one first.
    out.sort(key=lambda s: (s["consecutiveWithGoalOrAssist"], s["goals"]), reverse=True)
    return out or None


# Ballsy's own team loyalties — real, not neutral (see CLAUDE.md/README for
# the reasoning). Each favourite team maps to the ONE competition its table
# position gets checked against below — a team is only ever "watched" in its
# own league, never e.g. a Champions League table.
FAVORITE_TEAMS = {
    35: {"name": "Manchester United", "tournamentId": 17},  # Premier League
    2817: {"name": "FC Barcelona", "tournamentId": 8},  # LaLiga
}
RIVAL_TEAM_NAMES = {
    2829: "Real Madrid",
    17: "Manchester City",
    1644: "Paris Saint-Germain",
}


def build_personal_angle(home_id, away_id):
    """One of Ballsy's own teams, or a hated rival, playing in THIS match —
    cheap (no extra request), checked before the pricier build_personal_watch.
    """
    for team_id, favorite in FAVORITE_TEAMS.items():
        if team_id in (home_id, away_id):
            return {"type": "favorite", "team": favorite["name"]}
    for team_id, name in RIVAL_TEAM_NAMES.items():
        if team_id in (home_id, away_id):
            return {"type": "rival", "team": name}
    return None


def _standings_rows(tournament_id, season_id):
    """The total-standings table for one competition/season, keyed by team id.

    One request, shared by every caller that needs a table row — the
    post-match gap maths in build_personal_watch and the pre-match table
    snapshot in _standings_snapshot both read the exact same rows, so a
    preview and a recap of the same fixture can never disagree about where a
    team sits.
    """
    standings = api_get(f"/unique-tournament/{tournament_id}/season/{season_id}/standings/total")
    rows = ((standings or {}).get("standings") or [{}])[0].get("rows") or []
    return {r.get("team", {}).get("id"): r for r in rows if r.get("team", {}).get("id") is not None}


def _standings_snapshot(tournament_id, season_id, team_id, rows=None):
    """One team's current league position/points/played, or None if the table
    doesn't have them (a cup tie, a team not in this competition's table).

    Pass `rows` (an already-fetched _standings_rows map) when looking up more
    than one team from the same table, so two teams in the same fixture cost
    one request instead of two.
    """
    if not (tournament_id and season_id and team_id):
        return None
    if rows is None:
        rows = _standings_rows(tournament_id, season_id)
    row = rows.get(team_id)
    if not row:
        return None
    return {
        "position": row.get("position"),
        "points": _to_int(row.get("points")),
        "played": _to_int(row.get("matches")),
    }


def build_personal_watch(event, home_id, away_id):
    """Whether tonight's result moves the table gap between one of Ballsy's
    own teams and whoever's actually playing — only called when NEITHER
    playing team is one of his own or a rival (build_personal_angle already
    covers that, more directly). Grounded in real standings: reconstructs
    each playing team's PRE-match points from their CURRENT standings row
    minus what tonight's own result earned them, so the gap-before/gap-after
    comparison is exact, not estimated or guessed at.
    """
    home_score = (event.get("homeScore") or {}).get("current")
    away_score = (event.get("awayScore") or {}).get("current")
    if home_score is None or away_score is None:
        return None
    tournament_id = (((event.get("tournament") or {}).get("uniqueTournament")) or {}).get("id")
    season_id = (event.get("season") or {}).get("id")
    if not tournament_id or not season_id:
        return None

    favorite = next((f for f in FAVORITE_TEAMS.values() if f["tournamentId"] == tournament_id), None)
    if not favorite:
        return None  # Ballsy has no team in this match's own competition

    by_id = _standings_rows(tournament_id, season_id)

    favorite_id = next((tid for tid, r in by_id.items() if r.get("team", {}).get("name") == favorite["name"]), None)
    if favorite_id is None or favorite_id in (home_id, away_id):
        return None  # the favourite team IS one of tonight's two — build_personal_angle handles that case
    favorite_points = _to_int(by_id[favorite_id].get("points"))
    if favorite_points is None:
        return None

    draw = home_score == away_score
    home_won = home_score > away_score
    candidates = []
    for team_id, won in ((home_id, home_won and not draw), (away_id, (not home_won) and not draw)):
        row = by_id.get(team_id)
        points_after = _to_int(row.get("points")) if row else None
        if points_after is None:
            continue
        points_before = points_after - (1 if draw else (3 if won else 0))
        candidates.append({
            "team": row.get("team", {}).get("name"),
            "position": row.get("position"),
            "pointsBefore": points_before,
            "pointsAfter": points_after,
            "gapBefore": favorite_points - points_before,
            "gapAfter": favorite_points - points_after,
        })

    # Only surface a team whose gap to the favourite actually changed tonight
    # AND is close enough that anyone would call them rivals in the table —
    # a mid-table side forty points off doesn't have this angle.
    NEAR_ENOUGH_POINTS = 20
    watched = [
        c for c in candidates
        if c["gapBefore"] != c["gapAfter"] and min(abs(c["gapBefore"]), abs(c["gapAfter"])) <= NEAR_ENOUGH_POINTS
    ]
    if not watched:
        return None
    watched.sort(key=lambda c: min(abs(c["gapBefore"]), abs(c["gapAfter"])))
    closest = watched[0]
    return {
        "favoriteTeam": favorite["name"],
        "favoriteTeamPosition": by_id[favorite_id].get("position"),
        "favoriteTeamPoints": favorite_points,
        **closest,
    }


# Missed-penalty reason -> Ballsy penalty outcome. This is the mapping we
# verified on real matches: goalkeeperSave / woodwork / offTarget.
PENALTY_MISS_OUTCOME = {
    "goalkeeperSave": "saved",
    "woodwork": "post",
    "offTarget": "out",
    "wide": "out",
    "missed": "out",
}


def normalize_incident(it, numbers=None):
    """Return a neutral event dict, or None to skip (period markers, etc.)."""
    t = it.get("incidentType")
    minute = it.get("time")
    team = "home" if it.get("isHome") else "away"

    if t == "goal":
        penalty = it.get("incidentClass") == "penalty" or it.get("from") == "penalty"
        scorer = it.get("player") or {}
        return {
            "type": "goal",
            "minute": minute,
            "team": team,
            "player": _pname(scorer),
            # id/number let the Node side fetch a real photo (fetch-image
            # player) and badge the scorer's shirt, same as substitutions
            # already do — absent for an own goal (SofaScore omits `player`).
            "playerId": scorer.get("id"),
            "playerNumber": _number(scorer, numbers),
            "penalty": bool(penalty),
            "ownGoal": it.get("incidentClass") == "ownGoal",
            "homeScore": it.get("homeScore"),
            "awayScore": it.get("awayScore"),
            "assist": _pname(it.get("assist1")),
        }

    if t == "inGamePenalty" and it.get("incidentClass") == "missed":
        reason = it.get("reason")
        return {
            "type": "penalty_missed",
            "minute": minute,
            "team": team,
            "player": _pname(it.get("player")),
            "reason": reason,
            "outcome": PENALTY_MISS_OUTCOME.get(reason, "saved"),
        }

    if t == "card":
        cls = it.get("incidentClass")
        card_type = "red" if cls in ("red", "yellowRed") else "yellow"
        return {
            "type": "card",
            "minute": minute,
            "team": team,
            "cardType": card_type,
            "secondYellow": cls == "yellowRed",
            "player": _pname(it.get("player")) or _pname(it.get("manager")),
            "isManager": it.get("manager") is not None,
            "reason": it.get("reason"),
            "rescinded": bool(it.get("rescinded")),
        }

    if t == "substitution":
        pin = it.get("playerIn") or {}
        pout = it.get("playerOut") or {}
        return {
            "type": "substitution",
            "minute": minute,
            "team": team,
            "in": {"name": _pname(pin), "number": _number(pin, numbers)},
            "out": {"name": _pname(pout), "number": _number(pout, numbers)},
        }

    if t == "varDecision":
        return {
            "type": "var",
            "minute": minute,
            "team": team,
            "decision": it.get("incidentClass"),  # goalAwarded, penaltyNotAwarded, ...
            "player": _pname(it.get("player")),
            "confirmed": it.get("confirmed"),
        }

    return None  # period, injuryTime, or unknown -> skip


def cmd_fetch(match_id):
    ev = api_get(f"/event/{match_id}")
    if not ev or "event" not in ev:
        raise SystemExit(f"Could not fetch event {match_id} (bad id or blocked).")
    e = ev["event"]

    inc = api_get(f"/event/{match_id}/incidents") or {}
    raw = inc.get("incidents", []) if isinstance(inc, dict) else (inc or [])
    # Lineups fill shirt numbers the incident feed sometimes omits (late subs),
    # and say which team each player actually turned out for.
    lineups = api_get(f"/event/{match_id}/lineups")
    numbers = build_number_map(lineups)
    # Incidents come newest-first; emit chronological.
    events = [n for n in (normalize_incident(it, numbers) for it in reversed(raw)) if n]

    home_team = e.get("homeTeam") or {}
    away_team = e.get("awayTeam") or {}

    # Grounded context for the script: pre-match form, h2h, match stats, any
    # pre-match scoring run behind this match's goals/assists, and whether
    # tonight touches one of Ballsy's own team loyalties (see FAVORITE_TEAMS).
    context = {}
    form = build_form(api_get(f"/event/{match_id}/pregame-form"))
    h2h = build_h2h(api_get(f"/event/{match_id}/h2h"))
    stats = build_stats(api_get(f"/event/{match_id}/statistics"))
    streaks = build_player_streaks(raw, lineups, e)
    team_streaks = build_team_streaks(e, home_team.get("id"), away_team.get("id"))
    personal_angle = build_personal_angle(home_team.get("id"), away_team.get("id"))
    personal_watch = None if personal_angle else build_personal_watch(e, home_team.get("id"), away_team.get("id"))
    if form:
        context["form"] = form
    if h2h:
        context["h2h"] = h2h
    if stats:
        context["stats"] = stats
    if streaks:
        context["playerStreaks"] = streaks
    if team_streaks:
        context["teamStreaks"] = team_streaks
    if personal_angle:
        context["personalAngle"] = personal_angle
    if personal_watch:
        context["personalWatch"] = personal_watch

    status = e.get("status") or {}
    tournament = ((e.get("tournament") or {}).get("uniqueTournament") or {})
    out = {
        "fixtureId": str(match_id),
        "home": _pname(home_team),
        "away": _pname(away_team),
        # SofaScore's own 3-letter code (e.g. "TEL"), for the scoreboard graphic.
        "homeCode": home_team.get("nameCode"),
        "awayCode": away_team.get("nameCode"),
        # Team/tournament ids — needed to fetch real badge/logo images via
        # `fetch-image` (the images themselves aren't in this payload).
        "homeId": home_team.get("id"),
        "awayId": away_team.get("id"),
        "tournamentId": tournament.get("id"),
        # Real kit colors, straight off the team object already fetched here.
        "homeColors": home_team.get("teamColors"),
        "awayColors": away_team.get("teamColors"),
        "homeScore": (e.get("homeScore") or {}).get("current"),
        "awayScore": (e.get("awayScore") or {}).get("current"),
        "status": status.get("type"),
        "date": e.get("startTimestamp"),
        "tournament": tournament.get("name"),
        "season": (e.get("season") or {}).get("name"),
        "round": (e.get("roundInfo") or {}).get("round"),
        "context": context,
        "events": events,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


def build_prematch_context(event, home_id, away_id):
    """Everything grounded that describes how two teams ARRIVE at a fixture
    that hasn't been played yet — the pre-match sibling of cmd_fetch's own
    `context` dict.

    Deliberately has no `events` and no `stats`: neither exists before
    kick-off, and nothing downstream should expect them. Everything here is
    already fetched pre-match by design — /pregame-form and /h2h exist
    specifically to describe a match BEFORE it happens, and build_team_streaks
    only ever reads startTimestamp/tournament/season/team ids off `event`,
    never the score, so it works unchanged on a not-started fixture.
    """
    tournament_id = (((event.get("tournament") or {}).get("uniqueTournament")) or {}).get("id")
    season_id = (event.get("season") or {}).get("id")
    match_id = event.get("id")

    context = {}
    form = build_form(api_get(f"/event/{match_id}/pregame-form"))
    h2h = build_h2h(api_get(f"/event/{match_id}/h2h"))
    team_streaks = build_team_streaks(event, home_id, away_id)
    if form:
        context["form"] = form
    if h2h:
        context["h2h"] = h2h
    if team_streaks:
        context["teamStreaks"] = team_streaks

    if tournament_id and season_id:
        rows = _standings_rows(tournament_id, season_id)
        home_row = _standings_snapshot(tournament_id, season_id, home_id, rows)
        away_row = _standings_snapshot(tournament_id, season_id, away_id, rows)
        if home_row or away_row:
            context["standings"] = {"home": home_row, "away": away_row}

    personal_angle = build_personal_angle(home_id, away_id)
    if personal_angle:
        context["personalAngle"] = personal_angle
    return context


def cmd_prematch(match_id):
    """One UPCOMING fixture, with the grounded context for a preview video.

    Mirrors cmd_fetch's output shape minus everything that only exists after
    kick-off (score, incidents, lineups, match stats). Deliberately refuses a
    match that isn't `notstarted`: this command is specifically "preview a
    fixture that hasn't happened yet", not a general-purpose event fetch, and
    silently previewing a match already played would produce a script full of
    predictions about a known result.
    """
    ev = api_get(f"/event/{match_id}")
    if not ev or "event" not in ev:
        raise SystemExit(f"Could not fetch event {match_id} (bad id or blocked).")
    e = ev["event"]

    status = e.get("status") or {}
    if status.get("type") != "notstarted":
        raise SystemExit(
            # Plain ASCII on purpose: this message travels through stderr to
            # the Studio UI, and Windows' console encoding mangles non-ASCII
            # punctuation on the way (an em dash arrives as a replacement
            # character in the error banner).
            f"Event {match_id} is '{status.get('type')}', not 'notstarted' - "
            "a pre-match preview only makes sense for a fixture that hasn't been played yet."
        )

    home_team = e.get("homeTeam") or {}
    away_team = e.get("awayTeam") or {}
    tournament = ((e.get("tournament") or {}).get("uniqueTournament") or {})

    out = {
        "fixtureId": str(match_id),
        "home": _pname(home_team),
        "away": _pname(away_team),
        "homeCode": home_team.get("nameCode"),
        "awayCode": away_team.get("nameCode"),
        "homeId": home_team.get("id"),
        "awayId": away_team.get("id"),
        "tournamentId": tournament.get("id"),
        "homeColors": home_team.get("teamColors"),
        "awayColors": away_team.get("teamColors"),
        "status": status.get("type"),
        "date": e.get("startTimestamp"),
        "tournament": tournament.get("name"),
        "season": (e.get("season") or {}).get("name"),
        "round": (e.get("roundInfo") or {}).get("round"),
        "context": build_prematch_context(e, home_team.get("id"), away_team.get("id")),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


IMAGE_KIND_PATH = {
    "team": "/team/{id}/image",
    "player": "/player/{id}/image",
    "tournament": "/unique-tournament/{id}/image",
}


def cmd_fetch_image(kind, entity_id, out_path):
    """Downloads a team/player/tournament badge to out_path. Prints
    {"ok": true, "path": ...} on success or {"ok": false} if this id simply
    has no image on SofaScore (a 404, not an error) — Node treats that as
    "no badge available", not a failure to propagate.
    """
    if kind not in IMAGE_KIND_PATH:
        raise SystemExit(f"Unknown image kind {kind!r}, expected one of {list(IMAGE_KIND_PATH)}")
    path = IMAGE_KIND_PATH[kind].format(id=entity_id)
    content = fetch_image_bytes(path)
    if content is None:
        print(json.dumps({"ok": False}))
        return
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(content)
    print(json.dumps({"ok": True, "path": out_path}))


def cmd_player_seasons(player_id):
    """Every tournament/season pair this player has stats for, newest first
    per tournament — lets the picker default to his current competition
    instead of a hardcoded one."""
    data = api_get(f"/player/{player_id}/statistics/seasons")
    out = []
    for entry in (data or {}).get("uniqueTournamentSeasons") or []:
        ut = entry.get("uniqueTournament") or {}
        seasons = sorted(
            entry.get("seasons") or [],
            key=lambda s: _sortable_year(s.get("year")),
            reverse=True,
        )
        if not ut.get("id") or not seasons:
            continue
        out.append({
            "tournamentId": ut.get("id"),
            "tournament": ut.get("name"),
            "seasons": [{"id": s.get("id"), "name": s.get("name"), "year": s.get("year")} for s in seasons],
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))


def _sum_stat(values):
    """Adds up a counting stat (goals, minutes, shots, ...) across however
    many competitions were selected, treating a missing value as 0 — but
    returns None (not 0) if EVERY competition was missing it, so an absent
    stat still reads as absent rather than a suspicious zero."""
    present = [v for v in values if v is not None]
    return sum(present) if present else None


def _weighted_avg_rating(pairs):
    """A per-90 rating isn't additive across competitions — averaging it
    weighted by appearances (not a flat mean) means a competition he's
    barely played in doesn't skew it as much as his main one."""
    usable = [(v, w) for v, w in pairs if v is not None and w]
    total_weight = sum(w for _, w in usable)
    if not total_weight:
        return None
    return round(sum(v * w for v, w in usable) / total_weight, 2)


def cmd_player_form(player_id, competitions_json=None):
    """A player's current hot/cold form, standalone — no anchor match.

    Reuses the exact same appearance-window/streak-counting logic
    build_player_streaks() applies to a match's scorers, just entered
    directly with an explicit player/competition/season instead of being
    derived from who scored in some other match. `team_id` is never passed
    in — it's always read off the player's own CURRENT club in his profile,
    since that's the one club whose appearances his recent form should
    count.

    `competitions_json`, when given, is a JSON array of
    [{"tournamentId":, "seasonId":}, ...] — one or more competitions to pull
    form from AT ONCE (e.g. league + Champions League together), matching
    how the Studio UI's competition picker is multi-select. Appearances from
    every selected competition are pooled and re-sorted into true
    chronological order before any streak is counted (see
    _merge_player_appearances) — never each competition's last few games
    just stitched end to end. Season-cumulative stats are summed (or,
    for rating, weighted-averaged by appearances) across the same set.
    Omitted entirely, this defaults to a single competition: the player's
    current club's current competition (probed via /statistics/seasons), so
    `player-form <id>` alone still works for the common case.
    """
    player_id = int(player_id)
    profile_data = api_get(f"/player/{player_id}")
    player = (profile_data or {}).get("player")
    if not player:
        raise SystemExit(f"Could not fetch player {player_id} (bad id or blocked).")
    team_id = (player.get("team") or {}).get("id")
    if not team_id:
        raise SystemExit(f"Player {player_id} has no current club on SofaScore.")

    seasons_data = api_get(f"/player/{player_id}/statistics/seasons")
    entries = (seasons_data or {}).get("uniqueTournamentSeasons") or []
    # tournamentId -> {name, seasons: {seasonId: seasonName}} — used to
    # resolve display names for whichever competitions end up selected,
    # whether that's the default single one or an explicit multi-select.
    by_tournament = {}
    for entry in entries:
        ut = entry.get("uniqueTournament") or {}
        if not ut.get("id"):
            continue
        by_tournament[ut["id"]] = {
            "name": ut.get("name"),
            "seasons": {s["id"]: s.get("name") for s in (entry.get("seasons") or []) if s.get("id")},
        }

    if competitions_json:
        requested = json.loads(competitions_json)
        competitions = [
            {"tournamentId": int(c["tournamentId"]), "seasonId": int(c["seasonId"])} for c in requested
        ]
    else:
        if not entries:
            raise SystemExit(f"No season statistics available for player {player_id}.")
        current_tournament_id = (
            ((player.get("team") or {}).get("tournament") or {}).get("uniqueTournament") or {}
        ).get("id")
        entry = next(
            (e for e in entries if (e.get("uniqueTournament") or {}).get("id") == current_tournament_id),
            entries[0],
        )
        default_tournament_id = (entry.get("uniqueTournament") or {}).get("id")
        seasons_sorted = sorted(
            entry.get("seasons") or [], key=lambda s: _sortable_year(s.get("year")), reverse=True
        )
        default_season_id = seasons_sorted[0]["id"] if seasons_sorted else None
        if not default_tournament_id or not default_season_id:
            raise SystemExit(f"Could not resolve a current competition/season for player {player_id}.")
        competitions = [{"tournamentId": default_tournament_id, "seasonId": default_season_id}]

    for c in competitions:
        info = by_tournament.get(c["tournamentId"]) or {}
        c["tournament"] = info.get("name")
        c["seasonName"] = (info.get("seasons") or {}).get(c["seasonId"])

    now = time.time()
    apps = (
        _player_appearances(player_id, team_id, competitions[0]["tournamentId"], competitions[0]["seasonId"], now)
        if len(competitions) == 1
        else _merge_player_appearances(player_id, team_id, competitions, now)
    )

    run = 0
    for a in apps:
        if not (a["goals"] or a["assists"]):
            break
        run += 1
    scoring_run = 0
    for a in apps:
        if not a["goals"]:
            break
        scoring_run += 1
    # Cold-streak mirrors — how many of his most recent appearances in a row
    # have NOT had a goal/assist (or specifically not a goal), counting back
    # from the most recent. Same idea as build_team_streaks' lossStreak/
    # winlessStreak: a player is just as often telling a drought story as a
    # hot one, and without a real counted number for it, "he's cold" has
    # nothing to actually be grounded in.
    blank_run = 0
    for a in apps:
        if a["goals"] or a["assists"]:
            break
        blank_run += 1
    goalless_run = 0
    for a in apps:
        if a["goals"]:
            break
        goalless_run += 1
    involved = [a for a in apps if a["goals"] or a["assists"]]

    missed_in_window = (
        _absence_in_window(player_id, apps[-1]["timestamp"], now) if apps else False
    )

    # Summed (or, for rating, weighted-averaged) across every selected
    # competition — see _sum_stat/_weighted_avg_rating.
    per_competition_stats = []
    for c in competitions:
        season_stats = api_get(
            f"/player/{player_id}/unique-tournament/{c['tournamentId']}/season/{c['seasonId']}/statistics/overall"
        )
        per_competition_stats.append((season_stats or {}).get("statistics") or {})

    def combined(key):
        return _sum_stat(s.get(key) for s in per_competition_stats)

    combined_rating = _weighted_avg_rating(
        (s.get("rating"), s.get("matchesStarted") or 0) for s in per_competition_stats
    )

    upcoming = None
    next_data = api_get(f"/team/{team_id}/events/next/0")
    next_events = (next_data or {}).get("events") or []
    if next_events:
        ev = next_events[0]
        home, away = ev.get("homeTeam") or {}, ev.get("awayTeam") or {}
        opponent = away if home.get("id") == team_id else home
        upcoming = {
            "date": ev.get("startTimestamp"),
            "home": _pname(home),
            "away": _pname(away),
            "opponent": _pname(opponent),
            # id/color so the graphic can fetch a real badge, same as every
            # other team-mark in the show (see fetch-image/ensureTeamBadge).
            "opponentId": opponent.get("id"),
            "opponentColor": (opponent.get("teamColors") or {}).get("primary"),
            "competition": (ev.get("tournament") or {}).get("name"),
        }

    out = {
        "profile": {
            "id": player_id,
            "name": player.get("name"),
            "photo": None,  # fetched separately via fetch-image player <id>
            "position": player.get("position"),
            "jerseyNumber": _to_int(player.get("jerseyNumber")),
            "height": player.get("height"),
            "preferredFoot": player.get("preferredFoot"),
            "dateOfBirth": player.get("dateOfBirthTimestamp"),
            "marketValueEUR": _to_int(player.get("proposedMarketValue")),
            "country": (player.get("country") or {}).get("name"),
        },
        "team": {
            "id": team_id,
            "name": (player.get("team") or {}).get("name"),
            "code": (player.get("team") or {}).get("nameCode"),
            "color": ((player.get("team") or {}).get("teamColors") or {}).get("primary"),
        },
        # One or more {tournamentId, seasonId, tournament, seasonName} — the
        # competition(s) every number below is scoped to. Persist this
        # exact array (not just a display string) so a later re-fetch (e.g.
        # generate-player-timeline.mjs at render time) asks for the SAME set.
        "competitions": competitions,
        # Human-readable summary of the same list, for a quick single-line
        # display ("LaLiga" or "LaLiga + UEFA Champions League").
        "competition": " + ".join(c["tournament"] for c in competitions if c["tournament"]) or None,
        "appearances": len(apps),
        "withGoalOrAssist": len(involved),
        "withGoal": sum(1 for a in apps if a["goals"]),
        "goals": sum(a["goals"] for a in apps),
        "assists": sum(a["assists"] for a in apps),
        "consecutiveWithGoalOrAssist": run,
        "consecutiveWithGoal": scoring_run,
        "consecutiveWithoutGoalOrAssist": blank_run,
        "consecutiveWithoutGoal": goalless_run,
        "recent": [
            {k: a[k] for k in ("date", "opponent", "competition", "goals", "assists")} for a in apps
        ],
        "missedMatchesInWindow": missed_in_window,
        "seasonStats": {
            "rating": combined_rating,
            "appearances": combined("matchesStarted"),
            "goals": combined("goals"),
            "assists": combined("assists"),
            "expectedGoals": combined("expectedGoals"),
            "expectedAssists": combined("expectedAssists"),
            "keyPasses": combined("keyPasses"),
            "totalShots": combined("totalShots"),
            "shotsOnTarget": combined("shotsOnTarget"),
            "minutesPlayed": combined("minutesPlayed"),
            "bigChancesCreated": combined("bigChancesCreated"),
            "bigChancesMissed": combined("bigChancesMissed"),
        },
        "upcomingFixture": upcoming,
        # Same IDENTITY mechanism match videos use (build_personal_angle) —
        # whether this player's own club is one of Ballsy's favourites or a
        # hated rival, so his take can carry the show's established bias.
        "personalAngle": build_personal_angle(team_id, None),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_list(tournament_id, season_id, rnd):
    data = api_get(
        f"/unique-tournament/{tournament_id}/season/{season_id}/events/round/{rnd}"
    )
    events = (data or {}).get("events", []) if isinstance(data, dict) else []
    out = []
    for ev in events:
        st = (ev.get("status") or {})
        out.append({
            "id": ev.get("id"),
            "home": (ev.get("homeTeam") or {}).get("name"),
            "away": (ev.get("awayTeam") or {}).get("name"),
            "homeScore": (ev.get("homeScore") or {}).get("current"),
            "awayScore": (ev.get("awayScore") or {}).get("current"),
            "status": st.get("type"),
            "round": (ev.get("roundInfo") or {}).get("round"),
            "date": ev.get("startTimestamp"),
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_leagues():
    """The curated league list the picker opens on (no network call)."""
    try:
        with open(LEAGUES_FILE, encoding="utf-8") as f:
            leagues = json.load(f)
    except (OSError, ValueError):
        leagues = []
    print(json.dumps(leagues, ensure_ascii=False, indent=2))


def cmd_search(query):
    """Leagues/tournaments matching a free-text name (for the league picker).

    Uses the dedicated tournament-search endpoint (what the reference scraper
    uses to add a league) rather than /search/all, whose mixed results — teams,
    players, managers — have to be filtered by hand and rank inconsistently.
    """
    data = api_get(f"/search/unique-tournaments/{quote(query)}")
    results = (data or {}).get("uniqueTournaments") or (data or {}).get("results") or []
    out = []
    for r in results:
        e = r.get("entity", r) if isinstance(r, dict) else None
        if not isinstance(e, dict) or not e.get("id"):
            continue
        out.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "category": (e.get("category") or {}).get("name"),
            "userCount": e.get("userCount") or 0,
        })
    # Most-followed first — the league someone typed "premier" for is almost
    # always the popular one, not a third-tier namesake.
    out.sort(key=lambda x: x["userCount"], reverse=True)
    print(json.dumps(out[:25], ensure_ascii=False, indent=2))


def cmd_search_player(query):
    """Players matching a free-text name (for the player-video picker).

    Uses the dedicated player-search endpoint (confirmed live: a flat
    `players` array), not /search/all — same reasoning as cmd_search's
    league lookup: a mixed endpoint has to be filtered by hand and ranks
    inconsistently.
    """
    data = api_get(f"/search/players/{quote(query)}")
    results = (data or {}).get("players") or []
    out = []
    for e in results:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        team = e.get("team") or {}
        out.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "position": e.get("position"),
            "jerseyNumber": _to_int(e.get("jerseyNumber")),
            "country": (e.get("country") or {}).get("name"),
            "teamId": team.get("id"),
            "team": team.get("name"),
            "userCount": e.get("userCount") or 0,
        })
    # Most-followed first, same convention as cmd_search.
    out.sort(key=lambda x: x["userCount"], reverse=True)
    print(json.dumps(out[:25], ensure_ascii=False, indent=2))


def cmd_search_team(query):
    """Teams matching a free-text name (for the pre-match preview picker).

    Uses the dedicated team-search endpoint (confirmed live: a flat `teams`
    array carrying id/name/nameCode/teamColors), not /search/all — same
    reasoning as cmd_search/cmd_search_player: a mixed endpoint has to be
    filtered by hand and ranks inconsistently.
    """
    data = api_get(f"/search/teams/{quote(query)}")
    results = (data or {}).get("teams") or []
    out = []
    for e in results:
        if not isinstance(e, dict) or not e.get("id"):
            continue
        out.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "code": e.get("nameCode"),
            "color": (e.get("teamColors") or {}).get("primary"),
            "country": (e.get("country") or {}).get("name"),
            "userCount": e.get("userCount") or 0,
        })
    # Most-followed first, same convention as cmd_search/cmd_search_player.
    out.sort(key=lambda x: x["userCount"], reverse=True)
    print(json.dumps(out[:25], ensure_ascii=False, indent=2))


# /team/{id}/events/next/{page} returns 30 upcoming events per page across
# every competition, paging exactly like events/last does (same
# hasNextPage contract _team_results already walks). The fixture between two
# given teams is nearly always on page 0; the cap is there so a pair that
# never actually meet can't page forever.
NEXT_FIXTURE_MAX_PAGES = 4


def cmd_next_fixture(team_a_id, team_b_id):
    """The next scheduled fixture between two teams, or null.

    Pages team A's own upcoming events looking for the first one team B is
    also in — no separate "match search" endpoint needed once both team ids
    are known, and the result is a real scheduled event rather than a guess
    at which round they meet in.
    """
    team_a_id, team_b_id = int(team_a_id), int(team_b_id)
    found = None
    for page in range(NEXT_FIXTURE_MAX_PAGES):
        data = api_get(f"/team/{team_a_id}/events/next/{page}")
        if not isinstance(data, dict):
            break
        for e in data.get("events") or []:
            home, away = e.get("homeTeam") or {}, e.get("awayTeam") or {}
            ids = {home.get("id"), away.get("id")}
            if team_a_id not in ids or team_b_id not in ids:
                continue
            tournament = ((e.get("tournament") or {}).get("uniqueTournament") or {})
            candidate = {
                "matchId": e.get("id"),
                "home": _pname(home),
                "away": _pname(away),
                "homeId": home.get("id"),
                "awayId": away.get("id"),
                "tournament": tournament.get("name"),
                "tournamentId": tournament.get("id"),
                "round": (e.get("roundInfo") or {}).get("round"),
                "status": (e.get("status") or {}).get("type"),
                "date": e.get("startTimestamp"),
            }
            # Soonest first — events/next is already chronological per page,
            # but pick explicitly rather than relying on that.
            if found is None or (candidate["date"] or 0) < (found["date"] or 0):
                found = candidate
        if found or not data.get("hasNextPage"):
            break
    print(json.dumps(found, ensure_ascii=False, indent=2))


def _sortable_year(year):
    """Sortable number for a season's year string ("25/26", "2025", "99/00")."""
    if not year:
        return 0.0
    year = str(year).strip()
    if "/" in year:
        start, _, end = year.partition("/")
        start, end = start.strip(), end.strip()
        if len(start) == 2 and len(end) == 2:
            s, e = int(start), int(end)
            # Century rollover: "99/00" is 2000, not 1999.
            if s > e:
                return 2000.0 + e
            return (2000.0 + s) if s < 50 else (1900.0 + s)
        if len(start) == 4:
            return float(start)
        try:
            return float(start)
        except ValueError:
            return 0.0
    try:
        return float(year)
    except ValueError:
        m = re.search(r"20\d\d", year)
        return float(m.group()) if m else 0.0


def _season_has_finished(tournament_id, season_id):
    """True if the season has at least one finished match.

    A season with no played matches yet 404s on events/last, so this is one
    cheap request per season.
    """
    data = api_get(f"/unique-tournament/{tournament_id}/season/{season_id}/events/last/0")
    if not isinstance(data, dict):
        return False
    return any((e.get("status") or {}).get("type") == "finished" for e in data.get("events") or [])


# How many of the newest seasons to probe when picking a default. The newest
# season is very often the current, not-yet-started one; the reference scraper
# has the same "fall back to the previous season" rule.
SEASON_PROBE_LIMIT = 4


def cmd_seasons(tournament_id):
    """Seasons of a tournament, newest first, plus the one to select by default."""
    data = api_get(f"/unique-tournament/{tournament_id}/seasons")
    raw = (data or {}).get("seasons", [])
    seasons = [{"id": s.get("id"), "name": s.get("name"), "year": s.get("year")} for s in raw]
    seasons.sort(key=lambda s: _sortable_year(s["year"]), reverse=True)

    default_id = seasons[0]["id"] if seasons else None
    for season in seasons[:SEASON_PROBE_LIMIT]:
        if _season_has_finished(tournament_id, season["id"]):
            default_id = season["id"]
            break

    print(json.dumps({"seasons": seasons, "defaultSeasonId": default_id}, ensure_ascii=False, indent=2))


def _round_key(r):
    """Stable id for a round. Cups repeat round numbers (a "Round 1" in
    qualifying and another in the league phase), so the slug/prefix are part
    of the identity — and of the URL SofaScore needs to disambiguate them."""
    return f"{r.get('round')}|{r.get('slug') or ''}|{r.get('prefix') or ''}"


def _round_label(r):
    parts = [p for p in (r.get("prefix"), r.get("name") or f"Round {r.get('round')}") if p]
    return " ".join(parts)


def _normalize_round(r):
    if not isinstance(r, dict) or r.get("round") is None:
        return None
    out = {
        "round": r.get("round"),
        "name": r.get("name"),
        "slug": r.get("slug"),
        "prefix": r.get("prefix"),
    }
    out["key"] = _round_key(out)
    out["label"] = _round_label(out)
    return out


def _round_path(tournament_id, season_id, r):
    """events/round URL for a round. Named rounds 404 without their slug."""
    path = f"/unique-tournament/{tournament_id}/season/{season_id}/events/round/{r['round']}"
    if r.get("slug"):
        path += f"/slug/{quote(str(r['slug']))}"
    if r.get("prefix"):
        path += f"/prefix/{quote(str(r['prefix']))}"
    return path


def _finished(events):
    out = []
    for ev in events or []:
        if (ev.get("status") or {}).get("type") != "finished":
            continue
        out.append({
            "id": ev.get("id"),
            "home": (ev.get("homeTeam") or {}).get("name"),
            "away": (ev.get("awayTeam") or {}).get("name"),
            "homeScore": (ev.get("homeScore") or {}).get("current"),
            "awayScore": (ev.get("awayScore") or {}).get("current"),
            "round": (ev.get("roundInfo") or {}).get("round"),
            "date": ev.get("startTimestamp"),
        })
    out.sort(key=lambda m: m["date"] or 0, reverse=True)
    return out


# When defaulting to a round, walk back this far from the current one looking
# for played matches (mid-season the current round is often unplayed).
ROUND_LOOKBACK = 6


def cmd_matches(tournament_id, season_id, round_key=None):
    """Finished matches of one round of a season, plus that season's rounds.

    Round-by-round is how the reference scraper reads a season (the endpoint is
    deterministic and matches how a league is actually organised), instead of
    paging an opaque "last events" feed.
    """
    meta = api_get(f"/unique-tournament/{tournament_id}/season/{season_id}/rounds") or {}
    rounds = []
    seen = set()
    for r in meta.get("rounds") or []:
        norm = _normalize_round(r)
        if norm and norm["key"] not in seen:
            seen.add(norm["key"])
            rounds.append(norm)

    if not rounds:
        # No round structure (friendlies, some cups) — fall back to the season's
        # most recent events so the picker still shows something.
        data = api_get(f"/unique-tournament/{tournament_id}/season/{season_id}/events/last/0")
        events = data.get("events") if isinstance(data, dict) else []
        print(json.dumps(
            {"rounds": [], "selectedRound": None, "matches": _finished(events)},
            ensure_ascii=False, indent=2,
        ))
        return

    # Where to start looking: the requested round, else the current one.
    start = len(rounds) - 1
    if round_key:
        start = next((i for i, r in enumerate(rounds) if r["key"] == round_key), start)
    else:
        current = _normalize_round(meta.get("currentRound"))
        if current:
            start = next((i for i, r in enumerate(rounds) if r["key"] == current["key"]), start)

    selected, matches = rounds[start], []
    limit = 1 if round_key else ROUND_LOOKBACK
    for i in range(start, max(-1, start - limit), -1):
        data = api_get(_round_path(tournament_id, season_id, rounds[i]))
        found = _finished(data.get("events") if isinstance(data, dict) else [])
        if found:
            selected, matches = rounds[i], found
            break

    print(json.dumps(
        {"rounds": rounds, "selectedRound": selected["key"], "matches": matches},
        ensure_ascii=False, indent=2,
    ))


def main():
    # Force UTF-8 stdout so non-ASCII player names don't crash on Windows cp1252.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    cmd = args[0]
    if cmd == "fetch" and len(args) == 2:
        cmd_fetch(args[1])
    elif cmd == "list" and len(args) == 4:
        cmd_list(args[1], args[2], args[3])
    elif cmd == "leagues" and len(args) == 1:
        cmd_leagues()
    elif cmd == "search" and len(args) == 2:
        cmd_search(args[1])
    elif cmd == "seasons" and len(args) == 2:
        cmd_seasons(args[1])
    elif cmd == "matches" and len(args) in (3, 4):
        cmd_matches(args[1], args[2], args[3] if len(args) == 4 else None)
    elif cmd == "fetch-image" and len(args) == 4:
        cmd_fetch_image(args[1], args[2], args[3])
    elif cmd == "search-player" and len(args) == 2:
        cmd_search_player(args[1])
    elif cmd == "player-seasons" and len(args) == 2:
        cmd_player_seasons(args[1])
    elif cmd == "player-form" and len(args) in (2, 3):
        cmd_player_form(args[1], args[2] if len(args) == 3 else None)
    elif cmd == "search-team" and len(args) == 2:
        cmd_search_team(args[1])
    elif cmd == "next-fixture" and len(args) == 3:
        cmd_next_fixture(args[1], args[2])
    elif cmd == "prematch" and len(args) == 2:
        cmd_prematch(args[1])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
