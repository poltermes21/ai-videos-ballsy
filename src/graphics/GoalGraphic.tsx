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

  const previousHomeScore = scoringTeam === "home" ? homeScore - 1 : homeScore;
  const previousAwayScore = scoringTeam === "away" ? awayScore - 1 : awayScore;
  const showNewScore = frame >= 18;

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
              fontFamily: '"Arial Black", sans-serif',
              fontWeight: 900,
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
        style={{
          position: "absolute",
          bottom: "15%",
          left: "50%",
          translate: "-50%",
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "14px 32px",
          borderRadius: 999,
          background: "black",
          border: "3px solid white",
          color: "white",
          fontFamily: '"Arial Black", sans-serif',
          fontSize: 34,
        }}
      >
        <span>{homeTeam}</span>
        <span
          style={{
            display: "inline-block",
            minWidth: 32,
            textAlign: "center",
            color: "#FFD23F",
            scale:
              scoringTeam === "home" && showNewScore
                ? interpolate(frame, [18, 24, 30], [1, 1.5, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.spring({ damping: 8 }),
                  })
                : 1,
          }}
        >
          {showNewScore ? homeScore : previousHomeScore}
        </span>
        <span style={{ opacity: 0.6 }}>-</span>
        <span
          style={{
            display: "inline-block",
            minWidth: 32,
            textAlign: "center",
            color: "#FFD23F",
            scale:
              scoringTeam === "away" && showNewScore
                ? interpolate(frame, [18, 24, 30], [1, 1.5, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.spring({ damping: 8 }),
                  })
                : 1,
          }}
        >
          {showNewScore ? awayScore : previousAwayScore}
        </span>
        <span>{awayTeam}</span>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
