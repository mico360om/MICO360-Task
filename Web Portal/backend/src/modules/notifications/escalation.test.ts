import { describe, it, expect } from 'vitest';
import { planEscalations, type EscalationTask } from './escalation';

const d = (iso: string) => new Date(iso);
const now = d('2026-03-10T09:00:00Z');

const base = { projectId: 'p1' };
const tasks: EscalationTask[] = [
  { ...base, id: 't1', key: 'MICO-1', title: '4 days overdue', dueDate: d('2026-03-06T00:00:00Z'), columnCategory: 'TODO' },
  { ...base, id: 't2', key: 'MICO-2', title: '1 day overdue', dueDate: d('2026-03-09T00:00:00Z'), columnCategory: 'TODO' },
  { ...base, id: 't3', key: 'MICO-3', title: 'Blocked, no due', dueDate: null, columnCategory: 'BLOCKED' },
  { ...base, id: 't4', key: 'MICO-4', title: 'Done + old', dueDate: d('2026-01-01T00:00:00Z'), columnCategory: 'DONE' },
];

describe('planEscalations', () => {
  it('escalates tasks overdue by at least the threshold', () => {
    const plans = planEscalations(tasks, { now, overdueDays: 3 });
    const overdue = plans.filter((p) => p.reason === 'overdue');
    expect(overdue.map((p) => p.key)).toEqual(['MICO-1']); // MICO-2 is only 1 day overdue
  });

  it('escalates Blocked tasks regardless of due date', () => {
    const plans = planEscalations(tasks, { now, overdueDays: 3 });
    expect(plans.find((p) => p.key === 'MICO-3')?.reason).toBe('blocked');
  });

  it('never escalates a DONE task', () => {
    const plans = planEscalations(tasks, { now, overdueDays: 3 });
    expect(plans.some((p) => p.key === 'MICO-4')).toBe(false);
  });

  it('counts days overdue in company-time calendar days', () => {
    const due = [{ ...base, id: 'd', key: 'D-1', title: 'due 7 Mar', dueDate: d('2026-03-07T00:00:00Z'), columnCategory: 'TODO' }];
    // 23:00 on 9 Mar in Muscat → only 2 days past the 7th.
    expect(planEscalations(due, { now: d('2026-03-09T19:00:00Z'), overdueDays: 3, timeZone: 'Asia/Muscat' })).toEqual([]);
    // 00:30 on 10 Mar in Muscat (still the 9th in UTC) → 3 days.
    expect(planEscalations(due, { now: d('2026-03-09T20:30:00Z'), overdueDays: 3, timeZone: 'Asia/Muscat' })[0]!.overdueDays).toBe(3);
  });

  it('never escalates a task that carries a completion time', () => {
    const t: EscalationTask[] = [{ ...base, id: 'c', key: 'C-1', title: 'done elsewhere', dueDate: d('2026-01-01T00:00:00Z'), columnCategory: 'REVIEW', completedAt: d('2026-01-02T00:00:00Z') }];
    expect(planEscalations(t, { now, overdueDays: 3 })).toEqual([]);
  });

  it('prefers the "blocked" reason when a task is both blocked and overdue', () => {
    const t: EscalationTask[] = [{ ...base, id: 'x', key: 'X-1', title: 'both', dueDate: d('2026-01-01T00:00:00Z'), columnCategory: 'BLOCKED' }];
    expect(planEscalations(t, { now, overdueDays: 3 })[0]!.reason).toBe('blocked');
  });
});
