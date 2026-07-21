import "./index.css";
import { Composition } from "remotion";
import { Ballsy } from "./ballsy";
import { GoalGraphic } from "./graphics/GoalGraphic";
import { GoalDisallowedGraphic } from "./graphics/GoalDisallowedGraphic";
import { CardGraphic } from "./graphics/CardGraphic";
import { PenaltyGraphic } from "./graphics/PenaltyGraphic";
import { SubstitutionGraphic } from "./graphics/SubstitutionGraphic";
import { ClearChanceGraphic } from "./graphics/ClearChanceGraphic";
import { VarReviewGraphic } from "./graphics/VarReviewGraphic";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Ballsy"
        component={Ballsy}
        durationInFrames={1900}
        fps={30}
        width={1080}
        height={1080}
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
        id="PenaltyGraphicTest"
        component={PenaltyGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{
          outcome: "scored" as const,
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
        id="ClearChanceGraphicTest"
        component={ClearChanceGraphic}
        durationInFrames={100}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{
          outcome: "post" as const,
        }}
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