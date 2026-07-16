// Generates Ballsy's match script from API-Football events + Firecrawl headlines.
//
// Usage: node --env-file=.env scripts/generate-script.mjs

import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import {findWorldCupFixtureAndEvents} from './lib/api-football.mjs';
import {isLikelyValidArticle, scrapeArticle, searchHeadlines} from './lib/firecrawl.mjs';

const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error(
    'Missing ANTHROPIC_API_KEY. Add it to .env, then run with:\n' +
      '  node --env-file=.env scripts/generate-script.mjs',
  );
  process.exit(1);
}

const Expression = z.enum([
  'neutral',
  'excited',
  'angry',
  'disappointed',
  'surprised',
]);

// Segments (not one flat string) so the expression can change mid-block
// instead of staying static across a whole 5-50s line.
const ExpressionSegment = z.object({
  text: z.string(),
  expression: Expression,
});

const TextBlock = z.object({
  segments: z.array(ExpressionSegment),
});

const KeyMoment = z.object({
  minute: z.number().nullable(),
  event_type: z.string().nullable(),
  segments: z.array(ExpressionSegment),
});

const Script = z.object({
  hook: TextBlock,
  key_moments: z.array(KeyMoment),
  controversy: TextBlock.nullable(),
  result: TextBlock,
  outro: TextBlock,
});

const SYSTEM_PROMPT = `You write the script for Ballsy, a cartoon-football mascot recapping a match. Ballsy talks like your buddy from the neighborhood catching you up on the game he just watched — NOT a broadcaster, NOT a news anchor, NOT a robot reading stats. Casual, opinionated, a little cocky sometimes. Use contractions, asides, rhetorical reactions ("no way that stayed onside", "and here's the thing...", "I mean, come on"). If a sentence sounds like it belongs on the evening news, rewrite it looser.

CRITICAL RULE: you are a commentator, not a data narrator. Decide what deserves to be told using narrative judgment. For each event ask: did this change the match? Did it create tension? Is it what someone would talk about the next day?

Concrete filtering rules:
- A routine card in a low-tension moment: skip it.
- A card after a brawl or major flashpoint: mention it.
- A glaring miss with the game close: mention it, even if minor in the data.
- A substitution: only mention it if that player appears in a LATER event (scored, assisted, booked). Otherwise it's noise — skip it.

GROUNDING RULE: only state as fact what's actually present in the match data, headlines, or article excerpts you're given below. Do NOT invent historical stats, records, streaks, or trivia ("back-to-back third-place finishes", "his fifth goal of the tournament", etc.) unless that exact fact appears in the provided input. Casual tone does not mean casual with the truth — if you don't have a fact grounded in the input, don't say it as one.

You'll get real article excerpts (scraped from match reports) alongside the structured events. Use them to describe HOW each key moment actually happened — the buildup, the type of finish, the reaction — instead of just stating that it happened. API-Football's own data only gives you a bare label like "Normal Goal"; the article text is where the actual story is.

DURATION REQUIREMENT — this is a short-form video and it must run 30-90 seconds read aloud, which at a casual conversational pace is roughly 140-220 words total across every block. If a draft feels short, do NOT pad it with filler — add real texture to the key moments using the article excerpts (how the goal happened, who set it up, the stakes in that moment). A recap that's just a list of bare facts will always come in short; a recap with a story for each moment won't.

Output exactly 5 blocks:
1. hook — 5-10s, ~15-25 words. Teases that something happened.
2. key_moments — 40-65s, ~110-160 words total, 2 to 4 moments MAX. Chronological walkthrough of only the moments that matter, picked per the filtering rules above, each one telling the actual story of how it happened.
3. controversy — optional (null if there wasn't one), ~20-30 words. Only if a moment was genuinely controversial. Frame it explicitly as opinion/perspective ("for me...", "I think...", "it looked like..."), never as a factual claim about a real person.
4. result — 10-15s, ~30-45 words. Final score + what it means.
5. outro — ~15-20 words. Short hook to the next match.

Each block (and each moment inside key_moments) is written as a list of SEGMENTS, not one flat string. A segment is {text, expression}, and the segments concatenate in order (joined by a space) to form the full spoken line. Split into a new segment whenever the emotional beat genuinely shifts — do NOT switch expression every few words, that looks twitchy. Guideline: short blocks (hook, outro) usually need only 1-2 segments; a key moment with real buildup-then-payoff texture can reasonably use 2-3. Expression options: neutral, excited, angry, disappointed, surprised.

You may reference real player and team names in the text (this is spoken commentary, not a visual) — but the controversy block must stay opinion-framed, never a factual accusation about a real person.`;

// Optional CLI arg picks which finished fixture to use, counting back from
// the most recent (1 = last, 2 = second-to-last, ...).
const fromEnd = Number(process.argv[2]) || 1;
const {fixture, events} = await findWorldCupFixtureAndEvents(2022, fromEnd);

const query = `${fixture.teams.home.name} ${fixture.teams.away.name} World Cup ${fixture.league.season}`;
const headlines = await searchHeadlines(query, 8);

console.log(`\nHeadlines found (${headlines.length}):`);
for (const h of headlines) {
  console.log(`  - ${h.title}\n    ${h.url}`);
}

const VIDEO_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'dailymotion.com',
  'tiktok.com',
  'vimeo.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'facebook.com',
];
const TARGET_ARTICLE_COUNT = 2;

// Scrape real articles for play-by-play detail; headlines alone are just
// titles/snippets. Walk the candidates in order and keep trying the next one
// whenever a scrape fails or comes back blocked/junk, until we hit the
// target count or run out of candidates.
const articleCandidates = headlines
  .filter((h) => !VIDEO_DOMAINS.some((domain) => h.url.includes(domain)))
  .map((h) => h.url);

console.log(`\nScraping article text (target ${TARGET_ARTICLE_COUNT}):`);
const articleExcerpts = [];
for (const url of articleCandidates) {
  if (articleExcerpts.length >= TARGET_ARTICLE_COUNT) {
    break;
  }
  try {
    const markdown = await scrapeArticle(url);
    if (!isLikelyValidArticle(markdown)) {
      console.log(`  skipped ${url}: looks like a blocked/junk page`);
      continue;
    }
    const excerpt = markdown.slice(0, 3000);
    articleExcerpts.push({url, excerpt});
    console.log(`  scraped ${url} (${markdown.length} chars scraped, ${excerpt.length} used)`);
    console.log(`    "${excerpt.slice(0, 200).replace(/\s+/g, ' ')}..."`);
  } catch (err) {
    console.log(`  skipped ${url}: ${err.message}`);
  }
}
console.log('');

const matchData = {
  match: {
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    score: `${fixture.goals.home}-${fixture.goals.away}`,
    date: fixture.fixture.date,
  },
  events: events.map((e) => ({
    minute: e.time.elapsed,
    team: e.team.name,
    player: e.player.name,
    assist: e.assist.name,
    type: e.type,
    detail: e.detail,
    comments: e.comments,
  })),
  headlines: headlines.map((h) => ({
    title: h.title,
    url: h.url,
    description: h.description,
  })),
  articleExcerpts,
};

const client = new Anthropic({apiKey: ANTHROPIC_API_KEY});

const response = await client.messages.parse({
  model: 'claude-sonnet-5',
  // Adaptive thinking shares this budget with the output; 2048 truncated the
  // JSON mid-string on harder cases.
  max_tokens: 8192,
  system: SYSTEM_PROMPT,
  output_config: {format: zodOutputFormat(Script)},
  messages: [{role: 'user', content: JSON.stringify(matchData, null, 2)}],
});

const script = response.parsed_output;
if (!script) {
  throw new Error('Model output did not parse against the schema.');
}

if (script.key_moments.length < 2 || script.key_moments.length > 4) {
  throw new Error(
    `key_moments must have 2-4 entries, got ${script.key_moments.length}`,
  );
}

const blocksWithSegments = [
  ['hook', script.hook],
  ...script.key_moments.map((m, i) => [`key_moments[${i}]`, m]),
  ...(script.controversy ? [['controversy', script.controversy]] : []),
  ['result', script.result],
  ['outro', script.outro],
];
for (const [name, block] of blocksWithSegments) {
  if (block.segments.length === 0) {
    throw new Error(`${name} has no segments`);
  }
}

await mkdir(OUTPUT_DIR, {recursive: true});
const outputPath = join(OUTPUT_DIR, `${fixture.fixture.id}.json`);
await writeFile(
  outputPath,
  JSON.stringify({reviewStatus: 'pending', reviewedAt: null, script}, null, 2),
);

const allText = blocksWithSegments
  .flatMap(([, block]) => block.segments)
  .map((s) => s.text)
  .join(' ');
const wordCount = allText.trim().split(/\s+/).length;

console.log(`Saved: ${outputPath}`);
console.log(
  `Word count: ${wordCount} (~${Math.round(wordCount / 2.6)}-${Math.round(wordCount / 1.7)}s at a casual pace)`,
);
console.log(
  `Review with: node --env-file=.env scripts/review-script.mjs ${fixture.fixture.id}`,
);
console.log(JSON.stringify(script, null, 2));
