import { it, expect } from 'vitest';
import { TAB_ITEMS, TAB_LABEL_MAX_SCALE, TAB_LABEL_SIZE } from './tabs';
import { textWidthEm } from '../lib/font-metrics';
import { appSource as src } from '../testing/web-source';

/** The room a tab label has: a fifth of a 360 dp phone, less 2 dp on each side. */
const ROOM = 360 / TAB_ITEMS.length - 4;
const fitsAt = (scale: number) => TAB_ITEMS.every((t) => textWidthEm(t.title) * TAB_LABEL_SIZE * scale <= ROOM);

// Review Focus 4: the largest font size on a 360 dp phone cuts no tab label.
it('every tab label fits a fifth of a 360 dp screen at the largest font scale it allows', () => {
  for (const t of TAB_ITEMS) expect(textWidthEm(t.title) * TAB_LABEL_SIZE * TAB_LABEL_MAX_SCALE, t.title).toBeLessThanOrEqual(ROOM);
});

it('the cap is the largest of 1.3, 1.2, 1.15, 1.1 at which they all fit', () => {
  expect(TAB_LABEL_SIZE).toBe(11);
  expect(TAB_LABEL_MAX_SCALE).toBe([1.3, 1.2, 1.15, 1.1].find(fitsAt));
});

it('the tab label caps its font scale and stays on one line', () => expect(src('navigation/RootNavigator.tsx')).toMatch(/maxFontSizeMultiplier=\{TAB_LABEL_MAX_SCALE\}[^]*?numberOfLines=\{1\}/));
