import React from 'react';
import {Easing, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, TitlePill} from './shared';
import {displayFontFamily} from '../fonts';

type SeasonStats = {
  rating?: number | null;
  goals?: number | null;
  assists?: number | null;
  appearances?: number | null;
  minutesPlayed?: number | null;
};

type SeasonTallyGraphicProps = {
  competition?: string | null;
  seasonStats: SeasonStats;
};

const Tile: React.FC<{label: string; value: string; index: number}> = ({label, value, index}) => {
  const frame = useCurrentFrame();
  const pop = interpolate(frame, [index * 5, index * 5 + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.spring({damping: 10}),
  });

  return (
    <div
      style={{
        scale: pop,
        background: 'black',
        border: '4px solid white',
        borderRadius: 20,
        padding: '18px 30px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 150,
      }}
    >
      <div style={{fontFamily: displayFontFamily, fontSize: 52, color: COLORS.yellow}}>{value}</div>
      <div style={{fontFamily: displayFontFamily, fontSize: 20, color: 'white', letterSpacing: 2}}>{label}</div>
    </div>
  );
};

export const SeasonTallyGraphic: React.FC<SeasonTallyGraphicProps> = ({competition, seasonStats}) => {
  const tiles: Array<{label: string; value: string}> = [];
  if (seasonStats.goals != null) tiles.push({label: 'GOALS', value: String(seasonStats.goals)});
  if (seasonStats.assists != null) tiles.push({label: 'ASSISTS', value: String(seasonStats.assists)});
  if (seasonStats.rating != null) tiles.push({label: 'RATING', value: seasonStats.rating.toFixed(1)});
  if (seasonStats.appearances != null) tiles.push({label: 'APPS', value: String(seasonStats.appearances)});

  return (
    <>
      <Interactive.Div name="Season title" style={{position: 'absolute', top: '7%', left: '50%', translate: '-50%'}}>
        <TitlePill text={competition ? `THIS SEASON — ${competition.toUpperCase()}` : 'THIS SEASON'} fontSize={34} />
      </Interactive.Div>
      <Interactive.Div
        name="Stat tiles"
        style={{
          position: 'absolute',
          top: '40%',
          left: '50%',
          translate: '-50%',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 20,
          // See RecentFormGraphic's identical fix: width:max-content instead
          // of a percentage maxWidth, so this left:50%/translate:-50% row
          // doesn't wrap early against half the real available width.
          width: 'max-content',
          maxWidth: 950,
          justifyContent: 'center',
        }}
      >
        {tiles.map((tile, i) => (
          <Tile key={tile.label} label={tile.label} value={tile.value} index={i} />
        ))}
      </Interactive.Div>
    </>
  );
};
