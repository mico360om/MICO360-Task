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
