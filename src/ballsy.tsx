import React, {useEffect, useRef, useState} from 'react';
import {
  AbsoluteFill,
  Audio,
  continueRender,
  delayRender,
  Easing,
  interpolate,
  Sequence,
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
} from '@rive-app/canvas-advanced';
import {GoalGraphic} from './graphics/GoalGraphic';
import {GoalDisallowedGraphic} from './graphics/GoalDisallowedGraphic';
import {CardGraphic} from './graphics/CardGraphic';
import {PenaltyGraphic} from './graphics/PenaltyGraphic';
import {SubstitutionGraphic} from './graphics/SubstitutionGraphic';
import {ClearChanceGraphic} from './graphics/ClearChanceGraphic';
import {VarReviewGraphic} from './graphics/VarReviewGraphic';

type LoadedRive = {
  riveCanvas: RiveCanvas;
  artboard: Artboard;
  stateMachine: StateMachineInstance;
  visemeInput: SMIInput;
  expressionInput: SMIInput;
};

type MouthCue = {
  start: number;
  end: number;
  value: string;
};

type ExpressionCue = {
  start: number;
  end: number;
  expression: string;
};

type ScoreProps = {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  scoringTeam: 'home' | 'away';
};

// Discriminated union — one variant per event graphic. Shapes must match the
// props emitted by scripts/generate-graphics-timeline.mjs.
type GraphicsEntry = {startTime: number} & (
  | {type: 'goal'; props: ScoreProps}
  | {type: 'goalDisallowed'; props: ScoreProps}
  | {type: 'card'; props: {cardType: 'yellow' | 'red'; minute: number}}
  | {type: 'penalty'; props: {outcome: 'scored' | 'saved' | 'post' | 'out'}}
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

type AvatarKeyframe = {
  time: number;
  scale: number;
  x: number;
  y: number;
};

// Must match FLOAT_SCALE in scripts/generate-avatar-timeline.mjs.
const AVATAR_FLOAT_SCALE = 0.42;

const VISEME_INPUT_NAME = 'viseme';
const EXPRESSION_INPUT_NAME = 'expression';

// Test fixture until step 11 (frontend match selector) picks a real one.
// SofaScore event id (Eredivisie 25/26 — SC Telstar 2-2 Excelsior).
const FIXTURE_ID = '14053814';

const EXPRESSION_NAMES = [
  'neutral',
  'excited',
  'angry',
  'disappointed',
  'surprised',
];
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

const findViseme = (
  mouthCues: MouthCue[],
  timeSeconds: number,
): {index: number; letter: string} => {
  for (const cue of mouthCues) {
    if (timeSeconds >= cue.start && timeSeconds < cue.end) {
      return {index: RHUBARB_TO_VISEME[cue.value] ?? 0, letter: cue.value};
    }
  }
  return {index: 0, letter: 'X'};
};

const findExpression = (
  expressionCues: ExpressionCue[],
  timeSeconds: number,
): {index: number; name: string} => {
  for (const cue of expressionCues) {
    if (timeSeconds >= cue.start && timeSeconds < cue.end) {
      return {index: EXPRESSION_TO_INDEX[cue.expression] ?? 0, name: cue.expression};
    }
  }
  return {index: 0, name: 'neutral'};
};

export const Ballsy: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() =>
    delayRender('Loading ballsy.riv + lip-sync data'),
  );
  const loadedRef = useRef<LoadedRive | null>(null);
  const mouthCuesRef = useRef<MouthCue[]>([]);
  const expressionCuesRef = useRef<ExpressionCue[]>([]);
  const lastFrameRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [graphicsTimeline, setGraphicsTimeline] = useState<GraphicsEntry[]>([]);
  const [avatarKeyframes, setAvatarKeyframes] = useState<AvatarKeyframe[]>([]);
  const [debugInfo, setDebugInfo] = useState<{
    letter: string;
    visemeIndex: number;
    expressionName: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      Rive({
        locateFile: () =>
          'https://unpkg.com/@rive-app/canvas-advanced@2.31.5/rive.wasm',
      }),
      fetch(staticFile(`audio/${FIXTURE_ID}-visemes.json`)).then(
        (res) => res.json() as Promise<{mouthCues: MouthCue[]}>,
      ),
      fetch(staticFile(`audio/${FIXTURE_ID}-expressions.json`)).then(
        (res) => res.json() as Promise<{expressionCues: ExpressionCue[]}>,
      ),
      fetch(staticFile(`audio/${FIXTURE_ID}-graphics.json`)).then(
        (res) => res.json() as Promise<{graphicsTimeline: GraphicsEntry[]}>,
      ),
      fetch(staticFile(`audio/${FIXTURE_ID}-avatar.json`)).then(
        (res) => res.json() as Promise<{keyframes: AvatarKeyframe[]}>,
      ),
    ]).then(async ([riveCanvas, lipSyncData, expressionData, graphicsData, avatarData]) => {
      const buffer = await fetch(staticFile('ballsy.riv')).then((res) =>
        res.arrayBuffer(),
      );
      const file = await riveCanvas.load(new Uint8Array(buffer));
      const artboard = file.defaultArtboard();
      const stateMachine = new riveCanvas.StateMachineInstance(
        artboard.stateMachineByIndex(0),
        artboard,
      );

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
        throw new Error(
          `No "${VISEME_INPUT_NAME}" input found on the state machine. ` +
            'Check the input name in the Rive editor.',
        );
      }

      if (!expressionInput) {
        throw new Error(
          `No "${EXPRESSION_INPUT_NAME}" input found on the state machine. ` +
            'Check the input name in the Rive editor.',
        );
      }

      if (cancelled) {
        return;
      }

      loadedRef.current = {
        riveCanvas,
        artboard,
        stateMachine,
        visemeInput,
        expressionInput,
      };
      mouthCuesRef.current = lipSyncData.mouthCues;
      expressionCuesRef.current = expressionData.expressionCues;
      setGraphicsTimeline(graphicsData.graphicsTimeline);
      setAvatarKeyframes(avatarData.keyframes);
      setReady(true);
      continueRender(handle);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !loadedRef.current || !canvasRef.current) {
      return;
    }

    const {riveCanvas, artboard, stateMachine, visemeInput, expressionInput} =
      loadedRef.current;

    if (canvasRef.current.width !== width || canvasRef.current.height !== height) {
      canvasRef.current.width = width;
      canvasRef.current.height = height;
    }

    const timeSeconds = frame / fps;
    const {index: visemeIndex, letter} = findViseme(mouthCuesRef.current, timeSeconds);
    visemeInput.value = visemeIndex;

    const {index: expressionIndex, name: expressionName} = findExpression(
      expressionCuesRef.current,
      timeSeconds,
    );
    expressionInput.value = expressionIndex;

    setDebugInfo({letter, visemeIndex, expressionName});

    const diffSeconds = Math.max(frame - lastFrameRef.current, 0) / fps;
    stateMachine.advanceAndApply(diffSeconds);
    artboard.advance(diffSeconds);

    const renderer = riveCanvas.makeRenderer(canvasRef.current);
    renderer.clear();
    renderer.save();
    renderer.align(
      riveCanvas.Fit.contain,
      riveCanvas.Alignment.center,
      {minX: 0, minY: 0, maxX: width, maxY: height},
      artboard.bounds,
    );
    artboard.draw(renderer);
    renderer.restore();
    riveCanvas.resolveAnimationFrame();

    lastFrameRef.current = frame;
  }, [frame, ready, width, height, fps]);

  const timeSeconds = frame / fps;
  const avatarTimes = avatarKeyframes.map((k) => k.time);
  const avatarScaleValues = avatarKeyframes.map((k) => k.scale);
  const avatarXValues = avatarKeyframes.map((k) => k.x);
  const avatarYValues = avatarKeyframes.map((k) => k.y);

  const avatarEasing = Easing.bezier(0.33, 1, 0.68, 1);
  const baseScale =
    avatarTimes.length > 0
      ? interpolate(timeSeconds, avatarTimes, avatarScaleValues, {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: avatarEasing,
        })
      : 1;
  const baseX =
    avatarTimes.length > 0
      ? interpolate(timeSeconds, avatarTimes, avatarXValues, {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: avatarEasing,
        })
      : 0;
  const baseY =
    avatarTimes.length > 0
      ? interpolate(timeSeconds, avatarTimes, avatarYValues, {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: avatarEasing,
        })
      : 0;

  // Fades in/out with the scale transition, so the organic bob only shows up
  // while actually floating (not during the big & centered hook/outro).
  const floatingAmount = interpolate(baseScale, [AVATAR_FLOAT_SCALE, 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bobX = Math.sin((timeSeconds * 2 * Math.PI) / 2.6) * 14 * floatingAmount;
  const bobY = Math.sin((timeSeconds * 2 * Math.PI) / 3.1 + 1) * 10 * floatingAmount;
  const bobScale = Math.sin((timeSeconds * 2 * Math.PI) / 4) * 0.03 * floatingAmount;

  const avatarScale = baseScale + bobScale;
  const avatarX = baseX * width + bobX;
  const avatarY = baseY * height + bobY;

  return (
    <AbsoluteFill>
      <Audio src={staticFile(`audio/${FIXTURE_ID}.mp3`)} />
      <div
        style={{
          position: 'absolute',
          width,
          height,
          translate: `${avatarX}px ${avatarY}px`,
          scale: avatarScale,
        }}
      >
        <canvas ref={canvasRef} width={width} height={height} />
      </div>
      {graphicsTimeline.map((entry, i) => (
        <Sequence
          key={i}
          from={Math.round(entry.startTime * fps)}
          durationInFrames={GRAPHIC_DURATION[entry.type]}
        >
          {renderGraphic(entry)}
        </Sequence>
      ))}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '4px 8px',
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          fontFamily: 'monospace',
          fontSize: 20,
        }}
      >
        frame {frame} | t={timeSecondsLabel(frame, fps)}s | rhubarb=
        {debugInfo?.letter ?? '-'} viseme {debugInfo?.visemeIndex ?? '-'} | expression{' '}
        {debugInfo?.expressionName ?? '-'}
      </div>
    </AbsoluteFill>
  );
};

const timeSecondsLabel = (frame: number, fps: number) => (frame / fps).toFixed(2);
