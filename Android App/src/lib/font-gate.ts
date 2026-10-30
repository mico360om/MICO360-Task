/**
 * Which fonts the app starts on (pure): the brand faces once they are loaded; the phone's own fonts
 * when loading them failed or took longer than FONT_WAIT_MS — a phone is never left on the splash.
 * The first answer is kept: fonts that arrive later don't restyle a running app.
 */
export type FontGate = 'wait' | 'brand' | 'system';

export const FONT_WAIT_MS = 3000;

export function fontGate(previous: FontGate, now: { loaded: boolean; error: boolean; timedOut: boolean }): FontGate {
  if (previous !== 'wait') return previous;
  if (now.loaded) return 'brand';
  if (now.error || now.timedOut) return 'system';
  return 'wait';
}
