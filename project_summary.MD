# Ballsy — AI-Generated Football Match Recap Videos

## What this project is

A pipeline that automatically generates short-form vertical videos (9:16, ~60-90s)
recapping football matches, narrated by an animated mascot called **Ballsy** — a
cartoon football with eyes, eyebrows, mouth and floating hands, who comments on the
match casually and subjectively, like a person, not a robot reading statistics.

Built as a portfolio project. Currently targeting the 2026 FIFA World Cup, but
designed to work for any competition (e.g. La Liga) later.

**Key architectural principle: the video is composed with CODE, not generative AI.**
AI is used in exactly two places: (1) an LLM agent writes the script, (2) TTS turns
the script into audio. Everything else is deterministic React/Remotion rendering.
This was a deliberate choice — generative video models are non-deterministic (the
mascot would look different every episode) and can't legally depict real players or
team crests.

## Pipeline overview

```
Football API + news search  →  Agent (writes script)  →  Human review
                                                              ↓
                                        TTS (audio)  →  Rhubarb (visemes)
                                                              ↓
                                        Remotion (composes video)  →  MP4
```

## Stack decisions (and why)

| Layer | Choice | Rationale |
|---|---|---|
| Match data | **API-Football** (free tier) | Only free option with full event timeline (goals, cards, subs, VAR events) at minute-level precision. ~100 req/day is plenty — we call once per match, not live. |
| News / context | **Firecrawl** (search mode, free tier) | Structured data can't tell you what was *controversial* or what people are *talking about*. Firecrawl search returns headlines → the agent uses them as a relevance signal. |
| Agent | **Simple LLM + tool use** (Anthropic/OpenAI SDK, or Pydantic AI) | NOT LangGraph — the flow is linear (fetch → optionally search → write script). A graph is overengineering here. Structured output matters more than orchestration. |
| TTS | **ElevenLabs** (free tier, English) | Best expressive quality for a character voice. Free tier = 10k chars/month (~11 scripts). NOTE: free tier has **no commercial rights** — needs Starter ($5/mo) if publishing. Cartesia is the fallback (3-4x cheaper per char). |
| Lip-sync | **Rhubarb Lip Sync** | Open source. Takes the TTS audio, outputs a timeline of visemes (mouth shapes) with timestamps. |
| Mascot | **Rive** (`.riv` file) | Vector animation with state machines. Drawn once, reused forever. |
| Video composition | **Remotion** (React) | Programmatic video. Free for individual use. Live preview in browser (Remotion Studio) without rendering. Already know React. |
| Trigger | **Manual, via small frontend** | User picks a match from a list populated by API-Football (avoids typos, works for any competition). Cron is pointless because human review is required anyway. |

## Video structure (the script)

The agent outputs a structured JSON script with these blocks:

1. **Hook** (5-10s, ~15-20 words) — teases that something happened, without the result
2. **Key moments** (35-50s, ~90-120 words, 2-4 moments max) — chronological walkthrough
3. **Controversy** (optional, ~15-20 words) — only if there was one. Framed as *opinion*.
4. **Result + conclusion** (10-15s, ~25-35 words) — final score + what it means
5. **Outro** (~10 words) — short hook to the next match

Total ≈ 155 words ≈ 60-90s at casual TTS pace.

Each block is tagged with: the event it illustrates, and which **expression** Ballsy
should have.

## CRITICAL: the agent must be a commentator, not a data narrator

This is the single most important design principle in the project.

The agent must **decide what deserves to be told**, using narrative judgment — not
mechanically list every event the API returns. The criteria: did this change the
match? Did it create tension? Is it what someone would talk about in a bar the next
day?

Concrete rules:
- A routine yellow card in minute 20 → **don't mention it**
- A yellow card after a brawl → **mention it**
- A glaring miss in minute 80 with the game tied → **mention it**, even if the API
  barely registers it as an event
- A substitution → **only mention it if that player appears in a later event**
  (scored, assisted, got booked). Otherwise it's noise.

The 2-4 moment limit is an **editorial** constraint, not a space constraint. It
forces the agent to prioritise.

**Firecrawl headlines are the relevance signal that structured data can't give you.**
If three outlets lead with "X's miss in the 80th", the agent knows that's a key
moment. Run the Firecrawl search after **every** match unconditionally — not gated on
API event type — because a controversy often comes from a decision that was NOT made
(no red card given, no penalty awarded), which produces no API event at all.

## Legal / content constraints (these drove several decisions)

- **No real players, faces, team crests, or broadcast footage.** All visuals are
  generic: the ball, the scoreboard, symbols, animated graphics.
- **Mascot is stylised, not realistic.** A realistic AI avatar would trigger synthetic-
  media disclosure labels (TikTok/YouTube policies, and EU AI Act Art. 50 which comes
  into force 2 Aug 2026 — user is in Spain, so it applies). A cartoon football is
  explicitly exempt as a "stylised/fantasy effect".
- **Original ball design.** Not the Jabulani or any other trademarked ball (Adidas).
- Controversy commentary must be clearly framed as **opinion**, like any pundit —
  never as a factual claim about a real person.

## Visual design

- **Format:** vertical 9:16, short-form
- **Ballsy big and centred** during hook and outro (his personality moments)
- **Ballsy floats, no visible frame/border**, shrunk down during the key-moments
  section — not a streamer-cam picture-in-picture box, just Ballsy himself smaller
  and drifting.
- **Moves to a new corner "zone" on each new key moment** (not random, not fixed) —
  reinforces "something new is happening" and keeps him clear of the event graphic,
  which stays centered. Transition between zones is a smooth ease (`interpolate()` +
  `Easing.bezier()`), not an instant jump. While holding in a zone, a small
  continuous organic bob (position + scale, sine-based) keeps him feeling alive
  rather than static. 4 corner zones, each a fraction of the frame size so it's
  resolution-independent. Big & centered (no float, no bob) during hook/outro/
  controversy/result.
- **Subtitles**: generated from the script text directly (NOT via transcription) —
  the script already exists before the audio does. Sync using the word-level
  timestamps ElevenLabs returns with the audio. Zero risk of subtitle/audio mismatch.

### Event → graphic mapping

| Event | Graphic |
|---|---|
| Goal | Ball entering net + animated scoreboard counter |
| Goal disallowed (VAR) | Score ticks up then reverts + animated offside line + red strike-through |
| Yellow/red card | Card spins to centre with the minute |
| Penalty | Penalty spot + tension circle, two outcomes (scored/missed) |
| Substitution | Crossing green/red arrows with shirt numbers |
| Clear chance | Animated dotted ball trajectory toward post/wide |
| VAR review | Stylised monitor + "review in progress" effect |

The actor is always **the ball, the scoreboard, or a symbol** — never a person.

## Ballsy (the mascot) — current state

Drawn in Rive. Original black-and-white cartoon football design.

**Layer separation principle:** split by *what needs to move independently*, not by
geometry. The pentagons and seams never move independently, so they're all one static
group.

Groups:
- `body` — circle + all pentagons + all seams (one static group)
- `eyebrows` (L/R) — where most of the expression comes from
- `eyes` (L/R) — with separate pupils
- `mouth` — 9 viseme shapes stacked, one visible at a time
- `hands` (L/R) — four-finger cartoon gloves, floating (no arms, no joints). Poses,
  not pointing — a pose per expression, swapped by opacity like the visemes.

**Timelines:**
- 1 × `idle` (floating, looping)
- ~5 × expression (`neutral`, `excited`, `angry`, `disappointed`, `surprised`) —
  each one moves **eyebrows + eyes together**. Expressions do NOT touch the mouth.
- 9 × viseme: `0_rest`, `1_AI`, `2_E`, `3_O`, `4_U`, `5_MBP`, `6_FV`, `7_L`, `8_etc`

**State machine (single machine, parallel layers):**
- Layer 1 — `idle` float, always looping
- Layer 2 — lip-sync: `entry → 0_rest`, then `any state → each viseme`, conditioned
  on input `viseme` (0-8)
- Layer 3 (to build) — expression, conditioned on input `expression` (0-4)

Layers run in parallel and each touches only its own shapes — that's why "angry
eyebrows + O-shaped mouth" works without ever drawing that combination. **Never let
an expression timeline write to mouth properties** — it will fight the viseme layer
and cause flicker.

**Transitions between visemes must be ~0ms (instant).** Visemes change every
50-100ms; if Rive interpolates smoothly between mouth shapes, the lip-sync looks
blurry. Cartoon mouths cut, they don't crossfade.

## Human review flow

Two review points, in this order (order matters — it's about cost):

1. **Script review (text)** — the agent returns JSON. Read it, fix errors here.
   **Free and instant. No TTS credits spent yet.** This is where 90% of agent errors
   will surface (wrong score, misread event, wrong tone).
2. **Video preview** — once the script is approved, generate TTS + preview in
   **Remotion Studio** (runs locally in browser, scrub the timeline, no MP4 render
   needed, no credits consumed).
3. **Final render** — only when it all checks out.

**Cache the TTS audio to disk.** Remotion Studio can then be opened infinitely for
visual tweaks at zero cost. TTS is only re-spent if the *script text* changes.

## Remotion + Rive integration — the gotcha

Remotion renders **frame by frame**, not in real time. You must **drive the Rive
state machine manually from `useCurrentFrame()`** — do not let Rive run its own
clock, or the rendered video will be desynced from the audio.

Per frame, the code:
1. Reads the script JSON → determines which block we're in → sets `expression` input
2. Reads the Rhubarb viseme file → determines which mouth for this millisecond →
   sets `viseme` input

Load the `.riv` with `@rive-app/react-canvas`. The Rive artboard background must be
**transparent** (don't add a background rectangle) so Ballsy composites over the
match graphics.

## Build order (deliberately incremental)

1. ✅ Draw Ballsy in Rive, viseme state machine built
2. ✅ Static ball renders inside Remotion (Rive→Remotion pipe proven)
3. ✅ `idle` float works, survives the render
4. ✅ Viseme state machine verified inside Rive (manually cycling the `viseme` input
   switches the mouth correctly)
5. ✅ Drive the `viseme` input from Remotion — confirmed React can control the mouth
   per-frame via `useCurrentFrame()`. Verified first with a dummy cycle
   (`Math.floor(frame / 5) % 9`) before involving Rhubarb, isolating the Rive/Remotion
   wiring from the viseme mapping.
6. ✅ Wired up Rhubarb → viseme input for real lip-sync. Tested on a short ElevenLabs
   clip. Rhubarb's Preston Blair letters (A-H, X) mapped to the 9 timeline indices
   (0-8) via a lookup table — confirmed working end to end (audio + mouth in sync).
7. ✅ Added the 5 expressions (Layer 3) and drove `expression` from React the same
   way as `viseme` — per-frame from `useCurrentFrame()`, cycling through all 5 on a
   dummy timer alongside the real Rhubarb lip-sync on the same test phrase. Confirmed
   working: mouth and expression layers run independently with no flicker.
8. Match data ingestion + agent + script generation
   1. ✅ Fetched a single match's event timeline from API-Football via
      `scripts/fetch-match-events.mjs` (finds the World Cup league + a finished
      fixture dynamically, no hardcoded IDs). **Free plan only covers seasons
      2022-2024**, not 2026 — tested against a 2022 World Cup match (Croatia 2-1
      Morocco) as a stand-in; same league, same data shape. Confirmed shape: each
      event has `time.elapsed`, `team`, `player`, `assist`, `type` (Goal/subst/Card),
      `detail`, `comments`.
   2. ✅ Ran a Firecrawl search (`scripts/fetch-match-headlines.mjs`) for the same
      test match; confirmed real, usable headlines come back (ESPN, FIFA, Reddit,
      YouTube) as a relevance signal (see [CRITICAL: the agent must be a
      commentator, not a data
      narrator](#critical-the-agent-must-be-a-commentator-not-a-data-narrator)).
   3. ✅ Wrote the agent prompt encoding the commentator-not-narrator editorial
      rules and called Claude Sonnet 5 (`scripts/generate-script.mjs`, structured
      output via zod + `output_config.format`) with the combined events +
      headlines. Confirmed working end to end on the test fixture: real 5-block
      JSON script (hook, key_moments ×3, controversy null, result, outro). Each
      block is a list of **segments** (`{text, expression}`) rather than one flat
      string + one expression — a single static expression across 5-50s of
      speech read as robotic, so segments let the face change mid-block when the
      emotional beat shifts.
   4. ✅ Manually reviewed the agent's output across 3 different matches (a
      routine finish, a semifinal decided by a late sub's goal, and a
      quarterfinal with a missed penalty) and iterated the prompt through
      several real issues found in review: tone was too "broadcaster" (rewrote
      for a casual, opinionated voice), the script was too short for a 30-90s
      short (added a duration requirement + told the model to use scraped
      article text for play-by-play detail on goals, not just "Goal" labels),
      and the model fabricated an incorrect historical stat (added an explicit
      grounding rule — only state facts present in the provided data). Also
      fixed a real bug: Sonnet 5's adaptive thinking shares the `max_tokens`
      budget with the output, and 2048 was tight enough to truncate the JSON
      mid-string on a harder case — raised to 8192. Residual known risk: the
      model still occasionally adds historical color not present in the input
      (accurate so far, but unverified) — accepted as something the human
      review step (8.5) should catch, not something a prompt can fully prevent.
   5. ✅ Wired the **script review** step from the Human review flow.
      `scripts/generate-script.mjs` saves each script wrapped as
      `{reviewStatus: "pending", reviewedAt: null, script}`; a new
      `scripts/review-script.mjs <fixtureId>` renders it block-by-block
      (text + expression per segment) and prompts approve/reject, updating
      `reviewStatus`/`reviewedAt` in place. Manual edits: open the saved JSON,
      edit the `script` text directly, then run the review script to approve
      — no LLM regeneration needed. Still no TTS or rendering — that starts in
      step 9.
9. Automate TTS + Rhubarb for a real approved script (not a hand-picked test
   phrase like step 6), and wire the result into `src/ballsy.tsx` end to end.
   1. ✅ Got an ElevenLabs API key + picked a voice (Callum — "Husky
      Trickster", a **premade** voice; library voices like the first pick,
      "Ed - Late Night Announcer", return 402 on the free tier — library
      voices need a paid plan to use via API, premade voices don't). Built
      `scripts/generate-audio.mjs`: reads an approved script, concatenates all
      segment text into one string (tracking each segment's character offset
      for step 9.3), calls the TTS-with-timestamps endpoint, saves the audio
      to `public/audio/<fixtureId>.mp3` and the character-level alignment to
      `scripts/output/<fixtureId>-alignment.json`. Confirmed working on the
      test fixture: 78.86s of real audio (within the 30-90s target) with a
      timestamp for every one of its 1052 characters.
   2. ✅ Built `scripts/generate-visemes.mjs`: converts the generated MP3 to
      WAV via `ffmpeg`, writes the full script text to a temp dialog file,
      runs `rhubarb -f json -d <dialog> -o <output> <wav>` automatically (no
      manual CLI steps like step 6), and saves the result to
      `public/audio/<fixtureId>-visemes.json`. Confirmed working: 442 mouth
      cues for the 78.86s test fixture, same `{start, end, value}` shape
      (Preston Blair letters) already consumed by `findViseme`/
      `RHUBARB_TO_VISEME` in `src/ballsy.tsx` — no format changes needed there.
   3. ✅ Built `scripts/generate-expressions.mjs`: maps each segment's
      character offset to a real timestamp via the ElevenLabs alignment,
      producing contiguous `{start, end, expression}` cues (same shape as
      Rhubarb's `mouthCues`) covering the full audio duration. Saved to
      `public/audio/<fixtureId>-expressions.json`. Confirmed working: 12
      expression cues for the test fixture's 12 segments, spanning all 78.86s
      with no gaps.
   4. ✅ Wired `src/ballsy.tsx` to load the real per-match audio (`audio/<fixtureId>.mp3`)
      + Rhubarb viseme cues + the step 9.3 expression cues, replacing the fixed
      test-phrase audio and the dummy expression cycle. Added `findExpression`
      (mirrors `findViseme`) and updated `Root.tsx`'s `durationInFrames` to
      match the real audio length. Confirmed compiling and running in
      Remotion Studio with lip-sync + expression both driven by real data.

      Two rounds of review feedback after first checking it in Studio:
      - **Expressions looked artificial/held too long** (a segment can span
        5-8s, and holding one extreme expression that whole time doesn't read
        like a cartoon — real cartoons punch in a reaction briefly, then
        relax back to neutral while dialogue continues). Fixed in
        `generate-expressions.mjs`: non-neutral expressions now hold for only
        `EXPRESSION_HOLD_SECONDS` (0.9s) from the segment's start, then fall
        back to neutral for the remainder of that segment.
      - **Voice didn't fit** — too calm/generic. Tried tuning `voice_settings`
        (lower `stability`, added `style`) in `generate-audio.mjs` for a more
        animated delivery — helped some but not enough. Tried switching
        premade voices (Callum → considered Liam/Laura). Ultimately the user
        used ElevenLabs' **Voice Design** to generate a custom voice from a
        text description (persona: "playful cartoon sports sidekick"),
        named it "Ballsy", and it worked via the API on the free tier —
        confirming **Voice Design ("generated" category) voices are usable
        via API for free, unlike Voice Library ("professional"/shared)
        voices**, which return 402 regardless of which one you pick. Current
        `ELEVENLABS_VOICE_ID` in `.env` is this custom Ballsy voice.
10. Event graphics
    1. ✅ Built the **goal** graphic (`src/graphics/GoalGraphic.tsx`): a real
       cartoon-ball PNG (`public/ball.png`, user-provided, alpha-transparent —
       reused instead of a hand-drawn SVG, which looked cheap on the first two
       tries) flies in and settles, a tilted red "GOAL!" banner scales in, and
       the scoreboard ticks up with a bounce on the scoring team's number.
       Built following the `remotion-markup` Agent Skill conventions
       (installed via `npx skills add remotion-dev/skills`): `interpolate()` +
       `Easing.spring()`/`Easing.bezier()` instead of bare `spring()`,
       individual `scale`/`translate`/`rotate` CSS properties instead of
       composed `transform` strings, `Interactive.Div` with descriptive names
       for Studio editability. Verified visually via `npx remotion still`
       rendered frames (not just Studio) — caught and fixed a real centering
       bug (absolutely-positioned children need `left: 50%` *and*
       `translate: -50%`, not `translate` alone) and a pre-impact-visible-flash
       bug, before removing the flash entirely per feedback.
    2. ✅ Built `scripts/generate-graphics-timeline.mjs`: for each `key_moment`
       tagged `"goal"`, finds its start timestamp (via the same alignment data
       as the expression timeline) and re-fetches the raw API-Football events
       to compute the running score at that point (the script only keeps
       `minute`/`event_type`, not the scoreline) and which team scored. Saves
       `public/audio/<fixtureId>-graphics.json`. Wired into `src/ballsy.tsx`
       via `<Sequence from={...}><GoalGraphic ... /></Sequence>`, one per
       goal. Shared block-timing logic factored into
       `scripts/lib/script-timing.mjs` (`computeBlockStartTimes`) so this
       script and the avatar-timeline script don't duplicate the segment
       traversal.

       **Unplanned but necessary detour:** the first end-to-end render showed
       the goal graphic colliding with Ballsy's face, because Ballsy was still
       always big & centered — the "floating during key moments" behavior
       from the Visual design section had never actually been built. Rather
       than the originally-documented bordered streamer-cam frame, the user
       asked for Ballsy to float freely (shrink/grow, drift) with no visible
       frame, moving to a new corner zone each key moment. Built
       `scripts/generate-avatar-timeline.mjs`: keyframes of
       `{time, scale, x, y}` (big & centered for hook/controversy/result/
       outro; shrunk into one of 4 corner-zone fractions during key moments,
       easing between zones — see updated Visual design section above).
       `src/ballsy.tsx` wraps the `<canvas>` in a div driven by
       `interpolate()` across those keyframes, plus a small sine-based
       position/scale "bob" that fades in/out with a `floatingAmount` value
       (0 when big & centered, 1 when floating) so it never jitters during
       the static hook/outro. Confirmed working: Ballsy shrinks into the
       correct zone per moment, no more collision with the event graphic.
    3. ✅ Built the remaining graphic types: `GoalDisallowedGraphic`,
       `CardGraphic`, `PenaltyGraphic`, `SubstitutionGraphic`,
       `ClearChanceGraphic`, `VarReviewGraphic`. Shared style tokens in
       `src/graphics/shared.tsx` (`COLORS`, `Banner`, `TitlePill`) so every
       graphic reads as one system. Revised twice per user feedback:
       - `GoalDisallowed` made generic (works for any disallow reason, not
         just offside): GOAL! banner struck through + ball crossed out + NO
         GOAL stamp, score ticks up then reverts.
       - `Penalty` uses real assets (`public/net.png`, `public/save.png`,
         `public/ball.png`) with 4 distinct outcomes:
         `'scored' | 'saved' | 'post' | 'out'` (not just scored/missed).
       - `Substitution` simplified to just the reference `substitution.png`
         icon (pop + spin) plus OUT/IN number badges — no player likeness.
       - `ClearChance` redrawn with `net.png` + `ball.png` + dotted
         trajectory, outcomes `'post' | 'wide'`.
       - `VarReview` redrawn in code (not the reference PNG, which was a
         watermarked stock image) matching its black-outline TV + "VAR" look.
       - Ball flight paths (penalty + clear chance) use frame-spacing
         proportional to distance between keyframes so linear motion reads as
         one continuous speed — evenly-spaced-in-time waypoints on an uneven
         path caused a visible mid-flight slowdown.
       Audited against the `remotion-markup` Agent Skill: compliant
       (`interpolate()`+`Easing`, `scale`/`translate`/`rotate` props,
       `Interactive.Div`, no CSS transitions). One deliberate deviation: the
       disallowed-goal strike-through/cross is hand-rolled SVG instead of
       `@remotion/rough-notation`, because that package's oldest published
       version (4.0.491) is newer than this project's pinned Remotion
       (4.0.489) — adopting it would require a full Remotion upgrade, judged
       not worth it for one annotation.
    4. ✅ Every graphic type is now driven by real per-match data.
       - `generate-script.mjs`: `event_type` is a restricted enum (`goal`,
         `goal_disallowed`, `yellow_card`, `red_card`, `penalty`,
         `substitution`, `clear_chance`, `var_review`) plus an `outcome` field
         the model fills for `penalty` / `clear_chance` (the raw API can't
         disambiguate a missed penalty into saved/post/out, and a clear chance
         isn't an API event at all — both are read from the scraped article).
       - `generate-graphics-timeline.mjs`: for each key moment, normalizes the
         event type and cross-references the raw API-Football events to build
         the matching graphic's props. Goal/disallowed compute the running /
         standing score; cards read `detail`; penalty uses API scored-vs-missed
         then the model's `outcome` (default `saved`) for the miss; substitution
         pulls shirt numbers from a new `/fixtures/lineups` fetch
         (`fetchFixtureLineups` in `api-football.mjs`) — player=ON, assist=OFF,
         surname-only badges; VAR is propless; clear_chance is purely the
         model's `outcome`.
       - `src/ballsy.tsx`: `GraphicsEntry` is a discriminated union over all 7
         types with a per-type on-screen duration; a `renderGraphic()` switch
         mounts the right component inside each `<Sequence>`.
       Validated end to end: the real fixture 979138 still emits its 3 goals
       unchanged, and a synthetic all-types script (built over 979138's real
       card/subst events) produced correct props for every branch, incl. real
       shirt numbers from the lineups endpoint.
       Known caveat: `goal_disallowed` scoringTeam relies on a matching API
       `Var` event; if none exists it defaults to `home` with a warning (the
       free tier rarely has disallowed-goal events).
11. **← YOU ARE HERE:** Frontend match selector

## Out of scope for v1 (deliberately)

- Automated publishing to TikTok/YouTube (stays a local demo for now)
- A separate dedicated video just about the controversy (idea for later)
- Hands that actually point at things (too complex for the value)