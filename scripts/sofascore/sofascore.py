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

Requires: curl_cffi  (pip install -r requirements.txt)
"""

import json
import random
import sys
import time

from curl_cffi import requests as cffi

BASE = "https://www.sofascore.com/api/v1"

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
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
