// Usage: node scripts/generate-expressions.mjs <fixtureId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node scripts/generate-expressions.mjs <fixtureId>');
  process.exit(1);
}

const {segmentOffsets, character_start_times_seconds, character_end_times_seconds} =
  JSON.parse(
    await readFile(join(OUTPUT_DIR, `${fixtureId}-alignment.json`), 'utf8'),
  );

// Cartoons don't hold an extreme expression for the whole time a character
// is talking — it punches in as a brief reaction, then the face relaxes back
// to neutral while the sentence keeps going. So non-neutral expressions get a
// short accent at the start of their segment, then fall back to neutral for
// the rest of it, instead of holding for the segment's full duration.
const EXPRESSION_HOLD_SECONDS = 0.9;

const expressionCues = [];
segmentOffsets.forEach((segment, i) => {
  const start = character_start_times_seconds[segment.start];
  const end =
    i < segmentOffsets.length - 1
      ? character_start_times_seconds[segmentOffsets[i + 1].start]
      : character_end_times_seconds.at(-1);

  if (segment.expression === 'neutral') {
    expressionCues.push({start, end, expression: 'neutral'});
    return;
  }

  const holdEnd = Math.min(start + EXPRESSION_HOLD_SECONDS, end);
  expressionCues.push({start, end: holdEnd, expression: segment.expression});
  if (holdEnd < end) {
    expressionCues.push({start: holdEnd, end, expression: 'neutral'});
  }
});

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-expressions.json`);
await writeFile(outputPath, JSON.stringify({expressionCues}, null, 2));

console.log(`Saved expressions: ${outputPath}`);
console.log(`Expression cues: ${expressionCues.length}`);
console.log(JSON.stringify(expressionCues, null, 2));
