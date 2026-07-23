// Builds the per-match graphics timeline: for each key moment, cross-references
// the raw API-Football events and emits the props for the matching graphic
// component (goal, disallowed goal, card, penalty, substitution, VAR, clear
// chance). Output feeds the <Sequence> graphics layer in src/ballsy.tsx.
//
// Usage: node --env-file=.env scripts/generate-graphics-timeline.mjs <fixtureId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchFixtureLineups, findWorldCupFixtureAndEvents} from './lib/api-football.mjs';
import {computeBlockStartTimes} from './lib/script-timing.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node --env-file=.env scripts/generate-graphics-timeline.mjs <fixtureId>');
  process.exit(1);
}

const {script} = JSON.parse(await readFile(join(OUTPUT_DIR, `${fixtureId}.json`), 'utf8'));
const alignment = JSON.parse(
  await readFile(join(OUTPUT_DIR, `${fixtureId}-alignment.json`), 'utf8'),
);

const keyMoments = computeBlockStartTimes(script, alignment)
  .filter((b) => b.moment)
  .map((b) => ({moment: b.moment, startTime: b.startTime}));

const {fixture, events} = await findWorldCupFixtureAndEvents();
if (String(fixture.fixture.id) !== String(fixtureId)) {
  console.warn(
    `WARNING: re-fetched fixture ${fixture.fixture.id} but script is for ${fixtureId}. ` +
      'The events endpoint only serves the most recent fixture on the free tier, so ' +
      'graphics may not line up if this is an older match.',
  );
}

const HOME = fixture.teams.home.name;
const AWAY = fixture.teams.away.name;
const shortCode = (name) => name.slice(0, 3).toUpperCase();
const homeTeam = shortCode(HOME);
const awayTeam = shortCode(AWAY);

const eventsSorted = [...events].sort(
  (a, b) => a.time.elapsed - b.time.elapsed || (a.time.extra ?? 0) - (b.time.extra ?? 0),
);

// Running score after each real goal, in chronological order.
const goalsWithScore = [];
{
  let h = 0;
  let a = 0;
  for (const e of eventsSorted) {
    if (e.type !== 'Goal') continue;
    if (e.team.name === HOME) h += 1;
    else a += 1;
    goalsWithScore.push({event: e, home: h, away: a});
  }
}

// Standing score just before a given minute (goals that had already counted).
function standingAtMinute(minute) {
  const before = goalsWithScore.filter((g) => g.event.time.elapsed <= (minute ?? Infinity));
  const last = before.at(-1);
  return last ? {home: last.home, away: last.away} : {home: 0, away: 0};
}

function nearestEvent(pred, minute) {
  let best = null;
  let bestDiff = Infinity;
  for (const e of eventsSorted) {
    if (!pred(e)) continue;
    const diff = Math.abs(e.time.elapsed - (minute ?? e.time.elapsed));
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

let lineups = null; // lazily fetched only if a substitution is present

const graphicsTimeline = [];

for (const {moment, startTime} of keyMoments) {
  const type = normalizeEventType(moment.event_type);
  const minute = moment.minute;

  if (type === 'goal') {
    const matched = nearestEvent((e) => e.type === 'Goal', minute);
    if (!matched) {
      console.warn(`No raw goal event near minute ${minute}, skipping goal graphic`);
      continue;
    }
    const scored = goalsWithScore.find((g) => g.event === matched);
    const scoringTeam = matched.team.name === HOME ? 'home' : 'away';
    graphicsTimeline.push({
      type: 'goal',
      startTime,
      props: {
        homeTeam,
        awayTeam,
        homeScore: scored.home,
        awayScore: scored.away,
        scoringTeam,
      },
    });
  } else if (type === 'goal_disallowed') {
    // No score change. Try to find which team the ruled-out goal was for.
    const varEvent = nearestEvent(
      (e) => e.type === 'Var' && /cancel|disallow|offside/i.test(e.detail ?? ''),
      minute,
    );
    const scoringTeam = varEvent ? (varEvent.team.name === HOME ? 'home' : 'away') : 'home';
    if (!varEvent) {
      console.warn(
        `No VAR/disallowed event near minute ${minute}; defaulting scoringTeam=home`,
      );
    }
    const standing = standingAtMinute(minute);
    graphicsTimeline.push({
      type: 'goalDisallowed',
      startTime,
      props: {homeTeam, awayTeam, homeScore: standing.home, awayScore: standing.away, scoringTeam},
    });
  } else if (type === 'yellow_card' || type === 'red_card') {
    const matched = nearestEvent(
      (e) => e.type === 'Card' && /card/i.test(e.detail ?? ''),
      minute,
    );
    const cardType = type === 'red_card' ? 'red' : 'yellow';
    graphicsTimeline.push({
      type: 'card',
      startTime,
      props: {cardType, minute: matched?.time.elapsed ?? minute ?? 0},
    });
  } else if (type === 'penalty') {
    // API tells us scored vs missed; the model's outcome disambiguates a miss.
    const pen = nearestEvent(
      (e) =>
        (e.type === 'Goal' && /penalty/i.test(e.detail ?? '')) ||
        /penalty/i.test(e.type ?? ''),
      minute,
    );
    const apiScored = pen ? pen.type === 'Goal' : moment.outcome === 'penalty_scored';
    let outcome;
    if (apiScored) {
      outcome = 'scored';
    } else {
      const fromModel = {
        penalty_saved: 'saved',
        penalty_post: 'post',
        penalty_out: 'out',
      }[moment.outcome];
      outcome = fromModel ?? 'saved'; // default per product decision
    }
    graphicsTimeline.push({type: 'penalty', startTime, props: {outcome}});
  } else if (type === 'substitution') {
    const sub = nearestEvent((e) => e.type === 'subst', minute);
    if (!sub) {
      console.warn(`No substitution event near minute ${minute}, skipping`);
      continue;
    }
    if (!lineups) {
      lineups = await fetchFixtureLineups(fixture.fixture.id);
    }
    // API-Football convention: player = coming ON, assist = going OFF.
    const on = sub.player;
    const off = sub.assist;
    graphicsTimeline.push({
      type: 'substitution',
      startTime,
      props: {
        playerOnName: badgeName(on?.name),
        playerOnNumber: lineups.get(on?.id)?.number ?? 0,
        playerOffName: badgeName(off?.name),
        playerOffNumber: lineups.get(off?.id)?.number ?? 0,
      },
    });
  } else if (type === 'var_review') {
    graphicsTimeline.push({type: 'varReview', startTime, props: {}});
  } else if (type === 'clear_chance') {
    // Not an API event — purely the model's read of the article text.
    const outcome = moment.outcome === 'clear_chance_post' ? 'post' : 'wide';
    graphicsTimeline.push({type: 'clearChance', startTime, props: {outcome}});
  } else {
    if (type) {
      console.warn(`Unrecognized event_type "${moment.event_type}" at minute ${minute}, skipping`);
    }
  }
}

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-graphics.json`);
await writeFile(outputPath, JSON.stringify({graphicsTimeline}, null, 2));

console.log(`Saved: ${outputPath} (${graphicsTimeline.length} graphics)`);
console.log(JSON.stringify(graphicsTimeline, null, 2));
