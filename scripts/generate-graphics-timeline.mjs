// Usage: node --env-file=.env scripts/generate-graphics-timeline.mjs <fixtureId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findWorldCupFixtureAndEvents} from './lib/api-football.mjs';
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

const keyMomentStartTimes = computeBlockStartTimes(script, alignment)
  .filter((b) => b.moment)
  .map((b) => ({moment: b.moment, startTime: b.startTime}));

// Re-fetch the raw event timeline to compute the running score at each
// goal — the script only keeps `minute`/`event_type`, not the scoreline.
const {fixture, events} = await findWorldCupFixtureAndEvents();
const goalEvents = events
  .filter((e) => e.type === 'Goal')
  .sort((a, b) => a.time.elapsed - b.time.elapsed);

const shortCode = (name) => name.slice(0, 3).toUpperCase();
const homeTeam = shortCode(fixture.teams.home.name);
const awayTeam = shortCode(fixture.teams.away.name);

let homeGoals = 0;
let awayGoals = 0;
const graphicsTimeline = [];

for (const {moment, startTime} of keyMomentStartTimes) {
  if (moment.event_type?.toLowerCase() !== 'goal') {
    continue;
  }

  // Match this key moment to the nearest raw goal event by minute.
  const matchedGoal = goalEvents.reduce((closest, event) => {
    const diff = Math.abs(event.time.elapsed - moment.minute);
    const closestDiff = closest ? Math.abs(closest.time.elapsed - moment.minute) : Infinity;
    return diff < closestDiff ? event : closest;
  }, null);

  if (!matchedGoal) {
    console.error(`No raw goal event found near minute ${moment.minute}, skipping`);
    continue;
  }

  const scoringTeam = matchedGoal.team.name === fixture.teams.home.name ? 'home' : 'away';
  if (scoringTeam === 'home') {
    homeGoals += 1;
  } else {
    awayGoals += 1;
  }

  graphicsTimeline.push({
    type: 'goal',
    startTime,
    props: {homeTeam, awayTeam, homeScore: homeGoals, awayScore: awayGoals, scoringTeam},
  });
}

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-graphics.json`);
await writeFile(outputPath, JSON.stringify({graphicsTimeline}, null, 2));

console.log(`Saved: ${outputPath}`);
console.log(JSON.stringify(graphicsTimeline, null, 2));
