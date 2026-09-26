import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Banner, COLORS, TeamMark, TitlePill} from './shared';

// The team-news beat (an injury, a suspension, a return) for ONE of the two
// sides. Unlike every other pre-match graphic, its headline isn't a number
// out of the structured data — there is no structured feed for "who's out",
// so it comes from the script's own tagged note, which the prompt binds to
// the scraped article excerpts under the GROUNDING RULE and which Ballsy
// says out loud in the same breath. That's the same script-derived-text
// contract the captions layer already runs on, not a second source of truth:
// the timeline generator simply drops the graphic when no note was written.
type TeamNewsGraphicProps = {
  code: string;
  badge?: string | null;
  color?: string | null;
  headline: string;
};

export const TeamNewsGraphic: React.FC<TeamNewsGraphicProps> = ({code, badge, color, headline}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const bannerScale = interpolate(frame, [8, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });
  // A longer note has to shrink to stay on one readable line at 1080 wide.
  const fontSize = headline.length > 22 ? 34 : headline.length > 14 ? 42 : 50;

  return (
    <>
      <Interactive.Div name="Team news title" style={{position: 'absolute', top: '8%', left: '50%', translate: '-50%'}}>
        <TitlePill text="TEAM NEWS" fontSize={34} />
      </Interactive.Div>
      <Interactive.Div
        name="Team news badge"
        style={{position: 'absolute', top: '28%', left: '50%', translate: '-50%', scale}}
      >
        <TeamMark code={code} badge={badge} color={color} />
      </Interactive.Div>
      <Interactive.Div
        name="Team news banner"
        style={{
          position: 'absolute',
          top: '48%',
          left: '50%',
          translate: '-50%',
          scale: bannerScale,
          rotate: '-2deg',
          maxWidth: '92%',
        }}
      >
        <Banner text={headline.toUpperCase()} color={COLORS.gray} textColor="white" fontSize={fontSize} />
      </Interactive.Div>
    </>
  );
};
