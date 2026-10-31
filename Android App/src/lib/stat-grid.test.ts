import { describe, it, expect } from 'vitest';
import { STAT_GRID, statLabelFits, statLabelRoom, statTileColumns } from './stat-grid';
import { typeStyle } from './typography';
import { spacing } from './theme';
import { appSource as src } from '../testing/web-source';

// The Dashboard's four tiles (Stage 2: the website's), for an employee and for an administrator.
const DASHBOARD = ['My tasks', 'Projects', 'Overdue', 'Due this week'];
const ADMIN = ['My tasks', 'Projects', 'All tasks', 'Overdue'];
const REPORTS = ['Total tasks', 'Completed', 'Overdue', 'On-time rate'];

// Final review S4 (RULING): two tiles per row only when every label fits; otherwise one per row.
describe('statTileColumns', () => {
  it('a 360 dp phone: two per row at the normal font size, one from 1.15 (COMPLETED no longer fits)', () => {
    expect(statLabelRoom(360)).toBe(74);
    expect(statTileColumns(REPORTS, 360, 1)).toBe(2);
    expect(statTileColumns(REPORTS, 360, 1.15)).toBe(1);
    expect(statTileColumns(REPORTS, 360, 1.3)).toBe(1);
    expect(statTileColumns(REPORTS, 360, 2)).toBe(1);
  });

  it('the Dashboard’s four tiles (employee and administrator) stay two per row up to 1.15, then one per row (PROJECTS no longer fits)', () => {
    for (const labels of [DASHBOARD, ADMIN]) {
      expect(statTileColumns(labels, 360, 1)).toBe(2);
      expect(statTileColumns(labels, 360, 1.15)).toBe(2);
      expect(statTileColumns(labels, 360, 1.3)).toBe(1);
      expect(statTileColumns(labels, 360, 2)).toBe(1);
    }
    expect(statLabelFits('Projects', statLabelRoom(360), 1.3)).toBe(false);
  });

  it('a 320 dp screen (a larger Display size) has one per row: OVERDUE needs 54.4 of its 54 dp', () => {
    expect(statLabelRoom(320)).toBe(54);
    for (const labels of [DASHBOARD, REPORTS, ADMIN]) expect(statTileColumns(labels, 320, 1)).toBe(1);
  });

  it('a wider phone keeps two per row at 1.3', () => {
    for (const labels of [DASHBOARD, REPORTS, ADMIN]) expect(statTileColumns(labels, 411, 1.3)).toBe(2);
  });

  it('a label may take two lines between words, never a cut word', () => {
    expect(statLabelFits('Due today', 40, 1)).toBe(true); // DUE / TODAY
    expect(statLabelFits('Completed', 60, 1)).toBe(false); // one word wider than the room
    expect(statLabelFits('On time and late', 40, 1)).toBe(false); // three lines
  });
});

describe('measured the way the tiles are drawn', () => {
  it('the eyebrow label’s size, spacing and lines', () => {
    expect(typeStyle('eyebrow')).toMatchObject({ fontSize: STAT_GRID.labelSize, letterSpacing: STAT_GRID.labelSpacing, textTransform: 'uppercase' });
    expect(src('components/ui/StatTile.tsx')).toMatch(/typeStyle\('eyebrow'\)[^>]*numberOfLines=\{2\}/);
  });

  it('the card’s border and padding, the icon bubble and its gap', () => {
    expect(STAT_GRID.cardInset).toBe(1 + 16);
    expect(src('components/ui/Card.tsx')).toMatch(/borderWidth: 1,[^]*padding: 16/);
    expect(STAT_GRID.bubble).toBe(40 + 12);
    expect(src('components/ui/StatTile.tsx')).toMatch(/row: \{[^}]*gap: 12/);
    expect(src('components/ui/StatTile.tsx')).toMatch(/bubble: \{ width: 40, height: 40/);
  });

  it('the page padding and the gap between tiles', () => {
    expect(STAT_GRID.pagePadding).toBe(spacing.lg);
    expect(STAT_GRID.gap).toBe(spacing.sm);
    expect(src('screens/DashboardScreen.tsx')).toMatch(/scroll: \{ padding: spacing\.lg/);
    expect(src('screens/ReportsScreen.tsx')).toMatch(/scroll: \{ padding: spacing\.lg/);
    for (const f of ['components/dashboard/DashboardTiles.tsx', 'screens/ReportsScreen.tsx']) {
      expect(src(f), f).toMatch(/tiles: \{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing\.sm \}/);
    }
  });
});

// Stage 2: the Dashboard's tiles moved to components/dashboard/DashboardTiles.tsx (measured from the
// tiles it is given); the administrators' totals lost their two tiles to it.
describe('the grids use it', () => {
  it.each([
    ['components/dashboard/DashboardTiles.tsx', null],
    ['screens/ReportsScreen.tsx', REPORTS],
  ] as const)('%s', (file, labels) => {
    const s = src(file);
    expect(s).toMatch(/useWindowDimensions\(\)/);
    expect(s).toMatch(/cols === 2 \? (?:s|styles)\.tile : (?:s|styles)\.tileFull/);
    expect(s).toMatch(/tileFull: \{ flexBasis: '100%' \}/);
    if (labels) {
      // It measures exactly the labels the tiles show.
      const call = /statTileColumns\(\[([^\]]*)\], width, fontScale\)/.exec(s);
      expect(call, 'statTileColumns([…labels], width, fontScale)').not.toBeNull();
      const measured = [...call![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const shown = [...s.matchAll(/<StatTile[^>]*?\blabel="([^"]+)"/g)].map((m) => m[1]);
      expect(measured).toEqual([...labels]);
      expect([...shown].sort()).toEqual([...labels].sort());
    } else {
      expect(s).toMatch(/statTileColumns\(tiles\.map\(\(t\) => t\.label\), width, fontScale\)/);
    }
  });
});
