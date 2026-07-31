// Properly loaded webfonts (not raw CSS font-family strings) so text renders
// identically regardless of what's installed on the host machine, and so
// Chrome doesn't have to faux-bold a substitute font (the likely cause of
// the fuzzy edges seen with "Arial Black" as a bare string).
import {loadFont as loadDisplayFont} from '@remotion/google-fonts/LuckiestGuy';
import {loadFont as loadCaptionFont} from '@remotion/google-fonts/Anton';

// Comic/cartoon display face for graphic banners, pills and scoreboards —
// matches Ballsy's mascot personality.
export const {fontFamily: displayFontFamily} = loadDisplayFont('normal', {
  subsets: ['latin'],
});

// Bold condensed face for captions — chosen separately from the display
// font because captions cycle fast and need to stay legible at speed.
export const {fontFamily: captionFontFamily} = loadCaptionFont('normal', {
  weights: ['400'],
  subsets: ['latin'],
});
