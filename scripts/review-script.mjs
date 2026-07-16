// Usage: node scripts/review-script.mjs <fixtureId>

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output');

const fixtureId = process.argv[2];
if (!fixtureId) {
  console.error('Usage: node scripts/review-script.mjs <fixtureId>');
  process.exit(1);
}

const filePath = join(OUTPUT_DIR, `${fixtureId}.json`);
const saved = JSON.parse(await readFile(filePath, 'utf8'));
const {script} = saved;

function renderBlock(name, block) {
  const text = block.segments.map((s) => `[${s.expression}] ${s.text}`).join(' ');
  console.log(`\n${name.toUpperCase()}:\n  ${text}`);
}

renderBlock('hook', script.hook);
script.key_moments.forEach((m, i) =>
  renderBlock(`key_moment[${i}] (min ${m.minute ?? '?'})`, m),
);
if (script.controversy) {
  renderBlock('controversy', script.controversy);
}
renderBlock('result', script.result);
renderBlock('outro', script.outro);

const rl = createInterface({input: process.stdin, output: process.stdout});
const answer = await rl.question('\nApprove this script? [y/n] ');
rl.close();

const approved = answer.trim().toLowerCase().startsWith('y');
saved.reviewStatus = approved ? 'approved' : 'rejected';
saved.reviewedAt = new Date().toISOString();

await writeFile(filePath, JSON.stringify(saved, null, 2));
console.log(`\nMarked as ${saved.reviewStatus}.`);
