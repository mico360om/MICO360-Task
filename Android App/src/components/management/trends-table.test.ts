import { it, expect } from 'vitest';
import { TREND_COLUMNS } from '../../lib/management';
import { textWidthEm } from '../../lib/font-metrics';
import { spacing } from '../../lib/theme';
import { appSource as src, hasWeb, readWeb } from '../../testing/web-source';

/**
 * Stage 3 final review P4: the weeks table's headers (the website's: small, upper case) stay whole
 * at 360 dp and the normal font size — none breaks in the middle of a word — and so do its values.
 * Measured with the app's Plex advances, in the table's real room.
 */
const eyebrow = (t: string) => textWidthEm(t.toUpperCase()) * 11 + [...t].length * 0.55; // typeStyle('eyebrow')
const value13 = (t: string) => textWidthEm(t) * 13; // the cells' 13 dp text

it('every header word and every value fits its column at 360 dp', () => {
  // 360 dp less the page's padding, the section card (border + padding), the table's border, the row's padding and the four gaps.
  const room = 360 - 2 * spacing.lg - 2 * 17 - 2 * 1 - 2 * spacing.sm - 4 * spacing.xs;
  const total = TREND_COLUMNS.reduce((n, col) => n + col.flex, 0);
  const width = (i: number) => (room * TREND_COLUMNS[i]!.flex) / total;
  const values: string[][] = [['11 Oct', '(this', 'week)', '28 Sep'], ['999'], ['999'], ['999'], ['100%', '—']];
  TREND_COLUMNS.forEach((col, i) => {
    for (const word of col.title.split(' ')) expect(eyebrow(word), `${col.title}: ${word}`).toBeLessThanOrEqual(width(i));
    for (const v of values[i]!) expect(value13(v), `${col.title}: ${v}`).toBeLessThanOrEqual(width(i));
  });
  expect(TREND_COLUMNS.map((c) => c.title)).toEqual(['Week of', 'Created', 'Completed', 'Late', 'Pass rate']);
  if (hasWeb('frontend/src/components/management/TrendsSection.tsx')) for (const c of TREND_COLUMNS) expect(readWeb('frontend/src/components/management/TrendsSection.tsx'), c.title).toContain(`>${c.title}</th>`);
});

it('the table is laid out as measured: the columns’ shares for headers and cells, the paddings and gaps', () => {
  const s = src('components/management/TrendsSection.tsx');
  expect(s).toMatch(/TREND_COLUMNS\.map\(/);
  expect(s).toMatch(/flex: TREND_COLUMNS\[\d\]!\.flex/);
  expect(s).toMatch(/tr: \{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing\.sm, gap: spacing\.xs \}/);
  expect(s).toMatch(/th: \{ \.\.\.typeStyle\('eyebrow'\)/);
  expect(s).toMatch(/td: \{ \.\.\.typeStyle\('number'\), fontSize: 13/);
  expect(src('screens/ManagementScreen.tsx')).toMatch(/scroll: \{ padding: spacing\.lg/);
  expect(src('components/ui/Card.tsx')).toMatch(/borderWidth: 1,[^]*padding: 16/);
});
