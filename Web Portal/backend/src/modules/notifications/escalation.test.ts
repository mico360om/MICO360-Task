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

  it('prefers the "blocked" reason when a task is both blocked and overdue', () => {
    const t: EscalationTask[] = [{ ...base, id: 'x', key: 'X-1', title: 'both', dueDate: d('2026-01-01T00:00:00Z'), columnCategory: 'BLOCKED' }];
    expect(planEscalations(t, { now, overdueDays: 3 })[0]!.reason).toBe('blocked');
  });
});
