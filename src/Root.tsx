import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { Ballsy, FIXTURE_ID } from "./ballsy";
import { PlayerBallsy, PLAYER_FIXTURE_ID } from "./ballsyPlayer";
import { PrematchBallsy, PREMATCH_FIXTURE_ID } from "./ballsyPrematch";
import { GoalGraphic } from "./graphics/GoalGraphic";
import { GoalDisallowedGraphic } from "./graphics/GoalDisallowedGraphic";
import { CardGraphic } from "./graphics/CardGraphic";
import { PenaltyGraphic } from "./graphics/PenaltyGraphic";
import { SubstitutionGraphic } from "./graphics/SubstitutionGraphic";
import { ClearChanceGraphic } from "./graphics/ClearChanceGraphic";
import { VarReviewGraphic } from "./graphics/VarReviewGraphic";
import { RecentFormGraphic } from "./graphics/RecentFormGraphic";
import { SeasonTallyGraphic } from "./graphics/SeasonTallyGraphic";
import { StreakCallOutGraphic } from "./graphics/StreakCallOutGraphic";
import { InjuryGapGraphic } from "./graphics/InjuryGapGraphic";
import { UpcomingFixtureGraphic } from "./graphics/UpcomingFixtureGraphic";
import { TeamFormCompareGraphic } from "./graphics/TeamFormCompareGraphic";
import { TablePositionGraphic } from "./graphics/TablePositionGraphic";
import { H2HGraphic } from "./graphics/H2HGraphic";
import { TeamStreakGraphic } from "./graphics/TeamStreakGraphic";
import { TeamNewsGraphic } from "./graphics/TeamNewsGraphic";
import { PredictionGraphic } from "./graphics/PredictionGraphic";

// Sizes the Ballsy composition to the real audio length instead of a
// hand-maintained constant. The ElevenLabs alignment file that carries the
// exact end time only exists in scripts/output/ (a Node-side build artifact,
// never copied into public/) — so it can't be fetched here. Instead we reuse
// `${FIXTURE_ID}-expressions.json`, which IS public (ballsy.tsx already
// fetches it) and whose last cue's `end` is derived from that same exact
// value in generate-expressions.mjs, so it's an equally precise source.
const FPS = 30;
const TAIL_BUFFER_SECONDS = 2;

const calculateBallsyMetadata: CalculateMetadataFunction<
  Record<string, unknown>
> = async ({ abortSignal }) => {
  const res = await fetch(staticFile(`audio/${FIXTURE_ID}-expressions.json`), {
    signal: abortSignal,
  });
  const { expressionCues } = await res.json();
  const durationSeconds =
    (expressionCues?.at(-1)?.end ?? 0) + TAIL_BUFFER_SECONDS;

  return {
    durationInFrames: Math.ceil(durationSeconds * FPS),
  };
};

// Same trick as calculateBallsyMetadata, targeting the player composition's
// own fixture id instead.
const calculatePlayerBallsyMetadata: CalculateMetadataFunction<
  Record<string, unknown>
> = async ({ abortSignal }) => {
  const res = await fetch(
    staticFile(`audio/${PLAYER_FIXTURE_ID}-expressions.json`),
    { signal: abortSignal },
  );
  const { expressionCues } = await res.json();
  const durationSeconds =
    (expressionCues?.at(-1)?.end ?? 0) + TAIL_BUFFER_SECONDS;

  return {
    durationInFrames: Math.ceil(durationSeconds * FPS),
  };
};

// Same trick again, targeting the pre-match preview composition's own
// fixture id.
const calculatePrematchBallsyMetadata: CalculateMetadataFunction<
  Record<string, unknown>
> = async ({ abortSignal }) => {
  const res = await fetch(
    staticFile(`audio/${PREMATCH_FIXTURE_ID}-expressions.json`),
    { signal: abortSignal },
  );
  const { expressionCues } = await res.json();
  const durationSeconds =
    (expressionCues?.at(-1)?.end ?? 0) + TAIL_BUFFER_SECONDS;

  return {
    durationInFrames: Math.ceil(durationSeconds * FPS),
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Ballsy"
        component={Ballsy}
        durationInFrames={2440} // fallback shown before calculateMetadata resolves
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={calculateBallsyMetadata}
      />
      <Composition
        id="PlayerBallsy"
        component={PlayerBallsy}
        durationInFrames={2440} // fallback shown before calculateMetadata resolves
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={calculatePlayerBallsyMetadata}
      />
      <Composition
        id="PrematchBallsy"
        component={PrematchBallsy}
        durationInFrames={2440} // fallback shown before calculateMetadata resolves
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={calculatePrematchBallsyMetadata}
      />
      <Composition
        id="GoalGraphicTest"
        component={GoalGraphic}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeTeam: "ATM",
          awayTeam: "BAR",
          homeScore: 2,
          awayScore: 1,
          scoringTeam: "home" as const,
          homeBadge: "badges/2836.png",
          awayBadge: "badges/2817.png",
          homeColor: "#ffffff",
          awayColor: "#154284",
          scorer: {name: "Griezmann", number: 7, photo: "players/41789.png"},
        }}
      />
      <Composition
        id="GoalGraphicAwayTest"
        component={GoalGraphic}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeTeam: "ATM",
          awayTeam: "BAR",
          homeScore: 1,
          awayScore: 2,
          scoringTeam: "away" as const,
          homeBadge: "badges/2836.png",
          awayBadge: "badges/2817.png",
          homeColor: "#ffffff",
          awayColor: "#154284",
          scorer: {name: "Lewandowski", number: 9, photo: "players/41789.png"},
        }}
      />
      <Composition
        id="GoalDisallowedGraphicTest"
        component={GoalDisallowedGraphic}
        durationInFrames={120}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeTeam: "ATM",
          awayTeam: "BAR",
          homeScore: 1,
          awayScore: 1,
          scoringTeam: "home" as const,
          homeBadge: "badges/2836.png",
          awayBadge: "badges/2817.png",
          homeColor: "#ffffff",
          awayColor: "#154284",
        }}
      />
      <Composition
        id="CardGraphicTest"
        component={CardGraphic}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          cardType: "yellow" as const,
          minute: 45,
        }}
      />
      <Composition
        id="PenaltyScoredTest"
        component={PenaltyGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          outcome: "scored" as const,
          homeTeam: "TEL",
          awayTeam: "EXC",
          homeScore: 2,
          awayScore: 1,
          scoringTeam: "away" as const,
          homeBadge: "badges/2836.png",
          awayBadge: "badges/2817.png",
          homeColor: "#ffffff",
          awayColor: "#154284",
        }}
      />
      <Composition
        id="PenaltySavedTest"
        component={PenaltyGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          outcome: "saved" as const,
          homeTeam: "TEL",
          awayTeam: "EXC",
          homeScore: 2,
          awayScore: 0,
          scoringTeam: "home" as const,
        }}
      />
      <Composition
        id="PenaltyPostTest"
        component={PenaltyGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          outcome: "post" as const,
          homeTeam: "TEL",
          awayTeam: "EXC",
          homeScore: 2,
          awayScore: 0,
          scoringTeam: "away" as const,
        }}
      />
      <Composition
        id="PenaltyOutTest"
        component={PenaltyGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          outcome: "out" as const,
          homeTeam: "TEL",
          awayTeam: "EXC",
          homeScore: 2,
          awayScore: 0,
          scoringTeam: "home" as const,
        }}
      />
      <Composition
        id="SubstitutionGraphicTest"
        component={SubstitutionGraphic}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          playerOnName: "MODRIC",
          playerOnNumber: 10,
          playerOffName: "KOVACIC",
          playerOffNumber: 8,
        }}
      />
      <Composition
        id="ClearChancePostTest"
        component={ClearChanceGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ outcome: "post" as const }}
      />
      <Composition
        id="ClearChanceWideTest"
        component={ClearChanceGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ outcome: "wide" as const }}
      />
      <Composition
        id="VarReviewGraphicTest"
        component={VarReviewGraphic}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="RecentFormGraphicTest"
        component={RecentFormGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          playerName: "Lamine Yamal",
          playerNumber: 10,
          playerPhoto: "players/1402912.png",
          recent: [
            { date: "2026-08-16", opponent: "Real Sociedad", goals: 0, assists: 1 },
            { date: "2026-08-23", opponent: "Levante", goals: 1, assists: 0 },
            { date: "2026-08-30", opponent: "Rayo Vallecano", goals: 2, assists: 0 },
            { date: "2026-09-06", opponent: "Valencia", goals: 1, assists: 0 },
            { date: "2026-09-13", opponent: "Real Madrid", goals: 0, assists: 0 },
          ],
        }}
      />
      <Composition
        id="SeasonTallyGraphicTest"
        component={SeasonTallyGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          competition: "LaLiga",
          seasonStats: { rating: 8.1, goals: 7, assists: 2, appearances: 6, minutesPlayed: 491 },
        }}
      />
      <Composition
        id="StreakCallOutGraphicTest"
        component={StreakCallOutGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          playerName: "Lamine Yamal",
          playerNumber: 10,
          playerPhoto: "players/1402912.png",
          consecutiveWithGoalOrAssist: 4,
          consecutiveWithGoal: 3,
          consecutiveWithoutGoalOrAssist: 0,
          consecutiveWithoutGoal: 0,
        }}
      />
      <Composition
        id="StreakCallOutGraphicColdTest"
        component={StreakCallOutGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          playerName: "Lamine Yamal",
          playerNumber: 10,
          playerPhoto: "players/1402912.png",
          consecutiveWithGoalOrAssist: 0,
          consecutiveWithGoal: 0,
          consecutiveWithoutGoalOrAssist: 2,
          consecutiveWithoutGoal: 6,
        }}
      />
      <Composition
        id="InjuryGapGraphicTest"
        component={InjuryGapGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ missedMatchesInWindow: true }}
      />
      <Composition
        id="UpcomingFixtureGraphicTest"
        component={UpcomingFixtureGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          teamBadge: "badges/2817.png",
          teamColor: "#154284",
          opponent: "Sevilla",
          opponentBadge: "badges/2833.png",
          opponentColor: "#ffffff",
          date: 1789844400,
          competition: "LaLiga",
        }}
      />
      {/* Pre-match preview cards. Two test compositions each wherever the
          graphic has a real dual framing to check (hot vs cold streaks, a
          home vs away pick), same precedent as StreakCallOutGraphicTest /
          StreakCallOutGraphicColdTest above. */}
      <Composition
        id="TeamFormCompareGraphicTest"
        component={TeamFormCompareGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          homeLast5: "WWWWW",
          awayCode: "RMA",
          awayBadge: "badges/2829.png",
          awayColor: "#ffffff",
          awayLast5: "WLDWL",
        }}
      />
      <Composition
        id="TeamFormCompareGraphicNoFormTest"
        component={TeamFormCompareGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          homeLast5: "WWLDW",
          awayCode: "RMA",
          awayBadge: null,
          awayColor: "#ffffff",
          awayLast5: null,
        }}
      />
      <Composition
        id="TablePositionGraphicTest"
        component={TablePositionGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          competition: "LaLiga",
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          homePosition: 1,
          homePoints: 21,
          homePlayed: 7,
          awayCode: "RMA",
          awayBadge: "badges/2829.png",
          awayColor: "#ffffff",
          awayPosition: 2,
          awayPoints: 15,
          awayPlayed: 6,
        }}
      />
      <Composition
        id="TablePositionGraphicMidTableTest"
        component={TablePositionGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          competition: "LaLiga",
          homeCode: "SEV",
          homeBadge: "badges/2833.png",
          homeColor: "#ffffff",
          homePosition: 12,
          homePoints: 9,
          homePlayed: 7,
          awayCode: "ATM",
          awayBadge: "badges/2836.png",
          awayColor: "#ffffff",
          awayPosition: 3,
          awayPoints: 14,
          awayPlayed: 7,
        }}
      />
      <Composition
        id="H2HGraphicTest"
        component={H2HGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          awayCode: "RMA",
          awayBadge: "badges/2829.png",
          awayColor: "#ffffff",
          homeWins: 7,
          draws: 0,
          awayWins: 3,
        }}
      />
      <Composition
        id="TeamStreakGraphicTest"
        component={TeamStreakGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          homeStreak: {
            matchesConsidered: 7,
            winStreak: 7,
            unbeatenStreak: 7,
            lossStreak: 0,
            winlessStreak: 0,
          },
          awayCode: "RMA",
          awayBadge: "badges/2829.png",
          awayColor: "#ffffff",
          awayStreak: {
            matchesConsidered: 6,
            winStreak: 2,
            unbeatenStreak: 2,
            lossStreak: 0,
            winlessStreak: 0,
          },
        }}
      />
      {/* The cold/no-run side of the same graphic — a real losing run and a
          team with no run either way must both read honestly, never get
          spun into a positive framing. */}
      <Composition
        id="TeamStreakGraphicColdTest"
        component={TeamStreakGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "SEV",
          homeBadge: "badges/2833.png",
          homeColor: "#ffffff",
          homeStreak: {
            matchesConsidered: 7,
            winStreak: 0,
            unbeatenStreak: 0,
            lossStreak: 4,
            winlessStreak: 6,
          },
          awayCode: "ATM",
          awayBadge: "badges/2836.png",
          awayColor: "#ffffff",
          awayStreak: {
            matchesConsidered: 7,
            winStreak: 0,
            unbeatenStreak: 0,
            lossStreak: 0,
            winlessStreak: 3,
          },
        }}
      />
      <Composition
        id="TeamNewsGraphicTest"
        component={TeamNewsGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          code: "BAR",
          badge: "badges/2817.png",
          color: "#154284",
          headline: "Pedri out injured",
        }}
      />
      <Composition
        id="TeamNewsGraphicLongTest"
        component={TeamNewsGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          code: "RMA",
          badge: "badges/2829.png",
          color: "#ffffff",
          headline: "Two defenders suspended",
        }}
      />
      <Composition
        id="PredictionGraphicTest"
        component={PredictionGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          awayCode: "RMA",
          awayBadge: "badges/2829.png",
          awayColor: "#ffffff",
          pick: "home" as const,
          pickTeam: "FC Barcelona",
        }}
      />
      {/* Away pick with a near-white kit colour — the banner must fall back
          to a readable fill rather than white text on white. */}
      <Composition
        id="PredictionGraphicAwayTest"
        component={PredictionGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          awayCode: "RMA",
          awayBadge: "badges/2829.png",
          awayColor: "#ffffff",
          pick: "away" as const,
          pickTeam: "Real Madrid",
        }}
      />
      <Composition
        id="PredictionGraphicDrawTest"
        component={PredictionGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          homeCode: "BAR",
          homeBadge: "badges/2817.png",
          homeColor: "#154284",
          awayCode: "RMA",
          awayBadge: "badges/2829.png",
          awayColor: "#ffffff",
          pick: "draw" as const,
          pickTeam: null,
        }}
      />
    </>
  );
};