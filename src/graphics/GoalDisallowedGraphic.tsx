import React from 'react';
import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';

type GoalDisallowedGraphicProps = {
  homeTeam: string;
  awayTeam: string;
  // The score as it STANDS after the goal is disallowed (i.e. unchanged).
  homeScore: number;
  awayScore: number;
  scoringTeam: 'home' | 'away';
};

export const GoalDisallowedGraphic: React.FC<GoalDisallowedGraphicProps> = ({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  scoringTeam,
}) => {
  const frame = useCurrentFrame();

  // Score ticks up (as if the goal counted) between frames 14 and 54, then reverts.
  const showUp = frame >= 14 && frame < 54;
  const homeDisplay = scoringTeam === 'home' && showUp ? homeScore + 1 : homeScore;
  const awayDisplay = scoringTeam === 'away' && showUp ? awayScore + 1 : awayScore;

  let numScale = 1;
  if (frame >= 14 && frame < 54) {
    numScale = interpolate(frame, [14, 20, 28], [1, 1.5, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.spring({damping: 8}),
    });
  } else if (frame >= 54) {
    numScale = interpolate(frame, [54, 60, 68], [1, 1.4, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.spring({damping: 8}),
    });
  }

  const bannerScale = interpolate(frame, [12, 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  // Offside lines sweep down from the top.
  const offsideGrow = interpolate(frame, [28, 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const offsideOpacity = interpolate(frame, [28, 34, 64, 74], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Red strike-through drawn across the GOAL banner.
  const strike = interpolate(frame, [44, 56], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  // "NO GOAL" stamp slams in.
  const stampScale = interpolate(frame, [48, 60], [2.2, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const stampOpacity = interpolate(frame, [48, 56], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      {/* Offside lines (defender blue, attacker red) */}
      <Interactive.Div
        name="Offside line defender"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '44%',
          width: 8,
          background: '#1D4ED8',
          boxShadow: '0 0 12px rgba(29,78,216,0.8)',
          transformOrigin: 'top',
          scale: `1 ${offsideGrow}`,
          rotate: '4deg',
          opacity: offsideOpacity,
        }}
      />
      <Interactive.Div
        name="Offside line attacker"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '58%',
          width: 8,
          background: '#FF3B3B',
          boxShadow: '0 0 12px rgba(255,59,59,0.8)',
          transformOrigin: 'top',
          scale: `1 ${offsideGrow}`,
          rotate: '4deg',
          opacity: offsideOpacity,
        }}
      />
      <Interactive.Div
        name="Offside tag"
        style={{
          position: 'absolute',
          top: '22%',
          left: '58%',
          translate: '-50%',
          opacity: offsideOpacity,
          rotate: '4deg',
        }}
      >
        <div
          style={{
            background: 'white',
            border: '3px solid black',
            padding: '4px 14px',
            fontFamily: '"Arial Black", sans-serif',
            fontSize: 24,
            letterSpacing: 2,
            color: 'black',
          }}
        >
          OFFSIDE
        </div>
      </Interactive.Div>

      {/* GOAL banner (celebration that gets undercut) */}
      <Interactive.Div
        name="Goal banner"
        style={{
          position: 'absolute',
          top: '10%',
          left: '50%',
          translate: '-50%',
          scale: bannerScale,
          rotate: '-6deg',
        }}
      >
        <div
          style={{
            position: 'relative',
            background: '#FF3B3B',
            padding: '10px 48px',
            boxShadow: '0 8px 0 rgba(0,0,0,0.25)',
            border: '4px solid black',
          }}
        >
          <span
            style={{
              fontFamily: '"Arial Black", sans-serif',
              fontWeight: 900,
              fontSize: 68,
              color: 'white',
              letterSpacing: 3,
              WebkitTextStroke: '2px black',
            }}
          >
            GOAL!
          </span>
          {/* strike-through */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              translate: '-50%',
              width: '118%',
              height: 16,
              background: 'black',
              scale: `${strike} 1`,
            }}
          />
        </div>
      </Interactive.Div>

      {/* NO GOAL stamp */}
      <Interactive.Div
        name="No goal stamp"
        style={{
          position: 'absolute',
          top: '32%',
          left: '50%',
          translate: '-50%',
          scale: stampScale,
          rotate: '-12deg',
          opacity: stampOpacity,
        }}
      >
        <div
          style={{
            border: '8px solid #FF3B3B',
            borderRadius: 14,
            padding: '8px 30px',
            fontFamily: '"Arial Black", sans-serif',
            fontSize: 78,
            color: '#FF3B3B',
            letterSpacing: 4,
            WebkitTextStroke: '1px #7f1010',
          }}
        >
          NO GOAL
        </div>
      </Interactive.Div>

      {/* Scoreboard */}
      <Interactive.Div
        name="Scoreboard"
        style={{
          position: 'absolute',
          bottom: '15%',
          left: '50%',
          translate: '-50%',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '14px 32px',
          borderRadius: 999,
          background: 'black',
          border: '3px solid white',
          color: 'white',
          fontFamily: '"Arial Black", sans-serif',
          fontSize: 34,
        }}
      >
        <span>{homeTeam}</span>
        <span
          style={{
            display: 'inline-block',
            minWidth: 32,
            textAlign: 'center',
            color: '#FFD23F',
            scale: scoringTeam === 'home' ? numScale : 1,
          }}
        >
          {homeDisplay}
        </span>
        <span style={{opacity: 0.6}}>-</span>
        <span
          style={{
            display: 'inline-block',
            minWidth: 32,
            textAlign: 'center',
            color: '#FFD23F',
            scale: scoringTeam === 'away' ? numScale : 1,
          }}
        >
          {awayDisplay}
        </span>
        <span>{awayTeam}</span>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
