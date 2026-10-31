import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

/**
 * Re-check I (31 Oct): at font 2.0 on a 360 dp phone the Chat tab's unread badge cut its number —
 * only the top half of "2" showed — while the bell's was fine. React Navigation's own tab badge grows
 * with the font in a fixed 18 dp circle; the bell's (IconButton) caps its number at 1.3×. Both are
 * now one badge: the number capped at 1.3×, the badge at least 18 dp and growing to fit it.
 */
it('one count badge: its number capped at 1.3× the font, the badge at least 18 dp tall', () => {
  const badge = src('components/ui/CountBadge.tsx');
  expect(badge).toMatch(/export const COUNT_BADGE_FONT_CAP = 1\.3;/);
  expect(badge).toMatch(/maxFontSizeMultiplier=\{COUNT_BADGE_FONT_CAP\}/);
  expect(badge).toMatch(/minHeight: 18,/);
  expect(badge).not.toMatch(/\bheight: 18/);
  expect(badge).toMatch(/importantForAccessibility="no-hide-descendants"/);
});

it('the bell and the Chat tab both use it; the tab no longer uses React Navigation’s badge', () => {
  expect(src('components/ui/IconButton.tsx')).toMatch(/<CountBadge value=\{badge\}/);
  const nav = src('navigation/RootNavigator.tsx');
  expect(nav).not.toMatch(/tabBarBadge/);
  expect(nav).toMatch(/<CountBadge value=\{chatBadge\}/);
  expect(nav).toMatch(/tabBarAccessibilityLabel: chatTabLabel\(unread\)/); // TalkBack still hears the count
});
