import React from 'react';
import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';

export const VarReviewGraphic: React.FC = () => {
  const frame = useCurrentFrame();

  const enter = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });

  // Scanning line sweeps top -> bottom of the screen, looping.
  const scanPeriod = 45;
  const scanY = interpolate(frame % scanPeriod, [0, scanPeriod], [0, 320], {
    extrapolateRight: 'clamp',
  });

  // Pulsing border glow.
  const pulse = 0.5 + 0.5 * Math.sin(frame / 5);

  // Blinking "REC" dot.
  const recOn = frame % 30 < 18;

  // Animated ellipsis for "IN PROGRESS".
  const dots = '.'.repeat((Math.floor(frame / 12) % 3) + 1);

  return (
    <AbsoluteFill>
      <Interactive.Div
        name="VAR title"
        style={{
          position: 'absolute',
          top: '16%',
          left: '50%',
          translate: '-50%',
          scale: enter,
        }}
      >
        <div
          style={{
            background: '#FF3B3B',
            border: '4px solid black',
            padding: '10px 46px',
            boxShadow: '0 8px 0 rgba(0,0,0,0.25)',
            fontFamily: '"Arial Black", sans-serif',
            fontSize: 54,
            color: 'white',
            letterSpacing: 5,
            whiteSpace: 'nowrap',
            WebkitTextStroke: '2px black',
          }}
        >
          VAR REVIEW
        </div>
      </Interactive.Div>

      <Interactive.Div
        name="Monitor"
        style={{
          position: 'absolute',
          top: '34%',
          left: '50%',
          translate: '-50%',
          scale: enter,
        }}
      >
        <div
          style={{
            width: 560,
            height: 360,
            borderRadius: 24,
            background: '#0B1220',
            border: '10px solid black',
            boxShadow: `0 0 ${20 + pulse * 40}px rgba(255,59,59,${0.4 + pulse * 0.6}), 0 16px 0 rgba(0,0,0,0.25)`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* faint grid backdrop */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(rgba(80,120,180,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(80,120,180,0.18) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />

          {/* scanning line */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${scanY}px`,
              height: 6,
              background: '#38BDF8',
              boxShadow: '0 0 24px 6px rgba(56,189,248,0.8)',
            }}
          />

          {/* REC indicator */}
          <div
            style={{
              position: 'absolute',
              top: 18,
              left: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#FF3B3B',
                opacity: recOn ? 1 : 0.15,
              }}
            />
            <span
              style={{
                fontFamily: '"Arial Black", sans-serif',
                fontSize: 24,
                color: 'white',
                letterSpacing: 2,
              }}
            >
              REC
            </span>
          </div>

          {/* centre reticle */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              translate: '-50%',
              width: 150,
              height: 150,
              borderRadius: '50%',
              border: '4px dashed rgba(255,255,255,0.6)',
              rotate: `${(frame * 2) % 360}deg`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              translate: '-50%',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#FFD23F',
              border: '3px solid black',
            }}
          />
        </div>
      </Interactive.Div>

      <Interactive.Div
        name="Status text"
        style={{
          position: 'absolute',
          top: '74%',
          left: '50%',
          translate: '-50%',
          opacity: enter,
        }}
      >
        <div
          style={{
            background: 'black',
            border: '3px solid white',
            borderRadius: 999,
            padding: '10px 40px',
            color: 'white',
            fontFamily: '"Arial Black", sans-serif',
            fontSize: 38,
            letterSpacing: 2,
            minWidth: 460,
            textAlign: 'center',
          }}
        >
          CHECKING{dots}
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
