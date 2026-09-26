import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, Sequence, staticFile, useVideoConfig} from 'remotion';
import {BallsyCam, ROOT_BACKGROUND} from './BallsyCam';
import {Background} from './Background';
import {CoverCard} from './CoverCard';
import {PitchSizeProvider} from './PitchSizeContext';
import {GoalGraphic} from './graphics/GoalGraphic';
import {GoalDisallowedGraphic} from './graphics/GoalDisallowedGraphic';
import {CardGraphic} from './graphics/CardGraphic';
import {PenaltyGraphic} from './graphics/PenaltyGraphic';
import {SubstitutionGraphic} from './graphics/SubstitutionGraphic';
import {ClearChanceGraphic} from './graphics/ClearChanceGraphic';
import {VarReviewGraphic} from './graphics/VarReviewGraphic';

type ScoreProps = {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  scoringTeam: 'home' | 'away';
  // Real badge/kit-colour, from SofaScore — optional so a graphics.json
  // generated before this existed still matches (falls back to text codes).
  homeBadge?: string | null;
  awayBadge?: string | null;
  homeColor?: string | null;
  awayColor?: string | null;
};

// The scorer of a goal/scored-penalty — name + shirt number always, a real
// SofaScore photo only if this player has one (PlayerCard falls back to a
// plain number badge otherwise). See CLAUDE.md for why a real photo is used
// here at all.
type Scorer = {name: string; number: number | null; photo: string | null};

// Static match identity — cover card + the persistent mini-scoreboard both
// need this outside of any single event graphic. Emitted once, alongside
// graphicsTimeline in the same file (see generate-graphics-timeline.mjs), so
// it doesn't need its own fetch.
type MatchInfo = {
  homeTeam: string;
  awayTeam: string;
  homeBadge: string | null;
  awayBadge: string | null;
  homeColor: string | null;
  awayColor: string | null;
  tournament: string | null;
  tournamentLogo: string | null;
  season: string | null;
  round: number | null;
  date: number | null;
};

// Discriminated union — one variant per event graphic. Shapes must match the
// props emitted by scripts/generate-graphics-timeline.mjs. `durationSeconds`
// is how long the underlying script segment actually takes to say (so the
// graphic stays up for the whole line instead of a generic fixed duration);
// optional for backward compat with graphics.json files generated before
// this existed — GRAPHIC_DURATION below is the fallback for those.
type GraphicsEntry = {startTime: number; durationSeconds?: number} & (
  | {type: 'goal'; props: ScoreProps & {scorer?: Scorer | null}}
  | {type: 'goalDisallowed'; props: ScoreProps}
  | {type: 'card'; props: {cardType: 'yellow' | 'red'; minute: number}}
  | {type: 'penalty'; props: {outcome: 'scored' | 'saved' | 'post' | 'out'} & ScoreProps & {scorer?: Scorer | null}}
  | {
      type: 'substitution';
      props: {
        playerOnName: string;
        playerOnNumber: number;
        playerOffName: string;
        playerOffNumber: number;
      };
    }
  | {type: 'clearChance'; props: {outcome: 'post' | 'wide'}}
  | {type: 'varReview'; props: Record<string, never>}
);

// Frames each graphic stays on screen (mirrors the test comps in Root.tsx).
const GRAPHIC_DURATION: Record<GraphicsEntry['type'], number> = {
  goal: 90,
  goalDisallowed: 120,
  card: 90,
  penalty: 100,
  substitution: 90,
  clearChance: 100,
  varReview: 150,
};

function renderGraphic(entry: GraphicsEntry) {
  switch (entry.type) {
    case 'goal':
      return <GoalGraphic {...entry.props} />;
    case 'goalDisallowed':
      return <GoalDisallowedGraphic {...entry.props} />;
    case 'card':
      return <CardGraphic {...entry.props} />;
    case 'penalty':
      return <PenaltyGraphic {...entry.props} />;
    case 'substitution':
      return <SubstitutionGraphic {...entry.props} />;
    case 'clearChance':
      return <ClearChanceGraphic {...entry.props} />;
    case 'varReview':
      return <VarReviewGraphic />;
  }
}

// SofaScore event id — FC Barcelona 7-2 Real Racing Club, LaLiga 26/27.
// Exported so Root.tsx's calculateMetadata can size the composition to this
// fixture's real audio length without duplicating the id.
export const FIXTURE_ID = '16416339-the-uncalled-fouls-by-romero-and-kang-in-lee-on-valverde-and-bellingham-that-mourinho-named-together-and-said-deserved-two-red-cards-plus-his-press-conference-reaction';

export const Ballsy: React.FC = () => {
  const {width, fps} = useVideoConfig();
  const [handle] = useState(() => delayRender('Loading match graphics timeline'));
  const [graphicsTimeline, setGraphicsTimeline] = useState<GraphicsEntry[]>([]);
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(staticFile(`audio/${FIXTURE_ID}-graphics.json`))
      .then((res) => res.json() as Promise<{graphicsTimeline: GraphicsEntry[]; matchInfo: MatchInfo | null}>)
      .then((data) => {
        if (cancelled) return;
        setGraphicsTimeline(data.graphicsTimeline);
        setMatchInfo(data.matchInfo ?? null);
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
        fixtureId={FIXTURE_ID}
        coverCard={
          matchInfo && (
            <Sequence durationInFrames={75} layout="none">
              <CoverCard
                tournament={matchInfo.tournament}
                tournamentLogo={matchInfo.tournamentLogo}
                round={matchInfo.round}
                date={matchInfo.date}
              />
            </Sequence>
          )
        }
      >
        {({camHeight, contentHeight, contentSafeHeight, contentOpacity}) => (
          // The pitch — confined below the cam, filled edge-to-edge by the
          // grass (no dead gap at the very bottom). Event graphics render in
          // a shorter inner layer (contentSafeHeight) instead: YouTube
          // Shorts/TikTok draw their own UI over roughly the bottom fifth of
          // the frame — confirmed against a real published Short — so
          // graphics stay clear of it while the grass still reaches the true
          // bottom edge underneath them. PitchSizeProvider tells the few
          // graphics that do pixel math (Penalty/ClearChance/Background) the
          // size of whichever layer they're actually in — see
          // PitchSizeContext.tsx.
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
              <PitchSizeProvider value={{width, height: contentSafeHeight}}>
                {graphicsTimeline.map((entry, i) => {
                  const durationInFrames =
                    entry.durationSeconds != null ? Math.round(entry.durationSeconds * fps) : GRAPHIC_DURATION[entry.type];
                  return (
                    <Sequence key={i} from={Math.round(entry.startTime * fps)} durationInFrames={durationInFrames}>
                      {renderGraphic(entry)}
                    </Sequence>
                  );
                })}
              </PitchSizeProvider>
            </div>
          </div>
        )}
      </BallsyCam>
    </AbsoluteFill>
  );
};
