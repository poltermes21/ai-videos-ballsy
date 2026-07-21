import React from 'react';
import {AbsoluteFill, Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';

type ClearChanceGraphicProps = {
  outcome: 'post' | 'wide';
};

// Trajectory keyframes in composition-space (1080x1080).
const PATHS = {
  post: {
    frames: [6, 26, 42, 48, 51, 62],
    xs: [300, 470, 600, 652, 652, 812],
    ys: [860, 560, 380, 300, 300, 372],
  },
  wide: {
    frames: [6, 26, 46, 62],
    xs: [300, 480, 700, 952],
    ys: [860, 540, 330, 150],
  },
} as const;

export const ClearChanceGraphic: React.FC<ClearChanceGraphicProps> = ({outcome}) => {
  const frame = useCurrentFrame();

  const path = PATHS[outcome];
  const ballX = interpolate(frame, [...path.frames], [...path.xs], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 0.5, 1),
  });
  const ballY = interpolate(frame, [...path.frames], [...path.ys], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 0.5, 1),
  });
  const ballScale = interpolate(frame, [6, 62], [1, 0.72], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const points = path.frames.map((_, i) => `${path.xs[i]},${path.ys[i]}`).join(' ');

  const pathOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Post-hit impact ring (post outcome only).
  const impact = interpolate(frame, [48, 58], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const labelReveal = interpolate(frame, [64, 78], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  return (
    <AbsoluteFill>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1080 1080"
        style={{position: 'absolute', inset: 0}}
      >
        {/* Goal frame */}
        <g stroke="black" strokeWidth={5}>
          <rect x={422} y={192} width={16} height={205} fill="white" />
          <rect x={642} y={192} width={16} height={205} fill="white" />
          <rect x={422} y={192} width={236} height={16} fill="white" />
        </g>

        {/* Dotted trajectory: black outline underlay + white dots on top,
            so it stays legible over any background it composites onto. */}
        <polyline
          points={points}
          fill="none"
          stroke="black"
          strokeWidth={22}
          strokeLinecap="round"
          strokeDasharray="2 30"
          opacity={pathOpacity}
        />
        <polyline
          points={points}
          fill="none"
          stroke="white"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray="2 30"
          opacity={pathOpacity}
        />

        {outcome === 'post' && impact > 0 && (
          <circle
            cx={652}
            cy={300}
            r={20 + impact * 60}
            fill="none"
            stroke="#FFD23F"
            strokeWidth={10}
            opacity={1 - impact}
          />
        )}
      </svg>

      <Interactive.Div
        name="Chance ball"
        style={{
          position: 'absolute',
          left: `${ballX}px`,
          top: `${ballY}px`,
          translate: '-50%',
          scale: ballScale,
        }}
      >
        <Img src={staticFile('ball.png')} style={{width: 96, height: 96}} />
      </Interactive.Div>

      <Interactive.Div
        name="Chance label"
        style={{
          position: 'absolute',
          bottom: '14%',
          left: '50%',
          translate: '-50%',
          scale: labelReveal,
          rotate: '-4deg',
        }}
      >
        <div
          style={{
            background: outcome === 'post' ? '#FFD23F' : '#6B7280',
            padding: '10px 44px',
            boxShadow: '0 8px 0 rgba(0,0,0,0.25)',
            border: '4px solid black',
          }}
        >
          <span
            style={{
              fontFamily: '"Arial Black", sans-serif',
              fontWeight: 900,
              fontSize: 56,
              color: outcome === 'post' ? 'black' : 'white',
              letterSpacing: 2,
              WebkitTextStroke: outcome === 'post' ? undefined : '2px black',
            }}
          >
            {outcome === 'post' ? 'OFF THE POST!' : 'WIDE!'}
          </span>
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
