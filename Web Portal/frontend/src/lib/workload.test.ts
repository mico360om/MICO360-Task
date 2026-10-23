import { describe, it, expect } from 'vitest';
import type { WorkloadCell, WorkloadPerson } from '../api/planning';
import {
  cellLabel,
  cellTone,
  dayHeading,
  filterPeople,
  limitOptions,
  popoverSub,
  popoverTitle,
  sortPeople,
  suggestionLabel,
  suggestionText,
  summaryLine,
  weekBar,
  weekLabel,
} from './workload';

const WEEK = '2026-10-25';
const DAYS = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];

function cells(counts: number[], limit = 5): WorkloadCell[] {
  return counts.map((count, i) => {
    const max = i >= 5 ? 0 : limit;
    return { date: DAYS[i]!, count, limit: max, over: Math.max(0, count - max), tasks: [] };
  });
}
function person(id: string, name: string, counts: number[], extra: Partial<WorkloadPerson> = {}): WorkloadPerson {
  const days = cells(counts);
  return { id, name, avatarUrl: null, me: false, overdue: 0, total: counts.reduce((a, b) => a + b, 0), weekLimit: 25, days, ...extra };
}

const OMAR = person('omar', 'Omar Said', [3, 7, 5, 8, 5, 0, 0], { overdue: 12 });
const SARA = person('sara', 'Sara Ahmed', [2, 2, 4, 1, 5, 0, 0], { overdue: 3 });
const HASSAN = person('hassan', 'Hassan Ahmed', [0, 1, 0, 2, 1, 0, 0]);
const RACHEL = person('rachel', 'Rachel Rea Dsouza', [0, 0, 1, 0, 1, 0, 0]);

describe('cells', () => {
  it('is quiet at 0, green below the limit, amber at it, red over it, and “Off” on an empty day off', () => {
    expect(cellTone({ count: 0, limit: 5 })).toBe('none');
    expect(cellTone({ count: 3, limit: 5 })).toBe('below');
    expect(cellTone({ count: 5, limit: 5 })).toBe('at');
    expect(cellTone({ count: 7, limit: 5 })).toBe('over');
    expect(cellTone({ count: 0, limit: 0 })).toBe('off');
    // Tasks due on a day off: their own state (a working-day limit doesn't apply).
    expect(cellTone({ count: 2, limit: 0 })).toBe('offdue');
  });

  it('reads out the person, the day and what is due', () => {
    expect(cellLabel('Omar Said', OMAR.days[3]!)).toBe('Omar Said, Wednesday 28 October: 8 tasks due, 3 over the limit');
    expect(cellLabel('Sara Ahmed', SARA.days[4]!)).toBe('Sara Ahmed, Thursday 29 October: 5 tasks due, at the limit');
    expect(cellLabel('Sara Ahmed', SARA.days[3]!)).toBe('Sara Ahmed, Wednesday 28 October: 1 task due');
    expect(cellLabel('Hassan Ahmed', HASSAN.days[0]!)).toBe('Hassan Ahmed, Sunday 25 October: nothing due');
    expect(cellLabel('Hassan Ahmed', HASSAN.days[5]!)).toBe('Hassan Ahmed, Friday 30 October: a day off');
    expect(cellLabel('Omar Said', { date: '2026-10-30', count: 2, limit: 0, over: 2, tasks: [] })).toBe('Omar Said, Friday 30 October: a day off, 2 tasks due');
  });
});

describe('a person’s week', () => {
  it('shows the week’s tasks due against the week’s limit, and how far over or how much room', () => {
    expect(weekBar(OMAR)).toEqual({ pct: 100, tone: 'over', text: '28 due · limit 25', note: 'over by 3' });
    expect(weekBar(SARA)).toEqual({ pct: 56, tone: 'busy', text: '14 due · limit 25', note: 'room for 11' });
    expect(weekBar(HASSAN)).toEqual({ pct: 16, tone: 'ok', text: '4 due · limit 25', note: 'room for 21' });
    expect(weekBar({ ...HASSAN, total: 25 })).toEqual({ pct: 100, tone: 'busy', text: '25 due · limit 25', note: 'at the limit' });
  });

  it('puts the most overloaded first, then the busiest, then by name', () => {
    expect(sortPeople([RACHEL, HASSAN, SARA, OMAR]).map((p) => p.id)).toEqual(['omar', 'sara', 'hassan', 'rachel']);
    // Tasks due on a day off don't make anyone the most overloaded.
    expect(sortPeople([person('w', 'Weekend', [0, 0, 0, 0, 0, 9, 0]), SARA]).map((p) => p.id)).toEqual(['sara', 'w']);
    expect(sortPeople([person('w', 'Weekend', [0, 0, 0, 0, 0, 9, 0]), OMAR]).map((p) => p.id)).toEqual(['omar', 'w']);
    const twin = person('a', 'Aisha', [0, 1, 0, 2, 1, 0, 0]);
    expect(sortPeople([HASSAN, twin]).map((p) => p.id)).toEqual(['a', 'hassan']);
  });

  it('finds a person by any part of their name', () => {
    expect(filterPeople([OMAR, SARA, HASSAN, RACHEL], 'ahm').map((p) => p.id)).toEqual(['sara', 'hassan']);
    expect(filterPeople([OMAR, SARA], '  ')).toHaveLength(2);
    expect(filterPeople([OMAR, SARA, RACHEL], 'rea dso').map((p) => p.id)).toEqual(['rachel']);
  });
});

describe('the summary line', () => {
  it('says who is over the daily limit, on how many days', () => {
    expect(summaryLine([OMAR, SARA, HASSAN], true)).toBe('1 person is over the daily limit on 2 days this week.');
    const omarToo = person('o2', 'Other', [6, 0, 0, 0, 0, 0, 0]);
    expect(summaryLine([OMAR, omarToo], true)).toBe('2 people are over the daily limit on 3 days this week.');
    expect(summaryLine([person('x', 'X', [0, 6, 0, 0, 0, 0, 0])], false)).toBe('1 person is over the daily limit on 1 day that week.');
    expect(summaryLine([SARA, HASSAN], true)).toBe('Nobody is over the daily limit this week.');
    expect(summaryLine([], false)).toBe('Nobody is over the daily limit that week.');
    // Tasks due on a day off are not "over the daily limit".
    expect(summaryLine([person('w', 'Weekend', [0, 0, 0, 0, 0, 3, 2])], true)).toBe('Nobody is over the daily limit this week.');
  });
});

describe('days and the week', () => {
  it('names the week and each day, marking today', () => {
    expect(weekLabel(WEEK, '2026-10-28')).toBe('Week of 25 Oct');
    expect(weekLabel('2026-12-27', '2026-10-28')).toBe('Week of 27 Dec');
    expect(weekLabel('2027-01-03', '2026-10-28')).toBe('Week of 3 Jan 2027');
    expect(dayHeading('2026-10-28', '2026-10-28')).toBe('Wed 28 · Today');
    expect(dayHeading('2026-10-29', '2026-10-28')).toBe('Thu 29');
  });

  it('offers the usual limits, and the current one when it is unusual', () => {
    expect(limitOptions(5)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50]);
    expect(limitOptions(13)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 20, 25, 30, 40, 50]);
  });
});

describe('the popover', () => {
  it('names the person and day, and how the day stands', () => {
    expect(popoverTitle('Omar Said', '2026-10-28')).toBe('Omar Said · Wed 28 Oct');
    expect(popoverSub(OMAR.days[3]!)).toBe('8 tasks due · limit 5 · 3 over');
    expect(popoverSub(SARA.days[4]!)).toBe('5 tasks due · limit 5 · at the limit');
    expect(popoverSub(SARA.days[3]!)).toBe('1 task due · limit 5 · room for 4');
    expect(popoverSub({ date: '2026-10-30', count: 2, limit: 0, over: 2, tasks: [] })).toBe('2 tasks due on a day off');
  });

  it('words each suggestion short on the button, in full for screen readers', () => {
    const hassan = { kind: 'reassign' as const, to: { id: 'hassan', name: 'Hassan Ahmed' }, count: 2 };
    const rachel = { kind: 'reassign' as const, to: { id: 'rachel', name: 'Rachel Rea Dsouza' }, count: 0 };
    expect(suggestionText(hassan, WEEK)).toBe('→ Hassan (2 that day)');
    expect(suggestionText(rachel, WEEK)).toBe('→ Rachel (0 that day)');
    expect(suggestionText({ kind: 'move', date: '2026-10-29', count: 3 }, WEEK)).toBe('Move to Thu 29');
    expect(suggestionText({ kind: 'move', date: '2026-11-01', count: 0 }, WEEK)).toBe('Move to Sun 1 Nov');
    expect(suggestionLabel(hassan, 'RIG-14')).toBe('Give RIG-14 to Hassan Ahmed, who has 2 tasks due that day');
    expect(suggestionLabel(rachel, 'MOB-8')).toBe('Give MOB-8 to Rachel Rea Dsouza, who has nothing due that day');
    expect(suggestionLabel({ kind: 'move', date: '2026-10-29', count: 3 }, 'FCRM-3')).toBe('Move FCRM-3 to Thursday 29 October');
  });
});
