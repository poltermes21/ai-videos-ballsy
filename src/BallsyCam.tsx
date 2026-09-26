import React, {useEffect, useRef, useState} from 'react';
import {
  Audio,
  continueRender,
  delayRender,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import Rive from '@rive-app/canvas-advanced';
import type {
  Artboard,
  RiveCanvas,
  SMIInput,
  StateMachineInstance,
  WrappedRenderer,
} from '@rive-app/canvas-advanced';
import type {Caption} from '@remotion/captions';
import {Captions} from './Captions';

// Ballsy's "cam" — the Rive avatar, its lip-sync/expression drive, the
// fullscreen-vs-split cam-height mechanic, and captions. Fully content-
// agnostic (never looks at match or player data), shared by both the match
// composition (src/ballsy.tsx) and the player composition
// (src/ballsyPlayer.tsx) so this logic lives in exactly one place instead of
// two copies drifting apart. The content region below the cam (match pitch
// or player stat-cards) is the caller's job — see the `children` render
// prop, which receives the cam's live geometry so that region can lay
// itself out consistently (same Shorts/TikTok safe-zone treatment either
// way).

type LoadedRive = {
  riveCanvas: RiveCanvas;
  artboard: Artboard;
  stateMachine: StateMachineInstance;
  visemeInput: SMIInput;
  expressionInput: SMIInput;
  renderer: WrappedRenderer;
};

type MouthCue = {start: number; end: number; value: string};
type ExpressionCue = {start: number; end: number; expression: string};
type CamKeyframe = {time: number; camHeightFraction: number};

export type CamGeometry = {
  camHeight: number;
  /** Full remaining height below the cam — the background/texture layer. */
  contentHeight: number;
  /** contentHeight minus the YouTube Shorts/TikTok UI reserve — graphics
   * (anything not just a full-bleed background) must stay within this. */
  contentSafeHeight: number;
  /** Fades 1 -> 0 as the cam goes fullscreen, so the content region can
   * fade out instead of jump-cutting the instant it's fully covered. */
  contentOpacity: number;
};

// Must match NORMAL_CAM_FRACTION in scripts/generate-avatar-timeline.mjs —
// the fallback used for the instant before that file's data has loaded.
const NORMAL_CAM_FRACTION = 0.42;
const CAM_BACKGROUND_IMAGE = 'setup.jpg';
export const ROOT_BACKGROUND = '#0d0f14';
// YouTube Shorts / TikTok draw their own UI over roughly the bottom fifth of
// the frame — confirmed against a real published Short. Content stays clear
// of it (contentSafeHeight); the background texture itself still reaches
// the true bottom edge underneath, so there's no visible dead space.
const SAFE_BOTTOM_FRACTION = 0.2;

// Opening beat (retention hook): a big, exaggerated zoom-forward-then-back-
// then-settle bounce on Ballsy himself, with a bounce sound — the classic
// "stinger" a short-form video opens on to stop a scroll. INTRO_BOUNCE_FRAMES
// matches public/bounce-sound.mp3's real length (1.776s) so the sound and
// the bounce always land together.
const INTRO_BOUNCE_FRAMES = 53;
const BOUNCE_SOUND_FILE = 'bounce-sound.mp3';
// The source clip peaks at -8.2dB — Remotion mixes audio server-side (not
// through the browser's capped-at-1.0 <audio> element), so this gain is a
// real amplification, landing just under 0dB instead of clipping.
const BOUNCE_SOUND_VOLUME = 2.5;

// Retention nudge shown once, at this fraction of WHATEVER length this video
// ends up being (durationInFrames varies per video) — never a fixed frame
// number.
const SUBSCRIBE_IMAGE = 'subscribe-button.webp';
const SUBSCRIBE_AT_FRACTION = 0.33;
const SUBSCRIBE_DURATION_SECONDS = 4.5;

const VISEME_INPUT_NAME = 'viseme';
const EXPRESSION_INPUT_NAME = 'expression';

const EXPRESSION_NAMES = ['neutral', 'excited', 'angry', 'disappointed', 'surprised'];
const EXPRESSION_TO_INDEX: Record<string, number> = Object.fromEntries(
  EXPRESSION_NAMES.map((name, index) => [name, index]),
);

// Rhubarb's Preston Blair shapes (A-H, X for silence) mapped to Ballsy's
// 9 viseme timelines (see project_summary.MD step 6).
const RHUBARB_TO_VISEME: Record<string, number> = {
  X: 0, // rest / silence
  D: 1, // AI — wide open
  C: 2, // E — open (EH/AE)
  E: 3, // O — rounded open (AO/ER)
  F: 4, // U — puckered (UW/OW/W)
  A: 5, // MBP — closed
  G: 6, // FV — teeth on lip
  H: 7, // L — tongue up
  B: 8, // etc — other consonants
};

const findViseme = (mouthCues: MouthCue[], timeSeconds: number): {index: number} => {
  for (const cue of mouthCues) {
    if (timeSeconds >= cue.start && timeSeconds < cue.end) {
      return {index: RHUBARB_TO_VISEME[cue.value] ?? 0};
    }
  }
  return {index: 0};
};

const findExpression = (expressionCues: ExpressionCue[], timeSeconds: number): {index: number} => {
  for (const cue of expressionCues) {
    if (timeSeconds >= cue.start && timeSeconds < cue.end) {
      return {index: EXPRESSION_TO_INDEX[cue.expression] ?? 0};
    }
  }
  return {index: 0};
};

export const BallsyCam: React.FC<{
  fixtureId: string;
  /** An independent overlay (e.g. a cover card) — rendered above everything
   * except captions. */
  coverCard?: React.ReactNode;
  children: (geometry: CamGeometry) => React.ReactNode;
}> = ({fixtureId, coverCard, children}) => {
  const frame = useCurrentFrame();
  const {width, height, fps, durationInFrames} = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender('Loading ballsy.riv + lip-sync data'));
  const loadedRef = useRef<LoadedRive | null>(null);
  const mouthCuesRef = useRef<MouthCue[]>([]);
  const expressionCuesRef = useRef<ExpressionCue[]>([]);
  const lastFrameRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [camKeyframes, setCamKeyframes] = useState<CamKeyframe[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      Rive({
        locateFile: () => 'https://unpkg.com/@rive-app/canvas-advanced@2.31.5/rive.wasm',
      }),
      fetch(staticFile(`audio/${fixtureId}-visemes.json`)).then(
        (res) => res.json() as Promise<{mouthCues: MouthCue[]}>,
      ),
      fetch(staticFile(`audio/${fixtureId}-expressions.json`)).then(
        (res) => res.json() as Promise<{expressionCues: ExpressionCue[]}>,
      ),
      fetch(staticFile(`audio/${fixtureId}-avatar.json`)).then(
        (res) => res.json() as Promise<{keyframes: CamKeyframe[]}>,
      ),
      fetch(staticFile(`audio/${fixtureId}-captions.json`)).then(
        (res) => res.json() as Promise<{captions: Caption[]}>,
      ),
    ]).then(async ([riveCanvas, lipSyncData, expressionData, camData, captionsData]) => {
      const buffer = await fetch(staticFile('ballsy.riv')).then((res) => res.arrayBuffer());
      const file = await riveCanvas.load(new Uint8Array(buffer));
      const artboard = file.defaultArtboard();
      const stateMachine = new riveCanvas.StateMachineInstance(artboard.stateMachineByIndex(0), artboard);

      let visemeInput: SMIInput | null = null;
      let expressionInput: SMIInput | null = null;
      for (let i = 0; i < stateMachine.inputCount(); i++) {
        const input = stateMachine.input(i);
        if (input.name === VISEME_INPUT_NAME) {
          // The generic SMIInput wrapper's `.value` setter is a no-op until
          // downcast to the concrete typed accessor.
          visemeInput = input.asNumber();
        } else if (input.name === EXPRESSION_INPUT_NAME) {
          expressionInput = input.asNumber();
        }
      }

      if (!visemeInput) {
        throw new Error(`No "${VISEME_INPUT_NAME}" input found on the state machine. Check the input name in the Rive editor.`);
      }
      if (!expressionInput) {
        throw new Error(`No "${EXPRESSION_INPUT_NAME}" input found on the state machine. Check the input name in the Rive editor.`);
      }
      if (cancelled || !canvasRef.current) {
        return;
      }

      // Created once and reused every frame — never call makeRenderer() per
      // frame, it allocates a new renderer that's never deleted.
      const renderer = riveCanvas.makeRenderer(canvasRef.current);

      loadedRef.current = {riveCanvas, artboard, stateMachine, visemeInput, expressionInput, renderer};
      mouthCuesRef.current = lipSyncData.mouthCues;
      expressionCuesRef.current = expressionData.expressionCues;
      setCamKeyframes(camData.keyframes);
      setCaptions(captionsData.captions);
      setReady(true);
      continueRender(handle);
    });

    return () => {
      cancelled = true;
      loadedRef.current?.renderer.delete();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId]);

  const timeSeconds = frame / fps;
  const camTimes = camKeyframes.map((k) => k.time);
  const camFractionValues = camKeyframes.map((k) => k.camHeightFraction);
  const camHeightFraction =
    camTimes.length > 0
      ? interpolate(timeSeconds, camTimes, camFractionValues, {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.bezier(0.33, 1, 0.68, 1),
        })
      : NORMAL_CAM_FRACTION;
  const camHeight = Math.round(camHeightFraction * height);

  // A small idle wobble so the cam never reads as a static frame — not part
  // of any position/collision system, just a life-like idle in whatever box
  // currently exists.
  const bobX = Math.sin((timeSeconds * 2 * Math.PI) / 2.6) * 10;
  const bobY = Math.sin((timeSeconds * 2 * Math.PI) / 3.1 + 1) * 8;
  const bobScale = 1 + Math.sin((timeSeconds * 2 * Math.PI) / 4) * 0.02;

  // Opening bounce: a big, exaggerated zoom forward, snapping back past
  // neutral, forward again smaller, settling at rest — like a real ball
  // bouncing to a stop. Multiplies onto the idle bobScale rather than
  // replacing it, so this reads as one continuous motion instead of a
  // hand-off.
  const introBounceScale = interpolate(
    frame,
    [
      0,
      INTRO_BOUNCE_FRAMES * 0.15,
      INTRO_BOUNCE_FRAMES * 0.34,
      INTRO_BOUNCE_FRAMES * 0.53,
      INTRO_BOUNCE_FRAMES * 0.72,
      INTRO_BOUNCE_FRAMES,
    ],
    [1, 2.2, 0.75, 1.4, 0.9, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)},
  );

  // Subscribe nudge at this video's own SUBSCRIBE_AT_FRACTION point —
  // durationInFrames varies per video, never a fixed frame number.
  const subscribeAtFrame = Math.round(durationInFrames * SUBSCRIBE_AT_FRACTION);
  const subscribeDurationFrames = Math.round(fps * SUBSCRIBE_DURATION_SECONDS);
  const subscribeLocalFrame = frame - subscribeAtFrame;
  const subscribeVisible = subscribeLocalFrame >= 0 && subscribeLocalFrame < subscribeDurationFrames;
  // Two sequential beats, not simultaneous — a zoom pop-in (frames 0-14),
  // THEN a single spiral turn in place once the zoom has already settled
  // (frames 14-40). Spinning DURING the zoom (the old version) compressed
  // both into the same ~0.6s window and read as chaotic/glitchy, like the
  // animation firing twice; one clean beat after another reads as deliberate.
  const subscribeScale = interpolate(
    subscribeLocalFrame,
    [0, 7, 14, subscribeDurationFrames - 10, subscribeDurationFrames],
    [0.3, 1.2, 1, 1, 0.85],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)},
  );
  const subscribeOpacity = interpolate(
    subscribeLocalFrame,
    [0, 6, subscribeDurationFrames - 8, subscribeDurationFrames],
    [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  // Spiral-over-itself: stays put (0deg) through the zoom, then spins one
  // full turn in place once the zoom has landed.
  const subscribeRotate = interpolate(subscribeLocalFrame, [0, 14, 40], [0, 0, 360], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  useEffect(() => {
    if (!ready || !loadedRef.current || !canvasRef.current) {
      return;
    }

    const {riveCanvas, artboard, stateMachine, visemeInput, expressionInput, renderer} = loadedRef.current;

    if (canvasRef.current.width !== width || canvasRef.current.height !== camHeight) {
      canvasRef.current.width = width;
      canvasRef.current.height = camHeight;
    }

    const {index: visemeIndex} = findViseme(mouthCuesRef.current, timeSeconds);
    visemeInput.value = visemeIndex;

    const {index: expressionIndex} = findExpression(expressionCuesRef.current, timeSeconds);
    expressionInput.value = expressionIndex;

    const diffSeconds = Math.max(frame - lastFrameRef.current, 0) / fps;
    stateMachine.advanceAndApply(diffSeconds);
    artboard.advance(diffSeconds);

    renderer.clear();
    renderer.save();
    renderer.align(
      riveCanvas.Fit.contain,
      riveCanvas.Alignment.center,
      {minX: 0, minY: 0, maxX: width, maxY: camHeight},
      artboard.bounds,
    );
    artboard.draw(renderer);
    renderer.restore();
    riveCanvas.resolveAnimationFrame();

    lastFrameRef.current = frame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, ready, width, camHeight, fps]);

  const contentOpacity = interpolate(camHeightFraction, [NORMAL_CAM_FRACTION, 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const contentHeight = Math.max(0, height - camHeight);
  const contentSafeHeight = Math.max(0, contentHeight - Math.round(height * SAFE_BOTTOM_FRACTION));
  // Captions sit just below Ballsy, growing UPWARD from the live cam/content
  // boundary instead of hanging down into the content region (where they
  // could cover a graphic's own title pill) — bottomFraction is measured
  // from the bottom of the frame, so it's the inverse of the boundary's
  // top-down fraction. Eases toward a fixed spot still just below Ballsy
  // once the cam goes fullscreen.
  const captionBottomFraction =
    1 -
    interpolate(camHeightFraction, [NORMAL_CAM_FRACTION, 1], [NORMAL_CAM_FRACTION, 0.7], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  return (
    <>
      <Audio src={staticFile(`audio/${fixtureId}.mp3`)} />
      <Audio src={staticFile(BOUNCE_SOUND_FILE)} volume={BOUNCE_SOUND_VOLUME} />

      {children({camHeight, contentHeight, contentSafeHeight, contentOpacity})}

      {/* Ballsy's cam — pinned to the top, bordered off from the content
          below. Height (camHeight) is the only thing that ever changes;
          Rive's own Fit.contain scales Ballsy to fill whatever that
          produces. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height: camHeight,
          borderBottom: '10px solid black',
          overflow: 'hidden',
        }}
      >
        <Img
          src={staticFile(CAM_BACKGROUND_IMAGE)}
          style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover'}}
        />
        {/* Darkens the illustrated room a touch so Ballsy's black outline and
            the scoreboard/text on top of it stay readable against it. */}
        <div style={{position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)'}} />
        <canvas
          ref={canvasRef}
          width={width}
          height={camHeight}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            translate: `${bobX}px ${bobY}px`,
            scale: bobScale * introBounceScale,
          }}
        />
      </div>

      {coverCard}

      {/* Subscribe nudge — once, at this video's own halfway point. The
          source image is a wide button on a solid WHITE canvas (not
          transparent); multiply blending makes white vanish against
          whatever's behind it and keeps only the red button/text, so no
          cropping or image edit was needed. */}
      {subscribeVisible && (
        <div
          style={{
            position: 'absolute',
            top: '0.5%',
            left: '1%',
            transformOrigin: 'top left',
            scale: subscribeScale,
            rotate: `${subscribeRotate}deg`,
            opacity: subscribeOpacity,
            width: '64%',
          }}
        >
          <Img
            src={staticFile(SUBSCRIBE_IMAGE)}
            style={{width: '100%', mixBlendMode: 'multiply'}}
          />
        </div>
      )}

      <Captions captions={captions} bottomFraction={captionBottomFraction} />
    </>
  );
};
