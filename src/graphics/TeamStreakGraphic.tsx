import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Banner, COLORS, TeamMark, TitlePill} from './shared';
import {displayFontFamily} from '../fonts';

// One team's real current run in this competition and season — see
// sofascore.py's build_team_streaks. Both directions are always reported;
// exactly one side is ever meaningfully non-zero.
type TeamStreak = {
  matchesConsidered: number;
  winStreak: number;
  unbeatenStreak: number;
  lossStreak: number;
  winlessStreak: number;
} | null;

type TeamStreakGraphicProps = {
  homeCode: string;
  homeBadge?: string | null;
  homeColor?: string | null;
  homeStreak?: TeamStreak;
  awayCode: string;
  awayBadge?: string | null;
  awayColor?: string | null;
  awayStreak?: TeamStreak;
};

// The exact hot/cold framing StreakCallOutGraphic applies to one player,
// generalized to a team: pick whichever run is actually TRUE (a winning run
// or a losing one), preferring the more specific of the two same-direction
// counts when both are non-zero — a pure win streak reads better than the
// broader unbeaten one, a pure losing run better than the broader winless
// one. A bad run is never dressed up as a good one; when neither side has a
// real run, this says so rather than inventing a positive spin.
function describeStreak(streak: TeamStreak): {label: string; color: string; textColor: string} {
  if (!streak) return {label: 'NO RECORD YET', color: COLORS.gray, textColor: 'white'};

  const isHot = streak.winStreak > 0 || streak.unbeatenStreak > 0;
  if (isHot) {
    const useWins = streak.winStreak >= streak.unbeatenStreak && streak.winStreak > 0;
    const count = useWins ? streak.winStreak : streak.unbeatenStreak;
    return {
      label: useWins ? `${count} WINS IN A ROW` : `${count} UNBEATEN`,
      color: count >= 4 ? COLORS.green : COLORS.yellow,
      textColor: 'black',
    };
  }

  const isCold = streak.lossStreak > 0 || streak.winlessStreak > 0;
  if (isCold) {
    const useLosses = streak.lossStreak >= streak.winlessStreak && streak.lossStreak > 0;
    const count = useLosses ? streak.lossStreak : streak.winlessStreak;
    return {
      label: useLosses ? `${count} STRAIGHT DEFEATS` : `${count} WITHOUT A WIN`,
      color: COLORS.red,
      textColor: 'white',
    };
  }

  // Neither direction has a run — the last result broke both ways of
  // counting (a draw after a win, say). Nothing to call out.
  return {label: 'NO RUN EITHER WAY', color: COLORS.gray, textColor: 'white'};
}

const StreakRow: React.FC<{
  code: string;
  badge?: string | null;
  color?: string | null;
  streak?: TeamStreak;
  index: number;
}> = ({code, badge, color, streak, index}) => {
  const frame = useCurrentFrame();
  const delay = index * 10;
  const pop = interpolate(frame, [delay, delay + 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const {label, color: bannerColor, textColor} = describeStreak(streak ?? null);

  return (
    <div style={{scale: pop, display: 'flex', alignItems: 'center', gap: 22, width: 'max-content'}}>
      <TeamMark code={code} badge={badge} color={color} />
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6}}>
        <span
          style={{
            fontFamily: displayFontFamily,
            fontSize: 26,
            color: 'white',
            letterSpacing: 2,
            WebkitTextStroke: '2px black',
          }}
        >
          {code}
        </span>
        <Banner text={label} color={bannerColor} textColor={textColor} fontSize={34} />
      </div>
    </div>
  );
};

export const TeamStreakGraphic: React.FC<TeamStreakGraphicProps> = ({
  homeCode,
  homeBadge,
  homeColor,
  homeStreak,
  awayCode,
  awayBadge,
  awayColor,
  awayStreak,
}) => (
  <>
    <Interactive.Div name="Streak title" style={{position: 'absolute', top: '5%', left: '50%', translate: '-50%'}}>
      <TitlePill text="FORM GOING IN" fontSize={32} />
    </Interactive.Div>
    <Interactive.Div
      name="Streak rows"
      style={{
        position: 'absolute',
        top: '24%',
        left: '50%',
        translate: '-50%',
        display: 'flex',
        flexDirection: 'column',
        gap: 34,
        alignItems: 'flex-start',
        width: 'max-content',
      }}
    >
      <StreakRow code={homeCode} badge={homeBadge} color={homeColor} streak={homeStreak} index={0} />
      <StreakRow code={awayCode} badge={awayBadge} color={awayColor} streak={awayStreak} index={1} />
    </Interactive.Div>
  </>
);
