import React from 'react';
import {Easing, Img, interpolate, staticFile} from 'remotion';
import {displayFontFamily} from '../fonts';

// One fixed spot for the score pill on every event that actually changes the
// score (goal, penalty-goal, ...) — same position regardless of which
// graphic is showing, so nothing needs retuning per event type.
export const SCORE_PILL_BOTTOM = '2%';

// Shared cartoon style tokens so every event graphic reads as one system:
// bold comic-display text, thick black outlines, chunky drop shadow.
export const COLORS = {
  red: '#FF3B3B',
  green: '#22C55E',
  yellow: '#FFD23F',
  gray: '#6B7280',
  cyan: '#38BDF8',
};

// A team's real primary colour can be white or near-white (plenty of kits
// are) — fine as a badge ring, but a solid banner fill in that colour would
// make the white banner text unreadable. Perceived-luminance check so a
// caller can fall back to something with real contrast instead.
export function isLightColor(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return false;
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Standard perceived-luminance weighting; >0.7 reads as "too light for
  // white text on top" in practice for this show's font weight/size.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.7;
}

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
        fontFamily: displayFontFamily,
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

// A team's mark in the scoreboard: its real badge on a colour swatch (own
// kit colour, from SofaScore) when we have one, the 3-letter code otherwise.
// Never both at once — the badge already identifies the team.
// Exported for GoalDisallowedGraphic, which needs the badge but has its own
// two-phase (tick up, then revert) score animation that Scoreboard's
// single-transition `tickStart` can't express — everything else reuses the
// full Scoreboard component instead of this piece directly.
export const TeamMark: React.FC<{code: string; badge?: string | null; color?: string | null}> = ({
  code,
  badge,
  color,
}) =>
  badge ? (
    <div
      style={{
        width: 76,
        height: 76,
        borderRadius: '50%',
        background: color || 'white',
        border: '3px solid white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <Img src={staticFile(badge)} style={{width: 54, height: 54, objectFit: 'contain'}} />
    </div>
  ) : (
    // No badge on file (e.g. a fixture resolved before ensureTeamBadge ran) —
    // same circle footprint as the badge case, so callers never need to know
    // which branch rendered, with the code itself standing in for the crest.
    <div
      style={{
        width: 76,
        height: 76,
        borderRadius: '50%',
        background: color || COLORS.gray,
        border: '3px solid white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: displayFontFamily,
          fontSize: 22,
          letterSpacing: 1,
          color: isLightColor(color) ? 'black' : 'white',
          WebkitTextStroke: isLightColor(color) ? 'none' : '1px black',
        }}
      >
        {code}
      </span>
    </div>
  );

// Team scoreboard pill, shared by every graphic that shows or updates the
// score (Goal, Penalty-scored, ...). Pass `tickStart` (the frame the new
// score becomes true) to animate a punch-in tick on the scoring side's
// number; omit it to render the score statically with no animation.
// `homeBadge`/`awayBadge`/`homeColor`/`awayColor` are optional — a script
// generated before real badges existed just falls back to the text codes.
export const Scoreboard: React.FC<{
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  scoringTeam?: 'home' | 'away';
  frame: number;
  tickStart?: number;
  homeBadge?: string | null;
  awayBadge?: string | null;
  homeColor?: string | null;
  awayColor?: string | null;
}> = ({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  scoringTeam,
  frame,
  tickStart,
  homeBadge,
  awayBadge,
  homeColor,
  awayColor,
}) => {
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
        gap: 26,
        padding: '20px 42px',
        borderRadius: 999,
        background: 'black',
        border: '4px solid white',
        color: 'white',
        fontFamily: displayFontFamily,
        fontSize: 48,
      }}
    >
      <TeamMark code={homeTeam} badge={homeBadge} color={homeColor} />
      <span
        style={{
          display: 'inline-block',
          minWidth: 40,
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
          minWidth: 40,
          textAlign: 'center',
          color: COLORS.yellow,
          scale: tickScale('away'),
        }}
      >
        {showNewScore ? awayScore : previousAwayScore}
      </span>
      <TeamMark code={awayTeam} badge={awayBadge} color={awayColor} />
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
      fontFamily: displayFontFamily,
      fontSize,
      letterSpacing: 4,
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </div>
);
