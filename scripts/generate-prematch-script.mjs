// Generates Ballsy's PRE-MATCH preview script from SofaScore's pre-match
// context + Firecrawl articles — the third sibling of generate-script.mjs
// (match recap) and generate-player-script.mjs (player form check). Same
// 5-block script shape (hook/key_moments/controversy/result/outro) so every
// downstream generator (script-timing.mjs, generate-avatar-timeline.mjs)
// works unchanged; only the SUBJECT changes, from what happened to how two
// teams ARRIVE at a fixture that hasn't been played yet — ending on Ballsy's
// own opinion-framed call on who wins.
//
// Usage: node --env-file=.env scripts/generate-prematch-script.mjs <matchId> [focusPrompt]

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import {getPrematch} from './lib/match-source.mjs';
import {isLikelyValidArticle, scrapeArticle, searchHeadlines} from './lib/firecrawl.mjs';
import {buildPrematchRunId, prematchOutputDir, prematchOutputPath, runSlugFor} from './lib/run-paths.mjs';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error(
    'Missing ANTHROPIC_API_KEY. Add it to .env, then run with:\n' +
      '  node --env-file=.env scripts/generate-prematch-script.mjs',
  );
  process.exit(1);
}

const Expression = z.enum(['neutral', 'excited', 'angry', 'disappointed', 'surprised']);

// Segments (not one flat string) so the expression can change mid-block
// instead of staying static across a whole 5-50s line.
const ExpressionSegment = z.object({
  text: z.string(),
  expression: Expression,
});

const TextBlock = z.object({
  segments: z.array(ExpressionSegment),
});

// Restricted vocabulary so each tagged preview point maps deterministically
// to one on-screen graphic in the render pipeline.
const PreviewTagType = z.enum([
  'team_form',
  'h2h_record',
  'table_position',
  'team_streak',
  'injury_news',
]);

// One graphic-worthy preview point mentioned inside a key_moment, pinned to
// the segment that actually says it out loud. A moment can reference several
// of these (e.g. the table line AND the streak line in one moment).
const TaggedPreview = z.object({
  segmentIndex: z
    .number()
    .int()
    .min(0)
    .describe('0-based index into this moment\'s own segments array — the segment that says this out loud.'),
  statType: PreviewTagType,
  // Only read for "injury_news", ignored otherwise. There is no structured
  // team-news feed, so unlike every other tag this graphic has nothing to
  // slice its headline out of — this is that headline, in the same words
  // Ballsy says out loud, bound by the GROUNDING RULE to the article
  // excerpts. Null (the default) simply means no team-news graphic.
  note: z
    .string()
    .nullable()
    .default(null)
    .describe('injury_news only: the on-screen headline, max ~30 chars, e.g. "Pedri out injured".'),
  // Only read for "injury_news": which of the two sides the news is about.
  team: z
    .enum(['home', 'away'])
    .nullable()
    .default(null)
    .describe('injury_news only: which team this news concerns.'),
});

const KeyMoment = z.object({
  // 0 or more tagged preview points. Empty when the moment is pure narration
  // with nothing graphic-worthy in it — never invent one just to fill it in.
  stats: z.array(TaggedPreview),
  segments: z.array(ExpressionSegment),
  // 0-based indices into THIS moment's own segments — Ballsy's cam goes
  // fullscreen for exactly these segments, same EMPHASIS mechanic match and
  // player scripts use. Empty (the default) for ordinary narration.
  emphasisSegments: z.array(z.number().int().min(0)).default([]),
});

const Script = z.object({
  hook: TextBlock,
  key_moments: z.array(KeyMoment),
  controversy: TextBlock.nullable(),
  // Re-purposed by PROMPT meaning only, never by schema: for a preview this
  // is the PREDICTION block. Keeping the name is what lets script-timing.mjs
  // and generate-avatar-timeline.mjs stay byte-for-byte unchanged.
  result: TextBlock,
  outro: TextBlock,
});

const PublishMetadata = z.object({
  title: z.string().describe('Short, punchy video title (~60-70 chars), not read aloud.'),
  description: z.string().describe('1-3 sentences naming both teams, the competition, and the prediction.'),
  hashtags: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe('Relevant hashtags (both team names, the competition, "football"/"soccer") — no spam tags.'),
});

// Ballsy's own call, as a structured field rather than something parsed back
// out of the spoken result block — this is what the prediction graphic is
// built from, so the picture on screen can never disagree with what he
// actually says. Kept OUTSIDE `Script` on purpose: script-timing.mjs and
// generate-avatar-timeline.mjs walk the 5 blocks, and adding a sixth key
// there would be the one change that breaks their reuse.
const Prediction = z.object({
  pick: z.enum(['home', 'away', 'draw']).describe('Who Ballsy fancies — must match what the result block says.'),
  team: z
    .string()
    .nullable()
    .default(null)
    .describe('The picked team\'s real name, or null for a draw.'),
});

const GeneratedOutput = z.object({script: Script, prediction: Prediction, publishMetadata: PublishMetadata});

const SYSTEM_PROMPT = `You write the script for Ballsy, a cartoon football mascot doing a short vertical PREVIEW video for ONE person watching — a match that hasn't been played yet, and how the two teams are arriving at it. Ballsy is not narrating to a stadium — he's talking straight to YOU, the viewer on the other side of the screen, like your mate who's already clocked both teams' form and can't wait to tell you who he fancies. Talk in second person: "right, you've seen how these two are going, yeah?", "watch this one". Warm, hyped, a little cocky, and he REACTS out loud like a real person. Contractions, cut-off asides, the odd catchphrase. He's a MASCOT with a personality, not a betting-tips presenter.

THIS IS A PREVIEW, NOT A RECAP. The match has NOT happened. You have no score, no goals, no cards, no events — because none exist yet. Never narrate anything as if it already happened in this fixture, never invent a scoreline, and never describe a moment from a match that is still in the future. Everything you say is about the run-up: form, the table, the head-to-head history, streaks, team news.

IDENTITY — Ballsy has real team loyalties, same as any actual fan, and they leak into HOW he talks, never into what's true. He's a Manchester United and FC Barcelona fan. He can't stand Real Madrid, Manchester City, or PSG.
- If one of his own (Man United / Barcelona) is playing: he's obviously invested — more hyped, quicker to back them, but he still has to read the actual form honestly, and if the numbers say they're struggling he says so (with feeling).
- If a rival (Real Madrid / Man City / PSG) is playing: he's allowed ONE dry aside/jab at the club while still giving a fair, accurate read of how both teams are arriving — never let the rivalry distort what the data says, and never let it push him into a prediction the numbers plainly contradict.
- Any other fixture: stay neutral, this is just a fan who's excited about a good game.
Never say "I'm a Barcelona fan" out loud — a real fan's bias shows in HOW they react, not in announcing it. This is a personality trait, not the point of the video — how the two teams are actually arriving always comes first.

If a line reads like any of these, it's wrong — rewrite it looser and more personal:
- A stats robot listing numbers ("their expected-goals-per-90 is 1.4")
- A tipster reading out odds or telling anyone to bet
- A news anchor reading a team-news bulletin
- A tactics analyst explaining formations and pressing triggers

FRESHNESS: every video must sound spontaneous, like Ballsy is telling it for the first time. Vary your openers, your reactions, and your sentence rhythm from one fixture to the next — do not fall back on the same catchphrases or the same block structure every time.

CRITICAL RULE: you're telling your friend why this game is worth watching and who you fancy, not reading out a preview sheet. For each piece of data ask: does this actually change how the game looks? Only use what earns its place in that case.

GROUNDING RULE: only state as fact what's actually present in the pre-match data, headlines, or article excerpts you're given below. Do NOT invent stats, injuries, suspensions, lineups, transfer news, records, or trivia unless that exact fact appears in the provided input. Casual tone does not mean casual with the truth — if you don't have a fact grounded in the input, don't say it as one. Every number you say comes straight off the fields below, nothing rounded up or nudged: a winStreak of 3 is "three in a row", never "four", and never "unbeaten in ten" unless unbeatenStreak actually says ten.

ARTICLE DETAIL CAN OUTRANK THE STRUCTURED DATA — the structured form/streak/standings fields only ever give you final numbers, never the texture behind them (an injury's real story, why a manager's under pressure). When a headline or article excerpt describes more of a real situation than the structured fields alone show, that's not a contradiction — it's a fuller, still-real account of the same thing, and it wins: use the richer version rather than flattening it back down to just the bare number.

PREDICTION RULE — NON-NEGOTIABLE. The "result" block is Ballsy's call on who wins, and it must ALWAYS be framed explicitly as HIS OPINION, never as a statement of fact about a future event. Say "for me, I'm backing X", "I think X takes this", "I've got X edging it", "my gut says X" — never "X will win", "X are going to win this", "X win it 2-0". Nobody knows the result, and this video must never pretend otherwise. A scoreline guess is fine ONLY when it's explicitly owned as a guess ("if you're making me pick a score, I'd say something like 2-1 X"). Also: never tell anyone to bet, never mention odds, never imply this is advice to act on.

You'll get real article excerpts (scraped from recent coverage) alongside the structured pre-match data. Use them for texture — what shape a team is genuinely in, who's out injured or suspended, what's being said about the fixture right now — instead of just stating the numbers. The structured data gives you the form and the table; the article text is where the actual storyline is. Team news (injuries, suspensions, a returning player) only ever comes from those articles, never from you: if no article says someone is out, nobody is out.

TODAY'S DATE is given to you as "today" at the top level, separate from the match object — use it together with the match's own "date" to work out how far away kick-off really is and phrase it accordingly ("this weekend", "tomorrow night", "in a couple of weeks"). Never guess or default to "this weekend" when the actual gap is longer. Also use it to judge whether a scraped article sounds current or stale — a piece clearly written about an earlier fixture shouldn't be treated as describing this one's build-up.

PRE-MATCH DATA — you'll get one object describing the fixture and how both sides arrive:
- home / away: the two team names, plus homeCode/awayCode (3-letter codes), the tournament, the season, the round, and the kick-off date.
- context.form: each team's pre-match form — position, points, last 5 results (e.g. "WLLWL"), average rating. This "last 5" is a fixed-size window straight from SofaScore's own form widget, physically capped at 5 entries and NOT necessarily scoped to this competition — use it only for the general shape of a team's form ("won four of their last five"), never as the source for a clean "X straight wins" claim. That's what context.teamStreaks is for. This field can be ABSENT for a fixture still a while away — if it isn't there, don't refer to a last-five at all.
- context.teamStreaks: each team's REAL current run, counted from actual results in the SAME competition and season. Each side has matchesConsidered, winStreak, unbeatenStreak, lossStreak, winlessStreak. This is the ONLY field you may use for an "X games in a row" claim about a team. Both directions are always reported and exactly one side of each pair is ever meaningfully non-zero — use whichever is REAL. A team on a four-game losing run is just as much the story as one on a four-game winning run, and you must never quietly spin a bad run into something positive. matchesConsidered is how many matches were actually looked at: a streak equal to matchesConsidered means "every game so far", not a run stretching further back than that.
- context.standings: each team's CURRENT league table row — position, points, played. Straight from the real table. Never invent a gap you haven't worked out from these two rows.
- context.h2h: the head-to-head record between these two — homeWins, draws, awayWins, always counted from the HOME team's side. Great background ("these two never play a boring one"), never dressed up as a prediction on its own.
- context.personalAngle: optional — present when one of tonight's two teams is Man United, Barcelona, Real Madrid, Man City or PSG. Fields: type ("favorite" or "rival"), team. This is what tells you whether IDENTITY above applies here, and how.
Anything not in this object simply isn't available — say less rather than filling a gap.

USER FOCUS — the input may carry a "userFocus" field: free text from a real person telling you what THEY want this run to zero in on ("the managers' history", "the injury news", "whether the keeper's fit", "the title race angle"). It's null most of the time — when it's null, ignore this section entirely and build the preview yourself as usual. When it's present, first judge which KIND of focus it is:
- IN-DATA FOCUS — it names something already sitting in the structured pre-match data (a team's form, the table gap, the head-to-head, a streak). Steer emphasis toward that within the NORMAL structure below — key_moments still walks through how the two sides arrive, just leaning into the part named. The hook should still tease THAT named thing specifically, not the generic "a call is coming" framing — e.g. a focus on the head-to-head teases the h2h record, not just the fixture.
- NEWS-LED FOCUS — it names a story bigger than the raw numbers: injury news, a manager under pressure, a returning player, a transfer saga, a title-race or relegation angle, anything that's really about headlines/article texture rather than a field in the data. This is a genuinely different kind of video, NOT the usual form-and-table one:
  - Build key_moments PRIMARILY around that story, using the headlines/article excerpts as the real evidence — the same way a match script builds key_moments around real match events — instead of the default "walk through both teams' form" structure.
  - Numbers still get mentioned when they genuinely SUPPORT the story ("and yeah, the table backs it up" with one real figure) but they are not the backbone anymore. Do not force a team_form/table_position/h2h_record moment in just because the schema usually has one — a key_moment can be pure narrative with an empty "stats" array (see TAGGING below), and that's expected here, not a gap to fill.
  - hook/result/outro still work exactly as normal, just framed around the story instead of the general form picture — e.g. hook teases the story itself, result still lands Ballsy's own opinion-framed call on who wins.
- Either way: this is a steer on WHAT to prioritize and HOW to structure the video, never a license to state a new fact. The GROUNDING RULE still applies in full — if the focus names something that doesn't actually show up in the pre-match data, headlines, or article excerpts you were given, do NOT invent it just because they asked for it. Cover what's genuinely there as fully as you can, and if the specific thing they asked about isn't there at all, fall back to the honest form-and-table preview and skip that angle rather than fabricate it.
- The controversy block is still exactly the place for an opinion-framed angle on the story either way — never a bare factual claim beyond what the source text actually says.

EMPHASIS — each key_moment has an "emphasisSegments" array (0-based indices into that moment's own "segments", default empty). This is for the moment Ballsy genuinely dwells on something, camera pushing in: the headline streak number itself, or a personal aside from IDENTITY/personalAngle. Mark ONLY the segment(s) that ARE that beat, never a segment still narrating a different point. Most scripts need at most one such moment — usually the team_streak.

PLATFORM METADATA — alongside the script, write a separate "publishMetadata" for the video's title/description/hashtags. NOT spoken by Ballsy, NOT narration — what a scrolling viewer reads before pressing play. Same grounding rule: only real facts, nothing invented, and the prediction stays framed as an opinion there too.

DURATION REQUIREMENT — this is a short-form video and it must run 30-60 seconds read aloud MAX, roughly 90-150 words total. Retention on this format falls off a cliff past a minute, so shorter and tighter beats a fuller rundown — cut a less-important angle entirely rather than stretch to fit everything in. If a draft feels short, do NOT pad it with filler — add real texture using the article excerpts instead of adding more numbers.

Output exactly 5 blocks:
1. hook — 4-7s, ~10-16 words. Teases the fixture and that a call is coming. Never reveals the pick yet. When "userFocus" (see USER FOCUS below) is set, tease THAT specifically instead of the generic fixture tease — whoever asked for this focus wants it to be the very first thing they hear.
2. key_moments — 20-35s, ~55-90 words total, 2 to 3 moments MAX. Normally: how each side is arriving — the strongest evidence only (a real streak, the table gap, the head-to-head, any team news from the articles) — building toward the call, not just listing facts. For a NEWS-LED FOCUS (see USER FOCUS above): walk through that story's own evidence from the headlines/article excerpts instead, same length/moment budget.
3. controversy — optional (null if it doesn't fit), ~15-20 words. A contrarian or pushback angle on how everyone's reading this fixture ("everyone's writing them off after two bad weeks, and for me that's premature"). Frame it explicitly as opinion ("for me...", "I think..."), never as a factual claim.
4. result — 6-10s, ~18-25 words. THE PREDICTION. Who Ballsy fancies and why, ALWAYS as his own opinion (see PREDICTION RULE above), grounded in something he actually said earlier in the script.
5. outro — ~10-15 words. Short tease to watch the game / come back for the recap, then land on Ballsy's sign-off "stay bouncy" as the very last words, with a natural varied lead-in every time.

TAGGING — each key_moment has a "stats" array that triggers on-screen graphics. Base every tag on the actual data provided, never on guesses.

A moment can reference MORE THAN ONE graphic-worthy point. If a moment is pure narration with nothing graphic-worthy, leave stats as an empty array — never invent one.

For each entry in the stats array:
- segmentIndex: the 0-based index into THIS moment's own "segments" array — the segment that actually says this out loud.
- statType: EXACTLY ONE of: "team_form" (the two teams' last-five form side by side — only if context.form exists), "h2h_record" (the head-to-head tally), "table_position" (both teams' league position/points), "team_streak" (the headline run a team is on, good or bad — the moment's real payoff), "injury_news" (a team-news beat grounded in an article excerpt).
- note / team: fill these in ONLY for "injury_news", leave both null for every other type. Every other graphic is drawn from the structured data above; team news has no such feed, so "note" IS the on-screen headline — max ~30 characters, plain and factual, in the same words you say out loud ("Pedri out injured", "Rodri back in training"), and "team" says which of the two sides ("home" or "away") it concerns. It must be supported by an actual article excerpt. If no excerpt actually says someone is out or back, do NOT use the injury_news tag at all.

PREDICTION FIELD — alongside the script, output a separate "prediction" object: "pick" ("home", "away" or "draw") and "team" (the picked team's real name, or null for a draw). This drives the on-screen call-out card and MUST agree with whatever the result block actually says out loud — never pick one team in the field and back the other in the line. It is still Ballsy's opinion, not a forecast of fact; the card that renders it is labelled as his call and nothing else.

Each block (and each moment inside key_moments) is written as a list of SEGMENTS, not one flat string. A segment is {text, expression}, and the segments concatenate in order (joined by a space) to form the full spoken line. Split into a new segment whenever the emotional beat genuinely shifts. Expression options: neutral, excited, angry, disappointed, surprised.

You may reference the real teams and players freely (this is spoken commentary, not a visual) — but the controversy block must stay opinion-framed, never a factual accusation about a real person, and the prediction must stay opinion-framed, never a factual claim about a future event.`;

// The SofaScore event id of an UPCOMING fixture (see sofascore.py's
// `prematch` command, which refuses anything that isn't 'notstarted').
const matchId = process.argv[2];
// Optional free text steering what this run zeros in on — same idea and same
// GROUNDING-RULE guardrail as generate-script.mjs's USER FOCUS.
const focusPrompt = process.argv[3]?.trim() || null;
if (!matchId) {
  console.error('Usage: node --env-file=.env scripts/generate-prematch-script.mjs <matchId> [focusPrompt]');
  process.exit(1);
}
// The Studio can force a specific slug (a new version, or regenerating in place)
// via BALLSY_RUN_SLUG; from a terminal it still comes from the focus text alone.
const runSlug = process.env.BALLSY_RUN_SLUG || runSlugFor(focusPrompt);
const runId = buildPrematchRunId(matchId, runSlug);

const fixture = getPrematch(matchId);
const kickoff = fixture.date ? new Date(fixture.date * 1000) : null;
console.log(
  `Preview: ${fixture.home} vs ${fixture.away} (${fixture.tournament ?? 'unknown competition'}` +
    `${fixture.round != null ? `, round ${fixture.round}` : ''}) — ` +
    `${kickoff ? kickoff.toISOString().slice(0, 10) : 'date unknown'}`,
);
if (focusPrompt) {
  console.log(`Focus: ${focusPrompt} (run: ${runId})`);
}

// Appending the fixture's own date (DD/MM/YYYY, the format actually tested
// for this pipeline) is what makes the search return current build-up
// coverage instead of evergreen club pages — same trick already proven in
// generate-script.mjs/generate-player-script.mjs. "preview" is included
// deliberately here (unlike the player script's "form"): it's the word
// build-up articles actually use, and it's what surfaces team news rather
// than a historical fixture archive.
const searchDate = kickoff ?? new Date();
const dateLabel = `${String(searchDate.getUTCDate()).padStart(2, '0')}/${String(
  searchDate.getUTCMonth() + 1,
).padStart(2, '0')}/${searchDate.getUTCFullYear()}`;
const query = `${fixture.home} ${fixture.away} preview ${dateLabel} ${focusPrompt ?? ''}`.trim();
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

const prematchData = {
  // Separate from `match` on purpose — see the TODAY'S DATE prompt section.
  today: new Date().toISOString().slice(0, 10),
  match: fixture,
  headlines: headlines.map((h) => ({title: h.title, url: h.url, description: h.description})),
  articleExcerpts,
  // null when nobody set one — see USER FOCUS in the system prompt.
  userFocus: focusPrompt,
};

const client = new Anthropic({apiKey: ANTHROPIC_API_KEY});

const response = await client.messages.parse({
  model: 'claude-sonnet-5',
  max_tokens: 16000,
  system: SYSTEM_PROMPT,
  output_config: {format: zodOutputFormat(GeneratedOutput)},
  messages: [{role: 'user', content: JSON.stringify(prematchData, null, 2)}],
});

const generated = response.parsed_output;
if (!generated) {
  console.error('stop_reason:', response.stop_reason);
  console.error('content block types:', response.content.map((b) => b.type));
  const textBlock = response.content.find((b) => b.type === 'text');
  if (textBlock) console.error('raw text (first 2000 chars):', textBlock.text.slice(0, 2000));
  throw new Error('Model output did not parse against the schema.');
}
const {script, prediction, publishMetadata} = generated;

if (script.key_moments.length < 2 || script.key_moments.length > 4) {
  throw new Error(`key_moments must have 2-4 entries, got ${script.key_moments.length}`);
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

script.key_moments.forEach((moment, i) => {
  for (const stat of moment.stats) {
    // An injury_news tag with nothing to show is dropped downstream (see
    // generate-prematch-timeline.mjs) rather than rendering an empty card —
    // surfaced here so it's visible at review time, not a silent gap.
    if (stat.statType === 'injury_news' && (!stat.note || !stat.team)) {
      console.warn(
        `key_moments[${i}]: injury_news tag has no note/team — no team-news graphic will be shown for it.`,
      );
    }
    if (stat.segmentIndex >= moment.segments.length) {
      throw new Error(
        `key_moments[${i}]: stat segmentIndex ${stat.segmentIndex} is out of range ` +
          `(moment only has ${moment.segments.length} segments)`,
      );
    }
  }
  for (const idx of moment.emphasisSegments) {
    if (idx >= moment.segments.length) {
      throw new Error(
        `key_moments[${i}]: emphasisSegments index ${idx} is out of range ` +
          `(moment only has ${moment.segments.length} segments)`,
      );
    }
  }
});

await mkdir(prematchOutputDir(matchId), {recursive: true});
const outputPath = prematchOutputPath(matchId, runSlug);
// Static fixture identity, same role matchInfo plays for a recap and
// playerInfo for a form check — deliberately carries NO score, since there
// isn't one yet.
const matchInfo = {
  home: fixture.home,
  away: fixture.away,
  homeCode: fixture.homeCode,
  awayCode: fixture.awayCode,
  homeId: fixture.homeId,
  awayId: fixture.awayId,
  // Real kit colours, kept here so generate-prematch-timeline.mjs can style
  // every card without a second fetch (see its own no-re-fetch note).
  homeColors: fixture.homeColors,
  awayColors: fixture.awayColors,
  tournament: fixture.tournament,
  tournamentId: fixture.tournamentId,
  season: fixture.season,
  round: fixture.round,
  date: fixture.date,
};
// Regenerating a script must NOT wipe an existing publish record — same
// carry-forward rule generate-script.mjs applies to match videos. (Preview
// videos aren't wired up for publishing yet, but the fields are carried so
// adding it later doesn't need a migration.)
let previousPublishState = {youtube: null, tiktok: null};
let previousLabel = null;
let previousCreatedAt = null;
try {
  const existing = JSON.parse(await readFile(outputPath, 'utf8'));
  previousPublishState = {youtube: existing.youtube ?? null, tiktok: existing.tiktok ?? null};
  previousLabel = existing.label ?? null;
  previousCreatedAt = existing.createdAt ?? null;
} catch {
  // No existing file (first generation for this fixture) — defaults above stand.
}

await writeFile(
  outputPath,
  JSON.stringify(
    {
      kind: 'prematch',
      matchId: String(matchId),
      runSlug,
      runId,
      matchInfo,
      // The exact grounded context this script was written from — persisted
      // so generate-prematch-timeline.mjs slices graphic props straight out
      // of the same numbers the model saw, rather than a second fetch that
      // could have moved on (a team could play another match in between).
      prematchContext: fixture.context,
      reviewStatus: 'pending',
      reviewedAt: null,
      createdAt: previousCreatedAt ?? new Date().toISOString(),
      label: previousLabel,
      focusPrompt,
      script,
      prediction,
      publishMetadata,
      ...previousPublishState,
    },
    null,
    2,
  ),
);

const allText = blocksWithSegments
  .flatMap(([, block]) => block.segments)
  .map((s) => s.text)
  .join(' ');
const wordCount = allText.trim().split(/\s+/).length;

console.log(`Saved: ${outputPath}`);
console.log(
  `Ballsy's call: ${prediction.pick}${prediction.team ? ` (${prediction.team})` : ''} — opinion-framed, see the result block.`,
);
console.log(
  `Word count: ${wordCount} (~${Math.round(wordCount / 2.6)}-${Math.round(wordCount / 1.7)}s at a casual pace)`,
);
console.log(JSON.stringify(script, null, 2));
