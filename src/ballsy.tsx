import React, {useEffect, useRef, useState} from 'react';
import {
  AbsoluteFill,
  Audio,
  continueRender,
  delayRender,
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

const VISEME_INPUT_NAME = 'viseme';
const EXPRESSION_INPUT_NAME = 'expression';

// Dummy test cycle for step 7 — cycles through the 5 expressions on a fixed
// timer, independent of any real script data (that comes in step 8).
const EXPRESSION_NAMES = [
  'neutral',
  'excited',
  'angry',
  'disappointed',
  'surprised',
];
const FRAMES_PER_EXPRESSION = 24;

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

export const Ballsy: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() =>
    delayRender('Loading ballsy.riv + lip-sync data'),
  );
  const loadedRef = useRef<LoadedRive | null>(null);
  const mouthCuesRef = useRef<MouthCue[]>([]);
  const lastFrameRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    letter: string;
    index: number;
    expressionIndex: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      Rive({
        locateFile: () =>
          'https://unpkg.com/@rive-app/canvas-advanced@2.31.5/rive.wasm',
      }),
      fetch(staticFile('audio/test-phrase.json')).then(
        (res) => res.json() as Promise<{mouthCues: MouthCue[]}>,
      ),
    ]).then(async ([riveCanvas, lipSyncData]) => {
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
    const {index, letter} = findViseme(mouthCuesRef.current, timeSeconds);
    visemeInput.value = index;

    const expressionIndex =
      Math.floor(frame / FRAMES_PER_EXPRESSION) % EXPRESSION_NAMES.length;
    expressionInput.value = expressionIndex;

    setDebugInfo({letter, index, expressionIndex});

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

  return (
    <AbsoluteFill>
      <Audio src={staticFile('audio/test-phrase.mp3')} />
      <canvas ref={canvasRef} width={width} height={height} />
      {/* TEMP debug overlay for step 6 — remove once lip-sync wiring is confirmed */}
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
        {debugInfo?.letter ?? '-'} → viseme {debugInfo?.index ?? '-'} | expression{' '}
        {EXPRESSION_NAMES[debugInfo?.expressionIndex ?? 0]} (
        {debugInfo?.expressionIndex ?? '-'})
      </div>
    </AbsoluteFill>
  );
};

const timeSecondsLabel = (frame: number, fps: number) => (frame / fps).toFixed(2);
