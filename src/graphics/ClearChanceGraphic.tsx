import React from 'react';
import {AbsoluteFill, Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Banner, COLORS, TitlePill} from './shared';

type ClearChanceGraphicProps = {
  outcome: 'post' | 'wide';
};

// net.png box + landmarks in composition space (1080x1080).
const GOAL_BOX = {left: 260, top: 150, size: 560};
const RIGHT_POST = {x: 725, y: 360};

// Ball trajectory keyframes per outcome. Kept fast/punchy like a real strike
// rather than a slow drift. Middle keyframes are spaced proportionally to the
// distance they cover (not evenly in time), so linear interpolation reads as
// one continuous speed instead of visibly slowing down at each waypoint.
const PATHS = {
  post: {
    frames: [6, 16, 23, 25, 33],
    xs: [300, 520, 690, RIGHT_POST.x, 900],
    ys: [910, 620, 420, RIGHT_POST.y, 560],
  },
  wide: {
    frames: [6, 18, 27, 34],
    xs: [300, 560, 820, 990],
    ys: [910, 560, 330, 150],
  },
} as const;

export const ClearChanceGraphic: React.FC<ClearChanceGraphicProps> = ({outcome}) => {
  const frame = useCurrentFrame();
  const path = PATHS[outcome];

  // Linear between keyframes so the ball keeps moving continuously (no stops).
  const ballX = interpolate(frame, [...path.frames], [...path.xs], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ballY = interpolate(frame, [...path.frames], [...path.ys], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ballScale = interpolate(frame, [6, 26], [1.05, 0.66], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const points = path.frames.map((_, i) => `${path.xs[i]},${path.ys[i]}`).join(' ');
  const pathOpacity = interpolate(frame, [0, 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const goalPop = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });

  const impact = interpolate(frame, [24, 34], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const labelReveal = interpolate(frame, [36, 50], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  return (
    <AbsoluteFill>
      <Interactive.Div name="Chance title" style={{position: 'absolute', top: '7%', left: '50%', translate: '-50%'}}>
        <TitlePill text="CLOSE!" />
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

      {/* Dotted trajectory: black underlay + white dots so it reads on any bg */}
      <svg width="100%" height="100%" viewBox="0 0 1080 1080" style={{position: 'absolute', inset: 0}}>
        <polyline points={points} fill="none" stroke="black" strokeWidth={22} strokeLinecap="round" strokeDasharray="2 30" opacity={pathOpacity} />
        <polyline points={points} fill="none" stroke="white" strokeWidth={12} strokeLinecap="round" strokeDasharray="2 30" opacity={pathOpacity} />
        {outcome === 'post' && impact > 0 && (
          <circle cx={RIGHT_POST.x} cy={RIGHT_POST.y} r={20 + impact * 70} fill="none" stroke={COLORS.yellow} strokeWidth={10} opacity={1 - impact} />
        )}
      </svg>

      {/* Ball */}
      <Interactive.Div
        name="Chance ball"
        style={{position: 'absolute', left: `${ballX}px`, top: `${ballY}px`, translate: '-50% -50%', scale: ballScale}}
      >
        <Img src={staticFile('ball.png')} style={{width: 104, height: 104}} />
      </Interactive.Div>

      {/* Result label */}
      <Interactive.Div
        name="Chance label"
        style={{position: 'absolute', bottom: '10%', left: '50%', translate: '-50%', scale: labelReveal, rotate: '-4deg'}}
      >
        <Banner
          text={outcome === 'post' ? 'POST!' : 'WIDE!'}
          color={outcome === 'post' ? COLORS.yellow : COLORS.gray}
          textColor={outcome === 'post' ? 'black' : 'white'}
          fontSize={58}
        />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
