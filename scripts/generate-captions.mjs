// Builds word-level captions (@remotion/captions `Caption[]` shape) straight
// from the ElevenLabs per-character alignment — no ASR/transcription needed,
// this timing is exact since it's the same data ElevenLabs used to speak it.
//
// Usage: node scripts/generate-captions.mjs <fixtureId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node scripts/generate-captions.mjs <fixtureId>');
  process.exit(1);
}

const {characters, character_start_times_seconds, character_end_times_seconds} =
  JSON.parse(await readFile(join(OUTPUT_DIR, `${fixtureId}-alignment.json`), 'utf8'));

// Split into words at whitespace boundaries, tracking each word's start/end
// character index so its timing can be read straight off the aligned arrays.
const captions = [];
let wordChars = [];
let wordStartIndex = null;

function flushWord() {
  if (wordChars.length === 0) return;
  const wordEndIndex = wordStartIndex + wordChars.length - 1;
  captions.push({
    // A leading space (not trailing) on every word but the first — per
    // @remotion/captions' whitespace convention — so pages/tokens concatenate
    // back into normally-spaced text.
    text: (captions.length === 0 ? '' : ' ') + wordChars.join(''),
    startMs: character_start_times_seconds[wordStartIndex] * 1000,
    endMs: character_end_times_seconds[wordEndIndex] * 1000,
    timestampMs: null,
    confidence: null,
  });
  wordChars = [];
  wordStartIndex = null;
}

for (let i = 0; i < characters.length; i++) {
  const ch = characters[i];
  if (/\s/.test(ch)) {
    flushWord();
    continue;
  }
  if (wordStartIndex === null) wordStartIndex = i;
  wordChars.push(ch);
}
flushWord();

const outputPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-captions.json`);
await writeFile(outputPath, JSON.stringify({captions}, null, 2));

console.log(`Saved: ${outputPath} (${captions.length} words)`);
