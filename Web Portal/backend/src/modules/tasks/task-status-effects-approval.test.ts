import { describe, it, expect, vi } from 'vitest';
import { createStatusChangeEffects, type StatusEffectsDeps } from './task-status-effects';
import type { TaskRecord } from './task-repository';

const NOW = new Date('2026-10-30T06:00:00Z');
const COLUMNS: Record<string, { name: string; category: string }> = {
  doing: { name: 'In Progress', category: 'IN_PROGRESS' },
  review: { name: 'Review', category: 'REVIEW' },
  done: { name: 'Done', category: 'DONE' },
};
const task = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't1', key: 'RIG-4', title: 'Pressure test report', description: null, projectId: 'rig', columnId: 'review', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
  estimatedHours: null, actualHours: null, progress: 60, createdById: 'sara', completedAt: null, recurrenceRule: null, recurrenceParentId: null, boardDate: null,
  version: 3, createdAt: NOW, updatedAt: NOW, needsApproval: true, ...over,
});

function world(over: Partial<StatusEffectsDeps> = {}) {
  const deps = {
    column: vi.fn(async (id: string) => COLUMNS[id] ?? null),
    nextCopy: vi.fn(async () => ({ id: 'copy1' })),
    announceCopy: vi.fn(async () => {}),
    followActionItems: vi.fn(async () => {}),
    recipients: vi.fn(async () => ['bilal']),
    approvers: vi.fn(async () => ['omar', 'zara']),
    approvalAudience: vi.fn(async () => ['sara', 'bilal']),
    sentBackComment: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    record: vi.fn(async () => undefined),
    onError: vi.fn(),
    ...over,
  };
  return { deps, statusChanged: createStatusChangeEffects(deps) };
}
const notice = (userId: string, title: string) => ({ userId, type: 'TASK_APPROVAL', title, body: 'RIG-4 · Pressure test report', entityType: 'task', entityId: 't1' });

describe('What an approval step does', () => {
  it('starts waiting: a history line, and the people who can approve are told — not the followers, no next copy', async () => {
    const w = world();
    await w.statusChanged(task({ recurrenceRule: { freq: 'WEEKLY', interval: 1 } }), 'doing', 'sara', { approval: 'REQUESTED' });
    expect(w.deps.record).toHaveBeenCalledWith({ taskId: 't1', projectId: 'rig', userId: 'sara', action: 'APPROVAL_REQUESTED', meta: { from: 'In Progress', to: 'Review' } });
    expect(w.deps.approvers).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), 'sara');
    expect(w.deps.notify.mock.calls.map((c) => c[0])).toEqual([notice('omar', 'Waiting for your approval'), notice('zara', 'Waiting for your approval')]);
    expect(w.deps.recipients).not.toHaveBeenCalled();
    expect(w.deps.nextCopy).not.toHaveBeenCalled();
    expect(w.deps.followActionItems).not.toHaveBeenCalled();
  });

  it('waiting where it is (no Review column): still a history line and the approvers’ notice', async () => {
    const w = world();
    await w.statusChanged(task({ columnId: 'doing' }), 'doing', 'sara', { approval: 'REQUESTED' });
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVAL_REQUESTED', meta: { from: 'In Progress', to: 'In Progress' } }));
    expect(w.deps.notify).toHaveBeenCalledTimes(2);
  });

  it('approved: an APPROVED line, the next copy, action items done, and the assignees and finisher told (no "moved to Done")', async () => {
    const w = world();
    const t = task({ columnId: 'done', completedAt: NOW, progress: 100, recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    await w.statusChanged(t, 'review', 'omar', { approval: 'APPROVED', requestedById: 'sara' });
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ userId: 'omar', action: 'APPROVED', meta: { from: 'Review', to: 'Done' } }));
    expect(w.deps.nextCopy).toHaveBeenCalledTimes(1);
    expect(w.deps.followActionItems).toHaveBeenCalledWith('t1', true);
    expect(w.deps.approvalAudience).toHaveBeenCalledWith(t, 'omar', 'sara');
    expect(w.deps.notify.mock.calls.map((c) => c[0])).toEqual([notice('sara', 'Your task was approved'), notice('bilal', 'Your task was approved')]);
  });

  it('an approver finishing it themselves: a COMPLETED line marked approved, and the usual status notice', async () => {
    const w = world();
    await w.statusChanged(task({ columnId: 'done', completedAt: NOW }), 'doing', 'omar', { approval: 'APPROVED_ON_FINISH' });
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPLETED', meta: { from: 'In Progress', to: 'Done', approved: true } }));
    expect(w.deps.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'bilal', type: 'TASK_STATUS', title: 'Task moved to Done' }));
  });

  it('sent back: a SENT_BACK line with the reason, the reason as the approver’s comment, and the people on it told', async () => {
    const w = world();
    const t = task({ columnId: 'doing' });
    await w.statusChanged(t, 'review', 'omar', { approval: 'SENT_BACK', reason: 'Add the gauge readings', requestedById: 'sara' });
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'SENT_BACK', meta: { from: 'Review', to: 'In Progress', reason: 'Add the gauge readings' } }));
    expect(w.deps.sentBackComment).toHaveBeenCalledWith(t, 'omar', 'Add the gauge readings');
    expect(w.deps.notify.mock.calls.map((c) => c[0])).toEqual([notice('sara', 'Sent back: Add the gauge readings'), notice('bilal', 'Sent back: Add the gauge readings')]);
    expect(w.deps.recipients).not.toHaveBeenCalled();
  });

  it('a long reason is cut in the notice title (the comment keeps it whole)', async () => {
    const w = world();
    const reason = 'x'.repeat(300);
    await w.statusChanged(task({ columnId: 'doing' }), 'review', 'omar', { approval: 'SENT_BACK', reason, requestedById: 'sara' });
    const title = (w.deps.notify.mock.calls[0]![0] as { title: string }).title;
    expect(title.length).toBeLessThanOrEqual(140);
    expect(title.endsWith('…')).toBe(true);
    expect(w.deps.sentBackComment).toHaveBeenCalledWith(expect.anything(), 'omar', reason);
  });

  it('withdrawn (moved back by hand): an APPROVAL_WITHDRAWN line and the usual status notice', async () => {
    const w = world();
    await w.statusChanged(task({ columnId: 'doing' }), 'review', 'sara', { approval: 'WITHDRAWN' });
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVAL_WITHDRAWN', meta: { from: 'Review', to: 'In Progress' } }));
    expect(w.deps.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'TASK_STATUS', title: 'Task moved to In Progress' }));
  });

  it('approval switched off while waiting: a plain COMPLETED line and the next copy', async () => {
    const w = world();
    await w.statusChanged(task({ columnId: 'done', completedAt: NOW, recurrenceRule: { freq: 'DAILY', interval: 1 } }), 'review', 'omar', { approval: 'SWITCHED_OFF' });
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPLETED', meta: { from: 'Review', to: 'Done' } }));
    expect(w.deps.nextCopy).toHaveBeenCalledTimes(1);
  });

  it('quietly (a move to another project): no approval notices either', async () => {
    const w = world();
    await w.statusChanged(task({ columnId: 'done', completedAt: NOW }), 'review', 'omar', { approval: 'APPROVED', notify: false });
    expect(w.deps.notify).not.toHaveBeenCalled();
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVED' }));
  });
});
