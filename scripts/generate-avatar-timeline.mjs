// Usage: node scripts/generate-avatar-timeline.mjs <fixtureId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeBlockStartTimes} from './lib/script-timing.mjs';
import {fixtureOutputPath} from './lib/run-paths.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node scripts/generate-avatar-timeline.mjs <fixtureId>');
  process.exit(1);
}

const {script} = JSON.parse(await readFile(fixtureOutputPath(fixtureId), 'utf8'));
const alignment = JSON.parse(
  await readFile(fixtureOutputPath(fixtureId, '-alignment'), 'utf8'),
);

const blockStartTimes = computeBlockStartTimes(script, alignment);
const keyMomentEntries = blockStartTimes.filter((b) => b.moment);

if (keyMomentEntries.length === 0) {
  throw new Error('Script has no key_moments — nothing to build an avatar timeline from.');
}

const hookEnd = keyMomentEntries[0].startTime;
const lastKeyMomentIndex = blockStartTimes.indexOf(keyMomentEntries.at(-1));
const keyMomentsEnd = blockStartTimes[lastKeyMomentIndex + 1].startTime;

// Ballsy is a fixed "cam" pinned to the top of the frame (see ballsy.tsx) —
// this file just decides how TALL that cam is at any moment. Fullscreen (1)
// for hook/controversy/result/outro (unchanged from before — anything
// outside the key-moments span) and for any segment range the script marks
// with `emphasisSegments` (a player-streak aside, etc. — see IDENTITY /
// PLAYER STREAKS in generate-script.mjs's prompt); NORMAL_CAM_FRACTION
// otherwise, i.e. ordinary key-moment narration with its own graphic
// playing in the pitch below. Must match NORMAL_CAM_FRACTION in
// src/ballsy.tsx.
const NORMAL_CAM_FRACTION = 0.42;
const TRANSITION_SECONDS = 0.6;
// Below this much room between an emphasis span ending and its moment's own
// end, stepping back down to NORMAL_CAM_FRACTION doesn't read as a
// transition — see appendMoment's step-down guard below.
const MIN_STEP_DOWN_SECONDS = 0.4;

// Each key moment's own [start, end) window — the next block's start is this
// one's end, same logic keyMomentsEnd above already uses for the last one.
function momentWindow(index) {
  const blockIndex = blockStartTimes.indexOf(keyMomentEntries[index]);
  return {start: keyMomentEntries[index].startTime, end: blockStartTimes[blockIndex + 1].startTime};
}

// The span within [start, end) covered by this moment's own
// emphasisSegments (if the model set any) — collapsed to outer bounds the
// same way the pre-cam system collapsed overlapping graphics, so several
// marked segments in a row expand smoothly once rather than flickering
// per-segment. `entry` is the computeBlockStartTimes() entry for this
// moment — `entry.moment.emphasisSegments` is the model's tag,
// `entry.segmentStartTimes`/`segmentEndTimes` (indexed the same way
// generate-graphics-timeline.mjs indexes them for TaggedEvent.segmentIndex)
// resolve those indices to real times.
function emphasisSpan(entry, start, end) {
  const indices = entry.moment.emphasisSegments ?? [];
  if (indices.length === 0) return null;
  const spans = indices
    .map((i) => ({start: entry.segmentStartTimes?.[i], end: entry.segmentEndTimes?.[i]}))
    .filter((s) => s.start != null && s.end != null)
    .map((s) => ({start: Math.max(s.start, start), end: Math.min(s.end, end)}))
    .filter((s) => s.end > s.start);
  if (spans.length === 0) return null;
  return {
    start: Math.min(...spans.map((s) => s.start)),
    end: Math.max(...spans.map((s) => s.end)),
  };
}

// Appends this moment's keyframes to `keyframes`, which already ends with
// whatever cam height came before (the previous moment's landing spot, or
// the fullscreen hook) at or before `start`. Only ever pushes
// strictly-increasing times: interpolate() requires it, and several of the
// boundaries below (transition windows clamped against a short emphasis
// span, a span starting right at the moment boundary) can otherwise
// collide or go backwards.
function appendMoment(keyframes, start, end, entry) {
  const push = (time, camHeightFraction) => {
    if (time > keyframes.at(-1).time) keyframes.push({time, camHeightFraction});
  };
  const previous = keyframes.at(-1);
  if (start > previous.time) push(start, previous.camHeightFraction);

  const span = emphasisSpan(entry, start, end);

  if (!span) {
    push(Math.min(start + TRANSITION_SECONDS, end), NORMAL_CAM_FRACTION);
    push(end, NORMAL_CAM_FRACTION);
    return;
  }

  const expandAt = Math.max(start, span.start);
  const contractAt = Math.min(end, span.end);

  if (expandAt > start) {
    // Ordinary narration before the emphasised segment(s) — ease to normal, hold, expand.
    push(Math.min(start + TRANSITION_SECONDS, expandAt), NORMAL_CAM_FRACTION);
    push(expandAt, NORMAL_CAM_FRACTION);
  }
  push(Math.min(expandAt + TRANSITION_SECONDS, contractAt), 1);
  if (contractAt < end) {
    push(contractAt, 1);
    // Only step back down to NORMAL if there's actually room for it to read
    // as a transition rather than a flash. When the emphasised segment runs
    // almost to the moment's own end (e.g. it's the last segment spoken
    // before the next block), contractAt sits right next to `end` — stepping
    // down anyway produces a near-instant dip to the split view and back to
    // fullscreen a fraction of a second later, which reads as a glitch, not
    // a cut. Staying fullscreen through `end` in that case blends straight
    // into whatever comes next (also typically fullscreen).
    if (end - contractAt >= MIN_STEP_DOWN_SECONDS) {
      push(Math.min(contractAt + TRANSITION_SECONDS, end), NORMAL_CAM_FRACTION);
    }
  }
  // Always land exactly on the moment's own end, even if every push above
  // got clamped away by a very short span/moment — the next moment (or the
  // final fullscreen return) assumes one exists here.
  push(end, keyframes.at(-1).camHeightFraction);
}

const keyframes = [
  {time: 0, camHeightFraction: 1},
  {time: hookEnd, camHeightFraction: 1},
];

for (let i = 0; i < keyMomentEntries.length; i++) {
  const {start, end} = momentWindow(i);
  appendMoment(keyframes, start, end, keyMomentEntries[i]);
}

const lastNormal = keyframes.at(-1);
if (keyMomentsEnd > lastNormal.time) {
  keyframes.push({time: keyMomentsEnd, camHeightFraction: lastNormal.camHeightFraction});
}
keyframes.push({time: keyMomentsEnd + TRANSITION_SECONDS, camHeightFraction: 1});

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-avatar.json`);
await writeFile(outputPath, JSON.stringify({keyframes}, null, 2));

console.log(`Saved: ${outputPath}`);
console.log(JSON.stringify(keyframes, null, 2));
