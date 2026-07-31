import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

// Flat-cartoon football pitch — fills the "floating on blank white" gap
// without breaking the show's established look (bold flat shapes, black
// outlines, no photorealism). Deliberately muted/darker than COLORS.green
// (#22C55E) so "scored"/"goal" banners in that brighter green still pop
// against it instead of blending in.
const PITCH_GREEN = '#1E7A3E';
const STRIPE_GREEN = 'rgba(0,0,0,0.055)';
const LINE_COLOR = 'rgba(255,255,255,0.32)';
const STRIPE_WIDTH = 120; // px per mow stripe, in composition space (1080 wide)

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const t = frame / fps;

  // Slow one-way Ken Burns drift over the whole runtime, so the pitch never
  // reads as a static frame during the long stretches (hook/controversy/
  // result/outro) that have no event graphic on screen. Kept subtle enough
  // to stay in the background during busy key-moment sections too.
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const kenBurnsScale = 1 + progress * 0.05;
  const panX = Math.sin((t * 2 * Math.PI) / 26) * 16;
  const panY = Math.cos((t * 2 * Math.PI) / 34) * 12;

  // A soft floodlight sweep drifting slowly on its own independent loop.
  const sweepX = 50 + Math.sin((t * 2 * Math.PI) / 19) * 38;
  const sweepY = 50 + Math.cos((t * 2 * Math.PI) / 23) * 30;

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          background: PITCH_GREEN,
          scale: kenBurnsScale,
          translate: `${panX}px ${panY}px`,
        }}
      >
        {/* Mowed-stripe pattern */}
        <AbsoluteFill
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, transparent 0, transparent ${STRIPE_WIDTH}px, ${STRIPE_GREEN} ${STRIPE_WIDTH}px, ${STRIPE_GREEN} ${STRIPE_WIDTH * 2}px)`,
          }}
        />
        {/* Pitch markings: halfway line + centre circle, oversized/cropped
            like a tight zoom on the centre circle rather than a full pitch
            view. */}
        <svg width="100%" height="100%" viewBox="0 0 1080 1080" style={{position: 'absolute', inset: 0}}>
          <line x1={540} y1={0} x2={540} y2={1080} stroke={LINE_COLOR} strokeWidth={6} />
          <circle cx={540} cy={540} r={230} fill="none" stroke={LINE_COLOR} strokeWidth={6} />
          <circle cx={540} cy={540} r={10} fill={LINE_COLOR} />
        </svg>
      </AbsoluteFill>
      {/* Soft floodlight sweep — ambient motion so quiet stretches (no event
          graphic on screen) still feel alive instead of static. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${sweepX}% ${sweepY}%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 45%)`,
        }}
      />
      {/* Soft vignette so the edges recede and foreground content pops. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.28) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
