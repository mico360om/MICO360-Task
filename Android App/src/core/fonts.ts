/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles each font file named by a require(). */
import { useFonts } from 'expo-font';
import type { FontFace } from '../lib/typography';

/** The website's fonts, bundled with the app (assets/fonts, made by tools/fonts/convert-fonts.py). */
export const FONT_ASSETS: Record<FontFace, number> = {
  'IBMPlexSans-Regular': require('../../assets/fonts/IBMPlexSans-Regular.ttf'),
  'IBMPlexSans-Medium': require('../../assets/fonts/IBMPlexSans-Medium.ttf'),
  'IBMPlexSans-SemiBold': require('../../assets/fonts/IBMPlexSans-SemiBold.ttf'),
  'IBMPlexSans-Bold': require('../../assets/fonts/IBMPlexSans-Bold.ttf'),
  'Archivo-SemiBold': require('../../assets/fonts/Archivo-SemiBold.ttf'),
  'Archivo-Bold': require('../../assets/fonts/Archivo-Bold.ttf'),
  'Archivo-ExtraBold': require('../../assets/fonts/Archivo-ExtraBold.ttf'),
  'Archivo-Black': require('../../assets/fonts/Archivo-Black.ttf'),
};

/**
 * True once the fonts are loaded — or failed to load, so the app still opens (on the phone's own
 * font) rather than staying on the splash. Until then App renders nothing and the native splash
 * stays on screen.
 */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts(FONT_ASSETS);
  return loaded || error != null;
}
