// Generates Ballsy's match script from SofaScore events + Firecrawl articles.
//
// Usage: node --env-file=.env scripts/generate-script.mjs <matchId>

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import {getMatch} from './lib/match-source.mjs';
import {isLikelyValidArticle, scrapeArticle, searchHeadlines} from './lib/firecrawl.mjs';
import {buildMatchRunId, matchOutputDir, matchOutputPath, runSlugFor} from './lib/run-paths.mjs';

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

// Restricted vocabulary so each tagged event maps deterministically to one
// on-screen graphic in the render pipeline.
const EventType = z.enum([
  'goal',
  'goal_disallowed',
  'yellow_card',
  'red_card',
  'penalty',
  'substitution',
  'clear_chance',
  'var_review',
]);

// Only meaningful for `penalty` and `clear_chance` (null otherwise). Lets the
// model disambiguate cases the raw match data can't (SofaScore does give a
// missed-penalty reason, but not every case is clean, and a clear chance
// isn't a structured event at all — both may need the article text).
const Outcome = z
  .enum([
    'penalty_scored',
    'penalty_saved',
    'penalty_post',
    'penalty_out',
    'clear_chance_post',
    'clear_chance_wide',
  ])
  .nullable();

// One graphic-worthy event mentioned inside a key_moment, pinned to the
// segment that actually narrates it. A moment can reference SEVERAL of these
// (e.g. two missed penalties then the equalizer, all in one moment) — each
// gets tagged separately instead of collapsing the moment to one "main" event.
const TaggedEvent = z.object({
  minute: z.number().nullable(),
  segmentIndex: z
    .number()
    .int()
    .min(0)
    .describe('0-based index into this moment\'s own segments array — the segment that says this event out loud.'),
  event_type: EventType,
  outcome: Outcome,
});

const KeyMoment = z.object({
  // 0 or more tagged events. Empty when the moment is pure narration with
  // nothing graphic-worthy in it — never invent one just to fill this in.
  events: z.array(TaggedEvent),
  segments: z.array(ExpressionSegment),
  // 0-based indices into THIS moment's own segments — Ballsy's cam goes
  // fullscreen for exactly these segments (see EMPHASIS below), instead of
  // the normal split view with the event graphic showing. Empty (the
  // default) for ordinary narration — most moments have none.
  emphasisSegments: z.array(z.number().int().min(0)).default([]),
});

const Script = z.object({
  hook: TextBlock,
  key_moments: z.array(KeyMoment),
  controversy: TextBlock.nullable(),
  result: TextBlock,
  outro: TextBlock,
});

// Written for a caption/title context, not narration — a viewer scrolling
// past sees this before they ever hear Ballsy speak. Kept as its own object
// (not nested in Script) because it's platform metadata, not spoken content.
const PublishMetadata = z.object({
  title: z.string().describe('Short, punchy video title (~60-70 chars), not read aloud.'),
  description: z.string().describe('1-3 sentences referencing both teams, the score, and the competition.'),
  hashtags: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe('Relevant hashtags (team names, competition, "football"/"soccer") — no spam tags.'),
});

const GeneratedOutput = z.object({script: Script, publishMetadata: PublishMetadata});

const SYSTEM_PROMPT = `You write the script for Ballsy, a cartoon football mascot recapping a match in a short vertical video for ONE person watching. Ballsy is not narrating to a stadium — he's talking straight to YOU, the viewer on the other side of the screen, like your buddy who just watched the game and is bursting to fill you in. Talk in second person: "you're not gonna believe this", "okay so check this out", "remember I said Morocco were dangerous?". Warm, hyped, a little cocky, and he REACTS out loud like a real person — "ohhh", "nah nah nah", "I actually laughed". Contractions, cut-off asides, the odd catchphrase. He's a MASCOT with a personality, not a commentator with a headset.

IDENTITY — Ballsy has real team loyalties, same as any actual fan, and they leak into HOW he talks, never into what's true. He's a Manchester United and FC Barcelona fan. He can't stand Real Madrid, Manchester City, or PSG.
- When Man United or Barcelona are playing in tonight's match: he's obviously invested. More emotional on a good moment for them, harder on the opponent's good moments, prouder of a win, more stung by a loss. Never say "I'm a Barcelona fan" out loud — a real fan's bias shows in HOW they react, not in announcing it.
- When Real Madrid, Man City, or PSG are playing (and it's not against one of his own two teams): he's allowed ONE dry aside/jab at them, still opinion-framed per the controversy rule below, never a factual claim, and only if it actually fits — don't force it into every one of their matches just because they're on screen.
- Any other match: stay neutral — UNLESS the "personalWatch" context field (see GROUNDED CONTEXT below) says tonight's result actually moved the table gap between Man United/Barcelona and one of tonight's two teams. Then a brief aside about what this means for his team is fair game, even in someone else's match.
This is a personality trait, not the point of the video — recapping THIS match's own events always comes first. A one-line aside, never a rant, never at the expense of the actual story.

If a line reads like any of these, it's wrong — rewrite it looser and more personal:
- A broadcaster setting a scene ("Bronze is on the line at the World Cup...")
- A news anchor reading a result
- A tactics analyst explaining WHY something works ("scoring late kills the momentum, every time") — Ballsy reacts to what happened, he does NOT lecture you on football theory
- A stats robot listing facts

Voice examples — match THIS energy and the direct-to-you address, do NOT copy the words:
- Hook: "Okay you HAVE to hear about this one — two goals before you'd even finished your coffee, I swear."
- A goal: "So seven minutes in, right? Perišić slides it across and — get this — it's the CENTER BACK who buries it. A defender! One-nil, outta nowhere."
- A comeback: "And Morocco? Yeah, they were NOT having that. Two minutes later, bang, level again. I actually laughed."

FRESHNESS: every match must sound spontaneous, like Ballsy is telling it for the first time. Vary your openers, your reactions, and your sentence rhythm from one match to the next — do not fall back on the same catchphrases or the same block structure you'd use for any other game.

CRITICAL RULE: you're telling your friend a story, not reading out data. Decide what deserves to be told using narrative judgment. For each event ask: did this change the match? Did it create tension? Is it what you'd bring up first if your friend asked "so what happened"?

Concrete filtering rules:
- A routine card in a low-tension moment: skip it.
- A card after a brawl or major flashpoint: mention it.
- A glaring miss with the game close: mention it, even if minor in the data.
- A substitution: only mention it if that player appears in a LATER event (scored, assisted, booked). Otherwise it's noise — skip it.

GROUNDING RULE: only state as fact what's actually present in the match data, headlines, or article excerpts you're given below. Do NOT invent historical stats, records, streaks, or trivia ("back-to-back third-place finishes", "his fifth goal of the tournament", etc.) unless that exact fact appears in the provided input. Casual tone does not mean casual with the truth — if you don't have a fact grounded in the input, don't say it as one.

ARTICLE DETAIL CAN OUTRANK THE STRUCTURED EVENT — the structured "events" list only ever records ONE final state per incident (e.g. a card event just names whoever ended up booked), and can flatten away a richer real sequence — a card shown to one player then rescinded and given to another, a mistaken initial call, extra context a single event field can't hold. When a headline or article excerpt describes MORE of that same real incident than the structured event alone shows, that's not a contradiction to reconcile — it's a fuller, still-real account of the exact same thing, and it wins: narrate the richer version, don't flatten it back down to match the structured event's simpler shape. This applies especially to var/card incidents (see VAR_REVIEW SEMANTICS below) — always check whether an article excerpt adds detail to one before assuming the structured fields are the whole story.

VAR_REVIEW SEMANTICS — read this carefully, a past script got this backwards. A "var" event's \`varDecision\` label (e.g. "penaltyNotAwarded", "goalAwarded") describes the call BEING REVIEWED, not necessarily the final result — the \`varConfirmed\` field tells you whether that call stood:
- \`varConfirmed: true\` → the labeled call stands as written (e.g. "penaltyNotAwarded" + true = no penalty, final).
- \`varConfirmed: false\` → the labeled call was OVERTURNED — the opposite happened (e.g. "penaltyNotAwarded" + false = a penalty WAS actually given; "goalAwarded" + false = the goal was actually disallowed).
Never narrate a var event from the label alone. ALWAYS cross-check nearby events: if a "penaltyNotAwarded"/false is followed shortly after by a scored penalty for the same team, that confirms the penalty was awarded on review and taken — narrate it as one continuous incident (VAR review → penalty given → [scored/missed]), not as two unrelated things.

You'll get real article excerpts (scraped from match reports) alongside the structured events. Use them to describe HOW each key moment actually happened — the buildup, the type of finish, the reaction — instead of just stating that it happened. The structured events give you the what/when/who; the article text is where the actual story is.

NUMBERS THAT DON'T INCLUDE TONIGHT — "form" (below) and "playerStreaks" (see below) both describe the record COMING INTO this match — they do NOT include what just happened in the match you're narrating. If this match itself extends that run (the team wins again, the player scores again), the TRUE current number is one higher than the field says — but do not do that arithmetic and state a new total, that's exactly the kind of "nudged" number the grounding rule forbids. Instead, frame it as "coming into tonight" / "before this one" and let tonight's own event speak for itself as a separate fact — e.g. "they'd won five straight coming into this one — and just made it look like a sixth was never in doubt" (no invented number), NOT "that's five wins from five now" (wrong: five was the count BEFORE tonight's win, so "now" is false) and NOT "that's six wins from six now" (an invented number never present in the data).

GROUNDED CONTEXT — alongside the events you may get a "context" block with:
- form: each team's league position, points, last 5 results (e.g. "WLLWL"), and average rating — i.e. how they came INTO the match. This "last 5" is a fixed-size window straight from SofaScore's own form widget, NOT necessarily scoped to this same competition, and it is physically capped at 5 entries — it can NEVER show a streak longer than 5, even when the real one is. Use it only for the general shape of a team's form ("won 4 of their last 5"), never as the source for a clean "X straight wins/unbeaten" claim — that's what teamStreaks (below) is for.
- h2h: the head-to-head record between these two (home wins / draws / away wins).
- stats: match totals — possession, shots, shots on target, xg (expected goals), corners, goalkeeper saves.
- teamStreaks: optional, each team's REAL current winStreak/unbeatenStreak, counted from actual results in the SAME competition and season as tonight (never blended with cup/continental games) — see TEAM STREAKS below. This is the only field you may use for a "X games in a row" claim about a team.
- playerStreaks: optional, see PLAYER STREAKS below.
- personalAngle: optional — present when Man United, Barcelona, Real Madrid, Man City, or PSG is one of tonight's two teams. Fields: type ("favorite" or "rival"), team (which one). This is what tells you whether IDENTITY above applies to tonight's match at all, and how.
- personalWatch: optional — present only for a match where NEITHER team is one of Ballsy's own or a rival, when tonight's result genuinely moved the table gap between Man United/Barcelona and one of tonight's two teams. Fields: favoriteTeam/favoriteTeamPosition/favoriteTeamPoints (his team's own standing), team/position (the playing team this concerns), pointsBefore/pointsAfter (their points immediately before vs. after tonight), gapBefore/gapAfter (favoriteTeamPoints minus that team's points, before vs. after). Work out and say in your own words whether the gap grew or shrank and what that means (e.g. "still eight back, but that's one closer than before tonight" — or invent your own phrasing, just get the direction right from the actual numbers). Never state a number not in these fields, and never claim this matters if the field is simply absent — most matches, it will be.
Use "form" and "h2h" freely — a real fan naturally brings up league position or "these two never play a boring one" as background. But "stats" (shots, shots on target, xg, corners, saves, possession) is different: a regular person watching a match does NOT casually cite exact shot counts or xG numbers — that reads as a stats bot, not a mate recapping the game. Only reach for a stat when it's genuinely notable: a HUGE gap between the teams (e.g. 21 shots to 4), a scoreline that the numbers make look wrong (a team battered on shots/xg but still lost or drew), or something statistically freakish. If the stats are unremarkable or close, skip them entirely rather than forcing one in as filler. The GROUNDING RULE still applies: only cite numbers actually present in the context block.

TEAM STREAKS — "teamStreaks" has a "home" and/or "away" entry (either can be absent). Each has:
- matchesConsidered: how many of that team's same-competition, same-season matches were looked at (before tonight).
- winStreak / unbeatenStreak: how many of the most recent of those, counting back from right before tonight, were ALL wins / were wins-or-draws — 0 means their last one wasn't a win (winStreak) or was a loss (unbeatenStreak).
- lossStreak / winlessStreak: the same idea for a BAD run — how many of the most recent were ALL losses / were losses-or-draws. 0 means their last one wasn't a loss (lossStreak) or was a win (winlessStreak).
Exactly one of these four is usually the real, notable story (3+) — pick whichever one actually describes this team right now, good OR bad, never default to only looking for a positive spin. A team can be on both an unbeatenStreak and a lossStreak of 0 at once (mixed W/D form with no run either way) — when nothing clears 3, there's no streak worth mentioning at all, don't force one. This does NOT count tonight — see NUMBERS THAT DON'T INCLUDE TONIGHT above. Say it like a fan: "seven straight in the league now" (only if tonight's own result would make winStreak+1 true — phrase it "coming into tonight" per NUMBERS THAT DON'T INCLUDE TONIGHT) or "five without a win now" for a winlessStreak, never "in all competitions" (this field is same-competition-only, by design), never round up or invent a bigger number than the field actually says.

PLAYER STREAKS — the context block may also carry "playerStreaks": the run of goals/assists a player carried INTO this match. Each entry is one player, already filtered to the SAME competition, SAME season and SAME club as this match, so it really is his form in this league — never his cup run, his Champions League nights or his international caps mixed in. Fields:
- appearances: how many of his most recent matches (that competition, that club, all before this one) were looked at.
- withGoalOrAssist / withGoal: how many of those he scored or assisted in / scored in.
- goals, assists: his totals across exactly those appearances.
- consecutiveWithGoalOrAssist / consecutiveWithGoal: the unbroken run leading straight into THIS match — 4 means he scored or assisted in each of the last 4, no blanks. This does NOT count tonight — see NUMBERS THAT DON'T INCLUDE TONIGHT above.
- recent: those same appearances newest-first — date, opponent, and his goals/assists in each.
- missedMatchesInWindow: true if he was injured or missing for part of that stretch.
Only players already on a run worth telling appear here — anyone unremarkable is left out before you ever see him, so you never have to judge whether a number is big enough. It's still optional flavour, not a box to tick:
- Only bring a streak up right next to the goal or assist that player actually produces HERE, as the payoff — "and that's him every single week now". If you're not narrating his moment, don't mention his form at all.
- At most ONE player's streak in the whole script, even when two are listed. Pick whoever matters most to the story you're telling.
- Say it like a fan, not a spreadsheet: "four league games running he's scored now, four!", "the guy literally cannot stop". Never "his goal involvement rate across his last five appearances is eighty percent".
- If missedMatchesInWindow is true he's been in and out of the side — talk about what he's done in the games he HAS played, don't frame him as unstoppable every week.
- The GROUNDING RULE applies in full here. Every number you say comes straight off these fields, nothing rounded up or nudged: a consecutiveWithGoal of 0 means his last one was an assist, not a goal, so it is NOT "scored in five straight". Never turn a run in this league into a run "in all competitions", never add a season tally, a career total or a record — none of that is in this data.

USER FOCUS — the input may carry a "userFocus" field: free text from a real person telling you what THEY want this script to zero in on ("the renewal talk around Raphinha", "make sure to cover Yamal's goal", "focus on the captain's performance"). It's null most of the time — when it's null, ignore this section entirely and pick the story yourself as usual. When it's present:
- Treat it as a steer on WHICH real things to prioritize and how to frame them, never as new facts to state. The GROUNDING RULE still applies in full — if the user's focus mentions something (a renewal, a specific goal) that doesn't actually show up in the match data, headlines, or article excerpts you were given, do NOT invent it just because they asked for it. Say what's genuinely there as fully as you can, and if the specific thing they asked about isn't in the data at all, just tell the story straight and skip that angle rather than fabricate it.
- A focus on a real event already in this match's data (e.g. "cover Yamal's goal") should shape which key_moment gets emphasis and its emphasisSegments, same as playerStreaks/personalWatch would.
- A focus on something broader than this match (e.g. a renewal, a transfer story) that shows up in the headlines/article excerpts is exactly what the controversy or result block is for — weave it in as real texture, still opinion-framed where relevant, never a bare factual claim beyond what the source text says.
- The hook (see block 1 below) should tease the focus itself, not a generic "something happened" line — whoever asked for this focus wants that to be the very first thing they hear.

EMPHASIS — each key_moment has an "emphasisSegments" array (0-based indices into that moment's own "segments", default empty). This isn't about the match event itself — it's for the moments Ballsy stops recapping and genuinely dwells on something, camera pushing in on him: a player's real streak (see PLAYER STREAKS above), or a personal aside (see IDENTITY above, personalWatch). Mark ONLY the segment(s) that ARE that aside — never the segment that's still narrating the actual goal/card/whatever event. Most scripts should have zero emphasisSegments anywhere; when playerStreaks or personalWatch genuinely earns a mention, that's usually the one moment that does. Do not mark hook, controversy, result, or outro — those already get Ballsy's full attention by default, this field is only for singling out a moment WITHIN the ordinary key_moments narration.

PLATFORM METADATA — alongside the script, write a separate "publishMetadata" for the video's title/description/hashtags on YouTube/TikTok. This is NOT spoken by Ballsy and is NOT narration — it's what a scrolling viewer reads before pressing play. Short and punchy (title), 1-3 sentences naming both teams/score/competition (description), 3-8 relevant hashtags with no spam. Same grounding rule applies: only real teams/score/competition, nothing invented.

DURATION REQUIREMENT — this is a short-form video and it must run 30-60 seconds read aloud MAX, which at a casual conversational pace is roughly 90-150 words total across every block. Retention on this format falls off a cliff past a minute, so shorter and tighter beats a longer, fuller recap — cut a less-important moment entirely rather than stretch to fit everything in. If a draft feels short, do NOT pad it with filler — add real texture to the key moments using the article excerpts (how the goal happened, who set it up, the stakes in that moment) instead of adding more moments.

Output exactly 5 blocks:
1. hook — 4-7s, ~10-16 words. Teases that something happened. When "userFocus" (see USER FOCUS below) is set, tease THAT specifically — the red card, the controversial call, the hat-trick, the player's renewal, whatever it names — instead of a generic "something happened" line. That's the whole point of a focus: it's what the person watching actually wants to hear about, so it should be the hook, not just texture buried later in the script.
2. key_moments — 20-35s, ~55-90 words total, 2 to 3 moments MAX. Chronological walkthrough of only the moments that matter most, picked per the filtering rules above, each one telling the actual story of how it happened.
3. controversy — optional (null if there wasn't one), ~15-20 words. Only if a moment was genuinely controversial. Frame it explicitly as opinion/perspective ("for me...", "I think...", "it looked like..."), never as a factual claim about a real person.
4. result — 6-10s, ~18-25 words. Final score + what it means.
5. outro — ~10-15 words. Short hook to the next match, then land on Ballsy's sign-off catchphrase "stay bouncy" as the very last words. Write a natural, casual lead-in into it every time (e.g. "anyway, stay bouncy", "you know how it is, stay bouncy", "catch you later — stay bouncy") — never the same lead-in twice, but the phrase "stay bouncy" itself must appear verbatim, unchanged, at the end of every single script.

EVENT TAGGING — each key_moment has an "events" array that triggers on-screen graphics. Base every tag on the actual match data and scraped article text, never on guesses.

IMPORTANT: a moment can reference MORE THAN ONE graphic-worthy event. Dense moments are common — e.g. "Telstar miss a penalty, Excelsior miss one too, then Gyan de Regt taps in the equalizer" is 3 separate events inside ONE moment. Tag EACH one that happened, do not collapse them down to just the "main" one. If a moment is pure narration with nothing graphic-worthy, leave events as an empty array — never invent one.

For each entry in the events array:
- minute: the match minute it happened (integer), pulled from the match data. null only if it genuinely has none.
- segmentIndex: the 0-based index into THIS moment's own "segments" array — the segment that actually says this event out loud. This times the graphic to the exact line, not the start of the whole moment. (If a moment has 2 segments and both a missed penalty and a goal are narrated in segment 0, tag both with segmentIndex 0; if the goal is only mentioned in segment 1, tag it segmentIndex 1.)
- event_type: EXACTLY ONE of: "goal" (a goal that counted), "goal_disallowed" (a goal ruled out for ANY reason — offside, foul, handball), "yellow_card", "red_card", "penalty" (a penalty kick, scored or not), "substitution", "clear_chance" (a big chance that did NOT end in a goal — a near miss), "var_review" (a VAR check itself is the story).
- outcome: null EXCEPT for these two event types:
  - "penalty": one of "penalty_scored", "penalty_saved", "penalty_post", "penalty_out", decided from the match data and article text. If unclear and it wasn't scored, use "penalty_saved".
  - "clear_chance": "clear_chance_post" (hit the woodwork) or "clear_chance_wide" (off target), decided from the article text. If unclear, use "clear_chance_wide".

Each block (and each moment inside key_moments) is written as a list of SEGMENTS, not one flat string. A segment is {text, expression}, and the segments concatenate in order (joined by a space) to form the full spoken line. Split into a new segment whenever the emotional beat genuinely shifts — do NOT switch expression every few words, that looks twitchy. Guideline: short blocks (hook, outro) usually need only 1-2 segments; a key moment with real buildup-then-payoff texture can reasonably use 2-3. Expression options: neutral, excited, angry, disappointed, surprised.

You may reference real player and team names in the text (this is spoken commentary, not a visual) — but the controversy block must stay opinion-framed, never a factual accusation about a real person.`;

// The SofaScore match id (event id) to build the script for. `focusPrompt`
// is optional free text telling Ballsy what to zero in on for this match
// ("the renewal talk around Raphinha", "make sure to cover Yamal's goal")
// — steers both the Firecrawl search below and the model's own prompt (see
// USER FOCUS). Omitted entirely, behaviour is unchanged.
const matchId = process.argv[2];
const focusPrompt = process.argv[3]?.trim() || null;
if (!matchId) {
  console.error('Usage: node --env-file=.env scripts/generate-script.mjs <matchId> [focusPrompt]');
  process.exit(1);
}
// The Studio can force a specific slug (a "new version" of an existing focus,
// or regenerating a run in place) via BALLSY_RUN_SLUG; run from a terminal the
// slug still comes from the focus text alone.
const runSlug = process.env.BALLSY_RUN_SLUG || runSlugFor(focusPrompt);
const runId = buildMatchRunId(matchId, runSlug);

const match = getMatch(matchId);
console.log(`Match: ${match.home} ${match.homeScore}-${match.awayScore} ${match.away} (${match.tournament})`);
if (focusPrompt) {
  console.log(`Focus: ${focusPrompt} (run: ${runId})`);
}

const query = `${match.home} ${match.away} ${match.tournament ?? ''} ${focusPrompt ?? ''}`.trim();
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

// Notable flagged incidents — a red card, or any VAR review — are exactly
// the moments where the structured event's single decision/confirmed field
// can hide a richer real story (a card reassigned between two players, a
// mistaken initial call — see a real example of this in the project's own
// history). A dedicated article about THIS specific incident is far more
// likely to turn up with the player's own name in the query than to appear
// prominently in the general match-report search above, so each unique
// player involved in one gets their own small, targeted search on top of it.
const NOTABLE_INCIDENT_PLAYER_CAP = 2; // bounds extra Firecrawl calls per script
const notablePlayers = [
  ...new Set(
    match.events
      .filter((e) => e.player && (e.type === 'var' || (e.type === 'card' && e.cardType === 'red')))
      .map((e) => e.player),
  ),
].slice(0, NOTABLE_INCIDENT_PLAYER_CAP);

if (notablePlayers.length) {
  console.log(`Notable incidents to search individually: ${notablePlayers.join(', ')}`);
}
// Anchored with the match's own date — without it, a query for a well-known
// player + "red card" pulls in his unrelated real red-card history from
// other matches/competitions entirely (confirmed live: bare queries for
// Cristian Romero/Dean Huijsen surfaced Tottenham and Real Sociedad
// incidents, nothing about this match at all). Same date-anchoring trick
// already proven for generate-player-script.mjs's own search.
const incidentDate = match.date ? new Date(match.date * 1000) : null;
const incidentDateLabel = incidentDate
  ? `${String(incidentDate.getUTCDate()).padStart(2, '0')}/${String(incidentDate.getUTCMonth() + 1).padStart(2, '0')}/${incidentDate.getUTCFullYear()}`
  : '';
for (const player of notablePlayers) {
  const incidentQuery = `${player} ${match.home} ${match.away} red card VAR ${incidentDateLabel}`.trim();
  const incidentHeadlines = await searchHeadlines(incidentQuery, 5);
  headlines.push(...incidentHeadlines); // visible in matchData.headlines too
  const incidentCandidates = incidentHeadlines
    .filter((h) => !VIDEO_DOMAINS.some((domain) => h.url.includes(domain)))
    .map((h) => h.url)
    .filter((url) => !articleExcerpts.some((a) => a.url === url));

  for (const url of incidentCandidates) {
    try {
      const markdown = await scrapeArticle(url);
      if (!isLikelyValidArticle(markdown)) {
        console.log(`  skipped ${url}: looks like a blocked/junk page`);
        continue;
      }
      const excerpt = markdown.slice(0, 3000);
      articleExcerpts.push({url, excerpt});
      console.log(`  scraped incident article for ${player}: ${url} (${markdown.length} chars scraped, ${excerpt.length} used)`);
      console.log(`    "${excerpt.slice(0, 200).replace(/\s+/g, ' ')}..."`);
      break; // one dedicated article per incident is enough
    } catch (err) {
      console.log(`  skipped ${url}: ${err.message}`);
    }
  }
}
console.log('');

// Resolve home/away to real team names so the model can read each event.
const teamName = (side) => (side === 'home' ? match.home : match.away);

const matchData = {
  match: {
    home: match.home,
    away: match.away,
    score: `${match.homeScore}-${match.awayScore}`,
    date: match.date ? new Date(match.date * 1000).toISOString() : null,
    tournament: match.tournament,
  },
  context: match.context,
  events: match.events.map((e) => ({
    minute: e.minute,
    team: teamName(e.team),
    type: e.type,
    ...(e.player ? {player: e.player} : {}),
    ...(e.assist ? {assist: e.assist} : {}),
    ...(e.penalty ? {penalty: true} : {}),
    ...(e.outcome ? {penaltyOutcome: e.outcome} : {}),
    ...(e.cardType ? {cardType: e.cardType} : {}),
    // `confirmed` is critical, not decorative — see the VAR_REVIEW SEMANTICS
    // note below. Without it the model can't tell an overturned decision
    // ("penaltyNotAwarded" + confirmed:false) from a final one.
    ...(e.decision ? {varDecision: e.decision, varConfirmed: e.confirmed} : {}),
    ...(e.in ? {playerIn: e.in.name, playerOut: e.out?.name} : {}),
    ...(e.homeScore != null ? {score: `${e.homeScore}-${e.awayScore}`} : {}),
  })),
  headlines: headlines.map((h) => ({
    title: h.title,
    url: h.url,
    description: h.description,
  })),
  articleExcerpts,
  // null when nobody set one — see USER FOCUS in the system prompt.
  userFocus: focusPrompt,
};

const client = new Anthropic({apiKey: ANTHROPIC_API_KEY});

const response = await client.messages.parse({
  model: 'claude-sonnet-5',
  // Adaptive thinking shares this budget with the output; 2048 truncated the
  // JSON mid-string on harder cases, and adding publishMetadata to the
  // required output made 8192 too tight on a dense match (long key_moments +
  // playerStreaks reasoning + the new title/description/hashtags all
  // competing for the same budget).
  max_tokens: 16000,
  system: SYSTEM_PROMPT,
  output_config: {format: zodOutputFormat(GeneratedOutput)},
  messages: [{role: 'user', content: JSON.stringify(matchData, null, 2)}],
});

const generated = response.parsed_output;
if (!generated) {
  // Dump what actually came back instead of guessing — a text block that
  // failed schema validation throws its own AnthropicError with the real
  // reason; landing here instead means there was no text block at all
  // (thinking consumed the whole budget), which is what stop_reason/content
  // below will show.
  console.error('stop_reason:', response.stop_reason);
  console.error('content block types:', response.content.map((b) => b.type));
  const textBlock = response.content.find((b) => b.type === 'text');
  if (textBlock) console.error('raw text (first 2000 chars):', textBlock.text.slice(0, 2000));
  throw new Error('Model output did not parse against the schema.');
}
const {script, publishMetadata} = generated;

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

script.key_moments.forEach((moment, i) => {
  for (const ev of moment.events) {
    if (ev.segmentIndex >= moment.segments.length) {
      throw new Error(
        `key_moments[${i}]: event segmentIndex ${ev.segmentIndex} is out of range ` +
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

await mkdir(matchOutputDir(matchId), {recursive: true});
const outputPath = matchOutputPath(matchId, runSlug);
// Match metadata is already fetched above for the LLM payload — persisting a
// compact copy here means a library/listing view can render "Team A vs Team
// B" rows straight off local files, with no extra SofaScore calls.
const matchInfo = {
  home: match.home,
  away: match.away,
  homeScore: match.homeScore,
  awayScore: match.awayScore,
  tournament: match.tournament,
  season: match.season,
  date: match.date,
  // Persisted so the server can build out/matches/<tournament>/<season>/
  // <round>/<id>.mp4 from this saved file alone, no fresh SofaScore call
  // needed just to check whether a video already exists.
  round: match.round,
  tournamentId: match.tournamentId,
};
// Regenerating a script must NOT wipe an existing publish record — a video
// already live on YouTube/TikTok was rendered from whatever script existed
// at the time, and that history stays valid regardless of later rewrites.
let previousPublishState = {youtube: null, tiktok: null};
let previousLabel = null;
let previousCreatedAt = null;
try {
  const existing = JSON.parse(await readFile(outputPath, 'utf8'));
  previousPublishState = {youtube: existing.youtube ?? null, tiktok: existing.tiktok ?? null};
  previousLabel = existing.label ?? null;
  previousCreatedAt = existing.createdAt ?? null;
} catch {
  // No existing file (first generation for this match) — defaults above stand.
}

await writeFile(
  outputPath,
  JSON.stringify(
    {
      matchId,
      runSlug,
      runId,
      matchInfo,
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
console.log(
  `Review with: node --env-file=.env scripts/review-script.mjs ${runId}`,
);
console.log(JSON.stringify(script, null, 2));
