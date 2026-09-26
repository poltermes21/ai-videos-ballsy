import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, Sequence, staticFile, useVideoConfig} from 'remotion';
import {BallsyCam, ROOT_BACKGROUND} from './BallsyCam';
import {Background} from './Background';
import {PlayerCoverCard} from './PlayerCoverCard';
import {PitchSizeProvider} from './PitchSizeContext';
import {RecentFormGraphic} from './graphics/RecentFormGraphic';
import {SeasonTallyGraphic} from './graphics/SeasonTallyGraphic';
import {StreakCallOutGraphic} from './graphics/StreakCallOutGraphic';
import {InjuryGapGraphic} from './graphics/InjuryGapGraphic';
import {UpcomingFixtureGraphic} from './graphics/UpcomingFixtureGraphic';

// One variant per stat-card graphic. Shapes must match the props emitted by
// scripts/generate-player-timeline.mjs — the player-video sibling of
// GraphicsEntry in ballsy.tsx.
type PlayerTimelineEntry = {startTime: number; durationSeconds: number} & (
  | {
      type: 'recentForm';
      props: {
        playerName: string;
        playerNumber: number | null;
        playerPhoto: string | null;
        recent: Array<{date: string; opponent: string; goals: number; assists: number}>;
      };
    }
  | {type: 'seasonTally'; props: {competition: string | null; seasonStats: Record<string, number | null>}}
  | {
      type: 'streakCallOut';
      props: {
        playerName: string;
        playerNumber: number | null;
        playerPhoto: string | null;
        consecutiveWithGoalOrAssist: number;
        consecutiveWithGoal: number;
      };
    }
  | {type: 'injuryGap'; props: {missedMatchesInWindow: boolean}}
  | {
      type: 'upcomingFixture';
      props: {
        teamBadge: string | null;
        teamColor: string | null;
        opponent: string;
        opponentBadge: string | null;
        opponentColor: string | null;
        date: number | null;
        competition: string | null;
      };
    }
);

type PlayerInfo = {
  id: number;
  name: string;
  team: string;
  teamId: number;
  competition: string | null;
  tournamentId: number;
  seasonId: number;
  teamBadge: string | null;
  playerPhoto: string | null;
  teamColor: string | null;
  outroStart: number | null;
};

function renderStatCard(entry: PlayerTimelineEntry) {
  switch (entry.type) {
    case 'recentForm':
      return <RecentFormGraphic {...entry.props} />;
    case 'seasonTally':
      return <SeasonTallyGraphic {...entry.props} />;
    case 'streakCallOut':
      return <StreakCallOutGraphic {...entry.props} />;
    case 'injuryGap':
      return <InjuryGapGraphic {...entry.props} />;
    case 'upcomingFixture':
      return <UpcomingFixtureGraphic {...entry.props} />;
  }
}

// The player id this composition currently points at — set by Ballsy
// Studio's setFixtureId() the same way FIXTURE_ID in ballsy.tsx is, just
// targeting this constant instead. Exported so Root.tsx's calculateMetadata
// can size the composition to this fixture's real audio length.
export const PLAYER_FIXTURE_ID = 'player-831005-2026-09-19';

export const PlayerBallsy: React.FC = () => {
  const {width, fps} = useVideoConfig();
  const [handle] = useState(() => delayRender('Loading player stat timeline'));
  const [timeline, setTimeline] = useState<PlayerTimelineEntry[]>([]);
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(staticFile(`audio/${PLAYER_FIXTURE_ID}-timeline.json`))
      .then((res) => res.json() as Promise<{timeline: PlayerTimelineEntry[]; playerInfo: PlayerInfo | null}>)
      .then((data) => {
        if (cancelled) return;
        setTimeline(data.timeline);
        setPlayerInfo(data.playerInfo ?? null);
        continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AbsoluteFill style={{background: ROOT_BACKGROUND}}>
      <BallsyCam
        fixtureId={PLAYER_FIXTURE_ID}
        coverCard={
          playerInfo && (
            <Sequence durationInFrames={75} layout="none">
              <PlayerCoverCard playerName={playerInfo.name} playerPhoto={playerInfo.playerPhoto} teamName={playerInfo.team} />
            </Sequence>
          )
        }
      >
        {({camHeight, contentHeight, contentSafeHeight, contentOpacity}) => (
          // Same two-layer treatment as the match pitch (see ballsy.tsx):
          // the background fills all the way to the true bottom edge, stat
          // cards render in a shorter inner layer clear of the YouTube
          // Shorts/TikTok UI reserve.
          <div
            style={{
              position: 'absolute',
              top: camHeight,
              left: 0,
              width: '100%',
              height: contentHeight,
              overflow: 'hidden',
              opacity: contentOpacity,
            }}
          >
            <PitchSizeProvider value={{width, height: contentHeight}}>
              <Background />
            </PitchSizeProvider>
            <div style={{position: 'absolute', top: 0, left: 0, width: '100%', height: contentSafeHeight, overflow: 'hidden'}}>
              {timeline.map((entry, i) => (
                <Sequence
                  key={i}
                  from={Math.round(entry.startTime * fps)}
                  durationInFrames={Math.round(entry.durationSeconds * fps)}
                >
                  {renderStatCard(entry)}
                </Sequence>
              ))}
            </div>
          </div>
        )}
      </BallsyCam>
    </AbsoluteFill>
  );
};
