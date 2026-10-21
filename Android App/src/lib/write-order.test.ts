import { describe, it, expect, vi } from 'vitest';
import { createSyncQueue } from './sync-queue';
import { performMutation } from './perform-mutation';
import { createTaskWrites } from './task-writes';
import { ApiError, NetworkError, isNetworkError } from './api-client';
import { isKeptOnPhone, queueOnOffline, sendInOrder, writeTarget, type Write } from './write-order';
import type { ResourcesApi } from './resources';
import type { KeyValueStore } from './storage';

function fakeStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: async (k: string, v: string) => void m.set(k, v),
    deleteItem: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}

/** The server's side of the writes these tests make: what each item holds, and every call. */
function fakeServer() {
  const state = {
    agenda: new Map<string, boolean>(),
    attendance: new Map<string, string>(),
    actions: new Map<string, Record<string, unknown>>(),
    columns: new Map<string, string>(),
    checklist: new Map<string, boolean>(),
    assigned: new Set<string>(),
  };
  const meetings = {
    updateAgendaItem: vi.fn(async (_m: string, itemId: string, patch: { completed?: boolean }) => {
      state.agenda.set(itemId, !!patch.completed);
      return { id: itemId, completed: !!patch.completed };
    }),
    updateAttendee: vi.fn(async (_m: string, attendeeId: string, patch: { attendance?: string }) => {
      state.attendance.set(attendeeId, patch.attendance!);
      return { id: attendeeId, attendance: patch.attendance };
    }),
    updateActionItem: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      state.actions.set(id, { ...state.actions.get(id), ...patch });
      return { id, ...state.actions.get(id) };
    }),
  };
  const tasks = {
    move: vi.fn(async (id: string, columnId: string) => {
      state.columns.set(id, columnId);
      return { id, columnId };
    }),
    updateChecklistItem: vi.fn(async (itemId: string, patch: { done?: boolean }) => {
      state.checklist.set(itemId, !!patch.done);
    }),
    assign: vi.fn(async (id: string, userIds: string[]) => userIds.forEach((u) => state.assigned.add(`${id}:${u}`))),
    unassign: vi.fn(async (id: string, userId: string) => void state.assigned.delete(`${id}:${userId}`)),
  };
  return { state, meetings, tasks, resources: { meetings, tasks } as unknown as ResourcesApi };
}

async function setup() {
  const server = fakeServer();
  const queue = createSyncQueue({ store: fakeStore(), perform: (m) => performMutation(server.resources, m) });
  await queue.load();
  const sync = vi.fn();
  const deps = { queue, userId: () => 'u1', sync };
  /**
   * A write the way the screens make it: the mutation sends it through sendInOrder (the server call
   * as the live try), and its onError keeps one that got no answer (queueOnOffline).
   */
  const live = (w: Write, send: () => Promise<unknown>) =>
    sendInOrder(deps, w, send).then(
      () => 'sent' as const,
      async (e: unknown) => {
        if (!isNetworkError(e)) throw e;
        await queueOnOffline(queue, 'u1', e, w.kind, w.payload, w.idempotencyKey);
        return 'kept' as const;
      },
    );
  /** The try that got no answer: kept on this phone, as the hook does. */
  const timedOut = (w: Write) => live(w, () => Promise.reject(new NetworkError('The server took too long to respond.', { timedOut: true })));
  return { server, queue, deps, sync, live, timedOut };
}

describe('a newer change to the same item is never overwritten by an older one kept on this phone', () => {
  it('a queued agenda tick, then a live untick: the server ends unticked', async () => {
    const { server, queue, live, timedOut } = await setup();
    const tick = (completed: boolean): Write => ({ kind: 'meeting.agenda.covered', payload: { meetingId: 'm1', itemId: 'a2', completed } });
    await timedOut(tick(true));
    // The untick on a good connection; its answer starts the sync.
    await live(tick(false), () => server.meetings.updateAgendaItem('m1', 'a2', { completed: false }));
    await queue.flush('u1');
    expect(server.state.agenda.get('a2')).toBe(false);
    expect(queue.pending()).toHaveLength(0);
  });

  it('queued attendance, then a live change of it: the newer answer stands', async () => {
    const { server, queue, live, timedOut } = await setup();
    const mark = (attendance: string): Write => ({ kind: 'meeting.attendance', payload: { meetingId: 'm1', attendeeId: 'p1', attendance } });
    await timedOut(mark('PRESENT'));
    await live(mark('ABSENT'), () => server.meetings.updateAttendee('m1', 'p1', { attendance: 'ABSENT' }));
    await queue.flush('u1');
    expect(server.state.attendance.get('p1')).toBe('ABSENT');
  });

  it('a queued action-item status, then a live one: the newer status stands', async () => {
    const { server, queue, live, timedOut } = await setup();
    const status = (s: string): Write => ({ kind: 'meeting.action.update', payload: { meetingId: 'm1', id: 'x1', patch: { status: s } } });
    await timedOut(status('COMPLETED'));
    await live(status('OPEN'), () => server.meetings.updateActionItem('x1', { status: 'OPEN' }));
    await queue.flush('u1');
    expect(server.state.actions.get('x1')).toMatchObject({ status: 'OPEN' });
  });

  it('the same hole on the board, a subtask and the assignees is closed the same way', async () => {
    const { server, queue, live, timedOut } = await setup();
    const move = (columnId: string): Write => ({ kind: 'task.move', payload: { id: 't1', columnId, projectId: 'p1' } });
    await timedOut(move('c2'));
    await live(move('c3'), () => server.tasks.move('t1', 'c3'));
    const done = (d: boolean): Write => ({ kind: 'checklist.update', payload: { id: 't1', itemId: 'k1', patch: { done: d } } });
    await timedOut(done(true));
    await live(done(false), () => server.tasks.updateChecklistItem('k1', { done: false }));
    await timedOut({ kind: 'task.unassign', payload: { id: 't1', userId: 'u7' } });
    await live({ kind: 'task.assign', payload: { id: 't1', userIds: ['u7'] } }, () => server.tasks.assign('t1', ['u7']));
    await queue.flush('u1');
    expect(server.state.columns.get('t1')).toBe('c3');
    expect(server.state.checklist.get('k1')).toBe(false);
    expect(server.state.assigned.has('t1:u7')).toBe(true);
  });

  it('a change to another item still goes straight to the server', async () => {
    const { server, queue, live, timedOut } = await setup();
    await timedOut({ kind: 'meeting.agenda.covered', payload: { meetingId: 'm1', itemId: 'a2', completed: true } });
    const result = await live({ kind: 'meeting.agenda.covered', payload: { meetingId: 'm1', itemId: 'a3', completed: true } }, () =>
      server.meetings.updateAgendaItem('m1', 'a3', { completed: true }),
    );
    expect(result).toBe('sent');
    expect(server.state.agenda.get('a3')).toBe(true);
    expect(queue.pending()).toHaveLength(1);
  });

  it('the newer change waits on this phone behind the older one, and asks for a sync', async () => {
    const { server, queue, sync, live, timedOut } = await setup();
    const tick = (completed: boolean): Write => ({ kind: 'meeting.agenda.covered', payload: { meetingId: 'm1', itemId: 'a2', completed } });
    await timedOut(tick(true));
    expect(await live(tick(false), () => server.meetings.updateAgendaItem('m1', 'a2', { completed: false }))).toBe('kept');
    expect(server.meetings.updateAgendaItem).not.toHaveBeenCalled();
    expect(queue.pending().map((m) => (m.payload as { completed: boolean }).completed)).toEqual([true, false]);
    expect(sync).toHaveBeenCalled();
  });

  it('a try that got no answer is kept once, by the write itself, so the screen’s offline path doesn’t keep it again', async () => {
    const { queue, deps } = await setup();
    const err = await sendInOrder(deps, { kind: 'meeting.attendance', payload: { meetingId: 'm1', attendeeId: 'p1', attendance: 'PRESENT' } }, () =>
      Promise.reject(new NetworkError('offline')),
    ).catch((e: unknown) => e);
    expect(isNetworkError(err)).toBe(true);
    expect(isKeptOnPhone(err)).toBe(true);
    expect(queue.pending()).toHaveLength(1);
    // A refusal is not kept.
    const refused = await sendInOrder(deps, { kind: 'meeting.attendance', payload: { meetingId: 'm1', attendeeId: 'p2', attendance: 'PRESENT' } }, () =>
      Promise.reject(new ApiError(403, 'FORBIDDEN', 'No')),
    ).catch((e: unknown) => e);
    expect(isKeptOnPhone(refused)).toBe(false);
    expect(queue.pending()).toHaveLength(1);
  });

  it('two moves of a card in its write lane: the first gets no answer, so the second waits behind it (never races its keeping)', async () => {
    const { server, queue, deps } = await setup();
    const lanes = createTaskWrites();
    const move = (columnId: string): Write => ({ kind: 'task.move', payload: { id: 't1', columnId, projectId: 'p1' } });
    const first = lanes.run('t1', () => sendInOrder(deps, move('c2'), () => Promise.reject(new NetworkError('slow', { timedOut: true }))));
    const second = lanes.run('t1', () => sendInOrder(deps, move('c3'), () => server.tasks.move('t1', 'c3')));
    await Promise.allSettled([first, second]);
    expect(server.tasks.move).not.toHaveBeenCalled();
    expect(queue.pending().map((m) => (m.payload as { columnId: string }).columnId)).toEqual(['c2', 'c3']);
    await queue.flush('u1');
    expect(server.state.columns.get('t1')).toBe('c3');
  });

  it('a newer change that went through drops a refused older change of the same thing — not one of another field', async () => {
    const { server } = await setup();
    // Two changes to one action item the server refused on replay: shown as failed, with Retry.
    const refusing = createSyncQueue({ store: fakeStore(), perform: () => Promise.reject(new ApiError(422, 'X', 'No')) });
    await refusing.load();
    await refusing.enqueue('meeting.action.update', { meetingId: 'm1', id: 'x1', patch: { status: 'COMPLETED' } }, { userId: 'u1' });
    await refusing.enqueue('meeting.action.update', { meetingId: 'm1', id: 'x1', patch: { priority: 'HIGH' } }, { userId: 'u1' });
    await refusing.flush('u1');
    expect(refusing.failedFor('u1')).toHaveLength(2);
    // A newer status goes through: a Retry of the old status would overwrite it, so that one goes.
    await sendInOrder({ queue: refusing, userId: () => 'u1' }, { kind: 'meeting.action.update', payload: { meetingId: 'm1', id: 'x1', patch: { status: 'OPEN' } } }, () =>
      server.meetings.updateActionItem('x1', { status: 'OPEN' }),
    );
    expect(refusing.failedFor('u1').map((m) => (m.payload as { patch: object }).patch)).toEqual([{ priority: 'HIGH' }]);
  });
});

describe('what a queued change writes to', () => {
  it('names the item (and a task’s moves and edits share one), and nothing for a new item', () => {
    expect(writeTarget('meeting.agenda.covered', { meetingId: 'm1', itemId: 'a2', completed: true })).toBe(writeTarget('meeting.agenda.covered', { meetingId: 'm1', itemId: 'a2', completed: false }));
    expect(writeTarget('task.move', { id: 't1', columnId: 'c2' })).toBe(writeTarget('task.update', { id: 't1', patch: { title: 'B' } }));
    expect(writeTarget('task.assign', { id: 't1', userIds: ['u7'] })).toBe(writeTarget('task.unassign', { id: 't1', userId: 'u7' }));
    expect(writeTarget('meeting.attendance', { attendeeId: 'p1' })).not.toBe(writeTarget('meeting.attendance', { attendeeId: 'p2' }));
    for (const kind of ['meeting.note.add', 'meeting.action.add', 'task.create', 'comment.add', 'chat.send', 'checklist.add', 'notification.read']) {
      expect(writeTarget(kind, { id: 't1', meetingId: 'm1' }), kind).toBeNull();
    }
  });
});
