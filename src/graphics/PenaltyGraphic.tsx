import React from 'react';
import {AbsoluteFill, Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';

type PenaltyGraphicProps = {
  outcome: 'scored' | 'missed';
};

export const PenaltyGraphic: React.FC<PenaltyGraphicProps> = ({outcome}) => {
  const frame = useCurrentFrame();

  const resolveStart = 48;
  const resolved = frame >= resolveStart;

  // Tension rings fade out as the outcome resolves.
  const ringsOpacity = interpolate(frame, [resolveStart - 8, resolveStart], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const spotScale = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  const revealScale = interpolate(frame, [resolveStart, resolveStart + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  const ballRise = interpolate(frame, [resolveStart, resolveStart + 20], [0, -140], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 12, mass: 0.7}),
  });

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="Penalty label"
        style={{
          position: 'absolute',
          top: '12%',
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
            fontSize: 46,
            letterSpacing: 4,
          }}
        >
          PENALTY
        </div>
      </Interactive.Div>

      {[0, 1, 2].map((i) => {
        const t = ((frame + i * 14) % 42) / 42;
        return (
          <Interactive.Div
            key={i}
            name={`Tension ring ${i + 1}`}
            style={{
              position: 'absolute',
              top: '46%',
              left: '50%',
              translate: '-50%',
              width: 140,
              height: 140,
              borderRadius: '50%',
              border: '8px solid #FFD23F',
              scale: interpolate(t, [0, 1], [0.3, 3.2]),
              opacity: interpolate(t, [0, 1], [0.85, 0]) * ringsOpacity,
            }}
          />
        );
      })}

      <Interactive.Div
        name="Penalty spot"
        style={{
          position: 'absolute',
          top: '46%',
          left: '50%',
          translate: '-50%',
          scale: spotScale,
          opacity: ringsOpacity,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'black',
            border: '5px solid white',
          }}
        />
      </Interactive.Div>

      {resolved && outcome === 'scored' && (
        <>
          <Interactive.Div
            name="Penalty ball"
            style={{
              position: 'absolute',
              top: '46%',
              left: '50%',
              translate: `-50% calc(-50% + ${ballRise}px)`,
              scale: revealScale,
            }}
          >
            <Img src={staticFile('ball.png')} style={{width: 120, height: 120}} />
          </Interactive.Div>

          <Interactive.Div
            name="Scored banner"
            style={{
              position: 'absolute',
              top: '58%',
              left: '50%',
              translate: '-50%',
              scale: revealScale,
              rotate: `${interpolate(frame, [resolveStart, resolveStart + 14], [-8, -5], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
                easing: Easing.spring({damping: 9}),
              })}deg`,
            }}
          >
            <div
              style={{
                background: '#22C55E',
                padding: '10px 46px',
                boxShadow: '0 8px 0 rgba(0,0,0,0.25)',
                border: '4px solid black',
              }}
            >
              <span
                style={{
                  fontFamily: '"Arial Black", sans-serif',
                  fontWeight: 900,
                  fontSize: 62,
                  color: 'white',
                  letterSpacing: 3,
                  WebkitTextStroke: '2px black',
                }}
              >
                SCORED!
              </span>
            </div>
          </Interactive.Div>
        </>
      )}

      {resolved && outcome === 'missed' && (
        <>
          <Interactive.Div
            name="Miss cross"
            style={{
              position: 'absolute',
              top: '40%',
              left: '50%',
              translate: '-50%',
              scale: revealScale,
            }}
          >
            <div style={{position: 'relative', width: 180, height: 180}}>
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  translate: '-50%',
                  width: 210,
                  height: 34,
                  borderRadius: 8,
                  background: '#FF3B3B',
                  border: '5px solid black',
                  rotate: '45deg',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  translate: '-50%',
                  width: 210,
                  height: 34,
                  borderRadius: 8,
                  background: '#FF3B3B',
                  border: '5px solid black',
                  rotate: '-45deg',
                }}
              />
            </div>
          </Interactive.Div>

          <Interactive.Div
            name="Missed banner"
            style={{
              position: 'absolute',
              top: '58%',
              left: '50%',
              translate: '-50%',
              scale: revealScale,
            }}
          >
            <div
              style={{
                background: '#6B7280',
                padding: '10px 46px',
                boxShadow: '0 8px 0 rgba(0,0,0,0.25)',
                border: '4px solid black',
              }}
            >
              <span
                style={{
                  fontFamily: '"Arial Black", sans-serif',
                  fontWeight: 900,
                  fontSize: 62,
                  color: 'white',
                  letterSpacing: 3,
                  WebkitTextStroke: '2px black',
                }}
              >
                MISSED
              </span>
            </div>
          </Interactive.Div>
        </>
      )}
    </AbsoluteFill>
  );
};
