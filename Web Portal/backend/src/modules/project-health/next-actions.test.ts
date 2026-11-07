import { describe, expect, it } from 'vitest';
import { NEXT_ACTIONS_SHOWN, NEXT_SOON_DAYS, rankNextActions, type TaskActionCandidate } from './next-actions';

const ctx = { today: '2026-11-20', timeZone: 'Asia/Muscat' };
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
let n = 0;
const task = (over: Partial<TaskActionCandidate> = {}): TaskActionCandidate => {
  n += 1;
  return {
    kind: 'task',
    id: `t${n}`,
    key: `RIG-${n}`,
    priority: 'NORMAL',
    dueDate: null,
    createdAt: new Date(`2026-10-01T00:00:${String(n % 60).padStart(2, '0')}Z`),
    columnCategory: 'TODO',
    assigneeIds: ['omar'],
    heldByBlockers: false,
    blockers: [],
    dependents: 0,
    ...over,
  };
};
const codes = (list: ReturnType<typeof rankNextActions>) => list.map((r) => [r.candidate.key, r.reason.code]);

describe('next actions: the project’s next things to do, in the 1.23.4 priorities order', () => {
  it('shows seven, then “Show all”, and looks 7 days ahead', () => {
    expect([NEXT_ACTIONS_SHOWN, NEXT_SOON_DAYS]).toEqual([7, 7]);
  });

  it('includes overdue, due today, due within 7 days, blocked, and unassigned with a date — nothing else', () => {
    const late = task({ key: 'L', dueDate: day('2026-11-17') });
    const today = task({ key: 'T', dueDate: day('2026-11-20') });
    const soon = task({ key: 'S', dueDate: day('2026-11-27') });
    const later = task({ key: 'X', dueDate: day('2026-11-28') });
    const statusBlocked = task({ key: 'B', columnCategory: 'BLOCKED' });
    const held = task({ key: 'H', heldByBlockers: true, blockers: [{ id: 'z', key: 'RIG-99' }] });
    const planned = task({ key: 'P', blockers: [{ id: 'z', key: 'RIG-99' }] });
    const unassigned = task({ key: 'U', assigneeIds: [], dueDate: day('2027-02-01') });
    const unassignedNoDate = task({ key: 'N', assigneeIds: [] });
    const urgentOnly = task({ key: 'G', priority: 'URGENT' });
    const ranked = rankNextActions([later, soon, held, unassigned, statusBlocked, today, late, planned, unassignedNoDate, urgentOnly], ctx);
    expect(codes(ranked)).toEqual([
      ['L', 'overdue'],
      ['T', 'due-today'],
      ['U', 'unassigned'],
      ['B', 'blocked-status'],
      ['H', 'blocked-by'],
      ['S', 'due-soon'],
    ]);
    expect(ranked.find((r) => r.candidate.key === 'S')!.reason).toEqual({ code: 'due-soon', days: 7 });
    expect(ranked.find((r) => r.candidate.key === 'H')!.reason).toEqual({ code: 'blocked-by', blockers: [{ id: 'z', key: 'RIG-99' }] });
  });

  it('within a group: most days late first, then priority, then the earlier date, then the oldest', () => {
    const a = task({ key: 'A', dueDate: day('2026-11-18') });
    const b = task({ key: 'B', dueDate: day('2026-11-10') });
    const c = task({ key: 'C', dueDate: day('2026-11-23'), priority: 'LOW' });
    const d = task({ key: 'D', dueDate: day('2026-11-23'), priority: 'HIGH' });
    const e = task({ key: 'E', dueDate: day('2026-11-22'), priority: 'LOW' });
    expect(codes(rankNextActions([a, c, e, d, b], ctx)).map(([k]) => k)).toEqual(['B', 'A', 'D', 'E', 'C']);
  });

  it('a row keeps its other reasons as small tags (blocks others, urgent)', () => {
    const r = rankNextActions([task({ key: 'K', dueDate: day('2026-11-22'), priority: 'URGENT', dependents: 2 })], ctx)[0]!;
    expect(r.reason).toEqual({ code: 'blocking', count: 2 });
    expect(r.also).toEqual([{ code: 'urgent' }, { code: 'due-soon', days: 2 }]);
  });

  it('a checklist item (1.23.3) counts by its own date only', () => {
    const item = { kind: 'checklist-item' as const, id: 'c1', key: null, priority: 'NORMAL' as const, dueDate: day('2026-11-19'), createdAt: new Date('2026-10-01T00:00:00Z') };
    const far = { ...item, id: 'c2', dueDate: day('2026-12-30') };
    expect(rankNextActions([item, far], ctx).map((r) => [r.candidate.id, r.reason.code])).toEqual([['c1', 'overdue']]);
  });
});
