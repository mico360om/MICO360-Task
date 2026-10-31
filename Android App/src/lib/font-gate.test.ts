import { it, expect } from 'vitest';
import { FONT_WAIT_MS, fontGate } from './font-gate';

// Final review L4: the app waits for the brand fonts at most 3 s, then starts on the phone's fonts.
it('waits for the fonts, then the brand faces; an error or 3 s without them starts on the phone’s fonts', () => {
  expect(FONT_WAIT_MS).toBe(3000);
  expect(fontGate('wait', { loaded: false, error: false, timedOut: false })).toBe('wait');
  expect(fontGate('wait', { loaded: true, error: false, timedOut: false })).toBe('brand');
  expect(fontGate('wait', { loaded: false, error: true, timedOut: false })).toBe('system');
  expect(fontGate('wait', { loaded: false, error: false, timedOut: true })).toBe('system');
  expect(fontGate('wait', { loaded: true, error: false, timedOut: true })).toBe('brand'); // loaded in time wins
});

it('keeps its first answer: fonts that arrive after the app started on system fonts change nothing', () => {
  expect(fontGate('system', { loaded: true, error: false, timedOut: true })).toBe('system');
  expect(fontGate('brand', { loaded: true, error: true, timedOut: true })).toBe('brand');
});
