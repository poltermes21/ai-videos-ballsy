import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {TitlePill} from './graphics/shared';
import {displayFontFamily} from './fonts';

// Brief intro beat — competition, matchday, date — before the hook takes
// over. Deliberately an OVERLAY across the first couple of seconds, not a
// prepended delay: the hook already starts playing underneath at frame 0,
// so none of the frame-offset math in generate-*-timeline.mjs (all anchored
// to the script's own timing) needs to know this exists.
export const CoverCard: React.FC<{
  tournament: string | null;
  tournamentLogo: string | null;
  round: number | null;
  date: number | null;
}> = ({tournament, tournamentLogo, round, date}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 12, 58, 75], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const pop = interpolate(frame, [0, 14], [0.85, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });

  const dateLabel = date
    ? new Date(date * 1000).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'})
    : null;

  if (!tournament && !tournamentLogo) return null;

  return (
    // Anchored near the top, not dead-centre — Ballsy is big & centred for
    // this same first stretch (the hook), and would otherwise render right
    // on top of this (it comes later in ballsy.tsx's JSX, so it would win).
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: '8%',
        opacity,
        pointerEvents: 'none',
      }}
    >
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, scale: pop}}>
        {tournamentLogo && (
          <div
            style={{
              width: 110,
              height: 110,
              borderRadius: '50%',
              background: 'white',
              border: '5px solid black',
              boxShadow: '0 10px 0 rgba(0,0,0,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <Img src={staticFile(tournamentLogo)} style={{width: 80, height: 80, objectFit: 'contain'}} />
          </div>
        )}
        {tournament && (
          <div
            style={{
              fontFamily: displayFontFamily,
              fontSize: 44,
              color: 'white',
              letterSpacing: 2,
              WebkitTextStroke: '2px black',
              textAlign: 'center',
            }}
          >
            {tournament}
          </div>
        )}
        {(round != null || dateLabel) && (
          <TitlePill text={[round != null ? `Matchday ${round}` : null, dateLabel].filter(Boolean).join(' · ')} fontSize={28} />
        )}
      </div>
    </AbsoluteFill>
  );
};
