import React from 'react';
import {AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {TitlePill} from './graphics/shared';
import {displayFontFamily} from './fonts';

// Brief intro beat for a player video — player photo, name, team — the
// direct sibling of CoverCard (src/CoverCard.tsx), same overlay-not-delay
// approach and the same first-couple-seconds timing.
export const PlayerCoverCard: React.FC<{
  playerName: string;
  playerPhoto: string | null;
  teamName: string | null;
}> = ({playerName, playerPhoto, teamName}) => {
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

  return (
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
        {playerPhoto && (
          <div
            style={{
              width: 130,
              height: 130,
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
            <Img src={staticFile(playerPhoto)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          </div>
        )}
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
          {playerName}
        </div>
        {teamName && <TitlePill text={teamName.toUpperCase()} fontSize={28} />}
      </div>
    </AbsoluteFill>
  );
};
