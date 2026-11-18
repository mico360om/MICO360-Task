import { describe, it, expect } from 'vitest';
import { bulkConfirmText, dueLabel, GROUP_FIRST, groupOf, groupRows, movableOverdue, rowKey, rowTitle } from './dashboard-priority-groups';
import type { PriorityRow, PriorityTask } from '../api/dashboard';

// 1.23.41 "My Priorities Today" as a compact grouped list (owner, 18 Nov 2026): Today · Overdue · Approvals ·
// Blocked (only if any) · Upcoming · Team, five rows each, one-line rows, and the Overdue group's "Move all".
const TODAY = '2026-11-18';
const task = (o: Partial<PriorityTask> = {}): PriorityTask => ({
  id: 't1',
  key: 'RIG-4',
  title: 'Pump check',
  priority: 'NORMAL',
  dueDate: '2026-11-04',
  startDate: null,
  startAt: null,
  version: 3,
  columnId: 'c-todo',
  project: { id: 'p1', code: 'RIG', name: 'Rig Inspection', color: null, icon: null, imageUrl: null },
  assignees: [],
  blockers: [],
  doneColumnId: 'c-done',
  recurrenceRule: null,
  can: { complete: true, reschedule: true, assign: true, approve: false },
  ...o,
});
const row = (id: string, o: Partial<PriorityRow> = {}): PriorityRow => ({ id, kind: 'task', reason: { code: 'overdue', days: 2 }, also: [], chips: ['overdue'], group: 1, task: task({ id }), ...o });

describe('groupOf: each row in exactly one group', () => {
  it('approvals by kind; team rows under Team; otherwise the first of Today, Overdue, Blocked, Upcoming; no chip: Other', () => {
    expect(groupOf(row('a', { kind: 'approval', chips: ['approvals', 'overdue'] }))).toBe('approvals');
    expect(groupOf(row('b', { chips: ['overdue', 'team'] }))).toBe('team');
    expect(groupOf(row('c', { chips: ['today', 'blocked'] }))).toBe('today');
    expect(groupOf(row('d', { chips: ['overdue', 'blocked'] }))).toBe('overdue');
    expect(groupOf(row('e', { chips: ['blocked', 'upcoming'] }))).toBe('blocked');
    expect(groupOf(row('f', { chips: ['upcoming'] }))).toBe('upcoming');
    expect(groupOf(row('g', { chips: [] }))).toBe('other');
  });
});

describe('groupRows: the owner’s order, the server’s ranking kept inside each group', () => {
  const rows = [
    row('o1'),
    row('o2'),
    row('ap', { kind: 'approval', chips: ['approvals'] }),
    row('td', { chips: ['today'] }),
    row('up', { chips: ['upcoming'] }),
    row('o3'),
  ];
  it('Today · Overdue · Approvals · Upcoming (Blocked only if any; Team only for managers; Other only if any)', () => {
    const g = groupRows(rows, { manager: false });
    expect(g.map((x) => x.id)).toEqual(['today', 'overdue', 'approvals', 'upcoming']);
    expect(g.find((x) => x.id === 'overdue')!.rows.map((r) => r.id)).toEqual(['o1', 'o2', 'o3']);
    expect(g.map((x) => x.label)).toEqual(['Today', 'Overdue', 'Approvals', 'Upcoming']);
  });
  it('Blocked shows when it has rows; Team for managers (even empty); Other when some row has no chip', () => {
    const g = groupRows([...rows, row('bl', { chips: ['blocked'] }), row('ur', { chips: [], reason: { code: 'urgent' } })], { manager: true });
    expect(g.map((x) => x.id)).toEqual(['today', 'overdue', 'approvals', 'blocked', 'upcoming', 'team', 'other']);
    expect(g.find((x) => x.id === 'team')!.rows).toEqual([]);
    expect(g.find((x) => x.id === 'other')!.label).toBe('Other priorities');
  });
  it('shows five, then more', () => {
    expect(GROUP_FIRST).toBe(5);
  });
});

describe('dueLabel: "Today", "27 days late" (red), "Thu 20 Nov"', () => {
  it('says the day plainly', () => {
    expect(dueLabel(TODAY, TODAY)).toEqual({ text: 'Today', late: false });
    expect(dueLabel('2026-11-19', TODAY)).toEqual({ text: 'Tomorrow', late: false });
    expect(dueLabel('2026-11-17', TODAY)).toEqual({ text: '1 day late', late: true });
    expect(dueLabel('2026-10-22', TODAY)).toEqual({ text: '27 days late', late: true });
    expect(dueLabel('2026-11-20', TODAY)).toEqual({ text: 'Fri 20 Nov', late: false });
    expect(dueLabel('2027-01-05', TODAY)).toEqual({ text: 'Tue 5 Jan 2027', late: false });
    expect(dueLabel(null, TODAY)).toBeNull();
  });
});

describe('rowKey / rowTitle: what the tick and the menu are named after', () => {
  it('a task, an action item, a checklist item', () => {
    expect(rowKey(row('t1'))).toBe('RIG-4');
    expect(rowTitle(row('t1'))).toBe('Pump check');
    const a = row('a', { kind: 'action-item', task: undefined, actionItem: { id: 'a', description: 'Send the report', dueDate: TODAY, priority: 'NORMAL', status: 'OPEN', meeting: null, projectId: null, can: { done: true, reschedule: true } } });
    expect(rowKey(a)).toBeNull();
    expect(rowTitle(a)).toBe('Send the report');
    const c = row('c', { kind: 'checklist-item', task: undefined, checklistItem: { id: 'c', text: 'Torque', dueDate: null, task: { id: 't9', key: 'RIG-9', title: 'Flange', projectId: 'p1' }, can: { tick: true, reschedule: true } } });
    expect(rowKey(c)).toBe('RIG-9');
    expect(rowTitle(c)).toBe('Torque');
  });
});

describe('movableOverdue: the rows "Move all" changes, and how many stay', () => {
  it('only the rows the person may reschedule; approvals and the rest stay', () => {
    const rows = [
      row('a'),
      row('b', { task: task({ id: 'b', can: { complete: true, reschedule: false, assign: false, approve: false } }) }),
      row('c'),
      row('d', { kind: 'checklist-item', task: undefined, checklistItem: { id: 'd', text: 'Step', dueDate: '2026-11-01', task: { id: 't9', key: 'RIG-9', title: 'Flange', projectId: 'p1' }, can: { tick: true, reschedule: true } } }),
      row('e', { kind: 'approval', chips: ['approvals', 'overdue'], task: task({ id: 'e', can: { complete: false, reschedule: false, assign: false, approve: true } }) }),
    ];
    const m = movableOverdue(rows);
    expect(m.movable.map((r) => r.id)).toEqual(['a', 'c', 'd']);
    expect(m.staying).toBe(2);
    expect(m.allTasks).toBe(false);
    expect(movableOverdue([row('a'), row('c')]).allTasks).toBe(true);
  });
});

describe('bulkConfirmText', () => {
  it('"Move 22 tasks to today? 2 you can’t change will stay."', () => {
    expect(bulkConfirmText({ count: 22, staying: 2, allTasks: true, day: TODAY, today: TODAY })).toBe('Move 22 tasks to today? 2 you can’t change will stay.');
    expect(bulkConfirmText({ count: 1, staying: 0, allTasks: true, day: TODAY, today: TODAY })).toBe('Move 1 task to today?');
    expect(bulkConfirmText({ count: 3, staying: 1, allTasks: false, day: '2026-11-20', today: TODAY })).toBe('Move 3 items to Fri 20 Nov? 1 you can’t change will stay.');
  });
});
