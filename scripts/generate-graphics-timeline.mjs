// Builds the per-match graphics timeline: for each key moment, cross-references
// the normalized SofaScore events and emits the props for the matching graphic
// component (goal, disallowed goal, card, penalty, substitution, VAR, clear
// chance). Output feeds the <Sequence> graphics layer in src/ballsy.tsx.
//
// Usage: node --env-file=.env scripts/generate-graphics-timeline.mjs <matchId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getMatch} from './lib/match-source.mjs';
import {computeBlockStartTimes} from './lib/script-timing.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: node --env-file=.env scripts/generate-graphics-timeline.mjs <matchId>');
  process.exit(1);
}

const {script} = JSON.parse(await readFile(join(OUTPUT_DIR, `${matchId}.json`), 'utf8'));
const alignment = JSON.parse(
  await readFile(join(OUTPUT_DIR, `${matchId}-alignment.json`), 'utf8'),
);

// A graphic anchored to the exact start of its segment lands on the FIRST
// word of the sentence — often well before the sentence actually reveals the
// event (e.g. "Telstar get their own penalty... nah, that one's gone" only
// confirms the miss at the very end). Delaying the reveal a bit into the
// segment reads more like "setup, then payoff" instead of jumping the gun.
const REVEAL_DELAY_FRACTION = 0.25; // fraction of the segment's own duration
const REVEAL_DELAY_MAX_SECONDS = 1.2;
// A graphic must survive at least this long even if its segment is unusually
// short, so it never reads as a flash-frame.
const MIN_DURATION_SECONDS = 3;

// Flatten every tagged event across all key_moments into one chronological
// list, each timed to the exact segment that narrates it — not just the
// start of the whole moment, so a moment that bundles several events (e.g.
// two missed penalties then the equalizer) gets one graphic per event instead
// of only the first. Falls back to the old single-event-per-moment shape for
// scripts generated before per-event tagging existed.
const taggedEvents = computeBlockStartTimes(script, alignment)
  .filter((b) => b.moment)
  .flatMap((b) => {
    const moment = b.moment;
    const legacyEvents =
      moment.events ??
      (moment.event_type
        ? [{minute: moment.minute, event_type: moment.event_type, outcome: moment.outcome, segmentIndex: 0}]
        : []);
    return legacyEvents.map((ev) => {
      const segStart = b.segmentStartTimes?.[ev.segmentIndex] ?? b.startTime;
      const segEnd = b.segmentEndTimes?.[ev.segmentIndex] ?? segStart + MIN_DURATION_SECONDS;
      const segDuration = Math.max(0, segEnd - segStart);
      const delay = Math.min(segDuration * REVEAL_DELAY_FRACTION, REVEAL_DELAY_MAX_SECONDS);
      const startTime = segStart + delay;
      // Stays on screen until the segment actually finishes being spoken
      // (never shorter than the floor), instead of a generic fixed duration.
      const durationSeconds = Math.max(MIN_DURATION_SECONDS, segEnd - startTime);
      return {...ev, startTime, durationSeconds};
    });
  });

// Real, structured events from SofaScore (already normalized + chronological).
const match = getMatch(matchId);
// Prefer SofaScore's own 3-letter code; fall back to first 3 letters of the name.
const shortCode = (name) => (name || '???').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
const homeTeam = match.homeCode || shortCode(match.home);
const awayTeam = match.awayCode || shortCode(match.away);

const events = match.events;

// Goals carry the running score after them, so standing/final score is free.
const goals = events.filter((e) => e.type === 'goal');
function standingAtMinute(minute) {
  const before = goals.filter((g) => g.minute <= (minute ?? Infinity));
  const last = before.at(-1);
  return last ? {home: last.homeScore, away: last.awayScore} : {home: 0, away: 0};
}

function nearestEvent(pred, minute) {
  let best = null;
  let bestDiff = Infinity;
  for (const e of events) {
    if (!pred(e)) continue;
    const diff = Math.abs(e.minute - (minute ?? e.minute));
    if (diff < bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  return best;
}

// Old scripts stored event_type as a free string; normalize to the enum.
function normalizeEventType(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[\s-]+/g, '_');
  const map = {
    goal: 'goal',
    normal_goal: 'goal',
    penalty_goal: 'goal',
    goal_disallowed: 'goal_disallowed',
    disallowed_goal: 'goal_disallowed',
    goal_cancelled: 'goal_disallowed',
    yellow_card: 'yellow_card',
    red_card: 'red_card',
    card: 'yellow_card',
    penalty: 'penalty',
    missed_penalty: 'penalty',
    substitution: 'substitution',
    subst: 'substitution',
    clear_chance: 'clear_chance',
    chance: 'clear_chance',
    var: 'var_review',
    var_review: 'var_review',
  };
  return map[s] ?? s;
}

// Surname-only, uppercased, for the substitution badge (never a full likeness).
function badgeName(fullName) {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/).at(-1).toUpperCase();
}

const graphicsTimeline = [];

for (const ev of taggedEvents) {
  const type = normalizeEventType(ev.event_type);
  const minute = ev.minute;
  const startTime = ev.startTime;
  const durationSeconds = ev.durationSeconds;

  if (type === 'goal') {
    const matched = nearestEvent((e) => e.type === 'goal', minute);
    if (!matched) {
      console.warn(`No goal event near minute ${minute}, skipping goal graphic`);
      continue;
    }
    graphicsTimeline.push({
      type: 'goal',
      startTime,
      durationSeconds,
      props: {
        homeTeam,
        awayTeam,
        homeScore: matched.homeScore,
        awayScore: matched.awayScore,
        scoringTeam: matched.team,
      },
    });
  } else if (type === 'goal_disallowed') {
    // No score change. Best-effort team from a nearby VAR decision.
    const varEvent = nearestEvent((e) => e.type === 'var', minute);
    const scoringTeam = varEvent ? varEvent.team : 'home';
    if (!varEvent) {
      console.warn(`No VAR event near minute ${minute}; defaulting scoringTeam=home`);
    }
    const standing = standingAtMinute(minute);
    graphicsTimeline.push({
      type: 'goalDisallowed',
      startTime,
      durationSeconds,
      props: {homeTeam, awayTeam, homeScore: standing.home, awayScore: standing.away, scoringTeam},
    });
  } else if (type === 'yellow_card' || type === 'red_card') {
    const matched = nearestEvent((e) => e.type === 'card', minute);
    // Trust the data for the card colour when we found the event.
    const cardType = matched?.cardType ?? (type === 'red_card' ? 'red' : 'yellow');
    graphicsTimeline.push({
      type: 'card',
      startTime,
      durationSeconds,
      props: {cardType, minute: matched?.minute ?? minute ?? 0},
    });
  } else if (type === 'penalty') {
    // Outcome AND score come straight from SofaScore — scored / saved / post / out.
    const pen = nearestEvent(
      (e) => (e.type === 'goal' && e.penalty) || e.type === 'penalty_missed',
      minute,
    );
    let outcome;
    let scoreProps;
    if (pen && pen.type === 'goal') {
      // A scored penalty is still a goal — carry its real running score so
      // the scoreboard ticks up just like a regular Goal graphic would.
      outcome = 'scored';
      scoreProps = {homeScore: pen.homeScore, awayScore: pen.awayScore, scoringTeam: pen.team};
    } else if (pen && pen.type === 'penalty_missed') {
      outcome = pen.outcome; // saved | post | out — score doesn't change
      const standing = standingAtMinute(pen.minute);
      scoreProps = {homeScore: standing.home, awayScore: standing.away, scoringTeam: pen.team};
    } else {
      // No structured penalty found — fall back to the model's read.
      console.warn(`No structured penalty event near minute ${minute}; using model outcome, scoringTeam=home`);
      outcome = {penalty_scored: 'scored', penalty_saved: 'saved', penalty_post: 'post', penalty_out: 'out'}[
        ev.outcome
      ] ?? 'saved';
      const standing = standingAtMinute(minute);
      scoreProps = {homeScore: standing.home, awayScore: standing.away, scoringTeam: 'home'};
    }
    graphicsTimeline.push({
      type: 'penalty',
      startTime,
      durationSeconds,
      props: {outcome, homeTeam, awayTeam, ...scoreProps},
    });
  } else if (type === 'substitution') {
    const sub = nearestEvent((e) => e.type === 'substitution', minute);
    if (!sub) {
      console.warn(`No substitution event near minute ${minute}, skipping`);
      continue;
    }
    graphicsTimeline.push({
      type: 'substitution',
      startTime,
      durationSeconds,
      props: {
        playerOnName: badgeName(sub.in?.name),
        playerOnNumber: sub.in?.number ?? 0,
        playerOffName: badgeName(sub.out?.name),
        playerOffNumber: sub.out?.number ?? 0,
      },
    });
  } else if (type === 'var_review') {
    graphicsTimeline.push({type: 'varReview', startTime, durationSeconds, props: {}});
  } else if (type === 'clear_chance') {
    // Not a structured event — purely the model's read of the article text.
    const outcome = ev.outcome === 'clear_chance_post' ? 'post' : 'wide';
    graphicsTimeline.push({type: 'clearChance', startTime, durationSeconds, props: {outcome}});
  } else if (type) {
    console.warn(`Unrecognized event_type "${ev.event_type}" at minute ${minute}, skipping`);
  }
}

const outputPath = join(PUBLIC_AUDIO_DIR, `${matchId}-graphics.json`);
await writeFile(outputPath, JSON.stringify({graphicsTimeline}, null, 2));

console.log(`Saved: ${outputPath} (${graphicsTimeline.length} graphics)`);
console.log(JSON.stringify(graphicsTimeline, null, 2));
