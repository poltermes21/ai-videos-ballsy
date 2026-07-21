import React from 'react';
import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, TitlePill} from './shared';

// Redrawn (not the watermarked stock PNG) in the same iconic style: a
// black-outlined TV monitor with big "VAR" letters, plus a scan sweep and a
// blinking REC dot to signal a review in progress.
export const VarReviewGraphic: React.FC = () => {
  const frame = useCurrentFrame();

  const enter = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });

  // Scan line sweeps down the screen, looping.
  const scanPeriod = 48;
  const scanY = interpolate(frame % scanPeriod, [0, scanPeriod], [0, 300], {extrapolateRight: 'clamp'});
  const recOn = frame % 30 < 18;
  const dots = '.'.repeat((Math.floor(frame / 12) % 3) + 1);

  const SCREEN_W = 540;
  const SCREEN_H = 340;

  return (
    <AbsoluteFill>
      <Interactive.Div name="VAR title" style={{position: 'absolute', top: '14%', left: '50%', translate: '-50%', scale: enter}}>
        <div
          style={{
            background: COLORS.red,
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

      <Interactive.Div name="Monitor" style={{position: 'absolute', top: '33%', left: '50%', translate: '-50%', scale: enter}}>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          {/* Screen */}
          <div
            style={{
              width: SCREEN_W,
              height: SCREEN_H,
              borderRadius: 10,
              background: 'white',
              border: '14px solid black',
              boxShadow: '0 14px 0 rgba(0,0,0,0.25)',
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* VAR text */}
            <span
              style={{
                fontFamily: '"Arial Black", sans-serif',
                fontWeight: 900,
                fontSize: 168,
                letterSpacing: 6,
                color: 'black',
                lineHeight: 1,
              }}
            >
              VAR
            </span>

            {/* scan line */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${scanY}px`,
                height: 8,
                background: COLORS.cyan,
                opacity: 0.85,
                boxShadow: '0 0 22px 6px rgba(56,189,248,0.7)',
              }}
            />

            {/* REC indicator */}
            <div style={{position: 'absolute', top: 16, left: 16, display: 'flex', alignItems: 'center', gap: 10}}>
              <div style={{width: 22, height: 22, borderRadius: '50%', background: COLORS.red, opacity: recOn ? 1 : 0.15}} />
              <span style={{fontFamily: '"Arial Black", sans-serif', fontSize: 24, color: COLORS.red, letterSpacing: 2}}>REC</span>
            </div>
          </div>
          {/* Stand */}
          <div style={{width: 150, height: 26, background: 'black', clipPath: 'polygon(18% 0, 82% 0, 100% 100%, 0 100%)'}} />
          <div style={{width: 220, height: 16, background: 'black', borderRadius: 6}} />
        </div>
      </Interactive.Div>

      <Interactive.Div name="Status text" style={{position: 'absolute', top: '78%', left: '50%', translate: '-50%', opacity: enter}}>
        <TitlePill text={`CHECKING${dots}`} fontSize={38} />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
