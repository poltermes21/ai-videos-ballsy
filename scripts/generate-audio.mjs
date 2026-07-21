// Usage: node --env-file=.env scripts/generate-audio.mjs <fixtureId>

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchWithRetry} from './lib/http.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
if (!apiKey) {
  console.error('Missing ELEVENLABS_API_KEY. Add it to .env.');
  process.exit(1);
}
if (!voiceId) {
  console.error('Missing ELEVENLABS_VOICE_ID. Add it to .env.');
  process.exit(1);
}

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node --env-file=.env scripts/generate-audio.mjs <fixtureId>');
  process.exit(1);
}

const filePath = join(OUTPUT_DIR, `${fixtureId}.json`);
const saved = JSON.parse(await readFile(filePath, 'utf8'));
if (saved.reviewStatus !== 'approved') {
  console.error(
    `Script ${fixtureId} is not approved (reviewStatus: ${saved.reviewStatus}). Run review-script.mjs first.`,
  );
  process.exit(1);
}

const {script} = saved;
const blocks = [
  script.hook,
  ...script.key_moments,
  ...(script.controversy ? [script.controversy] : []),
  script.result,
  script.outro,
];

// Concatenate every segment's text, tracking each segment's character offset
// in the full string — needed later to map expression changes to timestamps
// via the ElevenLabs alignment.
let fullText = '';
const segmentOffsets = [];
for (const block of blocks) {
  for (const segment of block.segments) {
    if (fullText.length > 0) {
      fullText += ' ';
    }
    const start = fullText.length;
    fullText += segment.text;
    segmentOffsets.push({
      start,
      end: fullText.length,
      expression: segment.expression,
      text: segment.text,
    });
  }
}

console.log(`Full text (${fullText.length} chars):\n${fullText}\n`);

const res = await fetchWithRetry(
  `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
  {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: fullText,
      model_id: 'eleven_multilingual_v2',
      // Lower stability + added style push the delivery toward more
      // animated/energetic rather than flat — a mascot voice, not a
      // calm narrator, regardless of which voice is selected.
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true,
      },
    }),
  },
);

if (!res.ok) {
  throw new Error(`ElevenLabs request failed: ${res.status} ${res.statusText}`);
}

const json = await res.json();
const audioBuffer = Buffer.from(json.audio_base64, 'base64');
const {characters, character_start_times_seconds, character_end_times_seconds} =
  json.alignment;

await mkdir(PUBLIC_AUDIO_DIR, {recursive: true});
const audioPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}.mp3`);
await writeFile(audioPath, audioBuffer);

const alignmentPath = join(OUTPUT_DIR, `${fixtureId}-alignment.json`);
await writeFile(
  alignmentPath,
  JSON.stringify(
    {
      fullText,
      segmentOffsets,
      characters,
      character_start_times_seconds,
      character_end_times_seconds,
    },
    null,
    2,
  ),
);

const durationSeconds = character_end_times_seconds.at(-1);

console.log(`Saved audio: ${audioPath}`);
console.log(`Saved alignment: ${alignmentPath}`);
console.log(`Characters aligned: ${characters.length}`);
console.log(`Audio duration: ${durationSeconds.toFixed(2)}s`);
