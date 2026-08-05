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
        return {
            "type": "goal",
            "minute": minute,
            "team": team,
            "player": _pname(it.get("player")),
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
    # Lineups fill shirt numbers the incident feed sometimes omits (late subs).
    numbers = build_number_map(api_get(f"/event/{match_id}/lineups"))
    # Incidents come newest-first; emit chronological.
    events = [n for n in (normalize_incident(it, numbers) for it in reversed(raw)) if n]

    # Grounded context for the script: pre-match form, h2h, match stats.
    context = {}
    form = build_form(api_get(f"/event/{match_id}/pregame-form"))
    h2h = build_h2h(api_get(f"/event/{match_id}/h2h"))
    stats = build_stats(api_get(f"/event/{match_id}/statistics"))
    if form:
        context["form"] = form
    if h2h:
        context["h2h"] = h2h
    if stats:
        context["stats"] = stats

    status = e.get("status") or {}
    tournament = ((e.get("tournament") or {}).get("uniqueTournament") or {})
    out = {
        "fixtureId": str(match_id),
        "home": _pname(e.get("homeTeam")),
        "away": _pname(e.get("awayTeam")),
        # SofaScore's own 3-letter code (e.g. "TEL"), for the scoreboard graphic.
        "homeCode": (e.get("homeTeam") or {}).get("nameCode"),
        "awayCode": (e.get("awayTeam") or {}).get("nameCode"),
        "homeScore": (e.get("homeScore") or {}).get("current"),
        "awayScore": (e.get("awayScore") or {}).get("current"),
        "status": status.get("type"),
        "date": e.get("startTimestamp"),
        "tournament": tournament.get("name"),
        "season": (e.get("season") or {}).get("name"),
        "context": context,
        "events": events,
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
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
