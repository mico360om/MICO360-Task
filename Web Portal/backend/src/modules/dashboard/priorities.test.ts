import { describe, it, expect } from 'vitest';
import { chipCounts, rankPriorities, reasonsOf, type Candidate, type RankContext, type TaskCandidate } from './priorities';

// 1.23.4 Smarter Dashboard — "My Priorities Today": which rows there are, why, and in what order.
const ctx: RankContext = { today: '2026-11-06', timeZone: 'Asia/Muscat' };
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
let n = 0;
const task = (o: Partial<TaskCandidate> = {}): TaskCandidate => {
  n += 1;
  return {
    kind: 'task',
    id: `t${n}`,
    key: `RIG-${n}`,
    priority: 'NORMAL',
    dueDate: null,
    createdAt: new Date(`2026-10-01T00:00:${String(n % 60).padStart(2, '0')}Z`),
    columnCategory: 'TODO',
    assigneeIds: ['me'],
    mine: true,
    team: false,
    blockers: [],
    dependents: 0,
    ...o,
  };
};
const codes = (c: Candidate) => reasonsOf(c, ctx).map((r) => r.code);

describe('own open tasks: why each one is there', () => {
  it('overdue, due today, due in the next 3 days — and nothing for a later or missing date', () => {
    expect(reasonsOf(task({ dueDate: day('2026-11-04') }), ctx)).toEqual([{ code: 'overdue', days: 2 }]);
    expect(codes(task({ dueDate: day('2026-11-06') }))).toEqual(['due-today']);
    expect(reasonsOf(task({ dueDate: day('2026-11-07') }), ctx)).toEqual([{ code: 'due-soon', days: 1 }]);
    expect(reasonsOf(task({ dueDate: day('2026-11-09') }), ctx)).toEqual([{ code: 'due-soon', days: 3 }]);
    expect(codes(task({ dueDate: day('2026-11-10') }))).toEqual([]);
    expect(codes(task())).toEqual([]);
  });

  it('a due date stored as an instant is read on its company day (not its UTC day)', () => {
    // 22:00 UTC on the 5th is the 6th in Muscat (UTC+4): due today, not overdue.
    expect(codes(task({ dueDate: new Date('2026-11-05T22:00:00.000Z') }))).toEqual(['due-today']);
  });

  it('urgent priority (any date), blocking other open tasks, and both kinds of blocked', () => {
    expect(codes(task({ priority: 'URGENT' }))).toEqual(['urgent']);
    expect(codes(task({ priority: 'HIGH' }))).toEqual([]);
    expect(reasonsOf(task({ dependents: 3 }), ctx)).toEqual([{ code: 'blocking', count: 3 }]);
    expect(codes(task({ columnCategory: 'BLOCKED' }))).toEqual(['blocked-status']);
    expect(reasonsOf(task({ blockers: [{ id: 'b1', key: 'RIG-4' }] }), ctx)).toEqual([{ code: 'blocked-by', blockers: [{ id: 'b1', key: 'RIG-4' }] }]);
  });

  it('every reason a task has, strongest first', () => {
    const t = task({ dueDate: day('2026-11-06'), dependents: 2, priority: 'URGENT', columnCategory: 'BLOCKED' });
    expect(codes(t)).toEqual(['blocking', 'due-today', 'urgent', 'blocked-status']);
  });
});

describe('managers: their projects’ tasks that need them (owner 2, the escalation rule in full)', () => {
  it('no one assigned — whatever the date', () => {
    expect(codes(task({ mine: false, team: true, assigneeIds: [] }))).toEqual(['unassigned']);
    expect(codes(task({ mine: false, team: true, assigneeIds: [], dueDate: day('2026-11-05') }))).toEqual(['unassigned']);
  });

  it('overdue 3 days or more (not 2), or in a Blocked column, when assigned to others', () => {
    expect(reasonsOf(task({ mine: false, team: true, assigneeIds: ['omar'], dueDate: day('2026-11-03') }), ctx)).toEqual([{ code: 'team-overdue', days: 3 }]);
    expect(codes(task({ mine: false, team: true, assigneeIds: ['omar'], dueDate: day('2026-11-04') }))).toEqual([]);
    expect(codes(task({ mine: false, team: true, assigneeIds: ['omar'], columnCategory: 'BLOCKED' }))).toEqual(['team-blocked']);
    expect(codes(task({ mine: false, team: true, assigneeIds: ['omar'], priority: 'URGENT', dueDate: day('2026-11-06') }))).toEqual([]);
    // Unassigned and 5 days late: the escalation first, "No one assigned" beside it.
    expect(codes(task({ mine: false, team: true, assigneeIds: [], dueDate: day('2026-11-01') }))).toEqual(['team-overdue', 'unassigned']);
  });

  it('someone else’s task outside the projects they run is never there', () => {
    expect(codes(task({ mine: false, team: false, assigneeIds: [], dueDate: day('2026-10-01'), columnCategory: 'BLOCKED' }))).toEqual([]);
  });

  it('their own task is judged as their own (never as a team row)', () => {
    expect(codes(task({ mine: true, team: true, assigneeIds: ['me', 'omar'], dueDate: day('2026-11-01') }))).toEqual(['overdue']);
  });
});

describe('approvals, action items and checklist items', () => {
  it('approvals wait for the person, with when they were asked', () => {
    const since = new Date('2026-11-04T09:00:00Z');
    expect(reasonsOf({ kind: 'approval', id: 'a', key: 'RIG-9', priority: 'NORMAL', dueDate: null, createdAt: since, requestedAt: since }, ctx)).toEqual([
      { code: 'approval', since: since.toISOString() },
    ]);
  });

  it('dated items: overdue, today or the next 3 days only', () => {
    const item = (due: string | null) => ({ kind: 'action-item' as const, id: `ai-${due}`, key: null, priority: 'NORMAL' as const, dueDate: due ? day(due) : null, createdAt: day('2026-10-01') });
    expect(reasonsOf(item('2026-11-01'), ctx)).toEqual([{ code: 'overdue', days: 5 }]);
    expect(reasonsOf(item('2026-11-06'), ctx)).toEqual([{ code: 'due-today' }]);
    expect(reasonsOf(item('2026-11-08'), ctx)).toEqual([{ code: 'due-soon', days: 2 }]);
    expect(reasonsOf(item('2026-11-12'), ctx)).toEqual([]);
    expect(reasonsOf(item(null), ctx)).toEqual([]);
    expect(reasonsOf({ ...item('2026-11-05'), kind: 'checklist-item' }, ctx)).toEqual([{ code: 'overdue', days: 1 }]);
  });
});

describe('the order: most urgent first (design §Order)', () => {
  it('the nine groups, in order, each row once with its strongest reason and the rest as tags', () => {
    const rows = [
      task({ id: 'soon', dueDate: day('2026-11-08') }),
      task({ id: 'blockedBy', blockers: [{ id: 'x', key: 'RIG-4' }] }),
      task({ id: 'unassigned', mine: false, team: true, assigneeIds: [] }),
      task({ id: 'teamLate', mine: false, team: true, assigneeIds: ['omar'], dueDate: day('2026-11-02') }),
      task({ id: 'urgent', priority: 'URGENT', dueDate: day('2026-11-09') }),
      task({ id: 'today', dueDate: day('2026-11-06') }),
      task({ id: 'blocks', dependents: 2, dueDate: day('2026-11-06') }),
      { kind: 'approval' as const, id: 'approval', key: 'RIG-7', priority: 'LOW' as const, dueDate: null, createdAt: day('2026-10-01'), requestedAt: new Date('2026-11-05T10:00:00Z') },
      task({ id: 'late', dueDate: day('2026-11-05') }),
      task({ id: 'nothing', dueDate: day('2026-12-01') }),
    ];
    const ranked = rankPriorities(rows, ctx);
    expect(ranked.map((r) => r.candidate.id)).toEqual(['late', 'approval', 'blocks', 'today', 'urgent', 'teamLate', 'unassigned', 'blockedBy', 'soon']);
    expect(ranked.map((r) => r.group)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const blocks = ranked.find((r) => r.candidate.id === 'blocks')!;
    expect(blocks.reason).toEqual({ code: 'blocking', count: 2 });
    expect(blocks.also).toEqual([{ code: 'due-today' }]);
    // Urgent with a date 3 days away: Urgent (group 5), the date as a tag.
    expect(ranked.find((r) => r.candidate.id === 'urgent')!.also).toEqual([{ code: 'due-soon', days: 3 }]);
  });

  it('overdue: most days late first, then higher priority', () => {
    const rows = [
      task({ id: 'a', dueDate: day('2026-11-05'), priority: 'URGENT' }),
      task({ id: 'b', dueDate: day('2026-11-01') }),
      task({ id: 'c', dueDate: day('2026-11-05'), priority: 'LOW' }),
      { kind: 'action-item' as const, id: 'd', key: null, priority: 'HIGH' as const, dueDate: day('2026-11-03'), createdAt: day('2026-10-01') },
    ];
    expect(rankPriorities(rows, ctx).map((r) => r.candidate.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('approvals: the longest waiting first', () => {
    const ap = (id: string, at: string) => ({ kind: 'approval' as const, id, key: id, priority: 'URGENT' as const, dueDate: null, createdAt: day('2026-10-01'), requestedAt: new Date(at) });
    expect(rankPriorities([ap('new', '2026-11-05T10:00:00Z'), ap('old', '2026-11-01T10:00:00Z')], ctx).map((r) => r.candidate.id)).toEqual(['old', 'new']);
  });

  it('blocks others: the most blocked first', () => {
    const rows = [task({ id: 'two', dependents: 2, priority: 'URGENT' }), task({ id: 'five', dependents: 5, priority: 'LOW' })];
    expect(rankPriorities(rows, ctx).map((r) => r.candidate.id)).toEqual(['five', 'two']);
  });

  it('within a group: higher priority, then the earlier due date, then the oldest', () => {
    const rows = [
      task({ id: 'normal-early', dueDate: day('2026-11-07'), createdAt: day('2026-10-05') }),
      task({ id: 'high-late', priority: 'HIGH', dueDate: day('2026-11-09') }),
      task({ id: 'normal-late-old', dueDate: day('2026-11-09'), createdAt: day('2026-09-01') }),
      task({ id: 'normal-late-new', dueDate: day('2026-11-09'), createdAt: day('2026-10-20') }),
    ];
    expect(rankPriorities(rows, ctx).map((r) => r.candidate.id)).toEqual(['high-late', 'normal-early', 'normal-late-old', 'normal-late-new']);
  });

  it('a row with no reason is left out', () => {
    expect(rankPriorities([task({ dueDate: day('2026-11-20') }), task({ mine: false, team: false })], ctx)).toEqual([]);
  });
});

describe('filter chips and their counts', () => {
  it('each row counts under every chip one of its reasons belongs to', () => {
    const ranked = rankPriorities(
      [
        task({ id: 'late-blocked', dueDate: day('2026-11-05'), columnCategory: 'BLOCKED' }),
        task({ id: 'today', dueDate: day('2026-11-06') }),
        task({ id: 'soon', dueDate: day('2026-11-08') }),
        task({ id: 'dep', blockers: [{ id: 'x', key: 'RIG-1' }] }),
        task({ id: 'team-late', mine: false, team: true, assigneeIds: ['o'], dueDate: day('2026-11-01') }),
        task({ id: 'team-blocked', mine: false, team: true, assigneeIds: ['o'], columnCategory: 'BLOCKED' }),
        task({ id: 'nobody', mine: false, team: true, assigneeIds: [] }),
        { kind: 'approval' as const, id: 'ap', key: 'RIG-3', priority: 'NORMAL' as const, dueDate: null, createdAt: day('2026-10-01'), requestedAt: null },
        task({ id: 'urgent', priority: 'URGENT' }),
      ],
      ctx,
    );
    expect(ranked.find((r) => r.candidate.id === 'late-blocked')!.chips).toEqual(['overdue', 'blocked']);
    expect(ranked.find((r) => r.candidate.id === 'team-blocked')!.chips).toEqual(['blocked', 'team']);
    expect(ranked.find((r) => r.candidate.id === 'urgent')!.chips).toEqual([]);
    expect(chipCounts(ranked)).toEqual({ all: 9, overdue: 2, today: 1, approvals: 1, blocked: 3, upcoming: 1, team: 3 });
  });
});
