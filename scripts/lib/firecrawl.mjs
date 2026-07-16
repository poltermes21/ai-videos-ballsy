import {fetchWithRetry} from './http.mjs';

export async function searchHeadlines(query, limit = 5) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('Missing FIRECRAWL_API_KEY env var.');
  }

  const res = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({query, limit}),
  });

  if (!res.ok) {
    throw new Error(`Firecrawl request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(`Firecrawl error: ${JSON.stringify(json)}`);
  }

  return json.data;
}

export async function scrapeArticle(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('Missing FIRECRAWL_API_KEY env var.');
  }

  const res = await fetchWithRetry('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({url, formats: ['markdown']}),
  });

  if (!res.ok) {
    throw new Error(`Firecrawl scrape failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(`Firecrawl scrape error: ${JSON.stringify(json)}`);
  }

  return json.data.markdown ?? '';
}

// Firecrawl can return HTTP 200 for a blocked/consent/paywall page — success
// doesn't mean the content is a real article.
const JUNK_SIGNS = [
  'blocked by an extension',
  'err_blocked_by_client',
  'enable javascript',
  'access denied',
  'subscribe to continue',
  'checking your browser',
  'are you a robot',
  'accept cookies',
];

export function isLikelyValidArticle(markdown, minLength = 500) {
  if (!markdown || markdown.length < minLength) {
    return false;
  }
  const lower = markdown.toLowerCase();
  return !JUNK_SIGNS.some((sign) => lower.includes(sign));
}
