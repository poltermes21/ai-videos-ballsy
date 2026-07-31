import React, {useMemo} from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {createTikTokStyleCaptions} from '@remotion/captions';
import type {Caption, TikTokPage} from '@remotion/captions';
import {COLORS} from './graphics/shared';
import {captionFontFamily} from './fonts';

// How often the on-screen caption group switches (ms). Lower = closer to
// word-by-word; higher = more words visible at once.
const SWITCH_CAPTIONS_EVERY_MS = 1200;

const CaptionPage: React.FC<{page: TikTokPage}> = ({page}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  // Sequence-relative frame -> absolute ms, to compare against each token's
  // absolute fromMs/toMs and know which word is currently being spoken.
  const currentTimeMs = (frame / fps) * 1000;
  const absoluteTimeMs = page.startMs + currentTimeMs;

  return (
    <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '4%'}}>
      <div
        style={{
          maxWidth: '86%',
          textAlign: 'center',
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 16,
          padding: '10px 26px',
          fontFamily: captionFontFamily,
          fontSize: 40,
          lineHeight: 1.25,
          letterSpacing: 0.5,
          color: 'white',
          WebkitTextStroke: '1.5px black',
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
    </AbsoluteFill>
  );
};

export const Captions: React.FC<{captions: Caption[]}> = ({captions}) => {
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
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
