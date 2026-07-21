import React from 'react';
import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';

type SubstitutionGraphicProps = {
  playerOnName: string;
  playerOnNumber: number;
  playerOffName: string;
  playerOffNumber: number;
};

const GREEN = '#22C55E';
const RED = '#FF3B3B';

const Badge: React.FC<{color: string; number: number; name: string}> = ({color, number, name}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10}}>
    <div
      style={{
        width: 118,
        height: 118,
        borderRadius: '50%',
        background: color,
        border: '7px solid black',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 10px 0 rgba(0,0,0,0.22)',
        fontFamily: '"Arial Black", sans-serif',
        fontSize: 58,
        color: 'white',
        WebkitTextStroke: '2px black',
      }}
    >
      {number}
    </div>
    <div
      style={{
        background: 'black',
        borderRadius: 8,
        padding: '5px 16px',
        color: 'white',
        fontFamily: '"Arial Black", sans-serif',
        fontSize: 26,
        letterSpacing: 1,
        maxWidth: 260,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      {name}
    </div>
  </div>
);

// A single arrow drawn in SVG (400x400 viewBox). Points from tail to head.
const Arrow: React.FC<{color: string; x1: number; y1: number; x2: number; y2: number}> = ({
  color,
  x1,
  y1,
  x2,
  y2,
}) => {
  const id = `${color}-${x1}-${y1}`.replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg width={460} height={460} viewBox="0 0 400 400" style={{overflow: 'visible'}}>
      <defs>
        <marker id={id} markerWidth={5} markerHeight={5} refX={2.6} refY={2.5} orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" fill={color} stroke="black" strokeWidth={0.5} />
        </marker>
      </defs>
      {/* black outline underlay */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="black" strokeWidth={30} strokeLinecap="round" />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={18}
        strokeLinecap="round"
        markerEnd={`url(#${id})`}
      />
    </svg>
  );
};

export const SubstitutionGraphic: React.FC<SubstitutionGraphicProps> = ({
  playerOnName,
  playerOnNumber,
  playerOffName,
  playerOffNumber,
}) => {
  const frame = useCurrentFrame();

  // Green arrow (ON) rises up into place; red arrow (OFF) drops down into place.
  const onOffset = interpolate(frame, [0, 22], [140, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 13, mass: 0.7}),
  });
  const onOpacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const offOffset = interpolate(frame, [8, 30], [-140, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 13, mass: 0.7}),
  });
  const offOpacity = interpolate(frame, [8, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const onBadge = interpolate(frame, [26, 40], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const offBadge = interpolate(frame, [32, 46], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Substitution title"
        style={{
          position: 'absolute',
          top: '11%',
          left: '50%',
          translate: '-50%',
        }}
      >
        <div
          style={{
            background: 'black',
            border: '4px solid white',
            borderRadius: 999,
            padding: '10px 40px',
            color: 'white',
            fontFamily: '"Arial Black", sans-serif',
            fontSize: 42,
            letterSpacing: 4,
          }}
        >
          SUBSTITUTION
        </div>
      </Interactive.Div>

      {/* Green ON arrow: tail bottom-right -> head top-left */}
      <Interactive.Div
        name="Arrow on"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          translate: `-50% calc(-50% + ${onOffset}px)`,
          opacity: onOpacity,
        }}
      >
        <Arrow color={GREEN} x1={252} y1={330} x2={150} y2={72} />
      </Interactive.Div>

      {/* Red OFF arrow: tail top-right -> head bottom-left */}
      <Interactive.Div
        name="Arrow off"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          translate: `-50% calc(-50% + ${offOffset}px)`,
          opacity: offOpacity,
        }}
      >
        <Arrow color={RED} x1={252} y1={72} x2={150} y2={330} />
      </Interactive.Div>

      {/* ON badge near the green arrowhead (upper-left) */}
      <Interactive.Div
        name="Player on badge"
        style={{
          position: 'absolute',
          top: '31%',
          left: '32%',
          translate: '-50%',
          scale: onBadge,
        }}
      >
        <Badge color={GREEN} number={playerOnNumber} name={playerOnName} />
      </Interactive.Div>

      {/* OFF badge near the red arrowhead (lower-left) */}
      <Interactive.Div
        name="Player off badge"
        style={{
          position: 'absolute',
          top: '69%',
          left: '32%',
          translate: '-50%',
          scale: offBadge,
        }}
      >
        <Badge color={RED} number={playerOffNumber} name={playerOffName} />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
