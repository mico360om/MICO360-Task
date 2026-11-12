import { describe, it, expect } from 'vitest';
import { BLOCK_MAX_MINUTES, BLOCK_MIN_MINUTES, blockProblem, blockShown, mayChangeBlock, mayPlanBlock, plannedMinutesByDay } from './work-blocks';

const at = (iso: string) => new Date(iso);

describe('work blocks: planned time to work on a task (owner, 11 Nov)', () => {
  it('a block is 15 minutes to 12 hours and ends after it starts', () => {
    expect(BLOCK_MIN_MINUTES).toBe(15);
    expect(BLOCK_MAX_MINUTES).toBe(12 * 60);
    expect(blockProblem(at('2026-11-12T06:00:00Z'), at('2026-11-12T07:00:00Z'))).toBeNull();
    expect(blockProblem(at('2026-11-12T06:00:00Z'), at('2026-11-12T06:00:00Z'))).toMatch(/ends after it starts/);
    expect(blockProblem(at('2026-11-12T07:00:00Z'), at('2026-11-12T06:00:00Z'))).toMatch(/ends after it starts/);
    expect(blockProblem(at('2026-11-12T06:00:00Z'), at('2026-11-12T06:10:00Z'))).toMatch(/at least 15 minutes/);
    expect(blockProblem(at('2026-11-12T06:00:00Z'), at('2026-11-12T18:01:00Z'))).toMatch(/12 hours at most/);
    expect(blockProblem(new Date('nope'), at('2026-11-12T06:00:00Z'))).toMatch(/time/);
  });

  it('anyone assigned books their own; the task’s creator or whoever runs its project plans time for its assignees (call 1)', () => {
    const task = { assigneeIds: ['ali', 'mona'], createdById: 'sara' };
    expect(mayPlanBlock({ viewerId: 'ali', personId: 'ali', task, runsProject: false })).toBe(true);
    expect(mayPlanBlock({ viewerId: 'ali', personId: 'mona', task, runsProject: false })).toBe(false);
    expect(mayPlanBlock({ viewerId: 'sara', personId: 'mona', task, runsProject: false })).toBe(true);
    expect(mayPlanBlock({ viewerId: 'boss', personId: 'mona', task, runsProject: true })).toBe(true);
    // Blocks are the assignees' time: never someone who isn't on the task (not even by a manager).
    expect(mayPlanBlock({ viewerId: 'boss', personId: 'zed', task, runsProject: true })).toBe(false);
    expect(mayPlanBlock({ viewerId: 'zed', personId: 'zed', task, runsProject: false })).toBe(false);
  });

  it('a block is changed or removed by its person, whoever planned it, or whoever runs the project', () => {
    const block = { userId: 'mona', plannedById: 'sara' };
    expect(mayChangeBlock({ viewerId: 'mona', block, runsProject: false })).toBe(true);
    expect(mayChangeBlock({ viewerId: 'sara', block, runsProject: false })).toBe(true);
    expect(mayChangeBlock({ viewerId: 'boss', block, runsProject: true })).toBe(true);
    expect(mayChangeBlock({ viewerId: 'ali', block, runsProject: false })).toBe(false);
  });

  it('kept but hidden while the task is binned or archived; a done task’s future blocks hidden, past ones kept as history (call 2)', () => {
    const now = at('2026-11-12T08:00:00Z');
    const past = { startAt: at('2026-11-11T06:00:00Z'), endAt: at('2026-11-11T07:00:00Z') };
    const future = { startAt: at('2026-11-13T06:00:00Z'), endAt: at('2026-11-13T07:00:00Z') };
    const open = { deletedAt: null, completedAt: null };
    expect(blockShown(future, open, now)).toBe(true);
    expect(blockShown(past, open, now)).toBe(true);
    expect(blockShown(future, { deletedAt: at('2026-11-12T07:00:00Z'), completedAt: null }, now)).toBe(false);
    expect(blockShown(future, { ...open, archivedAt: at('2026-11-12T07:00:00Z') }, now)).toBe(false);
    expect(blockShown(future, { deletedAt: null, completedAt: at('2026-11-12T07:00:00Z') }, now)).toBe(false);
    expect(blockShown(past, { deletedAt: null, completedAt: at('2026-11-12T07:00:00Z') }, now)).toBe(true);
  });

  it('planned minutes per person and company day (Workload), a block over midnight split between its days', () => {
    const tz = 'Asia/Muscat'; // UTC+4
    const rows = [
      { userId: 'ali', startAt: at('2026-11-12T05:00:00Z'), endAt: at('2026-11-12T07:00:00Z') }, // 09:00–11:00
      { userId: 'ali', startAt: at('2026-11-12T10:00:00Z'), endAt: at('2026-11-12T10:30:00Z') }, // 14:00–14:30
      { userId: 'ali', startAt: at('2026-11-12T19:00:00Z'), endAt: at('2026-11-12T21:00:00Z') }, // 23:00–01:00
      { userId: 'mona', startAt: at('2026-11-13T05:00:00Z'), endAt: at('2026-11-13T06:00:00Z') },
    ];
    const by = plannedMinutesByDay(rows, tz);
    expect(by.get('ali 2026-11-12')).toBe(120 + 30 + 60);
    expect(by.get('ali 2026-11-13')).toBe(60);
    expect(by.get('mona 2026-11-13')).toBe(60);
  });
});
