// Usage: node --env-file=.env scripts/list-voices.mjs

import {fetchWithRetry} from './lib/http.mjs';

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('Missing ELEVENLABS_API_KEY. Add it to .env.');
  process.exit(1);
}

const res = await fetchWithRetry('https://api.elevenlabs.io/v1/voices', {
  headers: {'xi-api-key': apiKey},
});

if (!res.ok) {
  throw new Error(`ElevenLabs request failed: ${res.status} ${res.statusText}`);
}

const json = await res.json();

for (const voice of json.voices) {
  console.log(`${voice.name} (${voice.voice_id})`);
  console.log(`  category: ${voice.category}`);
  if (voice.preview_url) {
    console.log(`  preview: ${voice.preview_url}`);
  }
  console.log('');
}
