import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Banner, COLORS, TitlePill} from './shared';

type InjuryGapGraphicProps = {
  missedMatchesInWindow: boolean;
};

// Only ever rendered when the script actually tagged this stat, which only
// happens when missedMatchesInWindow is true (see the prompt's PLAYER FORM
// DATA section) — the "true" branch is the only one that should ever show,
// but a fallback message keeps this graphic never rendering blank.
export const InjuryGapGraphic: React.FC<InjuryGapGraphicProps> = ({missedMatchesInWindow}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  return (
    <>
      <Interactive.Div name="Injury title" style={{position: 'absolute', top: '38%', left: '50%', translate: '-50%'}}>
        <TitlePill text="IN AND OUT" />
      </Interactive.Div>
      <Interactive.Div
        name="Injury banner"
        style={{position: 'absolute', top: '50%', left: '50%', translate: '-50%', scale, rotate: '-2deg'}}
      >
        <Banner
          text={missedMatchesInWindow ? 'MISSED TIME RECENTLY' : 'AVAILABLE THROUGHOUT'}
          color={COLORS.gray}
          textColor="white"
          fontSize={44}
        />
      </Interactive.Div>
    </>
  );
};
