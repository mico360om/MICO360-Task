/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles each font file named by a require(). */
import { useEffect, useRef, useState } from 'react';
import { useFonts } from 'expo-font';
import type { FontFace } from '../lib/typography';
import { FONT_WAIT_MS, fontGate, type FontGate } from '../lib/font-gate';

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
 * Which fonts the app starts on (lib/font-gate): 'wait' while the brand fonts load (App shows the
 * splash), then 'brand' — or 'system' when they failed or took longer than FONT_WAIT_MS, so the app
 * still opens on the phone's own fonts. The first answer is kept.
 */
export function useBrandFonts(): FontGate {
  const [loaded, error] = useFonts(FONT_ASSETS);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), FONT_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const decided = useRef<FontGate>('wait');
  decided.current = fontGate(decided.current, { loaded, error: error != null, timedOut });
  return decided.current;
}
