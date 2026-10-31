import { describe, it, expect } from 'vitest';
import { myDueCounts } from './dashboard-tiles';
import { hasWeb, loadWebTs, webPath } from '../testing/web-source';

/** Wed 28 Oct 2026, 10:00 in Muscat. */
const NOW = new Date('2026-10-28T06:00:00Z');
const TZ = 'Asia/Muscat';

type Row = { dueDate?: string | null; columnCategory?: string | null; completedAt?: string | null; approvalRequestedAt?: string | null };

/** Every mix the counts tell apart: due day (past, today, this week, next week, none) × column × completed × waiting. */
const MATRIX: Row[] = [];
for (const dueDate of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-31', '2026-11-01', null])
  for (const columnCategory of ['TODO', 'REVIEW', 'DONE'])
    for (const completedAt of [null, '2026-10-27T09:00:00Z'])
      for (const approvalRequestedAt of [null, '2026-10-27T09:00:00Z']) MATRIX.push({ dueDate, columnCategory, completedAt, approvalRequestedAt });

describe.skipIf(!hasWeb('frontend/src/lib/dashboard-tiles.ts', 'backend/src/modules/tasks/task-status.ts', 'backend/src/lib/due-date.ts'))('Review Focus 4: the website’s and the server’s counts', () => {
  it('the same numbers as the website’s myDueCounts, for every week start', async () => {
    const web = (await import(/* @vite-ignore */ webPath('frontend/src/lib/dashboard-tiles.ts'))) as { myDueCounts: typeof myDueCounts };
    for (const weekStart of [0, 1, 6] as const) expect(myDueCounts(MATRIX, { timeZone: TZ, weekStart, now: NOW })).toEqual(web.myDueCounts(MATRIX, { timeZone: TZ, weekStart, now: NOW }));
  });

  it('Overdue is exactly what the server calls late — never a task waiting for approval', () => {
    const server = loadWebTs('backend/src/modules/tasks/task-status.ts', { '../../lib/due-date': 'backend/src/lib/due-date.ts' }) as { isTaskLate: (t: object, tz: string, now: Date) => boolean };
    const late = MATRIX.filter((t) => server.isTaskLate(t, TZ, NOW)).length;
    expect(late).toBeGreaterThan(0);
    expect(myDueCounts(MATRIX, { timeZone: TZ, weekStart: 0, now: NOW }).overdue).toBe(late);
  });
});

it('a late task waiting for approval is in neither number; one due this week still counts', () => {
  const waiting = { dueDate: '2026-10-27', columnCategory: 'REVIEW', approvalRequestedAt: '2026-10-27T09:00:00Z' };
  expect(myDueCounts([waiting], { timeZone: TZ, weekStart: 0, now: NOW })).toMatchObject({ overdue: 0, dueThisWeek: 0, weekEnd: '2026-10-31' });
  expect(myDueCounts([{ ...waiting, dueDate: '2026-10-30' }], { timeZone: TZ, weekStart: 0, now: NOW }).dueThisWeek).toBe(1);
  // Wed 28 Oct: a Monday week runs to Sun 1 Nov, a Saturday week to Fri 30 Oct.
  expect(myDueCounts([{ dueDate: '2026-11-01' }], { timeZone: TZ, weekStart: 1, now: NOW })).toMatchObject({ dueThisWeek: 1, weekEnd: '2026-11-01' });
  expect(myDueCounts([{ dueDate: '2026-11-01' }], { timeZone: TZ, weekStart: 6, now: NOW })).toMatchObject({ dueThisWeek: 0, weekEnd: '2026-10-30' });
});

it('finished work never counts, and today is the company’s day', () => {
  expect(myDueCounts([{ dueDate: '2026-10-26', columnCategory: 'DONE' }, { dueDate: '2026-10-26', completedAt: '2026-10-26T09:00:00Z' }], { timeZone: TZ, weekStart: 0, now: NOW })).toMatchObject({ overdue: 0, dueThisWeek: 0 });
  // 22:00 UTC on 27 Oct is already 28 Oct in Muscat: a task due on the 27th is overdue there.
  expect(myDueCounts([{ dueDate: '2026-10-27' }], { timeZone: TZ, weekStart: 0, now: new Date('2026-10-27T22:00:00Z') })).toMatchObject({ overdue: 1, today: '2026-10-28' });
});
