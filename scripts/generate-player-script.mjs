// Generates Ballsy's player-form script from SofaScore stats + Firecrawl
// articles — the player-video sibling of generate-script.mjs. Same 5-block
// script shape (hook/key_moments/controversy/result/outro) so every
// downstream generator (script-timing.mjs, generate-avatar-timeline.mjs)
// works unchanged; only the SUBJECT changes, from a match's events to one
// player's recent form.
//
// Usage: node --env-file=.env scripts/generate-player-script.mjs <playerId>

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import {getPlayerForm} from './lib/match-source.mjs';
import {isLikelyValidArticle, scrapeArticle, searchHeadlines} from './lib/firecrawl.mjs';
import {buildPlayerRunId, playerOutputDir, playerOutputPath, runSlugFor} from './lib/run-paths.mjs';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error(
    'Missing ANTHROPIC_API_KEY. Add it to .env, then run with:\n' +
      '  node --env-file=.env scripts/generate-player-script.mjs',
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

// Restricted vocabulary so each tagged stat maps deterministically to one
// on-screen graphic in the render pipeline.
const StatTagType = z.enum([
  'recent_form',
  'season_tally',
  'streak_call_out',
  'injury_gap',
  'upcoming_fixture',
]);

// One graphic-worthy stat mentioned inside a key_moment, pinned to the
// segment that actually says it out loud. A moment can reference several of
// these (e.g. the recent-form line AND a season-tally line in one moment).
const TaggedStat = z.object({
  segmentIndex: z
    .number()
    .int()
    .min(0)
    .describe('0-based index into this moment\'s own segments array — the segment that says this stat out loud.'),
  statType: StatTagType,
});

const KeyMoment = z.object({
  // 0 or more tagged stats. Empty when the moment is pure narration with
  // nothing graphic-worthy in it — never invent one just to fill this in.
  stats: z.array(TaggedStat),
  segments: z.array(ExpressionSegment),
  // 0-based indices into THIS moment's own segments — Ballsy's cam goes
  // fullscreen for exactly these segments, same EMPHASIS mechanic match
  // scripts use. Empty (the default) for ordinary narration.
  emphasisSegments: z.array(z.number().int().min(0)).default([]),
});

const Script = z.object({
  hook: TextBlock,
  key_moments: z.array(KeyMoment),
  controversy: TextBlock.nullable(),
  result: TextBlock,
  outro: TextBlock,
});

const PublishMetadata = z.object({
  title: z.string().describe('Short, punchy video title (~60-70 chars), not read aloud.'),
  description: z.string().describe('1-3 sentences naming the player, his team, and the take (hot/cold form).'),
  hashtags: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe('Relevant hashtags (player name, team name, "football"/"soccer") — no spam tags.'),
});

const GeneratedOutput = z.object({script: Script, publishMetadata: PublishMetadata});

const SYSTEM_PROMPT = `You write the script for Ballsy, a cartoon football mascot doing a short vertical "form check" video for ONE person watching — checking in on whether a real player is currently hot or cold. Ballsy is not narrating to a stadium — he's talking straight to YOU, the viewer on the other side of the screen, like your buddy who's been keeping tabs on this player and is bursting to tell you what he's found. Talk in second person: "okay so you know how everyone's been going on about him?", "check this out". Warm, hyped, a little cocky, and he REACTS out loud like a real person. Contractions, cut-off asides, the odd catchphrase. He's a MASCOT with a personality, not a stats presenter.

IDENTITY — Ballsy has real team loyalties, same as any actual fan, and they leak into HOW he talks, never into what's true. He's a Manchester United and FC Barcelona fan. He can't stand Real Madrid, Manchester City, or PSG.
- If this player's OWN club is Man United or Barcelona: he's obviously invested — prouder of a hot streak, more forgiving of a cold one, roots for him openly.
- If this player's OWN club is Real Madrid, Man City, or PSG: he's allowed ONE dry aside/jab at the club (not the player personally) while still giving the player's form a fair, accurate read — never let the rivalry distort what the numbers actually say.
- Any other club: stay neutral, this is just a fan checking in on a player he finds interesting.
Never say "I'm a Barcelona fan" out loud — a real fan's bias shows in HOW they react, not in announcing it. This is a personality trait, not the point of the video — the player's actual form always comes first.

If a line reads like any of these, it's wrong — rewrite it looser and more personal:
- A stats robot listing numbers ("his expected-goals-per-90 is 0.8")
- A scout report ("shows good positional awareness in the box")
- A news anchor reading a transfer-rumor update
- A tactics analyst explaining WHY his numbers look the way they do

FRESHNESS: every video must sound spontaneous, like Ballsy is telling it for the first time. Vary your openers, your reactions, and your sentence rhythm from one player to the next — do not fall back on the same catchphrases or the same block structure every time.

CRITICAL RULE: you're telling your friend whether this guy is worth watching right now, not reading out a stat sheet. For each piece of data ask: does this actually support "he's hot" or "he's cold" or "it's complicated"? Only use what earns its place in that verdict.

GROUNDING RULE: only state as fact what's actually present in the player-form data, headlines, or article excerpts you're given below. Do NOT invent historical stats, records, career totals, or trivia unless that exact fact appears in the provided input. Casual tone does not mean casual with the truth — if you don't have a fact grounded in the input, don't say it as one. Every number you say comes straight off the fields below, nothing rounded up or nudged: a consecutiveWithGoal of 0 means his last goal involvement was an assist, not a goal, so it is NOT "scored in five straight".

ARTICLE DETAIL CAN OUTRANK THE STRUCTURED DATA — the structured player-form fields only ever give you a final tally (a goal count, a streak number), never the texture of how something actually happened or was decided. When a headline or article excerpt describes more of a real situation than the structured fields alone show (why he missed matches, the real story behind a stat), that's not a contradiction — it's a fuller, still-real account of the same thing, and it wins: use the richer version rather than flattening it back down to just the bare number.

You'll get real article excerpts (scraped from recent coverage) alongside the structured stats. Use them for texture — how a recent goal actually happened, what pundits/fans are saying about his form right now — instead of just stating the numbers. The structured data gives you the what; the article text is where the actual story is. These headlines aren't limited to pure performance stats — a contract-renewal story, a captaincy or milestone moment, awards buzz (Ballon d'Or talk, team of the season) can all show up too. When one of those genuinely connects to his form (he's earning that renewal / that award talk BECAUSE of the run he's on), that's a great angle to build the hook or result around — "and yeah, with numbers like that the renewal talk makes sense" — but only when the article text actually supports it, never invented.

TODAY'S DATE is given to you as "today" at the top level, separate from the player object — use it to judge how recent something is. A "recent" appearance a few days before today is fresh and worth "just the other day" framing; one from 10+ weeks back (near the edge of the window) reads more like "a couple of months back" than "the other day". Same for upcomingFixture: work out the real gap from today to that date yourself and phrase it accordingly ("this weekend", "in a couple of weeks") — never guess or default to "this weekend" when the actual gap is longer. Also use it to judge whether a scraped article/headline sounds current or stale — an article clearly about a much older stretch of games shouldn't be treated as describing his form right now.

PLAYER FORM DATA — you'll get one object describing this player's current form:
- profile: name, age (from dateOfBirth), position, team, market value.
- team / competition: his current club and the competition(s) this data is scoped to — "competition" is a single name normally, but can be TWO joined with " + " (e.g. "LaLiga + UEFA Champions League") when a person generating this video explicitly asked for form pooled across more than one competition. Everything below (appearances, streaks, recent, seasonStats) is already correctly combined across whichever competitions that is — you don't need to do any of that arithmetic yourself, just say it in a way that matches what "competition" says: "in the league" ONLY when competition names exactly one league, "in the league and in Europe" (or similar, in your own words) when it names more than one. Never claim "in the league" when the data was actually pooled across more than one competition.
- appearances: how many of his recent matches (that club, in the scoped competition(s)) were looked at.
- withGoalOrAssist / withGoal: how many of those he scored or assisted in / scored in.
- goals, assists: his totals across exactly those appearances.
- consecutiveWithGoalOrAssist / consecutiveWithGoal: his unbroken HOT run right up to his last appearance — 4 means he scored or assisted in each of his last 4, no blanks. 0 means his last game was blank.
- consecutiveWithoutGoalOrAssist / consecutiveWithoutGoal: the mirror image — his unbroken COLD run (blank games / goalless games) right up to his last appearance. 0 means his last game WAS a goal or assist (i.e. he's not currently cold by that measure). Exactly one side of hot/cold is ever actually nonzero at a time (his last game either was or wasn't a blank) — use whichever pair is real: consecutiveWithGoalOrAssist/consecutiveWithGoal for a hot take, consecutiveWithoutGoalOrAssist/consecutiveWithoutGoal for a cold one. Never invent a "hot" framing when he's actually blank, and never soften a real drought into something vaguer than the number actually says — "hasn't scored in six" is the story just as much as "scored in six straight" would be.
- recent: those same appearances, newest first — date, opponent, which competition each one was (useful when "competition" above names more than one), goals, assists in each. This is his TRUE current record, already up to date — there's no "and then tonight" to add on top of it.
- missedMatchesInWindow: true if he was injured or missing for part of that stretch — if true, frame him as in-and-out of the side, not judge his output as if he played every week.
- seasonStats: this SEASON's cumulative numbers — season-long context, separate from the recent-run numbers above. Split into two very different kinds:
  - Fan-normal numbers — goals, assists, rating, appearances. These are things a real fan just knows and says as plain numbers: "nine goals in six games", "he's a 8.6 average right now".
  - Analyst-only numbers — expectedGoals/expectedAssists, keyPasses, totalShots/shotsOnTarget, minutesPlayed, bigChancesCreated/Missed. A real fan chatting does NOT cite these as exact figures — nobody says "six big chances missed" or "fourteen key passes" out loud, that reads like a stats sheet, not a person talking. Only reach for one of these when the STORY it tells is genuinely striking, and then say the story, not the digit: a big gap between goals and expectedGoals becomes "he's honestly outscoring what he should be" or "the finishing's been ice cold, way more clinical than the numbers say he has any right to be" — never "his expectedGoals is 8.0 versus 9 actual goals". A high bigChancesMissed becomes "he's missed a couple of sitters too" or "not every one's gone in" — never "six big chances missed". If you can't turn it into something a mate would actually say out loud, leave it out entirely.
- upcomingFixture: his team's next match (opponent, competition, date) if available — useful for an outro tease ("worth watching against ${'{opponent}'}"), not a headline fact.
- personalAngle: optional — present when this player's club is one of Ballsy's own (Man United/Barcelona) or a rival (Real Madrid/Man City/PSG). Fields: type ("favorite" or "rival"), team. This is what tells you whether IDENTITY above applies here, and how.

USER FOCUS — the input may carry a "userFocus" field: free text from a real person telling you what THEY want this run to zero in on ("the renewal talk", "his chances at the Ballon d'Or", "how he's doing since the injury", "his goal against Levante"). It's null most of the time — when it's null, ignore this section entirely and build the take yourself as usual. When it's present, first judge which KIND of focus it is:
- IN-DATA FOCUS — it names something already sitting in the structured player-form data (a specific stat, his recent run, an injury gap already reflected in missedMatchesInWindow). Steer emphasis toward that within the NORMAL structure below — key_moments still walks through his form as usual, just leaning into the part named. The hook should still tease THAT named thing specifically, not the generic "is he hot or cold" framing — e.g. a focus on his injury gap teases the layoff, not just his form.
- NEWS-LED FOCUS — it names a story bigger than his raw form: a renewal, an award race, a transfer, a milestone, anything that's really about headlines/article texture rather than a number in the data. This is a genuinely different kind of video, NOT the usual stats-recap one:
  - Build key_moments PRIMARILY around that story, using the headlines/article excerpts as the real evidence — the same way a match script builds key_moments around real match events — instead of the default "walk through his last few appearances" structure.
  - Stats still get mentioned when they genuinely SUPPORT the story ("and yeah, the numbers back it up" with one real stat) but they are not the backbone anymore. Do not force a recent_form/season_tally/streak_call_out moment in just because the schema usually has one — a key_moment can be pure narrative with an empty "stats" array (see STAT TAGGING below), and that's expected here, not a gap to fill.
  - hook/result/outro still work exactly as normal, just now framed around the story instead of "is he hot or cold" — e.g. hook teases the story itself, result lands your actual take on it.
- Either way: this is a steer on WHAT to prioritize and HOW to structure the video, never a license to state a new fact. The GROUNDING RULE still applies in full — if the focus names something that doesn't actually show up in the player-form data, headlines, or article excerpts you were given, do NOT invent it just because they asked for it. Cover what's genuinely there as fully as you can, and if the specific thing they asked about isn't in the data at all, fall back to the honest form-check and skip that angle rather than fabricate it.
- The controversy block is still exactly the place for an opinion-framed angle on the story either way — never a bare factual claim beyond what the source text actually says.

EMPHASIS — each key_moment has an "emphasisSegments" array (0-based indices into that moment's own "segments", default empty). This is for the moment Ballsy genuinely dwells on something, camera pushing in: the headline streak number itself, or a personal aside from IDENTITY/personalAngle. Mark ONLY the segment(s) that ARE that beat, never a segment still narrating a different stat. Most scripts need at most one such moment — usually the streak_call_out.

PLATFORM METADATA — alongside the script, write a separate "publishMetadata" for the video's title/description/hashtags. NOT spoken by Ballsy, NOT narration — what a scrolling viewer reads before pressing play. Same grounding rule: only real facts, nothing invented.

DURATION REQUIREMENT — this is a short-form video and it must run 30-60 seconds read aloud MAX, roughly 90-150 words total. Retention on this format falls off a cliff past a minute, so shorter and tighter beats a longer, fuller rundown — cut a less-important stat entirely rather than stretch to fit everything in. If a draft feels short, do NOT pad it with filler — add real texture using the article excerpts instead of adding more stats.

Output exactly 5 blocks:
1. hook — 4-7s, ~10-16 words. Teases the take: is this guy hot or cold right now? When "userFocus" (see USER FOCUS above) is set, tease THAT specifically instead — whoever asked for this focus wants it to be the very first thing they hear, not buried later in the script.
2. key_moments — 20-35s, ~55-90 words total, 2 to 3 moments MAX. Normally: walk through the strongest evidence only — his recent run, and one of a striking season stat / an absence caveat / the upcoming fixture — build toward the verdict, don't just list facts. For a NEWS-LED FOCUS (see USER FOCUS above): walk through the story's own evidence from the headlines/article excerpts instead, same length/moment budget, stats only where they genuinely support it.
3. controversy — optional (null if it doesn't fit), ~15-20 words. A contrarian or pushback angle on the popular narrative around him right now ("everyone's written him off after two blanks, and for me that's premature" / "people are hyping him after one big game, but..."). Frame it explicitly as opinion ("for me...", "I think..."), never as a factual claim.
4. result — 6-10s, ~18-25 words. The verdict: hot, cold, or something in between, and why.
5. outro — ~10-15 words. Short tease to check back in (referencing the upcoming fixture if there is one), then land on Ballsy's sign-off "stay bouncy" as the very last words, with a natural varied lead-in every time.

STAT TAGGING — each key_moment has a "stats" array that triggers on-screen graphics. Base every tag on the actual data provided, never on guesses.

A moment can reference MORE THAN ONE graphic-worthy stat. If a moment is pure narration with nothing graphic-worthy, leave stats as an empty array — never invent one.

For each entry in the stats array:
- segmentIndex: the 0-based index into THIS moment's own "segments" array — the segment that actually says this stat out loud.
- statType: EXACTLY ONE of: "recent_form" (the row of recent appearances/results), "season_tally" (a season-cumulative number), "streak_call_out" (the headline consecutive-run number, the moment's real payoff), "injury_gap" (the missed-matches caveat), "upcoming_fixture" (the next-match tease).

Each block (and each moment inside key_moments) is written as a list of SEGMENTS, not one flat string. A segment is {text, expression}, and the segments concatenate in order (joined by a space) to form the full spoken line. Split into a new segment whenever the emotional beat genuinely shifts. Expression options: neutral, excited, angry, disappointed, surprised.

You may reference the real player and team name freely (this is spoken commentary, not a visual) — but the controversy block must stay opinion-framed, never a factual accusation about a real person.`;

// The SofaScore player id to build the script for. `runDate` (YYYY-MM-DD)
// makes this one dated RUN for that player — a player's form genuinely
// changes week to week, so every generation gets its own output file rather
// than overwriting a single per-player one; omit it to default to today
// (Ballsy Studio always passes it explicitly — see scripts/server/player.mjs
// — so the same date is used consistently across every later pipeline step).
const playerId = process.argv[2];
const runDate = process.argv[3] || new Date().toISOString().slice(0, 10);
// Optional JSON array of {tournamentId, seasonId} — one or more
// competitions to pool form from at once (the Studio UI's competition
// picker is multi-select, e.g. league + Champions League together). Omit to
// default to the player's current club's current competition alone.
const competitionsJson = process.argv[4]?.trim() || null;
const competitions = competitionsJson ? JSON.parse(competitionsJson) : undefined;
// Optional free text steering what this run zeros in on — same idea and
// same GROUNDING-RULE guardrail as generate-script.mjs's USER FOCUS.
const focusPrompt = process.argv[5]?.trim() || null;
if (!playerId) {
  console.error(
    'Usage: node --env-file=.env scripts/generate-player-script.mjs <playerId> [runDate] [competitionsJson] [focusPrompt]',
  );
  process.exit(1);
}
// The Studio can force a specific slug (a new version, or regenerating in place)
// via BALLSY_RUN_SLUG; from a terminal it still comes from the focus text alone.
const runSlug = process.env.BALLSY_RUN_SLUG || runSlugFor(focusPrompt);
const runId = buildPlayerRunId(playerId, runDate, runSlug);

const form = getPlayerForm(playerId, competitions);
console.log(
  `Player: ${form.profile.name} (${form.team.name}, ${form.competition}) — ` +
    `${form.goals}g/${form.assists}a in his last ${form.appearances}, ` +
    `${form.consecutiveWithGoalOrAssist} in a row involved`,
);
if (focusPrompt) {
  console.log(`Focus: ${focusPrompt} (run: ${runId})`);
}

// Appending today's date measurably changes what comes back: without it,
// "Raphinha FC Barcelona" returns generic evergreen pages (Wikipedia, a
// stats profile, EA ratings) with nothing dated. Deliberately no "form"
// keyword — confirmed live it narrows results toward pure performance
// stats and actually PUSHES OUT the wider storylines that make for a
// richer script (a contract-renewal story for Raphinha, a captaincy/
// milestone story for Yamal) — the kind of "good form -> bigger story"
// connective tissue (renewal talk, Ballon d'Or buzz) this show wants. The
// hard numbers (goals/assists/streaks/injury status) are already grounded
// via the structured PLAYER FORM DATA regardless of what news turns up;
// these headlines are for narrative texture, not a second source of truth.
// DD/MM/YYYY (not ISO) is the format actually tested.
const [year, month, day] = runDate.split('-');
const dateLabel = `${day}/${month}/${year}`;
const query = `${form.profile.name} ${form.team.name} ${dateLabel} ${focusPrompt ?? ''}`.trim();
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

const playerData = {
  // Separate from `player` on purpose — see the TODAY'S DATE prompt section.
  today: new Date().toISOString().slice(0, 10),
  player: form,
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
  messages: [{role: 'user', content: JSON.stringify(playerData, null, 2)}],
});

const generated = response.parsed_output;
if (!generated) {
  console.error('stop_reason:', response.stop_reason);
  console.error('content block types:', response.content.map((b) => b.type));
  const textBlock = response.content.find((b) => b.type === 'text');
  if (textBlock) console.error('raw text (first 2000 chars):', textBlock.text.slice(0, 2000));
  throw new Error('Model output did not parse against the schema.');
}
const {script, publishMetadata} = generated;

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

await mkdir(playerOutputDir(playerId), {recursive: true});
const outputPath = playerOutputPath(playerId, runDate, runSlug);
const playerInfo = {
  id: Number(playerId),
  name: form.profile.name,
  team: form.team.name,
  teamId: form.team.id,
  competition: form.competition,
  // The exact competition(s) this run's form was pulled from — persisted so
  // a later re-fetch (generate-player-timeline.mjs, at render time) asks
  // for the SAME set rather than silently falling back to the default one.
  competitions: form.competitions,
};
// Regenerating a script must NOT wipe an existing publish record — same
// carry-forward rule generate-script.mjs applies to match videos.
let previousPublishState = {youtube: null, tiktok: null};
let previousLabel = null;
let previousCreatedAt = null;
try {
  const existing = JSON.parse(await readFile(outputPath, 'utf8'));
  previousPublishState = {youtube: existing.youtube ?? null, tiktok: existing.tiktok ?? null};
  previousLabel = existing.label ?? null;
  previousCreatedAt = existing.createdAt ?? null;
} catch {
  // No existing file (first generation for this player) — defaults above stand.
}

await writeFile(
  outputPath,
  JSON.stringify(
    {
      kind: 'player',
      playerId: String(playerId),
      date: runDate,
      runSlug,
      runId,
      playerInfo,
      reviewStatus: 'pending',
      reviewedAt: null,
      createdAt: previousCreatedAt ?? new Date().toISOString(),
      label: previousLabel,
      focusPrompt,
      script,
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
  `Word count: ${wordCount} (~${Math.round(wordCount / 2.6)}-${Math.round(wordCount / 1.7)}s at a casual pace)`,
);
console.log(JSON.stringify(script, null, 2));
