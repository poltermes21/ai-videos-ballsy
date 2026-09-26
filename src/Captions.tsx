import React, {useMemo} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {createTikTokStyleCaptions} from '@remotion/captions';
import type {Caption, TikTokPage} from '@remotion/captions';
import {COLORS} from './graphics/shared';
import {captionFontFamily} from './fonts';

// How often the on-screen caption group switches (ms). Lower = closer to
// word-by-word; higher = more words visible at once.
const SWITCH_CAPTIONS_EVERY_MS = 1200;

const CaptionPage: React.FC<{page: TikTokPage; bottomFraction: number}> = ({page, bottomFraction}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Sequence-relative frame -> absolute ms, to compare against each token's
  // absolute fromMs/toMs and know which word is currently being spoken.
  const currentTimeMs = (frame / fps) * 1000;
  const absoluteTimeMs = page.startMs + currentTimeMs;

  return (
    // Bottom-anchored (not top-anchored) at the live cam/pitch boundary
    // (bottomFraction, computed per-frame in ballsy.tsx) so the box grows
    // UPWARD from that line — staying inside the cam, right below Ballsy,
    // instead of hanging down into the pitch where it can cover a graphic's
    // own title pill (e.g. the "PENALTY" tag). Just below Ballsy once the
    // cam goes fullscreen too, always clear of the YouTube Shorts/TikTok UI
    // reserved at the very bottom of the frame.
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: `${bottomFraction * 100}%`,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '90%',
          textAlign: 'center',
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 20,
          padding: '14px 30px',
          fontFamily: captionFontFamily,
          fontSize: 54,
          lineHeight: 1.25,
          letterSpacing: 0.5,
          color: 'white',
          WebkitTextStroke: '2px black',
          whiteSpace: 'pre-wrap',
        }}
      >
        {page.tokens.map((token) => {
          const isActive = token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
          return (
            <span key={token.fromMs} style={{color: isActive ? COLORS.yellow : 'white'}}>
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const Captions: React.FC<{captions: Caption[]; bottomFraction: number}> = ({captions, bottomFraction}) => {
  const {fps} = useVideoConfig();

  const {pages} = useMemo(
    () => createTikTokStyleCaptions({captions, combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS}),
    [captions],
  );

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        const endFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * fps : Infinity,
          startFrame + (SWITCH_CAPTIONS_EVERY_MS / 1000) * fps,
        );
        const durationInFrames = Math.round(endFrame - startFrame);
        if (durationInFrames <= 0) {
          return null;
        }

        return (
          <Sequence key={index} from={Math.round(startFrame)} durationInFrames={durationInFrames}>
            <CaptionPage page={page} bottomFraction={bottomFraction} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
