import React from 'react';
import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';

type CardGraphicProps = {
  cardType: 'yellow' | 'red';
  minute: number;
};

export const CardGraphic: React.FC<CardGraphicProps> = ({cardType, minute}) => {
  const frame = useCurrentFrame();

  const cardColor = cardType === 'yellow' ? '#FFD23F' : '#FF3B3B';

  // Card spins in (a couple of full rotations) and settles upright with a spring.
  const spin = interpolate(frame, [0, 32], [-810, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 13, mass: 0.8}),
  });
  const scaleIn = interpolate(frame, [0, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });

  const minuteReveal = interpolate(frame, [28, 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Card"
        style={{
          position: 'absolute',
          top: '38%',
          left: '50%',
          translate: '-50%',
          scale: scaleIn,
          rotate: `${spin}deg`,
        }}
      >
        <div
          style={{
            width: 240,
            height: 330,
            borderRadius: 24,
            background: cardColor,
            border: '8px solid black',
            boxShadow: '0 16px 0 rgba(0,0,0,0.25)',
          }}
        />
      </Interactive.Div>

      <Interactive.Div
        name="Minute"
        style={{
          position: 'absolute',
          top: '74%',
          left: '50%',
          translate: '-50%',
          scale: minuteReveal,
        }}
      >
        <div
          style={{
            background: 'black',
            border: '3px solid white',
            borderRadius: 999,
            padding: '10px 36px',
            color: 'white',
            fontFamily: '"Arial Black", sans-serif',
            fontSize: 54,
            letterSpacing: 2,
          }}
        >
          {minute}&apos;
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
