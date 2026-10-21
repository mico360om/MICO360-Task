import { describe, it, expect, vi } from 'vitest';
import { performMutation, describeMutation, refreshesAfterReplay } from './perform-mutation';
import { ApiError, NetworkError } from './api-client';
import { moveRefreshes } from './task-cache';
import type { ResourcesApi } from './resources';
import type { QueuedMutation } from './sync-queue';

function mockResources() {
  const tasks = {
    create: vi.fn(async () => ({})),
    move: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    assign: vi.fn(async () => ({})),
    unassign: vi.fn(async () => undefined),
    addChecklistItem: vi.fn(async () => ({})),
    updateChecklistItem: vi.fn(async () => ({})),
    addComment: vi.fn(async () => ({})),
  };
  const notifications = { markRead: vi.fn(async () => ({})) };
  const chat = { send: vi.fn(async () => ({})) };
  return { tasks, notifications, chat } as unknown as ResourcesApi & {
    tasks: typeof tasks;
    notifications: typeof notifications;
    chat: typeof chat;
  };
}

const mut = (kind: string, payload: unknown): QueuedMutation => ({
  id: 'm',
  kind,
  payload,
  createdAt: 0,
  userId: 'u1',
  idempotencyKey: 'idem-1',
  attempts: 0,
  status: 'pending',
});

const KEY = { idempotencyKey: 'idem-1' };

describe('performMutation (offline replay mapping)', () => {
  it('replays every write kind to the right resource call, with the idempotency key on POSTs', async () => {
    const r = mockResources();
    await performMutation(r, mut('task.create', { title: 't', projectId: 'p', columnId: 'c', boardDate: '2026-09-26' }));
    expect(r.tasks.create).toHaveBeenCalledWith({ title: 't', projectId: 'p', columnId: 'c', boardDate: '2026-09-26' }, KEY);

    await performMutation(r, mut('task.move', { id: 't1', columnId: 'c2', position: 3 }));
    expect(r.tasks.move).toHaveBeenCalledWith('t1', 'c2', 3);

    await performMutation(r, mut('task.update', { id: 't1', patch: { title: 'x' } }));
    expect(r.tasks.update).toHaveBeenCalledWith('t1', { title: 'x' });

    await performMutation(r, mut('task.assign', { id: 't1', userIds: ['u1'] }));
    expect(r.tasks.assign).toHaveBeenCalledWith('t1', ['u1'], KEY);

    await performMutation(r, mut('task.unassign', { id: 't1', userId: 'u1' }));
    expect(r.tasks.unassign).toHaveBeenCalledWith('t1', 'u1');

    await performMutation(r, mut('checklist.add', { id: 't1', text: 'step' }));
    expect(r.tasks.addChecklistItem).toHaveBeenCalledWith('t1', 'step', KEY);

    await performMutation(r, mut('checklist.update', { itemId: 'k1', patch: { done: true } }));
    expect(r.tasks.updateChecklistItem).toHaveBeenCalledWith('k1', { done: true });

    await performMutation(r, mut('comment.add', { id: 't1', body: 'hi' }));
    expect(r.tasks.addComment).toHaveBeenCalledWith('t1', 'hi', undefined, KEY);

    await performMutation(r, mut('notification.read', { id: 'n1' }));
    expect(r.notifications.markRead).toHaveBeenCalledWith('n1');

    await performMutation(r, mut('chat.send', { conversationId: 'cv1', body: 'yo' }));
    expect(r.chat.send).toHaveBeenCalledWith('cv1', 'yo', KEY);
  });

  it('throws a permanent ApiError for an unknown kind (so it is marked failed, not wedged)', async () => {
    const r = mockResources();
    await expect(performMutation(r, mut('bogus', {}))).rejects.toBeInstanceOf(ApiError);
  });
});

describe('describeMutation', () => {
  it('summarises queued changes for the sync list', () => {
    expect(describeMutation({ kind: 'comment.add', payload: { body: 'Looks good' } })).toBe('Comment “Looks good”');
    expect(describeMutation({ kind: 'task.create', payload: { title: 'Ship' } })).toBe('New task “Ship”');
    expect(describeMutation({ kind: 'chat.send', payload: { body: 'x'.repeat(60) } })).toBe(`Message “${'x'.repeat(40)}…”`);
    expect(describeMutation({ kind: '???', payload: null })).toBe('A change');
  });
});

describe('performMutation — a replayed edit that the server had already saved', () => {
  const conflict = () => new ApiError(409, 'VERSION_CONFLICT', 'This task was changed by someone else. Reload and try again.');
  const edit = mut('task.update', { id: 't1', patch: { title: 'Ship it', dueDate: '2026-10-12', expectedVersion: 5 } });

  it('counts as done when the reloaded task already holds the edit (its first try timed out after saving)', async () => {
    const r = mockResources();
    const saved = { id: 't1', title: 'Ship it', dueDate: '2026-10-12T00:00:00.000Z', version: 6 };
    r.tasks.update.mockRejectedValueOnce(conflict());
    (r.tasks as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async () => saved);
    // Resolves with the task as it is, so this phone's later edits move on to its version.
    await expect(performMutation(r, edit)).resolves.toBe(saved);
  });

  it('is still a conflict when the task holds something else (someone else changed it)', async () => {
    const r = mockResources();
    const err = conflict();
    r.tasks.update.mockRejectedValueOnce(err);
    (r.tasks as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async () => ({ id: 't1', title: 'Their title', dueDate: '2026-10-12', version: 6 }));
    await expect(performMutation(r, edit)).rejects.toBe(err);
  });

  it('waits for a connection when the reload gets no answer (never marked failed for that)', async () => {
    const r = mockResources();
    r.tasks.update.mockRejectedValueOnce(conflict());
    const offline = new NetworkError('Network request failed.');
    (r.tasks as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async () => {
      throw offline;
    });
    await expect(performMutation(r, edit)).rejects.toBe(offline);
  });

  it('keeps the conflict when the task can’t be reloaded (deleted, no access)', async () => {
    const r = mockResources();
    const err = conflict();
    r.tasks.update.mockRejectedValueOnce(err);
    (r.tasks as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async () => {
      throw new ApiError(404, 'NOT_FOUND', 'Task not found.');
    });
    await expect(performMutation(r, edit)).rejects.toBe(err);
  });

  it('reloads only for a version conflict', async () => {
    const r = mockResources();
    const get = vi.fn(async () => ({}));
    (r.tasks as unknown as { get: typeof get }).get = get;
    r.tasks.update.mockRejectedValueOnce(new ApiError(400, 'VALIDATION', 'Invalid input.'));
    await expect(performMutation(r, edit)).rejects.toBeInstanceOf(ApiError);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('refreshesAfterReplay (what a replayed change refreshes, instead of everything)', () => {
  const task = (id: string) => [{ queryKey: ['task', id], exact: true }, { queryKey: ['task', id, 'activity'], exact: true }, { listsHolding: id }];

  it('a new task: its project’s lists, My Tasks and the project’s progress', () => {
    expect(refreshesAfterReplay(mut('task.create', { projectId: 'p1', title: 'x', columnId: 'c1' }))).toEqual([
      { queryKey: ['tasks', 'project', 'p1'] },
      { queryKey: ['tasks', 'mine'] },
      { queryKey: ['project', 'p1', 'progress'], exact: true },
    ]);
  });

  it('a move: the task, its activity, the lists holding it and its project’s progress', () => {
    expect(refreshesAfterReplay(mut('task.move', { id: 't1', columnId: 'c2' }))).toEqual([...task('t1'), { progressFor: 't1' }]);
  });

  it('a move queued with its project: what the same move made online refreshes, its project’s board days too', () => {
    // Finishing a repeating task adds its next copy to a later board day, which doesn't hold the task.
    const replayed = refreshesAfterReplay(mut('task.move', { id: 't1', columnId: 'c2', projectId: 'p1' }));
    expect(replayed).toContainEqual({ queryKey: ['tasks', 'project', 'p1'] });
    expect(replayed).toEqual(moveRefreshes('t1', 'p1'));
    expect(refreshesAfterReplay(mut('task.move', { id: 't1', columnId: 'c2', projectId: '' }))).toEqual([...task('t1'), { progressFor: 't1' }]);
  });

  it('an edit: what the edit changed', () => {
    expect(refreshesAfterReplay(mut('task.update', { id: 't1', patch: { title: 'x', expectedVersion: 2 } }))).toEqual(task('t1'));
    expect(refreshesAfterReplay(mut('task.update', { id: 't1', patch: { dueDate: null } }))).toContainEqual({ progressFor: 't1' });
  });

  it('people, checklist and comments: that part of the task, plus the lists showing it', () => {
    expect(refreshesAfterReplay(mut('task.assign', { id: 't1', userIds: ['u2'] }))).toEqual([
      { queryKey: ['task', 't1', 'assignees'], exact: true },
      { queryKey: ['task', 't1', 'activity'], exact: true },
      { queryKey: ['tasks', 'mine'] },
      { listsHolding: 't1' },
    ]);
    expect(refreshesAfterReplay(mut('checklist.add', { id: 't1', text: 'x' }))).toEqual([
      { queryKey: ['task', 't1', 'checklist'], exact: true },
      { queryKey: ['task', 't1'], exact: true },
      { queryKey: ['task', 't1', 'activity'], exact: true },
      { listsHolding: 't1' },
    ]);
    expect(refreshesAfterReplay(mut('comment.add', { id: 't1', body: 'x' }))).toEqual([
      { queryKey: ['task', 't1', 'comments'], exact: true },
      { queryKey: ['task', 't1', 'activity'], exact: true },
      { listsHolding: 't1' },
    ]);
  });

  it('a subtask change saved by an older version, without its task: every open checklist', () => {
    expect(refreshesAfterReplay(mut('checklist.update', { itemId: 'i1', patch: { done: true } }))).toEqual([
      { queryKey: ['task'] },
      { queryKey: ['tasks'] },
    ]);
    expect(refreshesAfterReplay(mut('checklist.update', { id: 't1', itemId: 'i1', patch: { done: true } }))).toEqual(
      refreshesAfterReplay(mut('checklist.add', { id: 't1', text: 'x' })),
    );
  });

  it('notifications and chat messages', () => {
    expect(refreshesAfterReplay(mut('notification.read', { id: 'n1' }))).toEqual([{ queryKey: ['notifications'] }]);
    expect(refreshesAfterReplay(mut('chat.send', { conversationId: 'c1', body: 'hi' }))).toEqual([
      { queryKey: ['chat', 'messages', 'c1'] },
      { queryKey: ['chat', 'conversations'] },
    ]);
  });

  it('anything it doesn’t know: everything, as before', () => {
    expect(refreshesAfterReplay(mut('something.new', {}))).toEqual([{ queryKey: [] }]);
  });
});
