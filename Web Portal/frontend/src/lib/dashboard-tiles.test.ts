import { describe, it, expect } from 'vitest';
import { myDueCounts } from './dashboard-tiles';

const task = (dueDate: string | null, over: Record<string, unknown> = {}) => ({ dueDate, columnCategory: 'TODO', completedAt: null, ...over });
// Wednesday 28 Oct 2026, 10:00 in Muscat.
const NOW = new Date('2026-10-28T06:00:00Z');
const MUSCAT = 'Asia/Muscat';

describe('the Dashboard’s own-task tiles', () => {
  const tasks = [
    task('2026-10-27'), // yesterday: overdue
    task('2026-10-20', { columnCategory: 'DONE' }), // finished: never overdue
    task('2026-10-21', { completedAt: '2026-10-22T08:00:00Z' }),
    task('2026-10-28'), // today
    task('2026-10-30'), // Friday
    task('2026-10-31'), // Saturday
    task('2026-11-04'), // next week
    task(null),
  ];

  it('counts overdue work (open, due before today in the company zone)', () => {
    expect(myDueCounts(tasks, { timeZone: MUSCAT, weekStart: 0, now: NOW }).overdue).toBe(1);
  });

  it('counts what is due from today to the end of the company’s week — Sunday to Saturday', () => {
    expect(myDueCounts(tasks, { timeZone: MUSCAT, weekStart: 0, now: NOW })).toMatchObject({ dueThisWeek: 3, today: '2026-10-28', weekEnd: '2026-10-31' });
  });

  it('…or Saturday to Friday, as the company week start says', () => {
    expect(myDueCounts(tasks, { timeZone: MUSCAT, weekStart: 6, now: NOW })).toMatchObject({ dueThisWeek: 2, weekEnd: '2026-10-30' });
  });

  it('…or Monday to Sunday', () => {
    expect(myDueCounts(tasks, { timeZone: MUSCAT, weekStart: 1, now: NOW })).toMatchObject({ dueThisWeek: 3, weekEnd: '2026-11-01' });
  });

  it('on the week’s last day, only today counts', () => {
    const friday = new Date('2026-10-30T06:00:00Z');
    expect(myDueCounts(tasks, { timeZone: MUSCAT, weekStart: 6, now: friday })).toMatchObject({ overdue: 2, dueThisWeek: 1, today: '2026-10-30', weekEnd: '2026-10-30' });
  });

  it('nothing to count: zeros', () => {
    expect(myDueCounts([], { timeZone: MUSCAT, weekStart: 0, now: NOW })).toMatchObject({ overdue: 0, dueThisWeek: 0 });
  });
});
