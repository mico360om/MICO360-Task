import { describe, it, expect, vi } from 'vitest';
import { performMutation, describeMutation } from './perform-mutation';
import { ApiError } from './api-client';
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
