// Usage: node --env-file=.env scripts/fetch-match-headlines.mjs

import {searchHeadlines} from './lib/firecrawl.mjs';

const QUERY = 'Croatia Morocco World Cup 2022 third place playoff';

const results = await searchHeadlines(QUERY);

for (const result of results) {
  console.log(`- ${result.title}\n  ${result.url}\n  ${result.description ?? ''}\n`);
}
