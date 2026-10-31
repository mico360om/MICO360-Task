import { it, expect } from 'vitest';
import { TAB_BAR_LABEL_GAP, TAB_ITEMS, TAB_LABEL_MAX_SCALE, TAB_LABEL_SIZE, tabBarFrame, tabLabelMaxScale, tabLabelRoom } from './tabs';
import { textWidthEm } from '../lib/font-metrics';
import { appSource as src } from '../testing/web-source';

const STEPS = [1.3, 1.2, 1.15, 1.1, 1];
/** The room a tab label has: a fifth of the screen, less 2 dp on each side. */
const room = (width: number) => width / TAB_ITEMS.length - 4;
const fitsAt = (width: number, scale: number) => TAB_ITEMS.every((t) => textWidthEm(t.title) * TAB_LABEL_SIZE * scale <= room(width));

// Review Focus 4: the largest font size on a 360 dp phone cuts no tab label.
it('every tab label fits a fifth of a 360 dp screen at the largest font scale it allows', () => {
  for (const t of TAB_ITEMS) expect(textWidthEm(t.title) * TAB_LABEL_SIZE * TAB_LABEL_MAX_SCALE, t.title).toBeLessThanOrEqual(room(360));
});

it('the cap is the largest of 1.3, 1.2, 1.15, 1.1, 1 at which they all fit', () => {
  expect(TAB_LABEL_SIZE).toBe(11);
  expect(tabLabelRoom(360)).toBe(room(360));
  expect(TAB_LABEL_MAX_SCALE).toBe(STEPS.find((s) => fitsAt(360, s)));
  expect(TAB_LABEL_MAX_SCALE).toBe(1.2);
});

// Final review L11: a larger Android "Display size" makes the screen 320 dp wide — the cap follows the width.
it('at 320 dp the cap drops to the step that still fits (1: Dashboard needs 54.9 of 60 dp)', () => {
  expect(tabLabelMaxScale(320)).toBe(STEPS.find((s) => fitsAt(320, s)));
  expect(tabLabelMaxScale(320)).toBe(1);
  for (const t of TAB_ITEMS) expect(textWidthEm(t.title) * TAB_LABEL_SIZE * tabLabelMaxScale(320), t.title).toBeLessThanOrEqual(room(320));
  expect(tabLabelMaxScale(360)).toBe(TAB_LABEL_MAX_SCALE);
  expect(tabLabelMaxScale(768)).toBe(1.3);
});

it('narrower still, the label shrinks to fit rather than being cut', () => {
  expect(fitsAt(280, 1)).toBe(false);
  expect(tabLabelMaxScale(280)).toBe(1);
  expect(src('navigation/RootNavigator.tsx')).toMatch(/numberOfLines=\{1\}\s*adjustsFontSizeToFit/);
});

it('the tab label caps its font scale by the window width and stays on one line', () => {
  const nav = src('navigation/RootNavigator.tsx');
  expect(nav).toMatch(/const labelScale = tabLabelMaxScale\(width\);/);
  expect(nav).toMatch(/maxFontSizeMultiplier=\{labelScale\}[^]*?numberOfLines=\{1\}/);
});

// Device check G (31 Oct): with no bottom inset (the phone's own navigation bar below the app) the
// labels sat on the tab bar's bottom edge — the "y" of "My Tasks" touched the system bar. The bar
// keeps a gap under its labels, or the phone's inset when that is larger, and grows by it.
it('the tab bar keeps a gap under its labels (the bottom inset when larger) and grows by it', () => {
  expect(TAB_BAR_LABEL_GAP).toBe(8);
  expect(tabBarFrame(0)).toEqual({ height: 49 + 8, paddingBottom: 8 });
  expect(tabBarFrame(5)).toEqual({ height: 49 + 8, paddingBottom: 8 });
  expect(tabBarFrame(24)).toEqual({ height: 49 + 24, paddingBottom: 24 });
  const nav = src('navigation/RootNavigator.tsx');
  expect(nav).toMatch(/tabBarStyle: \{ backgroundColor: colors\.surface, borderTopColor: colors\.line, borderTopWidth: 1, \.\.\.tabBarFrame\(insets\.bottom\) \}/);
  expect(nav).toMatch(/const insets = useSafeAreaInsets\(\);/);
});
