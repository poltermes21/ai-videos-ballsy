// Usage: node scripts/generate-avatar-timeline.mjs <fixtureId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeBlockStartTimes} from './lib/script-timing.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node scripts/generate-avatar-timeline.mjs <fixtureId>');
  process.exit(1);
}

const {script} = JSON.parse(await readFile(join(OUTPUT_DIR, `${fixtureId}.json`), 'utf8'));
const alignment = JSON.parse(
  await readFile(join(OUTPUT_DIR, `${fixtureId}-alignment.json`), 'utf8'),
);

const blockStartTimes = computeBlockStartTimes(script, alignment);
const keyMomentEntries = blockStartTimes.filter((b) => b.moment);

if (keyMomentEntries.length === 0) {
  throw new Error('Script has no key_moments — nothing to build an avatar timeline from.');
}

const hookEnd = keyMomentEntries[0].startTime;
const lastKeyMomentIndex = blockStartTimes.indexOf(keyMomentEntries.at(-1));
const keyMomentsEnd = blockStartTimes[lastKeyMomentIndex + 1].startTime;

// Ballsy is big & centered for hook/controversy/result/outro, and floats
// smaller in a corner "zone" during key moments — moving to a different
// zone each new moment, with a smooth (not instant) transition, instead of a
// rigid streamer-cam frame that jumps between fixed slots.
const FLOAT_SCALE = 0.42;
const TRANSITION_SECONDS = 0.6;
const ZONES = [
  {x: -0.22, y: -0.22},
  {x: 0.22, y: -0.22},
  {x: -0.22, y: 0.22},
  {x: 0.22, y: 0.22},
];

const keyframes = [{time: 0, scale: 1, x: 0, y: 0}];

const firstZone = ZONES[0];
keyframes.push({time: hookEnd, scale: 1, x: 0, y: 0});
keyframes.push({time: hookEnd + TRANSITION_SECONDS, scale: FLOAT_SCALE, x: firstZone.x, y: firstZone.y});

for (let i = 1; i < keyMomentEntries.length; i++) {
  const zone = ZONES[i % ZONES.length];
  const start = keyMomentEntries[i].startTime;
  const previous = keyframes.at(-1);
  keyframes.push({time: start, scale: FLOAT_SCALE, x: previous.x, y: previous.y});
  keyframes.push({time: start + TRANSITION_SECONDS, scale: FLOAT_SCALE, x: zone.x, y: zone.y});
}

const lastFloating = keyframes.at(-1);
keyframes.push({time: keyMomentsEnd, scale: FLOAT_SCALE, x: lastFloating.x, y: lastFloating.y});
keyframes.push({time: keyMomentsEnd + TRANSITION_SECONDS, scale: 1, x: 0, y: 0});

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-avatar.json`);
await writeFile(outputPath, JSON.stringify({keyframes}, null, 2));

console.log(`Saved: ${outputPath}`);
console.log(JSON.stringify(keyframes, null, 2));
