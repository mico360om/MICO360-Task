import { describe, it, expect } from 'vitest';
import { createCarryForwardService, type CarryForwardRepo } from './carry-forward-service';
import { boardDateFromKey, DEFAULT_CARRY_STATUSES, type CarryTask, type CarryLogEntry } from './board-date';

function makeRepo(candidates: CarryTask[]) {
  const applied: { id: string; toAnchor: Date; entry: CarryLogEntry }[] = [];
  const repo: CarryForwardRepo = {
    async listCarryCandidates(before) {
      return candidates.filter((t) => t.boardDate < before);
    },
    async applyCarry(id, toAnchor, entry) {
      applied.push({ id, toAnchor, entry });
    },
  };
  return { repo, applied };
}

const now = new Date('2026-09-09T09:00:00.000Z');
const enabled = async () => ({ enabled: true, statuses: DEFAULT_CARRY_STATUSES });

describe('carry-forward service', () => {
  it('carries open past-dated tasks to today and logs the move; leaves completed tasks alone', async () => {
    const { repo, applied } = makeRepo([
      { id: 'a', columnCategory: 'TODO', completedAt: null, boardDate: boardDateFromKey('2026-09-08') },
      { id: 'b', columnCategory: 'DONE', completedAt: new Date('2026-09-08T10:00:00Z'), boardDate: boardDateFromKey('2026-09-08') },
    ]);
    const svc = createCarryForwardService({ repo, config: enabled, timeZone: 'UTC', now: () => now });

    const res = await svc.run();

    expect(res.carried).toBe(1);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual({
      id: 'a',
      toAnchor: boardDateFromKey('2026-09-09'),
      entry: { from: '2026-09-08', to: '2026-09-09', at: now.toISOString() },
    });
  });

  it('does nothing when carry-forward is disabled', async () => {
    const { repo, applied } = makeRepo([{ id: 'a', columnCategory: 'TODO', completedAt: null, boardDate: boardDateFromKey('2026-09-01') }]);
    const svc = createCarryForwardService({ repo, config: async () => ({ enabled: false, statuses: DEFAULT_CARRY_STATUSES }), timeZone: 'UTC', now: () => now });
    expect((await svc.run()).carried).toBe(0);
    expect(applied).toHaveLength(0);
  });
});
