import React from 'react';
import {AbsoluteFill, Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Banner, COLORS, Scoreboard, TitlePill} from './shared';

type PenaltyOutcome = 'scored' | 'saved' | 'post' | 'out';

type PenaltyGraphicProps = {
  outcome: PenaltyOutcome;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  scoringTeam: 'home' | 'away';
};

// The goal (net.png) box in composition space (1080x1080), plus the derived
// landmarks the ball aims at. net.png is a square canvas with the goal drawn
// across the middle, so the mouth sits well inside the box.
const GOAL_BOX = {left: 260, top: 160, size: 560};
const GOAL = {
  cx: 540,
  cy: 470, // centre of the goal mouth
  postR: 725, // right upright
};
const SPOT = {x: 540, y: 872}; // penalty spot / ball start

// Ball trajectory per outcome: keyframe frames + x/y of the ball centre.
// A real penalty strike reaches the goal in well under a second — keep the
// flight fast and punchy rather than a slow drift. Middle keyframes are
// spaced proportionally to the distance they cover (not evenly in time), so
// linear interpolation reads as one continuous speed instead of visibly
// slowing down mid-flight at each waypoint.
const PATHS: Record<PenaltyOutcome, {frames: number[]; xs: number[]; ys: number[]}> = {
  // Straight line, a single segment — nothing to desync, so it's always constant speed.
  scored: {frames: [6, 26], xs: [SPOT.x, GOAL.cx], ys: [SPOT.y, GOAL.cy]},
  saved: {frames: [6, 19, 24], xs: [SPOT.x, 540, 540], ys: [SPOT.y, 600, 500]},
  post: {frames: [6, 16, 19, 26], xs: [SPOT.x, 690, GOAL.postR, 910], ys: [SPOT.y, 480, 360, 560]},
  out: {frames: [6, 17, 24], xs: [SPOT.x, 552, 600], ys: [SPOT.y, 340, 40]},
};

export const PenaltyGraphic: React.FC<PenaltyGraphicProps> = ({
  outcome,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  scoringTeam,
}) => {
  const frame = useCurrentFrame();
  const path = PATHS[outcome];

  // Linear between keyframes so the ball never decelerates to a stop mid-flight.
  const ballX = interpolate(frame, path.frames, path.xs, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ballY = interpolate(frame, path.frames, path.ys, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Perspective: ball shrinks as it travels away toward the goal.
  const ballScale = interpolate(frame, [6, 26], [1, 0.6], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // On a save, the ball disappears behind the keeper's gloves.
  const ballOpacity =
    outcome === 'saved'
      ? interpolate(frame, [22, 25], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
      : 1;

  // Keeper's gloves pop in to stop the shot.
  const savePop = interpolate(frame, [20, 32], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  // Post-hit impact ring.
  const impact = interpolate(frame, [18, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const goalPop = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });

  const bannerReveal = interpolate(frame, [30, 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  const banner = {
    scored: {text: 'GOAL!', color: COLORS.green, textColor: 'white'},
    saved: {text: 'SAVED!', color: COLORS.cyan, textColor: 'white'},
    post: {text: 'POST!', color: COLORS.yellow, textColor: 'black'},
    out: {text: 'MISSED!', color: COLORS.gray, textColor: 'white'},
  }[outcome];

  return (
    <AbsoluteFill>
      <Interactive.Div name="Penalty title" style={{position: 'absolute', top: '7%', left: '50%', translate: '-50%'}}>
        <TitlePill text="PENALTY" />
      </Interactive.Div>

      {/* Goal */}
      <Interactive.Div
        name="Goal net"
        style={{
          position: 'absolute',
          left: GOAL_BOX.left,
          top: GOAL_BOX.top,
          scale: goalPop,
          transformOrigin: 'center bottom',
        }}
      >
        <Img src={staticFile('net.png')} style={{width: GOAL_BOX.size, height: GOAL_BOX.size}} />
      </Interactive.Div>

      {/* Post-hit impact ring */}
      {outcome === 'post' && impact > 0 && (
        <Interactive.Div
          name="Post impact"
          style={{
            position: 'absolute',
            left: GOAL.postR,
            top: 360,
            translate: '-50% -50%',
            width: 60,
            height: 60,
            borderRadius: '50%',
            border: '10px solid ' + COLORS.yellow,
            scale: 0.4 + impact * 2.2,
            opacity: 1 - impact,
          }}
        />
      )}

      {/* Ball */}
      <Interactive.Div
        name="Penalty ball"
        style={{
          position: 'absolute',
          left: `${ballX}px`,
          top: `${ballY}px`,
          translate: '-50% -50%',
          scale: ballScale,
          opacity: ballOpacity,
        }}
      >
        <Img src={staticFile('ball.png')} style={{width: 120, height: 120}} />
      </Interactive.Div>

      {/* Keeper save */}
      {outcome === 'saved' && savePop > 0 && (
        <Interactive.Div
          name="Keeper save"
          style={{
            position: 'absolute',
            left: GOAL.cx,
            top: GOAL.cy + 10,
            translate: '-50% -50%',
            scale: savePop,
          }}
        >
          <Img src={staticFile('save.png')} style={{width: 380, height: 380}} />
        </Interactive.Div>
      )}

      {/* Result banner */}
      <Interactive.Div
        name="Penalty result"
        style={{
          position: 'absolute',
          bottom: outcome === 'scored' ? '20%' : '9%',
          left: '50%',
          translate: '-50%',
          scale: bannerReveal,
          rotate: '-4deg',
        }}
      >
        <Banner text={banner.text} color={banner.color} textColor={banner.textColor} fontSize={58} />
      </Interactive.Div>

      {/* A scored penalty changes the score — show the tick, same as a goal. */}
      {outcome === 'scored' && (
        <Interactive.Div
          name="Scoreboard"
          style={{
            position: 'absolute',
            bottom: '9%',
            left: '50%',
            translate: '-50%',
            scale: bannerReveal,
          }}
        >
          <Scoreboard
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            homeScore={homeScore}
            awayScore={awayScore}
            scoringTeam={scoringTeam}
            frame={frame}
            tickStart={30}
          />
        </Interactive.Div>
      )}
    </AbsoluteFill>
  );
};
