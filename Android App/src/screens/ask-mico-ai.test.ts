import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** Ask MICO AI from Search (Stage 3 Task 16), read from the screens' source. */
it('Search opens MICO AI with the question, and MICO AI asks it once, in a new chat', () => {
  expect(src('screens/SearchScreen.tsx')).toMatch(/kind === 'askMicoAi'[^]*navigate\('MicoAi', \{ ask: t\.text, askId: /);
  const s = src('screens/MicoAiScreen.tsx');
  expect(s).toMatch(/asked\.current === route\.params\?\.askId/); expect(s).toMatch(/setParams\(\{ ask: undefined, askId: undefined \}\)[^]*send\([^,]+, \{ newChat: true \}\)/);
});

it('each pick is its own question, and its row shows MICO AI’s icon', () => {
  const search = src('screens/SearchScreen.tsx');
  expect(search).toMatch(/askId: String\(Date\.now\(\)\)/);
  expect(search).toMatch(/item\.target\.kind === 'askMicoAi'\) return 'nav\.ai'/);
  // The question is taken off the screen's params before it is asked: going back to it asks nothing again.
  const s = src('screens/MicoAiScreen.tsx');
  expect(s).toMatch(/asked\.current = askId;\s+navigation\.setParams/);
});
