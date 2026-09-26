import React, {useEffect, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, Sequence, staticFile, useVideoConfig} from 'remotion';
import {BallsyCam, ROOT_BACKGROUND} from './BallsyCam';
import {Background} from './Background';
import {CoverCard} from './CoverCard';
import {PitchSizeProvider} from './PitchSizeContext';
import {TeamFormCompareGraphic} from './graphics/TeamFormCompareGraphic';
import {TablePositionGraphic} from './graphics/TablePositionGraphic';
import {H2HGraphic} from './graphics/H2HGraphic';
import {TeamStreakGraphic} from './graphics/TeamStreakGraphic';
import {TeamNewsGraphic} from './graphics/TeamNewsGraphic';
import {PredictionGraphic} from './graphics/PredictionGraphic';

// The two teams' identity, spread into every card that compares them — see
// the `teams` object in scripts/generate-prematch-timeline.mjs.
type TeamPair = {
  homeCode: string;
  homeBadge: string | null;
  homeColor: string | null;
  awayCode: string;
  awayBadge: string | null;
  awayColor: string | null;
};

type TeamStreak = {
  matchesConsidered: number;
  winStreak: number;
  unbeatenStreak: number;
  lossStreak: number;
  winlessStreak: number;
} | null;

// One variant per preview-card graphic. Shapes must match the props emitted
// by scripts/generate-prematch-timeline.mjs — the preview sibling of
// GraphicsEntry in ballsy.tsx and PlayerTimelineEntry in ballsyPlayer.tsx.
type PrematchTimelineEntry = {startTime: number; durationSeconds: number} & (
  | {type: 'teamFormCompare'; props: TeamPair & {homeLast5: string | null; awayLast5: string | null}}
  | {
      type: 'tablePosition';
      props: TeamPair & {
        competition: string | null;
        homePosition: number | null;
        homePoints: number | null;
        homePlayed: number | null;
        awayPosition: number | null;
        awayPoints: number | null;
        awayPlayed: number | null;
      };
    }
  | {type: 'h2h'; props: TeamPair & {homeWins: number | null; draws: number | null; awayWins: number | null}}
  | {type: 'teamStreak'; props: TeamPair & {homeStreak: TeamStreak; awayStreak: TeamStreak}}
  | {type: 'teamNews'; props: {code: string; badge: string | null; color: string | null; headline: string}}
);

// The prediction card, emitted on its own rather than inside `timeline` —
// see generate-prematch-timeline.mjs for why (it lands on the result block,
// where the cam is always fullscreen).
type PredictionCard = {
  startTime: number;
  durationSeconds: number;
  props: TeamPair & {pick: 'home' | 'away' | 'draw'; pickTeam: string | null};
};

// Static fixture identity — no score, because the match hasn't been played.
type PrematchInfo = {
  home: string;
  away: string;
  homeCode: string | null;
  awayCode: string | null;
  tournament: string | null;
  tournamentLogo: string | null;
  season: string | null;
  round: number | null;
  date: number | null;
  outroStart: number | null;
};

function renderPreviewCard(entry: PrematchTimelineEntry) {
  switch (entry.type) {
    case 'teamFormCompare':
      return <TeamFormCompareGraphic {...entry.props} />;
    case 'tablePosition':
      return <TablePositionGraphic {...entry.props} />;
    case 'h2h':
      return <H2HGraphic {...entry.props} />;
    case 'teamStreak':
      return <TeamStreakGraphic {...entry.props} />;
    case 'teamNews':
      return <TeamNewsGraphic {...entry.props} />;
  }
}

// Where the prediction overlay sits in the full frame. By the result block
// the cam has gone fullscreen (generate-avatar-timeline.mjs returns
// camHeightFraction to 1 after the last key moment, for every video type),
// so this card can't live in the content layer — it would be completely
// hidden behind Ballsy at the one beat that matters most. It renders on top
// of him instead, in the band ABOVE his head, which is the only part of a
// fullscreen frame that's genuinely free: his face starts around 34% down,
// the captions sit at roughly 65-70% once the cam is fullscreen (see
// BallsyCam's captionBottomFraction), and the bottom fifth is the
// Shorts/TikTok UI reserve. PredictionGraphic's own percentage layout is
// relative to this box, and lands clear of Ballsy with room to spare.
const PREDICTION_OVERLAY_TOP = '2%';
const PREDICTION_OVERLAY_HEIGHT = '32%';

// The preview run this composition currently points at — set by Ballsy
// Studio's setPrematchFixtureId() the same way FIXTURE_ID in ballsy.tsx and
// PLAYER_FIXTURE_ID in ballsyPlayer.tsx are. Always "prematch-<matchId>"
// prefixed, so a fixture's preview can never collide with its eventual
// recap (see scripts/lib/run-paths.mjs). Exported so Root.tsx's
// calculateMetadata can size the composition to this run's real audio length.
export const PREMATCH_FIXTURE_ID = 'prematch-16363721';

export const PrematchBallsy: React.FC = () => {
  const {width, fps} = useVideoConfig();
  const [handle] = useState(() => delayRender('Loading pre-match preview timeline'));
  const [timeline, setTimeline] = useState<PrematchTimelineEntry[]>([]);
  const [prediction, setPrediction] = useState<PredictionCard | null>(null);
  const [matchInfo, setMatchInfo] = useState<PrematchInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(staticFile(`audio/${PREMATCH_FIXTURE_ID}-timeline.json`))
      .then(
        (res) =>
          res.json() as Promise<{
            timeline: PrematchTimelineEntry[];
            prediction: PredictionCard | null;
            matchInfo: PrematchInfo | null;
          }>,
      )
      .then((data) => {
        if (cancelled) return;
        setTimeline(data.timeline);
        setPrediction(data.prediction ?? null);
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
        fixtureId={PREMATCH_FIXTURE_ID}
        // BallsyCam's own overlay slot ("above everything except captions")
        // — the cover card as usual, plus this video type's prediction
        // beat, which has to sit ON TOP of a fullscreen Ballsy rather than
        // in the content region below him. Using the existing render-prop
        // contract rather than forking BallsyCam, which stays content-
        // agnostic and shared verbatim by all three compositions.
        coverCard={
          <>
            {matchInfo && (
              <Sequence durationInFrames={75} layout="none">
                {/* Reused verbatim from the match composition — its props
                    (competition, logo, round, date) are exactly a fixture's
                    identity, with nothing score- or event-specific in them. */}
                <CoverCard
                  tournament={matchInfo.tournament}
                  tournamentLogo={matchInfo.tournamentLogo}
                  round={matchInfo.round}
                  date={matchInfo.date}
                />
              </Sequence>
            )}
            {prediction && (
              <Sequence
                from={Math.round(prediction.startTime * fps)}
                durationInFrames={Math.round(prediction.durationSeconds * fps)}
                layout="none"
              >
                <div
                  style={{
                    position: 'absolute',
                    top: PREDICTION_OVERLAY_TOP,
                    left: 0,
                    width: '100%',
                    height: PREDICTION_OVERLAY_HEIGHT,
                  }}
                >
                  <PredictionGraphic {...prediction.props} />
                </div>
              </Sequence>
            )}
          </>
        }
      >
        {({camHeight, contentHeight, contentSafeHeight, contentOpacity}) => (
          // Same two-layer treatment as the match pitch and the player
          // stat-cards: the background fills all the way to the true bottom
          // edge, preview cards render in a shorter inner layer clear of the
          // YouTube Shorts/TikTok UI reserve.
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
                  {renderPreviewCard(entry)}
                </Sequence>
              ))}
            </div>
          </div>
        )}
      </BallsyCam>
    </AbsoluteFill>
  );
};
