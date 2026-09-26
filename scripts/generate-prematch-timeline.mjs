// Builds the per-fixture preview-card timeline: for each key moment,
// resolves the script's tagged preview points to real on-screen timing and
// props, sliced straight out of the pre-match context saved alongside the
// script (already grounded — like generate-player-timeline.mjs, and unlike
// generate-graphics-timeline.mjs, there is no separate "real event" to
// cross-reference against, a form/table/streak number IS the ground truth).
// Output feeds the preview-card <Sequence> layer in src/ballsyPrematch.tsx.
//
// Usage: node --env-file=.env scripts/generate-prematch-timeline.mjs <fixtureId>
//   fixtureId is the full "prematch-<matchId>[-<runSlug>]" run id (see
//   scripts/generate-prematch-script.mjs) — the same fully-qualified id every
//   other fixtureId-generic step takes (generate-audio.mjs etc.), rather than
//   a bare match id; everything it needs about the fixture comes from the
//   saved script's own matchInfo/prematchContext instead of a second CLI
//   argument.
//
// Unlike the recap timeline, this deliberately does NOT re-fetch the fixture
// for fresh numbers: the saved context is what the model actually wrote the
// script from, and either team could have played another match in between,
// which would put a number on screen that contradicts what Ballsy says. Only
// the badge/logo images are fetched (they're static per team).

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureTeamBadge, ensureTournamentLogo} from './lib/match-source.mjs';
import {computeBlockStartTimes} from './lib/script-timing.mjs';
import {fixtureOutputPath} from './lib/run-paths.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node --env-file=.env scripts/generate-prematch-timeline.mjs <fixtureId>');
  process.exit(1);
}

const saved = JSON.parse(await readFile(fixtureOutputPath(fixtureId), 'utf8'));
const {script, matchInfo, prematchContext, prediction} = saved;
const alignment = JSON.parse(await readFile(fixtureOutputPath(fixtureId, '-alignment'), 'utf8'));

// Same reveal-delay/min-duration constants as generate-graphics-timeline.mjs
// and generate-player-timeline.mjs, so a card reveals near the line's actual
// payoff word rather than its first.
const REVEAL_DELAY_FRACTION = 0.25;
const REVEAL_DELAY_MAX_SECONDS = 1.2;
const MIN_DURATION_SECONDS = 3;

const blockStartTimes = computeBlockStartTimes(script, alignment);
const taggedPreviews = blockStartTimes
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

// Same overlap-bisection as the other two timeline generators — two points
// narrated in the same line would otherwise get identical windows and stack.
for (let i = 0; i < taggedPreviews.length - 1; i++) {
  const current = taggedPreviews[i];
  const next = taggedPreviews[i + 1];
  const currentEnd = current.startTime + current.durationSeconds;
  if (next.startTime >= currentEnd) continue;

  const windowStart = current.startTime;
  const windowEnd = Math.max(currentEnd, next.startTime + next.durationSeconds);
  const half = (windowEnd - windowStart) / 2;
  current.durationSeconds = Math.max(MIN_DURATION_SECONDS, half);
  next.startTime = windowStart + current.durationSeconds;
  next.durationSeconds = Math.max(MIN_DURATION_SECONDS, windowEnd - next.startTime);
}

// Badges/logo must exist on disk before the render starts — Remotion can't
// fetch anything itself at render time (same rule generate-graphics-timeline.mjs
// follows).
const homeBadge = ensureTeamBadge(matchInfo.homeId);
const awayBadge = ensureTeamBadge(matchInfo.awayId);
const tournamentLogo = ensureTournamentLogo(matchInfo.tournamentId);

const homeColor = matchInfo.homeColors?.primary ?? null;
const awayColor = matchInfo.awayColors?.primary ?? null;

// The two teams' shared identity, spread into every card so each graphic can
// show a real badge without re-deriving any of it.
const teams = {
  homeCode: matchInfo.homeCode ?? matchInfo.home,
  homeBadge,
  homeColor,
  awayCode: matchInfo.awayCode ?? matchInfo.away,
  awayBadge,
  awayColor,
};

const form = prematchContext?.form ?? null;
const standings = prematchContext?.standings ?? null;
const h2h = prematchContext?.h2h ?? null;
const teamStreaks = prematchContext?.teamStreaks ?? null;

const timeline = [];

for (const tag of taggedPreviews) {
  const {startTime, durationSeconds} = tag;

  if (tag.statType === 'team_form') {
    // /pregame-form isn't published for every fixture (a match still weeks
    // out often has none) — a form card with no form is a blank card, so
    // drop it rather than render one.
    if (!form?.home?.last5 && !form?.away?.last5) {
      console.warn('Script tagged team_form but no pre-match form data is available, skipping');
      continue;
    }
    timeline.push({
      type: 'teamFormCompare',
      startTime,
      durationSeconds,
      props: {...teams, homeLast5: form?.home?.last5 ?? null, awayLast5: form?.away?.last5 ?? null},
    });
  } else if (tag.statType === 'table_position') {
    if (!standings?.home && !standings?.away) {
      console.warn('Script tagged table_position but no standings are available, skipping');
      continue;
    }
    timeline.push({
      type: 'tablePosition',
      startTime,
      durationSeconds,
      props: {
        ...teams,
        competition: matchInfo.tournament ?? null,
        homePosition: standings?.home?.position ?? null,
        homePoints: standings?.home?.points ?? null,
        homePlayed: standings?.home?.played ?? null,
        awayPosition: standings?.away?.position ?? null,
        awayPoints: standings?.away?.points ?? null,
        awayPlayed: standings?.away?.played ?? null,
      },
    });
  } else if (tag.statType === 'h2h_record') {
    if (!h2h) {
      console.warn('Script tagged h2h_record but no head-to-head data is available, skipping');
      continue;
    }
    timeline.push({
      type: 'h2h',
      startTime,
      durationSeconds,
      props: {...teams, homeWins: h2h.homeWins, draws: h2h.draws, awayWins: h2h.awayWins},
    });
  } else if (tag.statType === 'team_streak') {
    if (!teamStreaks?.home && !teamStreaks?.away) {
      console.warn('Script tagged team_streak but no team-streak data is available, skipping');
      continue;
    }
    timeline.push({
      type: 'teamStreak',
      startTime,
      durationSeconds,
      props: {...teams, homeStreak: teamStreaks?.home ?? null, awayStreak: teamStreaks?.away ?? null},
    });
  } else if (tag.statType === 'injury_news') {
    // The one card with no structured source — see TeamNewsGraphic's own
    // note. No headline written means nothing grounded to put on screen.
    if (!tag.note || !tag.team) {
      console.warn('Script tagged injury_news without a note/team, skipping');
      continue;
    }
    const isHome = tag.team === 'home';
    timeline.push({
      type: 'teamNews',
      startTime,
      durationSeconds,
      props: {
        code: isHome ? teams.homeCode : teams.awayCode,
        badge: isHome ? homeBadge : awayBadge,
        color: isHome ? homeColor : awayColor,
        headline: tag.note,
      },
    });
  } else {
    console.warn(`Unrecognized statType "${tag.statType}", skipping`);
  }
}

timeline.sort((a, b) => a.startTime - b.startTime);

// The prediction card is emitted on its own, NOT inside `timeline`, for two
// reasons:
//
//  1. It isn't script-tagged like the others. It always belongs on the
//     result block, which for a preview IS the prediction (see
//     generate-prematch-script.mjs), and it's built from the model's own
//     structured `prediction` field so the card can never back a different
//     team than the spoken line does.
//  2. By the result block the cam is always FULLSCREEN — generate-avatar-
//     timeline.mjs returns camHeightFraction to 1 right after the last key
//     moment, for every video type. A card in the ordinary content layer
//     would be completely covered by Ballsy at exactly the beat it matters
//     most, so the composition renders this one as an overlay on top of him
//     instead (see src/ballsyPrematch.tsx).
const resultBlock = blockStartTimes.find((b) => b.name === 'result');
let predictionCard = null;
if (prediction && resultBlock) {
  const blockEnd = resultBlock.segmentEndTimes?.at(-1) ?? resultBlock.startTime + MIN_DURATION_SECONDS;
  const delay = Math.min((blockEnd - resultBlock.startTime) * REVEAL_DELAY_FRACTION, REVEAL_DELAY_MAX_SECONDS);
  const startTime = resultBlock.startTime + delay;
  predictionCard = {
    startTime,
    durationSeconds: Math.max(MIN_DURATION_SECONDS, blockEnd - startTime),
    props: {...teams, pick: prediction.pick, pickTeam: prediction.team ?? null},
  };
} else if (!prediction) {
  console.warn('No prediction field saved with this script — no call-out card will be shown.');
}

// Static fixture identity for the cover card, same role matchInfo plays for
// a recap and playerInfo for a form check. Deliberately carries no score —
// the match hasn't been played.
const matchInfoOut = {
  ...matchInfo,
  homeBadge,
  awayBadge,
  homeColor,
  awayColor,
  tournamentLogo,
  outroStart: blockStartTimes.find((b) => b.name === 'outro')?.startTime ?? null,
};

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-timeline.json`);
await writeFile(
  outputPath,
  JSON.stringify({timeline, prediction: predictionCard, matchInfo: matchInfoOut}, null, 2),
);

console.log(
  `Saved: ${outputPath} (${timeline.length} preview cards` +
    `${predictionCard ? ' + the prediction overlay' : ', no prediction overlay'})`,
);
console.log(JSON.stringify({timeline, prediction: predictionCard}, null, 2));
