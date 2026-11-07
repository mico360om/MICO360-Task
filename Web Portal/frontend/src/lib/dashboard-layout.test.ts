import { describe, it, expect } from 'vitest';
import {
  builtInLayout,
  layoutOrDefault,
  moveBy,
  moveTo,
  movedAnnouncement,
  previewFor,
  setSize,
  toggleHidden,
  WIDGET_NAME,
  ADMIN_ONLY_WIDGETS,
} from './dashboard-layout';
import type { DashboardLayout } from '../api/dashboard';

// 1.23.4 — the Dashboard's arrangement on the page: the built-in defaults (when the account's can't be
// read), moving a widget by handle or by Move up / Move down with what a screen reader hears, show/hide,
// Small/Wide, and the "everyone else" preview an administrator arranges.
const ids = (l: DashboardLayout) => l.widgets.map((w) => w.id);

describe('the built-in defaults (the server’s, used while the account’s is loading or unreadable)', () => {
  it('administrators: priorities, tiles, the charts, approvals, due soon, activity, open tasks hidden; everyone else without the charts', () => {
    expect(ids(builtInLayout(true))).toEqual(['priorities', 'stats', 'status-chart', 'completion', 'approvals', 'due-soon', 'activity', 'open-tasks']);
    expect(builtInLayout(true).widgets.find((w) => w.id === 'open-tasks')!.hidden).toBe(true);
    expect(ids(builtInLayout(false))).toEqual(['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity']);
    expect(builtInLayout(false).widgets[0]).toEqual({ id: 'priorities', hidden: false, size: 'wide' });
  });

  it('an answer that isn’t a layout is the built-in default', () => {
    expect(ids(layoutOrDefault([], false))).toEqual(ids(builtInLayout(false)));
    expect(ids(layoutOrDefault({ widgets: 'x' }, true))).toEqual(ids(builtInLayout(true)));
    expect(ids(layoutOrDefault({ widgets: [{ id: 'activity', hidden: false, size: 'small' }, { id: 'nope', hidden: false, size: 'small' }] }, false))).toEqual(['activity']);
  });

  it('every widget has a plain name', () => {
    expect(WIDGET_NAME).toEqual({
      priorities: 'My Priorities Today',
      stats: 'Stat tiles',
      'open-tasks': 'Your open tasks',
      approvals: 'Approvals',
      'due-soon': 'Due soon',
      activity: 'Recent activity',
      'status-chart': 'Tasks by status',
      completion: 'Project completion',
    });
  });
});

describe('arranging', () => {
  const base = builtInLayout(false);

  it('Move up / Move down: one place, never past either end', () => {
    expect(ids(moveBy(base, 'due-soon', -1))).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'approvals', 'activity']);
    expect(ids(moveBy(base, 'due-soon', 1))).toEqual(['priorities', 'stats', 'open-tasks', 'approvals', 'activity', 'due-soon']);
    expect(moveBy(base, 'priorities', -1)).toBe(base);
    expect(moveBy(base, 'activity', 1)).toBe(base);
  });

  it('a drag drops it where it lands', () => {
    expect(ids(moveTo(base, 'activity', 'priorities'))).toEqual(['activity', 'priorities', 'stats', 'open-tasks', 'approvals', 'due-soon']);
    expect(ids(moveTo(base, 'priorities', 'due-soon'))).toEqual(['stats', 'open-tasks', 'approvals', 'due-soon', 'priorities', 'activity']);
    expect(moveTo(base, 'stats', 'stats')).toBe(base);
  });

  it('what a screen reader hears after a move', () => {
    const moved = moveBy(base, 'due-soon', -1);
    expect(movedAnnouncement(moved, 'due-soon')).toBe('Due soon moved to position 4 of 6.');
  });

  it('show/hide and Small/Wide change only that widget', () => {
    const hidden = toggleHidden(base, 'activity');
    expect(hidden.widgets.find((w) => w.id === 'activity')!.hidden).toBe(true);
    expect(toggleHidden(hidden, 'activity').widgets.find((w) => w.id === 'activity')!.hidden).toBe(false);
    const wide = setSize(base, 'due-soon', 'wide');
    expect(wide.widgets.find((w) => w.id === 'due-soon')!.size).toBe('wide');
    expect(wide.widgets.filter((w) => w.size === 'wide').map((w) => w.id)).toEqual(['priorities', 'stats', 'due-soon']);
  });

  it('the “everyone else” default, previewed by an administrator, simply leaves out the admin-only charts', () => {
    const admin = builtInLayout(true);
    expect([...ADMIN_ONLY_WIDGETS]).toEqual(['status-chart', 'completion']);
    expect(ids(previewFor(admin, 'everyone'))).toEqual(['priorities', 'stats', 'approvals', 'due-soon', 'activity', 'open-tasks']);
    expect(previewFor(admin, 'admins')).toBe(admin);
  });
});

describe('the responsive grid (1.23.8): widgets side by side, the last ones stretch', () => {
  it('columns by the room the widgets have: one on a phone, two from 640px, three from 1400px', async () => {
    const { dashboardColumns } = await import('./dashboard-layout');
    expect(dashboardColumns(343)).toBe(1);
    expect(dashboardColumns(639)).toBe(1);
    expect(dashboardColumns(640)).toBe(2);
    expect(dashboardColumns(1140)).toBe(2);
    expect(dashboardColumns(1400)).toBe(3);
    expect(dashboardColumns(1596)).toBe(3);
  });

  it('a Wide widget takes the whole row; a Small one a column; the last in a row that isn’t full stretches to fill it', async () => {
    const { dashboardSpans } = await import('./dashboard-layout');
    // Two columns: S S | W | S S | S → the last alone stretches.
    expect(dashboardSpans(['small', 'small', 'wide', 'small', 'small', 'small'], 2)).toEqual([1, 1, 2, 1, 1, 2]);
    // A Small before a Wide that would leave a hole stretches instead.
    expect(dashboardSpans(['small', 'wide', 'small'], 2)).toEqual([2, 2, 2]);
    // Three columns: S S S | S S → the second of the last row takes what's left (2).
    expect(dashboardSpans(['small', 'small', 'small', 'small', 'small'], 3)).toEqual([1, 1, 1, 1, 2]);
    expect(dashboardSpans(['wide', 'small', 'wide'], 3)).toEqual([3, 3, 3]);
    // One column: everything is the whole row.
    expect(dashboardSpans(['small', 'wide', 'small'], 1)).toEqual([1, 1, 1]);
    expect(dashboardSpans([], 2)).toEqual([]);
  });
});

describe('lists show more rows on a tall screen (1.23.8)', () => {
  it('the usual number up to a 900px window, then one more for each 56px, at most twice the usual', async () => {
    const { rowsForHeight } = await import('./dashboard-layout');
    expect(rowsForHeight(6, 812)).toBe(6);
    expect(rowsForHeight(6, 900)).toBe(6);
    expect(rowsForHeight(6, 1080)).toBe(9);
    expect(rowsForHeight(6, 1440)).toBe(12);
    expect(rowsForHeight(8, 2160)).toBe(16);
  });
});
