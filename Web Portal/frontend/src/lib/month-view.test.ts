import { describe, it, expect } from 'vitest';
import { countCards, currentMonth, emptyMonthText, hideCards, monthCardDate, monthCards, monthTitle, monthWord, undatedKeys, withMonthDates, yearChoices } from './month-view';
import type { MonthClock } from './board-month';
import type { KanbanColumnData } from '../components/KanbanColumn';

const clock: MonthClock = { timeZone: 'Asia/Muscat', today: '2026-11-07' };
const day = (key: string) => `${key}T00:00:00.000Z`;
const open = (t: Record<string, unknown>) => ({ columnCategory: 'TODO', completedAt: null, startDate: null, dueDate: null, ...t });

describe('month words', () => {
  it('a month’s title, and its short word beside another month', () => {
    expect(monthTitle('2026-11')).toBe('November 2026');
    expect(monthWord('2026-12', '2026-11')).toBe('Dec');
    expect(monthWord('2027-01', '2026-11')).toBe('Jan 2027');
  });

  it('this month is the company’s (23:00 UTC on 30 Nov is December in Muscat)', () => {
    expect(currentMonth('Asia/Muscat', new Date('2026-11-30T23:00:00Z'))).toBe('2026-12');
    expect(currentMonth('UTC', new Date('2026-11-30T23:00:00Z'))).toBe('2026-11');
  });

  it('the year list: five years either side of this year, and the shown year when it is further', () => {
    expect(yearChoices('2026-11', '2026-11')).toEqual([2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031]);
    expect(yearChoices('2040-03', '2026-11').at(-1)).toBe(2040);
    expect(yearChoices('2001-03', '2026-11')[0]).toBe(2001);
  });

  it('an empty month says why', () => {
    expect(emptyMonthText('2026-11', '2026-11')).toBe('Nothing on this month’s board yet. Add a task with “New task” or a column’s +.');
    expect(emptyMonthText('2026-12', '2026-11')).toBe('Nothing planned for December 2026 yet.');
    expect(emptyMonthText('2026-10', '2026-11')).toBe('Nothing was on the board in October 2026.');
  });
});

describe('a card’s dates in the month view', () => {
  it('a span in one month: “5–20 Nov”', () => {
    expect(monthCardDate(open({ startDate: day('2026-11-05'), dueDate: day('2026-11-20') }), '2026-11', clock)).toEqual({ text: '5–20 Nov', overdue: false });
  });

  it('a span across months, and across years (the year where it isn’t the shown month’s)', () => {
    expect(monthCardDate(open({ startDate: day('2026-10-28'), dueDate: day('2026-12-04') }), '2026-11', clock).text).toBe('28 Oct – 4 Dec');
    expect(monthCardDate(open({ startDate: day('2026-12-28'), dueDate: day('2027-01-04') }), '2026-12', clock).text).toBe('28 Dec – 4 Jan 2027');
    expect(monthCardDate(open({ startDate: day('2026-12-28'), dueDate: day('2027-01-04') }), '2027-01', clock).text).toBe('28 Dec 2026 – 4 Jan');
  });

  it('only a due date (or a start on the due day): “Due 18 Nov”', () => {
    expect(monthCardDate(open({ dueDate: day('2026-11-18') }), '2026-11', clock)).toEqual({ text: 'Due 18 Nov', overdue: false });
    expect(monthCardDate(open({ startDate: day('2026-11-18'), dueDate: day('2026-11-18') }), '2026-11', clock).text).toBe('Due 18 Nov');
  });

  it('only a start: “From 5 Nov” (an automatic start on the company’s day)', () => {
    expect(monthCardDate(open({ startDate: '2026-11-05T09:12:00.000Z' }), '2026-12', clock).text).toBe('From 5 Nov');
    expect(monthCardDate(open({ startDate: '2026-10-31T21:30:00.000Z' }), '2026-11', clock).text).toBe('From 1 Nov');
  });

  it('done: “Done 3 Nov” (the company’s day)', () => {
    expect(monthCardDate({ columnCategory: 'DONE', completedAt: '2026-11-03T08:00:00.000Z', dueDate: day('2026-12-01') }, '2026-11', clock)).toEqual({ text: 'Done 3 Nov', overdue: false });
    expect(monthCardDate({ columnCategory: 'DONE', completedAt: '2026-10-31T20:30:00.000Z' }, '2026-11', clock).text).toBe('Done 1 Nov');
  });

  it('carried over from an earlier month: “Overdue · from Oct”, its due day on hover', () => {
    expect(monthCardDate(open({ startDate: day('2026-10-01'), dueDate: day('2026-10-30') }), '2026-11', clock)).toEqual({ text: 'Overdue · from Oct', overdue: true, title: 'Due 30 Oct' });
    expect(monthCardDate(open({ dueDate: day('2025-12-30') }), '2026-11', clock)).toEqual({ text: 'Overdue · from Dec 2025', overdue: true, title: 'Due 30 Dec 2025' });
  });

  it('overdue within the month shown: its dates, marked overdue', () => {
    expect(monthCardDate(open({ startDate: day('2026-11-01'), dueDate: day('2026-11-03') }), '2026-11', clock)).toEqual({ text: 'Overdue · 1–3 Nov', overdue: true });
    expect(monthCardDate(open({ dueDate: day('2026-10-20') }), '2026-10', clock)).toEqual({ text: 'Overdue · 20 Oct', overdue: true });
  });

  it('waiting for approval is never marked overdue (its badge says so): just its dates', () => {
    const waiting = open({ dueDate: day('2026-10-30'), approvalRequestedAt: '2026-10-29T08:00:00.000Z' });
    expect(monthCardDate(waiting, '2026-11', clock)).toEqual({ text: 'Due 30 Oct', overdue: false });
  });

  it('no dates: “No date”', () => {
    expect(monthCardDate(open({}), '2026-11', clock)).toEqual({ text: 'No date', overdue: false });
  });
});

describe('the month view’s board', () => {
  const columns: KanbanColumnData[] = [
    { id: 'c1', name: 'To Do', color: '#000', tasks: [
      { key: 'A-1', title: 'span', priority: 'NORMAL' as const, progress: 0, assignees: [] },
      { key: 'A-2', title: 'undated', priority: 'NORMAL' as const, progress: 0, assignees: [] },
    ] },
    { id: 'c2', name: 'Done', color: '#000', tasks: [{ key: 'A-3', title: 'done', priority: 'NORMAL' as const, progress: 0, assignees: [] }] },
  ];
  const tasks = [
    { key: 'A-1', ...open({ startDate: day('2026-11-05'), dueDate: day('2026-11-20') }) },
    { key: 'A-2', ...open({}) },
    { key: 'A-3', columnCategory: 'DONE', completedAt: '2026-11-03T08:00:00.000Z' },
  ];

  it('each card gets its month line; the undated ones are known', () => {
    const cards = monthCards(tasks, '2026-11', clock);
    expect(cards.get('A-1')).toEqual({ line: { text: '5–20 Nov', overdue: false }, undated: false });
    expect(cards.get('A-2')!.undated).toBe(true);
    const shown = withMonthDates(columns, cards);
    expect(shown[0]!.tasks.map((t) => t.dateLine?.text)).toEqual(['5–20 Nov', 'No date']);
    expect(shown[1]!.tasks[0]!.dateLine?.text).toBe('Done 3 Nov');
    // The input is left as it was.
    expect(columns[0]!.tasks[0]).not.toHaveProperty('dateLine');
  });

  it('the cards without dates are hidden, and counted, until “No date” is on', () => {
    const undated = undatedKeys(monthCards(tasks, '2026-11', clock));
    expect([...undated]).toEqual(['A-2']);
    expect(hideCards(columns, undated).map((c) => c.tasks.map((t) => t.key))).toEqual([['A-1'], ['A-3']]);
    expect(countCards(columns, undated)).toBe(1);
    expect(hideCards(columns, new Set())).toBe(columns);
  });
});
