import { describe, it, expect, vi } from 'vitest';
import { createMoveNotifier, moveNotice } from './task-move-notices';
import type { MoveResult } from './task-move-service';
import type { TaskRecord } from './task-repository';

const NOW = new Date('2026-10-24T06:00:00Z');
const moved = (title = 'Inspect the rig'): MoveResult & { actorId: string } => ({
  task: {
    id: 't4', key: 'OPS-17', title, description: null, projectId: 'ops', columnId: 'o-doing', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
    estimatedHours: null, actualHours: null, progress: 0, createdById: 'aisha', completedAt: null, recurrenceRule: null, recurrenceParentId: null,
    boardDate: null, version: 4, createdAt: NOW, updatedAt: NOW,
  } as TaskRecord,
  from: { projectId: 'rig', name: 'Rig Inspection', key: 'RIG-4' },
  to: { projectId: 'ops', name: 'Operations', key: 'OPS-17' },
  addedToTeam: [],
  unassigned: [],
  milestoneCleared: false,
  dueDateSet: null,
  statusChange: null,
  actorId: 'aisha',
});

describe('The notification that a task moved project', () => {
  it('names the key people knew it by and where it went, then the task as it is now', () => {
    expect(moveNotice(moved())).toEqual({ title: 'RIG-4 moved to Operations', body: 'OPS-17 · Inspect the rig' });
  });

  it('one notice also says when the move completed or re-opened it (no second “moved to Done” notice)', () => {
    expect(moveNotice({ ...moved(), statusChange: 'COMPLETED' }).title).toBe('RIG-4 moved to Operations and marked complete');
    expect(moveNotice({ ...moved(), statusChange: 'REOPENED' }).title).toBe('RIG-4 moved to Operations and reopened');
  });

  it('goes to the people following the task (its assignees and watchers) who can still open it — never the mover', async () => {
    const recipients = vi.fn(async () => ['omar', 'sara']);
    const notify = vi.fn(async () => undefined);
    await createMoveNotifier({ recipients, notify })(moved());
    expect(recipients).toHaveBeenCalledWith('t4', 'aisha');
    expect(notify.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      { userId: 'omar', type: 'TASK_STATUS', title: 'RIG-4 moved to Operations', body: 'OPS-17 · Inspect the rig', entityType: 'task', entityId: 't4' },
      { userId: 'sara', type: 'TASK_STATUS', title: 'RIG-4 moved to Operations', body: 'OPS-17 · Inspect the rig', entityType: 'task', entityId: 't4' },
    ]);
  });
});
