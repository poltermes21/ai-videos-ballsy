import React from 'react';
import {AbsoluteFill, Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {COLORS} from './shared';
import {displayFontFamily} from '../fonts';

type GoalDisallowedGraphicProps = {
  homeTeam: string;
  awayTeam: string;
  // The score as it STANDS after the goal is disallowed (i.e. unchanged).
  homeScore: number;
  awayScore: number;
  scoringTeam: 'home' | 'away';
};

// Generic "goal disallowed" — works for any reason (offside, foul, handball…):
// the ball + GOAL celebration appear, the score ticks up, then a big red cross
// slams over it, the score reverts and a "NO GOAL" stamp lands.
export const GoalDisallowedGraphic: React.FC<GoalDisallowedGraphicProps> = ({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  scoringTeam,
}) => {
  const frame = useCurrentFrame();

  // Score ticks up (as if it counted) between frames 14 and 52, then reverts.
  const showUp = frame >= 14 && frame < 52;
  const homeDisplay = scoringTeam === 'home' && showUp ? homeScore + 1 : homeScore;
  const awayDisplay = scoringTeam === 'away' && showUp ? awayScore + 1 : awayScore;

  let numScale = 1;
  if (frame >= 14 && frame < 52) {
    numScale = interpolate(frame, [14, 20, 28], [1, 1.5, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({damping: 8})});
  } else if (frame >= 52) {
    numScale = interpolate(frame, [52, 58, 66], [1, 1.4, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({damping: 8})});
  }

  const ballPop = interpolate(frame, [0, 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({damping: 11})});
  const bannerScale = interpolate(frame, [8, 22], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({damping: 9})});

  // Red cross draws over the ball/banner (two strokes, staggered).
  const cross1 = interpolate(frame, [40, 50], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const cross2 = interpolate(frame, [46, 56], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});

  // Strike-through across the GOAL banner.
  const strike = interpolate(frame, [42, 54], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});

  // "NO GOAL" stamp slams in.
  const stampScale = interpolate(frame, [50, 62], [2.2, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({damping: 10})});
  const stampOpacity = interpolate(frame, [50, 58], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill>
      {/* GOAL banner (celebration that gets undercut) */}
      <Interactive.Div
        name="Goal banner"
        style={{position: 'absolute', top: '11%', left: '50%', translate: '-50%', scale: bannerScale, rotate: '-6deg'}}
      >
        <div style={{position: 'relative', background: COLORS.red, padding: '10px 48px', boxShadow: '0 8px 0 rgba(0,0,0,0.25)', border: '4px solid black'}}>
          <span style={{fontFamily: displayFontFamily, fontSize: 68, color: 'white', letterSpacing: 3, WebkitTextStroke: '2px black'}}>
            GOAL!
          </span>
          <div style={{position: 'absolute', top: '50%', left: '50%', translate: '-50%', width: '118%', height: 16, background: 'black', scale: `${strike} 1`}} />
        </div>
      </Interactive.Div>

      {/* Ball with a big red cross drawn over it */}
      <Interactive.Div name="Disallowed ball" style={{position: 'absolute', top: '44%', left: '50%', translate: '-50% -50%', scale: ballPop}}>
        <div style={{position: 'relative', width: 230, height: 230, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <Img src={staticFile('ball.png')} style={{width: 200, height: 200}} />
          <svg width={280} height={280} viewBox="0 0 280 280" style={{position: 'absolute', inset: '-25px', overflow: 'visible'}}>
            <g stroke={COLORS.red} strokeWidth={30} strokeLinecap="round">
              <line x1={52} y1={52} x2={228} y2={228} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - cross1} />
              <line x1={228} y1={52} x2={52} y2={228} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - cross2} />
            </g>
            <g stroke="white" strokeWidth={10} strokeLinecap="round">
              <line x1={52} y1={52} x2={228} y2={228} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - cross1} />
              <line x1={228} y1={52} x2={52} y2={228} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - cross2} />
            </g>
          </svg>
        </div>
      </Interactive.Div>

      {/* NO GOAL stamp */}
      <Interactive.Div
        name="No goal stamp"
        style={{position: 'absolute', top: '68%', left: '50%', translate: '-50%', scale: stampScale, rotate: '-12deg', opacity: stampOpacity}}
      >
        <div style={{border: '8px solid ' + COLORS.red, borderRadius: 14, padding: '8px 30px', fontFamily: displayFontFamily, fontSize: 72, color: COLORS.red, letterSpacing: 4, WebkitTextStroke: '1px #7f1010'}}>
          NO GOAL
        </div>
      </Interactive.Div>

      {/* Scoreboard */}
      <Interactive.Div
        name="Scoreboard"
        style={{position: 'absolute', bottom: '8%', left: '50%', translate: '-50%', display: 'flex', alignItems: 'center', gap: 20, padding: '14px 32px', borderRadius: 999, background: 'black', border: '3px solid white', color: 'white', fontFamily: displayFontFamily, fontSize: 34}}
      >
        <span>{homeTeam}</span>
        <span style={{display: 'inline-block', minWidth: 32, textAlign: 'center', color: COLORS.yellow, scale: scoringTeam === 'home' ? numScale : 1}}>{homeDisplay}</span>
        <span style={{opacity: 0.6}}>-</span>
        <span style={{display: 'inline-block', minWidth: 32, textAlign: 'center', color: COLORS.yellow, scale: scoringTeam === 'away' ? numScale : 1}}>{awayDisplay}</span>
        <span>{awayTeam}</span>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
