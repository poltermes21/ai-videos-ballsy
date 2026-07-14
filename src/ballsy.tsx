import React, {useEffect, useRef, useState} from 'react';
import {
  AbsoluteFill,
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
};

const VISEME_INPUT_NAME = 'viseme';

// Dummy cycle to prove the Rive state machine can be driven per-frame from
// Remotion, before wiring real Rhubarb output (see project_summary.MD step 5).
const dummyVisemeForFrame = (frame: number) => Math.floor(frame / 5) % 9;

export const Ballsy: React.FC = () => {
  const frame = useCurrentFrame();
  const {width, height, fps} = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handle] = useState(() => delayRender('Loading ballsy.riv'));
  const loadedRef = useRef<LoadedRive | null>(null);
  const lastFrameRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [displayedViseme, setDisplayedViseme] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    Rive({
      locateFile: () => 'https://unpkg.com/@rive-app/canvas-advanced@2.31.5/rive.wasm',
    }).then(async (riveCanvas) => {
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
      for (let i = 0; i < stateMachine.inputCount(); i++) {
        const input = stateMachine.input(i);
        if (input.name === VISEME_INPUT_NAME) {
          // The generic SMIInput wrapper's `.value` setter is a no-op until
          // downcast to the concrete typed accessor.
          visemeInput = input.asNumber();
        }
      }

      if (!visemeInput) {
        throw new Error(
          `No "${VISEME_INPUT_NAME}" input found on the state machine. ` +
            'Check the input name in the Rive editor.',
        );
      }

      if (cancelled) {
        return;
      }

      loadedRef.current = {riveCanvas, artboard, stateMachine, visemeInput};
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

    const {riveCanvas, artboard, stateMachine, visemeInput} = loadedRef.current;

    if (canvasRef.current.width !== width || canvasRef.current.height !== height) {
      canvasRef.current.width = width;
      canvasRef.current.height = height;
    }

    const targetViseme = dummyVisemeForFrame(frame);
    visemeInput.value = targetViseme;
    setDisplayedViseme(targetViseme);

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
      <canvas ref={canvasRef} width={width} height={height} />
      {/* TEMP debug overlay for step 5 — remove once viseme wiring is confirmed */}
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
        frame {frame} → viseme {displayedViseme ?? '-'}
      </div>
    </AbsoluteFill>
  );
};
