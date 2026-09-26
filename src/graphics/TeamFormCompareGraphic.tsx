import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, TeamMark, TitlePill} from './shared';
import {displayFontFamily} from '../fonts';

// How two teams are arriving, side by side — the same pip-row idea
// RecentFormGraphic uses for one player's last matches, doubled for a
// fixture preview. Each letter comes straight from SofaScore's own
// pre-match form string ("WLLWD"), never re-derived here.
type TeamFormCompareGraphicProps = {
  homeCode: string;
  homeBadge?: string | null;
  homeColor?: string | null;
  homeLast5?: string | null;
  awayCode: string;
  awayBadge?: string | null;
  awayColor?: string | null;
  awayLast5?: string | null;
};

const PIP_COLOR: Record<string, string> = {
  W: COLORS.green,
  D: COLORS.yellow,
  L: COLORS.red,
};

const Pip: React.FC<{letter: string; index: number}> = ({letter, index}) => {
  const frame = useCurrentFrame();
  const pop = interpolate(frame, [index * 4, index * 4 + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11}),
  });

  return (
    <div
      style={{
        scale: pop,
        width: 48,
        height: 48,
        borderRadius: 12,
        border: '3px solid black',
        background: PIP_COLOR[letter] ?? COLORS.gray,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: displayFontFamily,
        fontSize: 26,
        color: letter === 'L' ? 'white' : 'black',
      }}
    >
      {letter}
    </div>
  );
};

const FormColumn: React.FC<{code: string; badge?: string | null; color?: string | null; last5?: string | null}> = ({
  code,
  badge,
  color,
  last5,
}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14}}>
    <TeamMark code={code} badge={badge} color={color} />
    <div
      style={{
        fontFamily: displayFontFamily,
        fontSize: 30,
        color: 'white',
        letterSpacing: 2,
        WebkitTextStroke: '2px black',
      }}
    >
      {code}
    </div>
    <div style={{display: 'flex', gap: 8}}>
      {last5 && last5.length > 0 ? (
        Array.from(last5).map((letter, i) => <Pip key={`${letter}-${i}`} letter={letter} index={i} />)
      ) : (
        // Given its own dark pill rather than bare muted text: this sits on
        // whatever the pitch happens to be behind it, and a 50%-white string
        // with no backing can wash out completely.
        <span
          style={{
            fontFamily: displayFontFamily,
            fontSize: 24,
            color: 'rgba(255,255,255,0.75)',
            background: 'rgba(0,0,0,0.55)',
            borderRadius: 12,
            padding: '10px 18px',
            whiteSpace: 'nowrap',
          }}
        >
          NO FORM DATA
        </span>
      )}
    </div>
  </div>
);

export const TeamFormCompareGraphic: React.FC<TeamFormCompareGraphicProps> = ({
  homeCode,
  homeBadge,
  homeColor,
  homeLast5,
  awayCode,
  awayBadge,
  awayColor,
  awayLast5,
}) => (
  <>
    <Interactive.Div name="Form compare title" style={{position: 'absolute', top: '6%', left: '50%', translate: '-50%'}}>
      <TitlePill text="LAST 5" fontSize={34} />
    </Interactive.Div>
    <Interactive.Div
      name="Form columns"
      style={{
        position: 'absolute',
        top: '28%',
        left: '50%',
        translate: '-50%',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 70,
        width: 'max-content',
      }}
    >
      <FormColumn code={homeCode} badge={homeBadge} color={homeColor} last5={homeLast5} />
      <FormColumn code={awayCode} badge={awayBadge} color={awayColor} last5={awayLast5} />
    </Interactive.Div>
  </>
);
