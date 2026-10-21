import { describe, it, expect, vi } from 'vitest';
import { performMutation, describeMutation, isKeyedCreate, refreshesAfterReplay, waitingReason } from './perform-mutation';

describe('waitingReason — why a waiting change can be discarded (2c review fix 4)', () => {
  it('says the server hasn’t answered, or that it has waited a long while', () => {
    expect(waitingReason({ timeouts: 2, createdAt: 0 }, 60_000)).toBe('The server hasn’t answered it yet (2 tries). It may already be saved.');
    expect(waitingReason({ timeouts: 1, createdAt: 0 }, 60_000)).toBe('The server hasn’t answered it yet (1 try). It may already be saved.');
    expect(waitingReason({ createdAt: 0 }, 20 * 60_000)).toBe('Waiting to sync for 20 minutes.');
    expect(waitingReason({ createdAt: 0 }, 3 * 3_600_000)).toBe('Waiting to sync for 3 hours.');
  });
});
import { createTaskWrites, isReloaded, noteReplayed } from './task-writes';
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

describe('performMutation: a chat message kept on this phone (3a)', () => {
  it('is sent with its client id and comes back as the server stored it', async () => {
    const r = mockResources();
    const saved = { id: 'm9', conversationId: 'cv1', body: 'yo', clientId: 'cid-1' };
    r.chat.send.mockResolvedValueOnce(saved);
    const result = await performMutation(r, mut('chat.send', { conversationId: 'cv1', body: 'yo', clientId: 'cid-1' }));
    expect(r.chat.send).toHaveBeenCalledWith('cv1', 'yo', { idempotencyKey: 'idem-1', clientId: 'cid-1' });
    expect(result).toBe(saved);
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

  it('says its answer is the reloaded task, so its version is never taken as this phone’s own (2c review fix 2)', async () => {
    const r = mockResources();
    // This phone's save made 6; a colleague's edit made 7 — the reload shows 7.
    const reloaded = { id: 't1', title: 'Ship it', dueDate: '2026-10-12T00:00:00.000Z', version: 7 };
    r.tasks.update.mockRejectedValueOnce(conflict());
    (r.tasks as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async () => reloaded);
    const result = await performMutation(r, edit);
    expect(isReloaded(result)).toBe(true);
    const writes = createTaskWrites();
    noteReplayed(writes, edit, result);
    expect(writes.expectedVersion('t1', 5)).toBe(5);
    // A replay that went through is the phone's own answer.
    r.tasks.update.mockResolvedValueOnce({ id: 't1', version: 8 });
    expect(isReloaded(await performMutation(r, edit))).toBe(false);
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

  it('a new task: its project’s lists, My Tasks, the project’s progress and the calendar', () => {
    expect(refreshesAfterReplay(mut('task.create', { projectId: 'p1', title: 'x', columnId: 'c1' }))).toEqual([
      { queryKey: ['tasks', 'project', 'p1'] },
      { queryKey: ['tasks', 'mine'] },
      { queryKey: ['project', 'p1', 'progress'], exact: true },
      { queryKey: ['tasks', 'calendar'] },
    ]);
  });

  it('a move: the task, its activity, the lists holding it, its project’s progress and My Action Items', () => {
    expect(refreshesAfterReplay(mut('task.move', { id: 't1', columnId: 'c2' }))).toEqual([...task('t1'), { progressFor: 't1' }, { queryKey: ['action-items', 'mine'], later: true }]);
  });

  it('a move queued with its project: what the same move made online refreshes, its project’s board days too', () => {
    // Finishing a repeating task adds its next copy to a later board day, which doesn't hold the task.
    const replayed = refreshesAfterReplay(mut('task.move', { id: 't1', columnId: 'c2', projectId: 'p1' }));
    expect(replayed).toContainEqual({ queryKey: ['tasks', 'project', 'p1'] });
    expect(replayed).toEqual(moveRefreshes('t1', 'p1'));
    expect(refreshesAfterReplay(mut('task.move', { id: 't1', columnId: 'c2', projectId: '' }))).toEqual([...task('t1'), { progressFor: 't1' }, { queryKey: ['action-items', 'mine'], later: true }]);
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
    // The thread gets the server's copy put in directly (chat-cache): only the inbox is fetched again.
    expect(refreshesAfterReplay(mut('chat.send', { conversationId: 'c1', body: 'hi', clientId: 'k1' }))).toEqual([{ queryKey: ['chat', 'conversations'] }]);
  });

  it('anything it doesn’t know: everything, as before', () => {
    expect(refreshesAfterReplay(mut('something.new', {}))).toEqual([{ queryKey: [] }]);
  });
});

describe('meeting changes made offline (2b: notes, action items, the agenda’s ticks, attendance)', () => {
  function meetingResources() {
    const meetings = {
      addNote: vi.fn(async () => ({})),
      addActionItem: vi.fn(async () => ({})),
      updateActionItem: vi.fn(async () => ({})),
      updateAgendaItem: vi.fn(async () => ({})),
      updateAttendee: vi.fn(async () => ({})),
    };
    return { meetings } as unknown as ResourcesApi & { meetings: typeof meetings };
  }

  it('replays each to the meeting’s own call, with the idempotency key on what it adds', async () => {
    const r = meetingResources();
    await performMutation(r, mut('meeting.note.add', { meetingId: 'm1', body: 'Go live in May', format: 'PLAIN', type: 'DECISION', highlighted: true }));
    expect(r.meetings.addNote).toHaveBeenCalledWith('m1', { body: 'Go live in May', format: 'PLAIN', type: 'DECISION', highlighted: true }, KEY);
    await performMutation(r, mut('meeting.action.add', { meetingId: 'm1', description: 'Send the plan', assigneeId: null, dueDate: null, priority: 'HIGH' }));
    expect(r.meetings.addActionItem).toHaveBeenCalledWith('m1', { description: 'Send the plan', assigneeId: null, dueDate: null, priority: 'HIGH' }, KEY);
    await performMutation(r, mut('meeting.action.update', { meetingId: 'm1', id: 'ai1', patch: { status: 'COMPLETED' } }));
    expect(r.meetings.updateActionItem).toHaveBeenCalledWith('ai1', { status: 'COMPLETED' });
    await performMutation(r, mut('meeting.agenda.covered', { meetingId: 'm1', itemId: 'g1', completed: true }));
    expect(r.meetings.updateAgendaItem).toHaveBeenCalledWith('m1', 'g1', { completed: true });
    await performMutation(r, mut('meeting.attendance', { meetingId: 'm1', attendeeId: 'a1', attendance: 'LATE' }));
    expect(r.meetings.updateAttendee).toHaveBeenCalledWith('m1', 'a1', { attendance: 'LATE' });
  });

  it('refreshes that part of the meeting once replayed (the lists’ counts when next shown)', () => {
    const counts = [{ queryKey: ['meetings'], later: true }, { projectMeetingsOf: 'm1' }];
    expect(refreshesAfterReplay(mut('meeting.note.add', { meetingId: 'm1', body: 'x' }))).toEqual([{ queryKey: ['meeting', 'm1', 'notes'], exact: true }, ...counts]);
    expect(refreshesAfterReplay(mut('meeting.action.add', { meetingId: 'm1', description: 'x' }))).toEqual([
      { queryKey: ['meeting', 'm1', 'action-items'], exact: true },
      { queryKey: ['action-items', 'mine'] },
      ...counts,
    ]);
    expect(refreshesAfterReplay(mut('meeting.action.update', { meetingId: 'm1', id: 'ai1', patch: {} }))).toEqual(refreshesAfterReplay(mut('meeting.action.add', { meetingId: 'm1' })));
    expect(refreshesAfterReplay(mut('meeting.agenda.covered', { meetingId: 'm1', itemId: 'g1', completed: true }))).toEqual([{ queryKey: ['meeting', 'm1', 'agenda'], exact: true }]);
    expect(refreshesAfterReplay(mut('meeting.attendance', { meetingId: 'm1', attendeeId: 'a1', attendance: 'LATE' }))).toEqual([{ queryKey: ['meeting', 'm1', 'attendees'], exact: true }]);
    // An action item changed from My Action Items, without a meeting: My Action Items.
    expect(refreshesAfterReplay(mut('meeting.action.update', { id: 'ai1', patch: {} }))).toEqual([{ queryKey: ['action-items', 'mine'] }]);
  });

  it('names them in the waiting-to-sync list', () => {
    expect(describeMutation({ kind: 'meeting.note.add', payload: { body: 'Go live in May' } })).toBe('Meeting note “Go live in May”');
    expect(describeMutation({ kind: 'meeting.action.add', payload: { description: 'Send the plan' } })).toBe('Action item “Send the plan”');
    expect(describeMutation({ kind: 'meeting.action.update', payload: {} })).toBe('Update an action item');
    expect(describeMutation({ kind: 'meeting.agenda.covered', payload: { completed: true } })).toBe('Tick off an agenda item');
    expect(describeMutation({ kind: 'meeting.agenda.covered', payload: { completed: false } })).toBe('Untick an agenda item');
    expect(describeMutation({ kind: 'meeting.attendance', payload: {} })).toBe('Record attendance');
  });
});

describe('the changes a lost key could make twice (4a review #1)', () => {
  it('are the creates sent under an idempotency key — not chat messages (their client id keeps them single) nor edits', () => {
    for (const kind of ['task.create', 'checklist.add', 'comment.add', 'meeting.note.add', 'meeting.action.add']) expect(isKeyedCreate({ kind }), kind).toBe(true);
    for (const kind of ['chat.send', 'task.update', 'task.move', 'checklist.update', 'meeting.attendance', 'notification.read']) expect(isKeyedCreate({ kind }), kind).toBe(false);
  });

  it('the app’s queue stops those after a day without an answer', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const services = readFileSync(resolve(__dirname, '../core/services.ts'), 'utf8');
    expect(services).toMatch(/keyLifetime: \{ ms: KEY_SAFE_MS, applies: isKeyedCreate \}/);
  });
});
