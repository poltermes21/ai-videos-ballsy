import {createContext, useContext} from 'react';
import {useVideoConfig} from 'remotion';

// The pixel size a graphic should treat as "the whole canvas" for its own
// fraction-of-width/height math. Ballsy's cam now confines the pitch
// (Background + event graphics) to a region smaller than the full
// composition — PenaltyGraphic/ClearChanceGraphic/Background are the only
// ones that read useVideoConfig() directly for pixel math (everything else
// positions by CSS %, which already resolves against whatever box actually
// contains it, no changes needed there).
const PitchSizeContext = createContext<{width: number; height: number} | null>(null);

export const PitchSizeProvider = PitchSizeContext.Provider;

// Falls back to the real composition size when no Provider is present —
// keeps the standalone *GraphicTest compositions in Root.tsx (which render
// these graphics directly, no pitch wrapper) working unchanged.
export function usePitchSize(): {width: number; height: number} {
  const pitchSize = useContext(PitchSizeContext);
  const {width, height} = useVideoConfig();
  return pitchSize ?? {width, height};
}
