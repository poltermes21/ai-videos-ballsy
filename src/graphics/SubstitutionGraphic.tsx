import React from 'react';
import {AbsoluteFill, Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {COLORS, TitlePill} from './shared';
import {displayFontFamily} from '../fonts';

type SubstitutionGraphicProps = {
  playerOnName: string;
  playerOnNumber: number;
  playerOffName: string;
  playerOffNumber: number;
};

const Badge: React.FC<{color: string; tag: string; number: number; name: string; scale: number}> = ({
  color,
  tag,
  number,
  name,
  scale,
}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, scale: `${scale}`}}>
    <div
      style={{
        background: color,
        borderRadius: 8,
        padding: '3px 16px',
        color: 'white',
        fontFamily: displayFontFamily,
        fontSize: 24,
        letterSpacing: 3,
        border: '3px solid black',
        WebkitTextStroke: '1px black',
      }}
    >
      {tag}
    </div>
    <div
      style={{
        width: 120,
        height: 120,
        borderRadius: '50%',
        background: color,
        border: '7px solid black',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 10px 0 rgba(0,0,0,0.22)',
        fontFamily: displayFontFamily,
        fontSize: 58,
        color: 'white',
        WebkitTextStroke: '2px black',
      }}
    >
      {number}
    </div>
    <div
      style={{
        background: 'black',
        borderRadius: 8,
        padding: '5px 16px',
        color: 'white',
        fontFamily: displayFontFamily,
        fontSize: 26,
        letterSpacing: 1,
        maxWidth: 280,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      {name}
    </div>
  </div>
);

export const SubstitutionGraphic: React.FC<SubstitutionGraphicProps> = ({
  playerOnName,
  playerOnNumber,
  playerOffName,
  playerOffNumber,
}) => {
  const frame = useCurrentFrame();

  // Swap icon pops in and rotates a touch to feel alive.
  const iconScale = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const iconSpin = interpolate(frame, [0, 26], [-90, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 11, mass: 0.7}),
  });

  // OUT badge lands first, then IN.
  const offBadge = interpolate(frame, [14, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const onBadge = interpolate(frame, [24, 38], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  return (
    <AbsoluteFill>
      <Interactive.Div name="Substitution title" style={{position: 'absolute', top: '9%', left: '50%', translate: '-50%'}}>
        <TitlePill text="SUBSTITUTION" fontSize={42} />
      </Interactive.Div>

      {/* Swap icon (the reference image) */}
      <Interactive.Div
        name="Swap icon"
        style={{position: 'absolute', top: '34%', left: '50%', translate: '-50%', scale: iconScale, rotate: `${iconSpin}deg`}}
      >
        <Img src={staticFile('substitution.png')} style={{width: 240, height: 240}} />
      </Interactive.Div>

      {/* Badges: OUT (red) on the left, IN (green) on the right */}
      <Interactive.Div name="Player off badge" style={{position: 'absolute', top: '62%', left: '29%', translate: '-50%'}}>
        <Badge color={COLORS.red} tag="OUT" number={playerOffNumber} name={playerOffName} scale={offBadge} />
      </Interactive.Div>
      <Interactive.Div name="Player on badge" style={{position: 'absolute', top: '62%', left: '71%', translate: '-50%'}}>
        <Badge color={COLORS.green} tag="IN" number={playerOnNumber} name={playerOnName} scale={onBadge} />
      </Interactive.Div>
    </AbsoluteFill>
  );
};
