import React from 'react';

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
