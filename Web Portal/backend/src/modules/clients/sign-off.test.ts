import { describe, it, expect } from 'vitest';
import { canSignOff, currentAcceptance } from './sign-off';

const at = (iso: string) => new Date(iso);

describe('A client’s sign-off', () => {
  it('counts only while the task is done, and only for this completion', () => {
    const done = { columnCategory: 'DONE', completedAt: at('2026-10-30T10:00:00Z') };
    expect(currentAcceptance({ ...done, clientAcceptedAt: at('2026-10-30T11:00:00Z') })).toEqual(at('2026-10-30T11:00:00Z'));
    expect(currentAcceptance({ ...done, clientAcceptedAt: null })).toBeNull();
    // Re-opened: not done any more.
    expect(currentAcceptance({ columnCategory: 'IN_PROGRESS', completedAt: null, clientAcceptedAt: at('2026-10-30T11:00:00Z') })).toBeNull();
    // Re-opened and finished again later: the old acceptance was for the earlier finish.
    expect(currentAcceptance({ columnCategory: 'DONE', completedAt: at('2026-11-02T09:00:00Z'), clientAcceptedAt: at('2026-10-30T11:00:00Z') })).toBeNull();
    // A Done column with no completion time (older data) still counts.
    expect(currentAcceptance({ columnCategory: 'DONE', completedAt: null, clientAcceptedAt: at('2026-10-30T11:00:00Z') })).toEqual(at('2026-10-30T11:00:00Z'));
  });

  it('can be given on a done task that isn’t waiting for approval', () => {
    expect(canSignOff({ columnCategory: 'DONE', completedAt: at('2026-10-30T10:00:00Z'), approvalRequestedAt: null })).toBe(true);
    expect(canSignOff({ columnCategory: 'REVIEW', completedAt: null, approvalRequestedAt: at('2026-10-30T10:00:00Z') })).toBe(false);
    expect(canSignOff({ columnCategory: 'IN_PROGRESS', completedAt: null, approvalRequestedAt: null })).toBe(false);
    expect(canSignOff({ columnCategory: 'DONE', completedAt: null, approvalRequestedAt: null })).toBe(true);
  });
});
