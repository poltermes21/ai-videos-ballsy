// Builds the per-player stat-card timeline: for each key moment, resolves
// the script's tagged stats to real on-screen timing and props, pulled
// straight from freshly-fetched player-form data (already grounded — unlike
// generate-graphics-timeline.mjs there's no separate "real event" to cross-
// reference against, a stat's own numbers ARE the ground truth). Output
// feeds the stat-card <Sequence> layer in src/ballsyPlayer.tsx.
//
// Usage: node --env-file=.env scripts/generate-player-timeline.mjs <fixtureId>
//   fixtureId is the full "player-<id>-<date>" run id (see
//   scripts/generate-player-script.mjs) — this file takes the same fully-
//   qualified id every other fixtureId-generic step does (generate-audio.mjs
//   etc.), rather than a bare playerId, and recovers which player/tournament/
//   season it needs from the saved script's own playerInfo instead of a
//   second CLI argument.

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getPlayerForm, ensureTeamBadge, ensurePlayerPhoto} from './lib/match-source.mjs';
import {computeBlockStartTimes} from './lib/script-timing.mjs';
import {fixtureOutputPath} from './lib/run-paths.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node --env-file=.env scripts/generate-player-timeline.mjs <fixtureId>');
  process.exit(1);
}

const {script, playerInfo} = JSON.parse(await readFile(fixtureOutputPath(fixtureId), 'utf8'));
const alignment = JSON.parse(await readFile(fixtureOutputPath(fixtureId, '-alignment'), 'utf8'));

// Same reveal-delay/min-duration constants as generate-graphics-timeline.mjs,
// so a stat card reveals near the line's actual payoff word, not its first.
const REVEAL_DELAY_FRACTION = 0.25;
const REVEAL_DELAY_MAX_SECONDS = 1.2;
const MIN_DURATION_SECONDS = 3;

const blockStartTimes = computeBlockStartTimes(script, alignment);
const taggedStats = blockStartTimes
  .filter((b) => b.moment)
  .flatMap((b) => {
    const moment = b.moment;
    return (moment.stats ?? []).map((tag) => {
      const segStart = b.segmentStartTimes?.[tag.segmentIndex] ?? b.startTime;
      const segEnd = b.segmentEndTimes?.[tag.segmentIndex] ?? segStart + MIN_DURATION_SECONDS;
      const segDuration = Math.max(0, segEnd - segStart);
      const delay = Math.min(segDuration * REVEAL_DELAY_FRACTION, REVEAL_DELAY_MAX_SECONDS);
      const startTime = segStart + delay;
      const durationSeconds = Math.max(MIN_DURATION_SECONDS, segEnd - startTime);
      return {...tag, startTime, durationSeconds};
    });
  });

// Same overlap-bisection as generate-graphics-timeline.mjs — two stats
// narrated in the same line would otherwise get identical windows and stack.
for (let i = 0; i < taggedStats.length - 1; i++) {
  const current = taggedStats[i];
  const next = taggedStats[i + 1];
  const currentEnd = current.startTime + current.durationSeconds;
  if (next.startTime >= currentEnd) continue;

  const windowStart = current.startTime;
  const windowEnd = Math.max(currentEnd, next.startTime + next.durationSeconds);
  const half = (windowEnd - windowStart) / 2;
  current.durationSeconds = Math.max(MIN_DURATION_SECONDS, half);
  next.startTime = windowStart + current.durationSeconds;
  next.durationSeconds = Math.max(MIN_DURATION_SECONDS, windowEnd - next.startTime);
}

// Re-fetch fresh, grounded form data — same discipline
// generate-graphics-timeline.mjs applies re-fetching getMatch() rather than
// trusting whatever was embedded in the script at generation time. Same
// competition(s) the script was actually written from — see
// generate-player-script.mjs's playerInfo.competitions.
const form = getPlayerForm(playerInfo.id, playerInfo.competitions);

const teamBadge = ensureTeamBadge(form.team.id);
const playerPhoto = ensurePlayerPhoto(form.profile.id);
const opponentBadge = form.upcomingFixture ? ensureTeamBadge(form.upcomingFixture.opponentId) : null;

const identity = {
  playerName: form.profile.name,
  playerNumber: form.profile.jerseyNumber ?? null,
  playerPhoto,
  teamName: form.team.name,
  teamBadge,
  teamColor: form.team.color,
};

const timeline = [];

for (const tag of taggedStats) {
  const {startTime, durationSeconds} = tag;

  if (tag.statType === 'recent_form') {
    timeline.push({
      type: 'recentForm',
      startTime,
      durationSeconds,
      props: {...identity, recent: form.recent},
    });
  } else if (tag.statType === 'season_tally') {
    timeline.push({
      type: 'seasonTally',
      startTime,
      durationSeconds,
      props: {...identity, competition: form.competition, seasonStats: form.seasonStats},
    });
  } else if (tag.statType === 'streak_call_out') {
    timeline.push({
      type: 'streakCallOut',
      startTime,
      durationSeconds,
      props: {
        ...identity,
        consecutiveWithGoalOrAssist: form.consecutiveWithGoalOrAssist,
        consecutiveWithGoal: form.consecutiveWithGoal,
        consecutiveWithoutGoalOrAssist: form.consecutiveWithoutGoalOrAssist,
        consecutiveWithoutGoal: form.consecutiveWithoutGoal,
      },
    });
  } else if (tag.statType === 'injury_gap') {
    timeline.push({
      type: 'injuryGap',
      startTime,
      durationSeconds,
      props: {...identity, missedMatchesInWindow: form.missedMatchesInWindow},
    });
  } else if (tag.statType === 'upcoming_fixture') {
    if (!form.upcomingFixture) {
      console.warn('Script tagged upcoming_fixture but no upcoming fixture is available, skipping');
      continue;
    }
    timeline.push({
      type: 'upcomingFixture',
      startTime,
      durationSeconds,
      props: {
        teamBadge,
        teamColor: form.team.color,
        opponent: form.upcomingFixture.opponent,
        opponentBadge,
        opponentColor: form.upcomingFixture.opponentColor,
        date: form.upcomingFixture.date,
        competition: form.upcomingFixture.competition,
      },
    });
  } else {
    console.warn(`Unrecognized statType "${tag.statType}", skipping`);
  }
}

// Static identity for the cover card, same role matchInfo plays for match
// videos — playerInfo already carries id/team/competition; add what the
// cover card needs to render (badge/photo) alongside it.
const playerInfoOut = {
  ...playerInfo,
  teamBadge,
  playerPhoto,
  teamColor: form.team.color,
  outroStart: blockStartTimes.find((b) => b.name === 'outro')?.startTime ?? null,
};

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-timeline.json`);
await writeFile(outputPath, JSON.stringify({timeline, playerInfo: playerInfoOut}, null, 2));

console.log(`Saved: ${outputPath} (${timeline.length} stat cards)`);
console.log(JSON.stringify(timeline, null, 2));
