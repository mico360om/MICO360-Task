import { it, expect } from 'vitest';
import { inspectionFigures, managementTiles, trendRowLabel, trendTableRows } from '../lib/management';
import { OVERVIEW } from '../testing/management-fixtures';
import { appSource as src } from '../testing/web-source';

/**
 * Stage 3 final review P5: a "—" or "–" standing in for a figure is a look, not a word — TalkBack
 * says what it means: "loading" while the figures load, "none yet" for a pass rate with no
 * finished inspection, "no inspection finished" for such a week.
 */
const noRate = { ...OVERVIEW, tiles: { ...OVERVIEW.tiles, passRate: null }, inspections: { ...OVERVIEW.inspections, passRate: null } };

it('the Pass rate tile and figure say "none yet" for their "—"; a real rate is read as shown', () => {
  expect(managementTiles(noRate).find((t) => t.label === 'Pass rate')).toMatchObject({ value: '—', spokenValue: 'none yet' });
  expect(managementTiles({ ...OVERVIEW, tiles: { ...OVERVIEW.tiles, passRate: 88 } }).find((t) => t.label === 'Pass rate')?.spokenValue).toBeUndefined();
  expect(inspectionFigures(noRate.inspections).find((f) => f.label === 'Pass rate')).toMatchObject({ value: '—', spoken: 'none yet' });
  expect(src('screens/ManagementScreen.tsx')).toMatch(/<StatTile[^>]*spokenValue=\{tile\.spokenValue\}/);
  expect(src('components/management/InspectionsSection.tsx')).toMatch(/`\$\{f\.label\}: \$\{f\.spoken \?\? f\.value\}`/);
});

it('a week of the table is read in words, "no inspection finished" for its "—"', () => {
  const [week] = trendTableRows([{ start: '2026-10-04', end: '2026-10-10', label: '4 Oct', current: false, created: 2, completed: 1, late: 0, passed: 0, failed: 0, passRate: null }], false);
  expect(trendRowLabel(week!)).toBe('Week of 4 Oct: 2 created, 1 completed, 0 late, no inspection finished');
  expect(trendRowLabel({ ...week!, passRate: 75 })).toBe('Week of 4 Oct: 2 created, 1 completed, 0 late, pass rate 75%');
  expect(src('components/management/TrendsSection.tsx')).toMatch(/accessibilityLabel=\{trendRowLabel\(w\)\}/);
});

it('Timeline’s cards say "loading" for their "–" while the figures load', () => {
  const s = src('screens/TimelineScreen.tsx');
  expect(s.match(/value=\{ready \? summary\.\w+ : '–'\}\s*spokenValue=\{ready \? undefined : 'loading'\}/g)).toHaveLength(5);
});
