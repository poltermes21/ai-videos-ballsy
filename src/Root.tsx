import "./index.css";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { Ballsy, FIXTURE_ID } from "./ballsy";
import { GoalGraphic } from "./graphics/GoalGraphic";
import { GoalDisallowedGraphic } from "./graphics/GoalDisallowedGraphic";
import { CardGraphic } from "./graphics/CardGraphic";
import { PenaltyGraphic } from "./graphics/PenaltyGraphic";
import { SubstitutionGraphic } from "./graphics/SubstitutionGraphic";
import { ClearChanceGraphic } from "./graphics/ClearChanceGraphic";
import { VarReviewGraphic } from "./graphics/VarReviewGraphic";

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

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Ballsy"
        component={Ballsy}
        durationInFrames={2440} // fallback shown before calculateMetadata resolves
        fps={FPS}
        width={1080}
        height={1080}
        calculateMetadata={calculateBallsyMetadata}
      />
      <Composition
        id="GoalGraphicTest"
        component={GoalGraphic}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{
          homeTeam: "CRO",
          awayTeam: "MAR",
          homeScore: 2,
          awayScore: 1,
          scoringTeam: "home" as const,
        }}
      />
      <Composition
        id="GoalDisallowedGraphicTest"
        component={GoalDisallowedGraphic}
        durationInFrames={120}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{
          homeTeam: "CRO",
          awayTeam: "MAR",
          homeScore: 1,
          awayScore: 1,
          scoringTeam: "home" as const,
        }}
      />
      <Composition
        id="CardGraphicTest"
        component={CardGraphic}
        durationInFrames={90}
        fps={30}
        width={1080}
        height={1080}
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
        height={1080}
        defaultProps={{
          outcome: "scored" as const,
          homeTeam: "TEL",
          awayTeam: "EXC",
          homeScore: 2,
          awayScore: 1,
          scoringTeam: "away" as const,
        }}
      />
      <Composition
        id="PenaltySavedTest"
        component={PenaltyGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1080}
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
        height={1080}
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
        height={1080}
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
        height={1080}
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
        height={1080}
        defaultProps={{ outcome: "post" as const }}
      />
      <Composition
        id="ClearChanceWideTest"
        component={ClearChanceGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{ outcome: "wide" as const }}
      />
      <Composition
        id="VarReviewGraphicTest"
        component={VarReviewGraphic}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1080}
      />
    </>
  );
};