// Usage: node scripts/generate-visemes.mjs <fixtureId>

import {execFile} from 'node:child_process';
import {readFile, unlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPTS_DIR, 'output');
const PUBLIC_AUDIO_DIR = join(SCRIPTS_DIR, '..', 'public', 'audio');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node scripts/generate-visemes.mjs <fixtureId>');
  process.exit(1);
}

const mp3Path = join(PUBLIC_AUDIO_DIR, `${fixtureId}.mp3`);
const wavPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}.wav`);
const dialogPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-dialog.txt`);
const visemesPath = join(PUBLIC_AUDIO_DIR, `${fixtureId}-visemes.json`);

const {fullText} = JSON.parse(
  await readFile(join(OUTPUT_DIR, `${fixtureId}-alignment.json`), 'utf8'),
);

console.log('Converting audio to WAV...');
await execFileAsync('ffmpeg', ['-y', '-i', mp3Path, wavPath]);

await writeFile(dialogPath, fullText);

console.log('Running Rhubarb...');
await execFileAsync('rhubarb', ['-f', 'json', '-d', dialogPath, '-o', visemesPath, wavPath]);

await unlink(dialogPath);

const visemes = JSON.parse(await readFile(visemesPath, 'utf8'));

console.log(`Saved visemes: ${visemesPath}`);
console.log(`Mouth cues: ${visemes.mouthCues.length}`);
