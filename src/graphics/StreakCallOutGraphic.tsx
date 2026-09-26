import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Banner, COLORS} from './shared';
import {PlayerCard} from './PlayerCard';

type StreakCallOutGraphicProps = {
  playerName: string;
  playerNumber?: number | null;
  playerPhoto?: string | null;
  consecutiveWithGoalOrAssist: number;
  consecutiveWithGoal: number;
  // The cold mirror of the two above — how many recent games in a row have
  // been blank / goalless. Optional so older saved data without them still
  // renders (falls back to the generic "GOING THROUGH IT" line).
  consecutiveWithoutGoalOrAssist?: number;
  consecutiveWithoutGoal?: number;
};

// The headline number a "form check" video is built around. Hot side:
// whichever run is longer/more specific — a pure scoring streak reads
// better than the broader goal-or-assist one when both are non-zero, same
// weighting logic mirrored on the cold side below.
export const StreakCallOutGraphic: React.FC<StreakCallOutGraphicProps> = ({
  playerName,
  playerNumber,
  playerPhoto,
  consecutiveWithGoalOrAssist,
  consecutiveWithGoal,
  consecutiveWithoutGoalOrAssist = 0,
  consecutiveWithoutGoal = 0,
}) => {
  const frame = useCurrentFrame();
  const isHot = consecutiveWithGoalOrAssist > 0;
  const useGoalStreak = consecutiveWithGoal >= consecutiveWithGoalOrAssist && consecutiveWithGoal > 0;
  const useGoallessDrought = consecutiveWithoutGoal >= consecutiveWithoutGoalOrAssist && consecutiveWithoutGoal > 0;
  const count = isHot
    ? useGoalStreak
      ? consecutiveWithGoal
      : consecutiveWithGoalOrAssist
    : useGoallessDrought
      ? consecutiveWithoutGoal
      : consecutiveWithoutGoalOrAssist;
  const label = isHot
    ? useGoalStreak
      ? `${count} STRAIGHT`
      : `${count} IN A ROW`
    : count === 0
      ? 'GOING THROUGH IT'
      : useGoallessDrought
        ? `${count} WITHOUT A GOAL`
        : `${count} WITHOUT A GOAL OR ASSIST`;
  const bannerColor = isHot ? (count >= 4 ? COLORS.green : COLORS.yellow) : count > 0 ? COLORS.red : COLORS.gray;

  const cardScale = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });
  const bannerScale = interpolate(frame, [10, 24], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 9}),
  });

  return (
    <>
      <Interactive.Div
        name="Streak hero card"
        style={{position: 'absolute', top: '32%', left: '50%', translate: '-50%', scale: cardScale}}
      >
        <PlayerCard name={playerName} number={playerNumber ?? null} photo={playerPhoto ?? null} />
      </Interactive.Div>
      <Interactive.Div
        name="Streak banner"
        style={{position: 'absolute', bottom: '10%', left: '50%', translate: '-50%', scale: bannerScale, rotate: '-3deg'}}
      >
        <Banner text={label} color={bannerColor} textColor={isHot ? 'black' : 'white'} fontSize={56} />
      </Interactive.Div>
    </>
  );
};
