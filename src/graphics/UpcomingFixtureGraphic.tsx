import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {TeamMark, TitlePill} from './shared';
import {displayFontFamily} from '../fonts';

type UpcomingFixtureGraphicProps = {
  teamBadge?: string | null;
  teamColor?: string | null;
  opponent: string;
  opponentBadge?: string | null;
  opponentColor?: string | null;
  date?: number | null;
  competition?: string | null;
};

export const UpcomingFixtureGraphic: React.FC<UpcomingFixtureGraphicProps> = ({
  teamBadge,
  teamColor,
  opponent,
  opponentBadge,
  opponentColor,
  date,
  competition,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const dateLabel = date
    ? new Date(date * 1000).toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'})
    : null;

  return (
    <>
      <Interactive.Div name="Next up title" style={{position: 'absolute', top: '36%', left: '50%', translate: '-50%'}}>
        <TitlePill text="NEXT UP" />
      </Interactive.Div>
      <Interactive.Div
        name="Fixture row"
        style={{
          position: 'absolute',
          top: '48%',
          left: '50%',
          translate: '-50%',
          scale,
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          background: 'black',
          border: '4px solid white',
          borderRadius: 999,
          padding: '18px 40px',
        }}
      >
        <TeamMark code="" badge={teamBadge} color={teamColor} />
        <span style={{fontFamily: displayFontFamily, fontSize: 34, color: 'white', opacity: 0.6}}>vs</span>
        <TeamMark code={opponent} badge={opponentBadge} color={opponentColor} />
      </Interactive.Div>
      {(dateLabel || competition) && (
        <Interactive.Div
          name="Fixture meta"
          style={{
            position: 'absolute',
            top: '62%',
            left: '50%',
            translate: '-50%',
            fontFamily: displayFontFamily,
            fontSize: 26,
            color: 'white',
            background: 'rgba(0,0,0,0.55)',
            borderRadius: 12,
            padding: '8px 22px',
            whiteSpace: 'nowrap',
          }}
        >
          {[dateLabel, competition].filter(Boolean).join(' · ')}
        </Interactive.Div>
      )}
    </>
  );
};
