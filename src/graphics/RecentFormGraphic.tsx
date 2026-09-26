import React from 'react';
import {Easing, Img, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {TitlePill} from './shared';
import {displayFontFamily} from '../fonts';
import {PlayerCard} from './PlayerCard';

type RecentAppearance = {date: string; opponent: string; goals: number; assists: number};

type RecentFormGraphicProps = {
  playerName: string;
  playerNumber?: number | null;
  playerPhoto?: string | null;
  recent: RecentAppearance[];
};

const GOAL_ICON = 'ball.png';
const ASSIST_ICON = 'assist-boot.png';
const MAX_MATCHES = 5;
const ICON_SIZE = 28;

// One row per match — opponent on the left, a real icon repeated once per
// goal/assist on the right (a ball per goal, a boot per assist) instead of
// a single letter/number code you have to decode.
const MatchRow: React.FC<{app: RecentAppearance; index: number}> = ({app, index}) => {
  const frame = useCurrentFrame();
  const delay = index * 6;
  const progress = interpolate(frame, [delay, delay + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const blank = app.goals === 0 && app.assists === 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        opacity: progress,
        translate: `${(1 - progress) * -50}px 0`,
        background: 'rgba(0,0,0,0.55)',
        borderRadius: 14,
        padding: '8px 20px',
      }}
    >
      <span
        style={{
          fontFamily: displayFontFamily,
          fontSize: 25,
          color: 'white',
          maxWidth: 260,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {app.opponent}
      </span>
      <div style={{display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0}}>
        {blank ? (
          <span style={{fontFamily: displayFontFamily, fontSize: 24, color: 'rgba(255,255,255,0.4)'}}>—</span>
        ) : (
          <>
            {Array.from({length: app.goals}).map((_, i) => (
              <Img key={`g${i}`} src={staticFile(GOAL_ICON)} style={{width: ICON_SIZE, height: ICON_SIZE}} />
            ))}
            {Array.from({length: app.assists}).map((_, i) => (
              <Img
                key={`a${i}`}
                src={staticFile(ASSIST_ICON)}
                style={{width: ICON_SIZE, height: ICON_SIZE, objectFit: 'contain'}}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
};

// Layout is worked out top-down against the real safe-content budget
// (~730px tall in the actual 1080x1920 composition — see BallsyCam's
// contentSafeHeight) rather than guessed percentages, so title/list/card
// never collide: title (~66px incl. its own padding/border) -> gap -> the
// 5-row list (~266px) -> gap -> the player card at its scale (~304px) ->
// margin, and it all adds up to comfortably under 730. Don't move any one
// of these without re-checking the other three still fit underneath it.
const TITLE_TOP_FRACTION = 0.03;
const LIST_TOP_FRACTION = 0.15;
const CARD_TOP_FRACTION = 0.58;
const CARD_SCALE = 1.15;

export const RecentFormGraphic: React.FC<RecentFormGraphicProps> = ({playerName, playerNumber, playerPhoto, recent}) => {
  const shown = recent.slice(0, MAX_MATCHES);

  return (
    <>
      <Interactive.Div
        name="Form title"
        style={{position: 'absolute', top: `${TITLE_TOP_FRACTION * 100}%`, left: '50%', translate: '-50%'}}
      >
        <TitlePill text="LAST 5 MATCHES" fontSize={32} />
      </Interactive.Div>
      <Interactive.Div
        name="Form list"
        style={{
          position: 'absolute',
          top: `${LIST_TOP_FRACTION * 100}%`,
          left: '50%',
          translate: '-50%',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          width: '84%',
        }}
      >
        {shown.map((app, i) => (
          <MatchRow key={`${app.date}-${i}`} app={app} index={i} />
        ))}
      </Interactive.Div>
      {/* Same PlayerCard the goal-scorer moment uses (photo + number badge +
          name plaque) — bigger than its usual goal-graphic size, positioned
          by its TOP (not bottom) so the precomputed CARD_TOP_FRACTION is
          exactly where it starts regardless of scale — growing it never
          pushes it back up into the list above. */}
      <Interactive.Div
        name="Player card"
        style={{
          position: 'absolute',
          top: `${CARD_TOP_FRACTION * 100}%`,
          left: '50%',
          translate: '-50%',
          transformOrigin: 'top',
          scale: CARD_SCALE,
        }}
      >
        <PlayerCard name={playerName} number={playerNumber ?? null} photo={playerPhoto ?? null} />
      </Interactive.Div>
    </>
  );
};
