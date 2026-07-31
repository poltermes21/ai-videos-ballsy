import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Scoreboard } from "./shared";
import { displayFontFamily } from "../fonts";

type GoalGraphicProps = {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  scoringTeam: "home" | "away";
};

export const GoalGraphic: React.FC<GoalGraphicProps> = ({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  scoringTeam,
}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Ball"
        style={{
          position: "absolute",
          top: "28%",
          left: "50%",
          translate: `calc(-50% + ${interpolate(frame, [0, 18], [-260, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 12, mass: 0.6 }),
          })}px)`,
          rotate: `${interpolate(frame, [0, 18], [-90, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 12, mass: 0.6 }),
          })}deg`,
        }}
      >
        <Img src={staticFile("ball.png")} style={{ width: 130, height: 130 }} />
      </Interactive.Div>
      <Interactive.Div
        name="Goal banner"
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          translate: "-50%",
          scale: interpolate(frame, [12, 27, 63], [0, 1, 1.006], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: [
              Easing.spring({
                damping: 9,
                mass: 1,
                stiffness: 100,
                overshootClamping: false,
              }),
              Easing.linear,
            ],
          }),
          rotate: `${interpolate(frame, [12, 27], [-8, -6], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 9 }),
          })}deg`,
        }}
      >
        <div
          style={{
            background: "#FF3B3B",
            padding: "10px 48px",
            boxShadow: "0 8px 0 rgba(0,0,0,0.25)",
            border: "4px solid black",
          }}
        >
          <span
            style={{
              fontFamily: displayFontFamily,
              fontSize: 68,
              color: "white",
              letterSpacing: 3,
              WebkitTextStroke: "2px black",
            }}
          >
            GOAL!
          </span>
        </div>
      </Interactive.Div>
      <Interactive.Div
        name="Scoreboard"
        style={{position: "absolute", bottom: "15%", left: "50%", translate: "-50%"}}
      >
        <Scoreboard
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeScore={homeScore}
          awayScore={awayScore}
          scoringTeam={scoringTeam}
          frame={frame}
          tickStart={18}
        />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
