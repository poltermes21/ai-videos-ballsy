import React from 'react';
import {Easing, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {displayFontFamily} from '../fonts';

// Prototype: names a specific player with their real SofaScore photo,
// treated to match the show's flat-cartoon system (thick black outline,
// chunky drop shadow, name plaque) rather than dropped in as a raw photo.
// First and only use so far is GoalGraphic's scorer — see CLAUDE.md for the
// legal-constraint reversal this represents and why. If the photo failed to
// download (not every player has one on SofaScore), falls back to a plain
// number badge in the same shape, so the card never shows a broken image.
export const PlayerCard: React.FC<{
  name: string;
  number: number | null;
  photo: string | null;
  revealAt?: number;
}> = ({name, number, photo, revealAt = 0}) => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [revealAt, revealAt + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  return (
    <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, scale: reveal}}>
      <div style={{position: 'relative', width: 200, height: 200}}>
        {photo ? (
          <Img
            src={staticFile(photo)}
            style={{
              width: 200,
              height: 200,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '9px solid black',
              boxShadow: '0 14px 0 rgba(0,0,0,0.22)',
              background: 'white',
            }}
          />
        ) : (
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: '50%',
              background: '#6B7280',
              border: '9px solid black',
              boxShadow: '0 14px 0 rgba(0,0,0,0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: displayFontFamily,
              fontSize: 76,
              color: 'white',
              WebkitTextStroke: '2px black',
            }}
          >
            {number ?? '?'}
          </div>
        )}
        {photo && number != null && (
          <div
            style={{
              position: 'absolute',
              bottom: -8,
              right: -8,
              width: 62,
              height: 62,
              borderRadius: '50%',
              background: 'black',
              border: '5px solid white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: displayFontFamily,
              fontSize: 28,
              color: 'white',
            }}
          >
            {number}
          </div>
        )}
      </div>
      <div
        style={{
          background: 'black',
          borderRadius: 10,
          padding: '7px 22px',
          color: 'white',
          fontFamily: displayFontFamily,
          fontSize: 32,
          letterSpacing: 1,
          maxWidth: 400,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </div>
    </div>
  );
};
