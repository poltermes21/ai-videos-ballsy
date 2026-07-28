import React from 'react';
import {Easing, interpolate} from 'remotion';

// Shared cartoon style tokens so every event graphic reads as one system:
// bold Arial-Black text, thick black outlines, chunky drop shadow.
export const COLORS = {
  red: '#FF3B3B',
  green: '#22C55E',
  yellow: '#FFD23F',
  gray: '#6B7280',
  cyan: '#38BDF8',
};

// Colored result banner (e.g. "GOAL!", "SAVED!") — matches the goal graphic.
export const Banner: React.FC<{
  text: string;
  color: string;
  textColor?: string;
  fontSize?: number;
}> = ({text, color, textColor = 'white', fontSize = 62}) => (
  <div
    style={{
      background: color,
      padding: '10px 46px',
      boxShadow: '0 8px 0 rgba(0,0,0,0.25)',
      border: '4px solid black',
    }}
  >
    <span
      style={{
        fontFamily: '"Arial Black", sans-serif',
        fontWeight: 900,
        fontSize,
        color: textColor,
        letterSpacing: 3,
        WebkitTextStroke: '2px black',
      }}
    >
      {text}
    </span>
  </div>
);

// Team scoreboard pill, shared by every graphic that shows or updates the
// score (Goal, Penalty-scored, ...). Pass `tickStart` (the frame the new
// score becomes true) to animate a punch-in tick on the scoring side's
// number; omit it to render the score statically with no animation.
export const Scoreboard: React.FC<{
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  scoringTeam?: 'home' | 'away';
  frame: number;
  tickStart?: number;
}> = ({homeTeam, awayTeam, homeScore, awayScore, scoringTeam, frame, tickStart}) => {
  const showNewScore = tickStart == null || frame >= tickStart;
  const previousHomeScore = scoringTeam === 'home' && tickStart != null ? homeScore - 1 : homeScore;
  const previousAwayScore = scoringTeam === 'away' && tickStart != null ? awayScore - 1 : awayScore;

  const tickScale = (side: 'home' | 'away') =>
    tickStart != null && scoringTeam === side
      ? interpolate(frame, [tickStart, tickStart + 6, tickStart + 12], [1, 1.5, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.spring({damping: 8}),
        })
      : 1;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '14px 32px',
        borderRadius: 999,
        background: 'black',
        border: '3px solid white',
        color: 'white',
        fontFamily: '"Arial Black", sans-serif',
        fontSize: 34,
      }}
    >
      <span>{homeTeam}</span>
      <span
        style={{
          display: 'inline-block',
          minWidth: 32,
          textAlign: 'center',
          color: COLORS.yellow,
          scale: tickScale('home'),
        }}
      >
        {showNewScore ? homeScore : previousHomeScore}
      </span>
      <span style={{opacity: 0.6}}>-</span>
      <span
        style={{
          display: 'inline-block',
          minWidth: 32,
          textAlign: 'center',
          color: COLORS.yellow,
          scale: tickScale('away'),
        }}
      >
        {showNewScore ? awayScore : previousAwayScore}
      </span>
      <span>{awayTeam}</span>
    </div>
  );
};

// Black rounded pill used for section titles ("PENALTY", "SUBSTITUTION", ...).
export const TitlePill: React.FC<{text: string; fontSize?: number}> = ({
  text,
  fontSize = 46,
}) => (
  <div
    style={{
      background: 'black',
      border: '4px solid white',
      borderRadius: 999,
      padding: '10px 40px',
      color: 'white',
      fontFamily: '"Arial Black", sans-serif',
      fontSize,
      letterSpacing: 4,
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </div>
);
