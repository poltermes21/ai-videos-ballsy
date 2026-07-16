import {fetchWithRetry} from './http.mjs';

const BASE_URL = 'https://v3.football.api-sports.io';

async function apiGet(apiKey, path) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    headers: {'x-apisports-key': apiKey},
  });
  if (!res.ok) {
    throw new Error(`API-Football request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  // API-Football returns HTTP 200 even for plan/quota errors — the failure is
  // only visible in this `errors` field.
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

// The free plan only covers seasons 2022-2024, not the real 2026 World Cup —
// season defaults to 2022 as a stand-in. `fromEnd` counts back from the most
// recent finished fixture (1 = last, 2 = second-to-last, ...).
export async function findWorldCupFixtureAndEvents(season = 2022, fromEnd = 1) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    throw new Error('Missing API_FOOTBALL_KEY env var.');
  }

  const leagues = await apiGet(apiKey, '/leagues?search=World Cup');
  const worldCup = leagues.response.find((l) => l.league.name === 'World Cup');
  if (!worldCup) {
    throw new Error('Could not find a league named exactly "World Cup" in the response.');
  }

  const fixtures = await apiGet(
    apiKey,
    `/fixtures?league=${worldCup.league.id}&season=${season}&status=FT`,
  );
  const fixture = fixtures.response.at(-fromEnd);
  if (!fixture) {
    throw new Error(`No finished ${season} World Cup fixture at position -${fromEnd}.`);
  }

  const eventsResponse = await apiGet(
    apiKey,
    `/fixtures/events?fixture=${fixture.fixture.id}`,
  );

  return {fixture, events: eventsResponse.response};
}
