import { describe, it, expect, vi } from 'vitest';
import { mutationRequest, describeMutation, sendOrQueue, enqueue, getQueue, flushQueue, makePerformMutation } from './queue.js';
import { taskIdOf } from './task-writes.js';
import { applyPending, tempId } from './pending-overlay.js';
import { createApi } from './api.js';
import { createReadCache } from './read-cache.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

// Stage 3 (the task drawer): every change it makes, other than uploading a file, is sent now or kept
// on this device and synced later, like the changes before it.
const A = 'user-a';
const body = (r) => JSON.parse(r.init.body);
const req = (kind, payload, idempotencyKey) => mutationRequest({ kind, payload, ...(idempotencyKey ? { idempotencyKey } : {}) });

describe('the drawer’s changes, as requests', () => {
  it('a reply names the comment it answers; edits and deletes go to the comment itself', () => {
    expect(body(req('comment.add', { id: 't1', body: 'Yes', parentId: 'c1' }))).toEqual({ body: 'Yes', parentId: 'c1' });
    expect(body(req('comment.add', { id: 't1', body: 'Top' }))).toEqual({ body: 'Top' });
    const edit = req('comment.update', { id: 't1', commentId: 'c1', body: 'Fixed typo' });
    expect(edit).toMatchObject({ path: '/comments/c1', init: { method: 'PUT' } });
    expect(body(edit)).toEqual({ body: 'Fixed typo' });
    expect(req('comment.delete', { id: 't1', commentId: 'c1' })).toEqual({ path: '/comments/c1', init: { method: 'DELETE' } });
  });

  it('tags are sent as the task’s whole list of names', () => {
    const r = req('task.tags', { id: 't1', tags: ['Urgent', 'Client'] });
    expect(r).toMatchObject({ path: '/tasks/t1/tags', init: { method: 'PUT' } });
    expect(body(r)).toEqual({ tags: ['Urgent', 'Client'] });
  });

  it('watching, removing a file and deleting a task (one copy or the whole series)', () => {
    expect(req('task.watch', { id: 't1' }, 'k1')).toMatchObject({ path: '/tasks/t1/watch', init: { method: 'POST', headers: { 'Idempotency-Key': 'k1' } } });
    expect(req('task.unwatch', { id: 't1' })).toEqual({ path: '/tasks/t1/watch', init: { method: 'DELETE' } });
    expect(req('attachment.delete', { id: 't1', attachmentId: 'f1', filename: 'a.png' })).toEqual({ path: '/attachments/f1', init: { method: 'DELETE' } });
    expect(req('task.delete', { id: 't1' })).toEqual({ path: '/tasks/t1', init: { method: 'DELETE' } });
    expect(req('task.delete', { id: 't1', scope: 'series', seriesId: 's1' })).toEqual({ path: '/tasks/t1?scope=series', init: { method: 'DELETE' } });
  });

  it('each is named plainly in Settings → Sync, and knows its task', () => {
    const named = (kind, payload) => describeMutation({ kind, payload });
    expect(named('comment.add', { id: 't1', body: 'x', parentId: 'c1' })).toBe('Reply to a comment');
    expect(named('comment.update', { id: 't1', commentId: 'c1', body: 'x' })).toBe('Edit a comment');
    expect(named('comment.delete', { id: 't1', commentId: 'c1' })).toBe('Delete a comment');
    expect(named('task.tags', { id: 't1', tags: [] })).toBe('Change a task’s tags');
    expect(named('task.watch', { id: 't1' })).toBe('Watch a task');
    expect(named('task.unwatch', { id: 't1' })).toBe('Stop watching a task');
    expect(named('attachment.delete', { id: 't1', attachmentId: 'f1', filename: 'site.png' })).toBe('Delete the file “site.png”');
    expect(named('task.delete', { id: 't1' })).toBe('Delete a task');
    expect(named('task.delete', { id: 't1', scope: 'series' })).toBe('Delete a repeating series');
    for (const kind of ['comment.update', 'comment.delete', 'task.tags', 'task.watch', 'task.unwatch', 'attachment.delete', 'task.delete']) {
      expect(taskIdOf({ kind, payload: { id: 't1' } }), kind).toBe('t1');
    }
  });
});

describe('the order they reach the server', () => {
  const doFetch = () => vi.fn(async () => jsonRes({ data: {} }));

  it('a change of a list (tags, people, watching, one comment) waits behind the same kind still waiting for that task', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.tags', payload: { id: 't1', tags: ['A'] }, userId: A });
    await enqueue(s, { kind: 'task.watch', payload: { id: 't1' }, userId: A });
    await enqueue(s, { kind: 'task.assign', payload: { id: 't1', userIds: ['u2'] }, userId: A });
    await enqueue(s, { kind: 'comment.update', payload: { id: 't1', commentId: 'c1', body: 'v1' }, userId: A });
    const send = doFetch();
    const sent = (kind, payload) => sendOrQueue({ kind, payload }, { doFetch: send, storage: s, userId: A });
    expect((await sent('task.tags', { id: 't1', tags: ['A', 'B'] })).queued).toBe(true);
    expect((await sent('task.unwatch', { id: 't1' })).queued).toBe(true);
    expect((await sent('task.unassign', { id: 't1', userId: 'u2' })).queued).toBe(true);
    expect((await sent('comment.delete', { id: 't1', commentId: 'c1' })).queued).toBe(true);
    expect(send).not.toHaveBeenCalled();
    // Another task, another comment, or another kind of change goes at once.
    await sent('task.tags', { id: 't2', tags: ['A'] });
    await sent('comment.delete', { id: 't1', commentId: 'c2' });
    await sent('attachment.delete', { id: 't1', attachmentId: 'f1' });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('deleting a task waits behind every change of it still waiting, so none of them fails later', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'comment.add', payload: { id: 't1', body: 'x' }, userId: A });
    const send = doFetch();
    const r = await sendOrQueue({ kind: 'task.delete', payload: { id: 't1' } }, { doFetch: send, storage: s, userId: A });
    expect(r.queued).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect((await getQueue(s)).map((i) => i.kind)).toEqual(['comment.add', 'task.delete']);
    // Nothing of that task waiting: sent now.
    await sendOrQueue({ kind: 'task.delete', payload: { id: 't9' } }, { doFetch: send, storage: s, userId: A });
    expect(send).toHaveBeenCalledWith('/tasks/t9', { method: 'DELETE' });
  });

  it('deleting something that is already gone counts as done — sent now or replayed later', async () => {
    const gone = vi.fn(async () => jsonRes({ error: { code: 'NOT_FOUND', message: 'Comment not found.' } }, 404));
    expect(await sendOrQueue({ kind: 'comment.delete', payload: { id: 't1', commentId: 'c1' } }, { doFetch: gone, storage: fakeStorage(), userId: A }))
      .toEqual({ queued: false, data: undefined });
    const s = fakeStorage();
    for (const [kind, payload] of [['comment.delete', { id: 't1', commentId: 'c1' }], ['attachment.delete', { id: 't1', attachmentId: 'f1' }], ['task.delete', { id: 't1' }]]) {
      await enqueue(s, { kind, payload, userId: A });
    }
    expect(await flushQueue(s, makePerformMutation(gone), { userId: A })).toMatchObject({ synced: 3, failed: 0, remaining: 0 });
    // Anything else that isn't found still fails, and says so.
    await enqueue(s, { kind: 'comment.update', payload: { id: 't1', commentId: 'c1', body: 'x' }, userId: A });
    expect(await flushQueue(s, makePerformMutation(gone), { userId: A })).toMatchObject({ synced: 0, failed: 1 });
  });
});

describe('changes saved on this device, shown in the drawer and lists (H3)', () => {
  const QUEUED_AT = Date.parse('2026-10-21T08:00:00Z');
  const q = (kind, payload, extra = {}) => ({ id: `q-${kind}-${Math.random()}`, kind, payload, userId: 'u1', status: 'pending', queuedAt: QUEUED_AT, ...extra });

  it('a reply waiting to sync sits under its comment; an edit or delete shows at once', () => {
    const rows = [{ id: 'c1', userId: 'u2', body: 'Can you check?', parentId: null }, { id: 'c2', userId: 'u1', body: 'Old', parentId: null }];
    const reply = q('comment.add', { id: 't1', body: 'Yes', parentId: 'c1' });
    const { data, applied } = applyPending('comments:t1', rows, [
      reply,
      q('comment.update', { id: 't1', commentId: 'c2', body: 'New' }),
      q('comment.delete', { id: 't1', commentId: 'c1' }),
    ]);
    expect(applied).toBe(3);
    expect(data).toEqual([
      { id: 'c2', userId: 'u1', body: 'New', parentId: null, editedAt: '2026-10-21T08:00:00.000Z' },
      expect.objectContaining({ id: tempId(reply), body: 'Yes', parentId: 'c1', pending: true }),
    ]);
    expect(rows[1].body).toBe('Old');
  });

  it('tags, watching and a removed file', () => {
    const tagged = applyPending('task:t1', { id: 't1', tags: [{ id: 'g1', name: 'Urgent', color: '#8B1E1E' }] }, [q('task.tags', { id: 't1', tags: ['urgent', 'Client'] })]);
    expect(tagged.data.tags).toEqual([{ id: 'g1', name: 'Urgent', color: '#8B1E1E' }, { id: 'tmp-tag:client', name: 'Client', color: null }]);
    expect(applyPending('tasks:mine', [{ id: 't1', tags: [] }], [q('task.tags', { id: 't1', tags: ['Client'] })]).data[0].tags).toEqual([{ id: 'tmp-tag:client', name: 'Client', color: null }]);

    expect(applyPending('watch:t1', { watching: false }, [q('task.watch', { id: 't1' })]).data).toEqual({ watching: true });
    expect(applyPending('watch:t1', { watching: true }, [q('task.unwatch', { id: 't1' })]).data).toEqual({ watching: false });
    const watchers = [{ id: 'u2', firstName: 'Omar' }];
    expect(applyPending('watchers:t1', watchers, [q('task.watch', { id: 't1' })]).data.map((w) => w.id)).toEqual(['u2', 'u1']);
    expect(applyPending('watchers:t1', [...watchers, { id: 'u1' }], [q('task.unwatch', { id: 't1' })]).data.map((w) => w.id)).toEqual(['u2']);

    const files = [{ id: 'f1', filename: 'a.png' }, { id: 'f2', filename: 'b.pdf' }];
    expect(applyPending('attachments:t1', files, [q('attachment.delete', { id: 't1', attachmentId: 'f1' })]).data).toEqual([files[1]]);
    expect(applyPending('attachments:t2', files, [q('attachment.delete', { id: 't1', attachmentId: 'f1' })]).applied).toBe(0);
  });

  it('a task deleted on this device leaves the lists (with its series when the whole series goes), and says so when opened', () => {
    const rows = [{ id: 't1' }, { id: 't2', recurrenceParentId: 's1' }, { id: 's1' }, { id: 't3' }];
    expect(applyPending('tasks:mine', rows, [q('task.delete', { id: 't1' })]).data.map((t) => t.id)).toEqual(['t2', 's1', 't3']);
    expect(applyPending('tasks:mine', rows, [q('task.delete', { id: 't2', scope: 'series', seriesId: 's1' })]).data.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(applyPending('task:t1', { id: 't1', title: 'x' }, [q('task.delete', { id: 't1' })]).data).toEqual({ id: 't1', title: 'x', pendingDelete: true });
  });
});

describe('the drawer’s reads (kept for offline)', () => {
  const json = (data) => ({ ok: true, status: 200, json: async () => ({ data }), headers: { get: () => 'application/json' } });

  it('files, activity, watching, watchers, the people to @mention and the workspace’s tags', async () => {
    const store = fakeStorage();
    const auth = { authedFetch: vi.fn(async (path) => json(path)) };
    const api = createApi({ auth, cache: createReadCache(store) });
    expect((await api.tasks.attachments('t1')).data).toBe('/tasks/t1/attachments');
    expect((await api.tasks.activity('t1')).data).toBe('/tasks/t1/activity');
    expect((await api.tasks.watch('t1')).data).toBe('/tasks/t1/watch');
    expect((await api.tasks.watchers('t1')).data).toBe('/tasks/t1/watchers');
    expect((await api.tasks.mentionable('t1')).data).toBe('/tasks/t1/mentionable');
    expect((await api.tags()).data).toBe('/tags');
    for (const key of ['attachments:t1', 'activity:t1', 'watch:t1', 'watchers:t1', 'mentionable:t1', 'tags']) expect(store.data[`cache:${key}`], key).toBeTruthy();
  });
});
