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
import { isLightColor, Scoreboard, SCORE_PILL_BOTTOM } from "./shared";
import { PlayerCard } from "./PlayerCard";
import { displayFontFamily } from "../fonts";

type Scorer = { name: string; number: number | null; photo: string | null };

type GoalGraphicProps = {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  scoringTeam: "home" | "away";
  homeBadge?: string | null;
  awayBadge?: string | null;
  homeColor?: string | null;
  awayColor?: string | null;
  scorer?: Scorer | null;
};

export const GoalGraphic: React.FC<GoalGraphicProps> = ({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  scoringTeam,
  homeBadge,
  awayBadge,
  homeColor,
  awayColor,
  scorer,
}) => {
  const frame = useCurrentFrame();

  // Home enters from the left, away mirrors from the right — same
  // home=left/away=right convention the scoreboard's own reading order
  // already implies. Sign flip on both the slide and the spin so an away
  // goal reads as a mirror image, not just the same animation offset.
  const side = scoringTeam === "away" ? -1 : 1;
  const teamColor = scoringTeam === "home" ? homeColor : awayColor;
  // White/near-white kit colours (common) would make the white banner text
  // unreadable as a solid fill — fall back to the original red for those.
  const bannerColor = teamColor && !isLightColor(teamColor) ? teamColor : "#FF3B3B";

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Ball"
        style={{
          position: "absolute",
          top: "22%",
          left: "50%",
          translate: `calc(-50% + ${interpolate(frame, [0, 18], [0, side * 260], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 12, mass: 0.6 }),
          })}px)`,
          rotate: `${interpolate(frame, [0, 18], [0, side * 90], {
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
          top: "6%",
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
            background: bannerColor,
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
      {scorer && (
        <Interactive.Div
          name="Scorer card"
          style={{ position: "absolute", top: "40%", left: "50%", translate: "-50%" }}
        >
          <PlayerCard name={scorer.name} number={scorer.number} photo={scorer.photo} revealAt={20} />
        </Interactive.Div>
      )}
      <Interactive.Div
        name="Scoreboard"
        style={{position: "absolute", bottom: SCORE_PILL_BOTTOM, left: "50%", translate: "-50%"}}
      >
        <Scoreboard
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          homeScore={homeScore}
          awayScore={awayScore}
          scoringTeam={scoringTeam}
          frame={frame}
          tickStart={18}
          homeBadge={homeBadge}
          awayBadge={awayBadge}
          homeColor={homeColor}
          awayColor={awayColor}
        />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
