import { PixelRatio } from 'react-native';
import { lineCap } from '../../lib/text-lines';

/**
 * `numberOfLines` for text cut after a few lines (lib/text-lines): `lines` at the phone's normal
 * font size, none when it is enlarged — Android would cut the "…" of an enlarged brand face. A
 * font-size change restarts the app's screen, so reading the scale while drawing is enough.
 */
export function capLines(lines: number): number | undefined {
  return lineCap(lines, PixelRatio.getFontScale());
}
