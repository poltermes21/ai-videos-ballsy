import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, TeamMark, TitlePill} from './shared';
import {displayFontFamily} from '../fonts';

// The two teams' head-to-head record. SofaScore always counts this from the
// HOME team's side (homeWins/draws/awayWins), so the wins column under each
// badge is that team's own — never flipped or re-derived here.
type H2HGraphicProps = {
  homeCode: string;
  homeBadge?: string | null;
  homeColor?: string | null;
  awayCode: string;
  awayBadge?: string | null;
  awayColor?: string | null;
  homeWins?: number | null;
  draws?: number | null;
  awayWins?: number | null;
};

const Tally: React.FC<{value: number | null | undefined; label: string; color: string; index: number}> = ({
  value,
  label,
  color,
  index,
}) => {
  const frame = useCurrentFrame();
  const pop = interpolate(frame, [index * 6, index * 6 + 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  return (
    <div style={{scale: pop, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 130}}>
      <div style={{fontFamily: displayFontFamily, fontSize: 82, color, lineHeight: 1, WebkitTextStroke: '3px black'}}>
        {value ?? 0}
      </div>
      <div style={{fontFamily: displayFontFamily, fontSize: 22, color: 'white', letterSpacing: 3}}>{label}</div>
    </div>
  );
};

export const H2HGraphic: React.FC<H2HGraphicProps> = ({
  homeCode,
  homeBadge,
  homeColor,
  awayCode,
  awayBadge,
  awayColor,
  homeWins,
  draws,
  awayWins,
}) => (
  <>
    <Interactive.Div name="H2H title" style={{position: 'absolute', top: '6%', left: '50%', translate: '-50%'}}>
      <TitlePill text="HEAD TO HEAD" fontSize={34} />
    </Interactive.Div>
    <Interactive.Div
      name="H2H badges"
      style={{
        position: 'absolute',
        top: '26%',
        left: '50%',
        translate: '-50%',
        display: 'flex',
        alignItems: 'center',
        gap: 90,
        width: 'max-content',
      }}
    >
      <TeamMark code={homeCode} badge={homeBadge} color={homeColor} />
      <TeamMark code={awayCode} badge={awayBadge} color={awayColor} />
    </Interactive.Div>
    <Interactive.Div
      name="H2H tally"
      style={{
        position: 'absolute',
        top: '45%',
        left: '50%',
        translate: '-50%',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        background: 'rgba(0,0,0,0.6)',
        border: '4px solid white',
        borderRadius: 28,
        padding: '18px 34px',
        width: 'max-content',
      }}
    >
      <Tally value={homeWins} label={homeCode} color={COLORS.green} index={0} />
      <Tally value={draws} label="DRAWS" color={COLORS.yellow} index={1} />
      <Tally value={awayWins} label={awayCode} color={COLORS.cyan} index={2} />
    </Interactive.Div>
  </>
);
