import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Banner, COLORS, TeamMark, TitlePill, isLightColor} from './shared';
import {displayFontFamily} from '../fonts';

// Ballsy's call on the fixture — the hero beat of a preview video.
//
// Deliberately NOT a scoreboard: nobody knows the result, and this graphic
// must never read as a statement of fact about a future match. Everything
// about it is framed as one ball's opinion — the "BALLSY'S CALL" header, the
// "just my opinion" footer, and a banner that says who he fancies rather
// than a predicted score. Same discipline the script prompt applies to the
// spoken prediction (see generate-prematch-script.mjs's PREDICTION RULE).
type PredictionGraphicProps = {
  homeCode: string;
  homeBadge?: string | null;
  homeColor?: string | null;
  awayCode: string;
  awayBadge?: string | null;
  awayColor?: string | null;
  pick: 'home' | 'away' | 'draw';
  // The picked team's real name (or null for a draw) — shown as the call.
  pickTeam?: string | null;
};

const Side: React.FC<{
  code: string;
  badge?: string | null;
  color?: string | null;
  picked: boolean;
}> = ({code, badge, color, picked}) => {
  const frame = useCurrentFrame();
  const emphasis = interpolate(frame, [14, 30], [1, picked ? 1.22 : 0.88], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });
  const fade = interpolate(frame, [14, 30], [1, picked ? 1 : 0.45], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{scale: emphasis, opacity: fade, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10}}>
      <TeamMark code={code} badge={badge} color={color} />
      <span style={{fontFamily: displayFontFamily, fontSize: 24, color: 'white', letterSpacing: 2, WebkitTextStroke: '2px black'}}>
        {code}
      </span>
    </div>
  );
};

export const PredictionGraphic: React.FC<PredictionGraphicProps> = ({
  homeCode,
  homeBadge,
  homeColor,
  awayCode,
  awayBadge,
  awayColor,
  pick,
  pickTeam,
}) => {
  const frame = useCurrentFrame();
  const bannerScale = interpolate(frame, [22, 38], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  const callText = pick === 'draw' ? 'HONESTLY? A DRAW' : (pickTeam ?? (pick === 'home' ? homeCode : awayCode)).toUpperCase();
  const pickedColor = pick === 'home' ? homeColor : pick === 'away' ? awayColor : null;
  // A real kit colour can be white/near-white — unreadable as a banner fill
  // behind white text — so fall back to the show's own cyan in that case.
  const bannerColor = pickedColor && !isLightColor(pickedColor) ? pickedColor : COLORS.cyan;
  const fontSize = callText.length > 20 ? 34 : callText.length > 12 ? 42 : 52;

  return (
    <>
      <Interactive.Div name="Prediction title" style={{position: 'absolute', top: '4%', left: '50%', translate: '-50%'}}>
        <TitlePill text="BALLSY'S CALL" fontSize={32} />
      </Interactive.Div>
      <Interactive.Div
        name="Prediction sides"
        style={{
          position: 'absolute',
          top: '22%',
          left: '50%',
          translate: '-50%',
          display: 'flex',
          alignItems: 'center',
          gap: 80,
          width: 'max-content',
        }}
      >
        <Side code={homeCode} badge={homeBadge} color={homeColor} picked={pick === 'home'} />
        <Side code={awayCode} badge={awayBadge} color={awayColor} picked={pick === 'away'} />
      </Interactive.Div>
      <Interactive.Div
        name="Prediction banner"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          translate: '-50%',
          scale: bannerScale,
          rotate: '-3deg',
          maxWidth: '94%',
        }}
      >
        <Banner text={callText} color={bannerColor} textColor="white" fontSize={fontSize} />
      </Interactive.Div>
      <Interactive.Div
        name="Prediction disclaimer"
        style={{
          position: 'absolute',
          top: '68%',
          left: '50%',
          translate: '-50%',
          fontFamily: displayFontFamily,
          fontSize: 24,
          color: 'white',
          letterSpacing: 2,
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 12,
          padding: '8px 22px',
          whiteSpace: 'nowrap',
        }}
      >
        JUST MY OPINION
      </Interactive.Div>
    </>
  );
};
