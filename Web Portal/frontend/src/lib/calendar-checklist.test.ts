import { describe, expect, it } from 'vitest';
import { checklistByDay, type CalendarChecklistItem } from './calendar-checklist';
import { DEFAULT_FILTERS } from './calendar-model';

const it_ = (patch: Partial<CalendarChecklistItem>): CalendarChecklistItem => ({
  id: 'i1',
  text: 'Label circuits',
  done: false,
  dueDate: '2026-11-03',
  assigneeId: 'me',
  taskId: 't1',
  taskKey: 'MICO-142',
  taskTitle: 'Fit out',
  projectId: 'p1',
  ...patch,
});
const ITEMS = [
  it_({}),
  it_({ id: 'i2', text: 'Test breakers', assigneeId: 'omar', done: true }),
  it_({ id: 'i3', text: 'Pipes', projectId: 'p2', taskKey: 'OPS-7', dueDate: '2026-11-05' }),
  it_({ id: 'i4', text: 'Unassigned step', assigneeId: null }),
];
const ctx = { myId: 'me', today: '2026-11-04', projectStatus: (id: string) => (id === 'p2' ? 'ARCHIVED' : 'ACTIVE') };
const ids = (m: Map<string, CalendarChecklistItem[]>) => [...m.entries()].map(([day, list]) => [day, list.map((i) => i.id)]);

describe('checklistByDay: checklist items on the calendar (1.23.3)', () => {
  it('across all projects: the items assigned to me, on their due day (archived projects hidden as tasks are)', () => {
    expect(ids(checklistByDay(ITEMS, DEFAULT_FILTERS, ctx))).toEqual([['2026-11-03', ['i1']]]);
    expect(ids(checklistByDay(ITEMS, { ...DEFAULT_FILTERS, showArchived: true }, ctx))).toEqual([
      ['2026-11-03', ['i1']],
      ['2026-11-05', ['i3']],
    ]);
  });

  it('a project’s calendar: every dated item of that project (done ones last)', () => {
    expect(ids(checklistByDay(ITEMS, { ...DEFAULT_FILTERS, projectId: 'p1' }, ctx))).toEqual([['2026-11-03', ['i1', 'i4', 'i2']]]);
  });

  it('the people filters: "mine" and one person', () => {
    expect(ids(checklistByDay(ITEMS, { ...DEFAULT_FILTERS, projectId: 'p1', mine: true }, ctx))).toEqual([['2026-11-03', ['i1']]]);
    expect(ids(checklistByDay(ITEMS, { ...DEFAULT_FILTERS, projectId: 'p1', assigneeId: 'omar' }, ctx))).toEqual([['2026-11-03', ['i2']]]);
    expect(ids(checklistByDay(ITEMS, { ...DEFAULT_FILTERS, assigneeId: 'omar' }, ctx))).toEqual([['2026-11-03', ['i2']]]);
  });

  it('done items follow "Show completed"; status filters read late as overdue; a priority filter leaves them out', () => {
    const p1 = { ...DEFAULT_FILTERS, projectId: 'p1' };
    expect(ids(checklistByDay(ITEMS, { ...p1, showCompleted: false }, ctx))).toEqual([['2026-11-03', ['i1', 'i4']]]);
    expect(ids(checklistByDay(ITEMS, { ...p1, statuses: ['overdue'] }, ctx))).toEqual([['2026-11-03', ['i1', 'i4']]]);
    expect(ids(checklistByDay(ITEMS, { ...p1, statuses: ['done'] }, ctx))).toEqual([['2026-11-03', ['i2']]]);
    expect(ids(checklistByDay(ITEMS, { ...p1, priorities: ['HIGH'] }, ctx))).toEqual([]);
  });

  it('the search box finds an item’s words or its task’s number', () => {
    const p1 = { ...DEFAULT_FILTERS, projectId: 'p1' };
    expect(ids(checklistByDay(ITEMS, { ...p1, q: 'breakers' }, ctx))).toEqual([['2026-11-03', ['i2']]]);
    expect(ids(checklistByDay(ITEMS, { ...p1, q: 'mico 142' }, ctx))).toEqual([['2026-11-03', ['i1', 'i4', 'i2']]]);
  });

  it('nothing from an older server', () => {
    expect(checklistByDay(undefined, DEFAULT_FILTERS, ctx).size).toBe(0);
  });
});
