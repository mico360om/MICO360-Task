import { describe, it, expect, vi } from 'vitest';
import { performMutation } from './perform-mutation';
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

const mut = (kind: string, payload: unknown): QueuedMutation => ({ id: 'm', kind, payload, createdAt: 0 });

describe('performMutation (offline replay mapping)', () => {
  it('replays every write kind to the right resource call', async () => {
    const r = mockResources();
    await performMutation(r, mut('task.create', { title: 't', projectId: 'p', columnId: 'c' }));
    expect(r.tasks.create).toHaveBeenCalledWith({ title: 't', projectId: 'p', columnId: 'c' });

    await performMutation(r, mut('task.move', { id: 't1', columnId: 'c2', position: 3 }));
    expect(r.tasks.move).toHaveBeenCalledWith('t1', 'c2', 3);

    await performMutation(r, mut('task.update', { id: 't1', patch: { title: 'x' } }));
    expect(r.tasks.update).toHaveBeenCalledWith('t1', { title: 'x' });

    await performMutation(r, mut('task.assign', { id: 't1', userIds: ['u1'] }));
    expect(r.tasks.assign).toHaveBeenCalledWith('t1', ['u1']);

    await performMutation(r, mut('task.unassign', { id: 't1', userId: 'u1' }));
    expect(r.tasks.unassign).toHaveBeenCalledWith('t1', 'u1');

    await performMutation(r, mut('checklist.add', { id: 't1', text: 'step' }));
    expect(r.tasks.addChecklistItem).toHaveBeenCalledWith('t1', 'step');

    await performMutation(r, mut('checklist.update', { itemId: 'k1', patch: { done: true } }));
    expect(r.tasks.updateChecklistItem).toHaveBeenCalledWith('k1', { done: true });

    await performMutation(r, mut('comment.add', { id: 't1', body: 'hi' }));
    expect(r.tasks.addComment).toHaveBeenCalledWith('t1', 'hi');

    await performMutation(r, mut('notification.read', { id: 'n1' }));
    expect(r.notifications.markRead).toHaveBeenCalledWith('n1');

    await performMutation(r, mut('chat.send', { conversationId: 'cv1', body: 'yo' }));
    expect(r.chat.send).toHaveBeenCalledWith('cv1', 'yo');
  });

  it('throws a permanent ApiError for an unknown kind (so it drains, not wedges)', async () => {
    const r = mockResources();
    await expect(performMutation(r, mut('bogus', {}))).rejects.toBeInstanceOf(ApiError);
  });
});
