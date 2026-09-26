import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, TeamMark, TitlePill} from './shared';
import {displayFontFamily} from '../fonts';

// Where both teams actually sit in the real league table going into this
// fixture — position/points/played straight off SofaScore's standings rows
// (see sofascore.py's _standings_snapshot), never estimated.
type TablePositionGraphicProps = {
  competition?: string | null;
  homeCode: string;
  homeBadge?: string | null;
  homeColor?: string | null;
  homePosition?: number | null;
  homePoints?: number | null;
  homePlayed?: number | null;
  awayCode: string;
  awayBadge?: string | null;
  awayColor?: string | null;
  awayPosition?: number | null;
  awayPoints?: number | null;
  awayPlayed?: number | null;
};

// "1" -> "1ST", "22" -> "22ND". Written out because a bare number next to a
// points total reads ambiguously on screen.
function ordinal(position: number): string {
  const rest = position % 100;
  if (rest >= 11 && rest <= 13) return `${position}TH`;
  return `${position}${['TH', 'ST', 'ND', 'RD'][position % 10] ?? 'TH'}`;
}

const TableCard: React.FC<{
  code: string;
  badge?: string | null;
  color?: string | null;
  position?: number | null;
  points?: number | null;
  played?: number | null;
  index: number;
}> = ({code, badge, color, position, points, played, index}) => {
  const frame = useCurrentFrame();
  const pop = interpolate(frame, [index * 7, index * 7 + 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  return (
    <div
      style={{
        scale: pop,
        background: 'black',
        border: '4px solid white',
        borderRadius: 24,
        boxShadow: '0 8px 0 rgba(0,0,0,0.25)',
        padding: '22px 30px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        minWidth: 240,
      }}
    >
      <TeamMark code={code} badge={badge} color={color} />
      <div style={{fontFamily: displayFontFamily, fontSize: 26, color: 'white', letterSpacing: 2}}>{code}</div>
      <div style={{fontFamily: displayFontFamily, fontSize: 64, color: COLORS.yellow, lineHeight: 1}}>
        {position != null ? ordinal(position) : '—'}
      </div>
      <div style={{fontFamily: displayFontFamily, fontSize: 24, color: 'white', opacity: 0.85}}>
        {points != null ? `${points} PTS` : 'NO TABLE DATA'}
        {points != null && played != null ? ` · ${played} PL` : ''}
      </div>
    </div>
  );
};

export const TablePositionGraphic: React.FC<TablePositionGraphicProps> = ({
  competition,
  homeCode,
  homeBadge,
  homeColor,
  homePosition,
  homePoints,
  homePlayed,
  awayCode,
  awayBadge,
  awayColor,
  awayPosition,
  awayPoints,
  awayPlayed,
}) => (
  <>
    <Interactive.Div name="Table title" style={{position: 'absolute', top: '5%', left: '50%', translate: '-50%'}}>
      <TitlePill text={competition ? `${competition.toUpperCase()} TABLE` : 'IN THE TABLE'} fontSize={32} />
    </Interactive.Div>
    <Interactive.Div
      name="Table cards"
      style={{
        position: 'absolute',
        top: '24%',
        left: '50%',
        translate: '-50%',
        display: 'flex',
        gap: 26,
        width: 'max-content',
      }}
    >
      <TableCard
        code={homeCode}
        badge={homeBadge}
        color={homeColor}
        position={homePosition}
        points={homePoints}
        played={homePlayed}
        index={0}
      />
      <TableCard
        code={awayCode}
        badge={awayBadge}
        color={awayColor}
        position={awayPosition}
        points={awayPoints}
        played={awayPlayed}
        index={1}
      />
    </Interactive.Div>
  </>
);
