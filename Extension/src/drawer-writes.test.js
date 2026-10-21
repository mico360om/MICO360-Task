import { describe, it, expect, vi } from 'vitest';
import { mutationRequest, describeMutation, sendOrQueue, enqueue, getQueue, flushQueue, makePerformMutation, retryQueued } from './queue.js';
import { taskIdOf, SUPERSEDED_MESSAGE } from './task-writes.js';
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

  it('a task delete the server refuses (403) fails with the server’s words, and nothing else is asked — even when the task can’t be read any more', async () => {
    // The server looks the task up before it checks who may delete it: a task that is already gone
    // answers 404 (done, above), so a 403 is a real refusal — say, a manager taken off the project
    // while the delete waited offline (reading the task then says 404 too: it is hidden from them).
    const refusing = () => vi.fn(async (path, init) => (init.method === 'DELETE'
      ? jsonRes({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } }, 403)
      : jsonRes({ error: { code: 'NOT_FOUND', message: 'Task not found.' } }, 404)));
    const now = refusing();
    const err = await sendOrQueue({ kind: 'task.delete', payload: { id: 't1' } }, { doFetch: now, storage: fakeStorage(), userId: A }).catch((e) => e);
    expect(err).toMatchObject({ status: 403, message: 'You do not have permission to do that.' });
    expect(now).toHaveBeenCalledTimes(1);
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.delete', payload: { id: 't1' }, userId: A });
    const later = refusing();
    expect(await flushQueue(s, makePerformMutation(later), { userId: A })).toMatchObject({ synced: 0, failed: 1 });
    expect(later).toHaveBeenCalledTimes(1);
    expect((await getQueue(s))[0]).toMatchObject({ status: 'failed', lastError: '403 — You do not have permission to do that.' });
  });

  it('a delete waits behind a ticked checklist item of the task too', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'checklist.update', payload: { id: 't1', itemId: 'k1', patch: { done: true } }, userId: A });
    const send = doFetch();
    expect((await sendOrQueue({ kind: 'task.delete', payload: { id: 't1' } }, { doFetch: send, storage: s, userId: A })).queued).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(taskIdOf({ kind: 'checklist.update', payload: { id: 't1', itemId: 'k1' } })).toBe('t1');
    expect(req('checklist.update', { id: 't1', itemId: 'k1', patch: { done: true } })).toEqual({ path: '/checklist/k1', init: { method: 'PUT', body: JSON.stringify({ done: true }) } });
  });
});

/** A server holding task t1's tags: GET and PUT /tasks/t1/tags, as the server answers them (sorted by name). */
function tagServer(initial) {
  let tags = [];
  const set = (names) => { tags = [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ id: `g-${name.toLowerCase()}`, name, color: null })); };
  set(initial);
  const doFetch = vi.fn(async (path, init) => {
    if (path !== '/tasks/t1/tags') return jsonRes({ data: {} });
    if (init.method === 'PUT') set(JSON.parse(init.body).tags);
    return jsonRes({ data: tags });
  });
  return { doFetch, set, names: () => tags.map((t) => t.name), puts: () => doFetch.mock.calls.filter(([, i]) => i.method === 'PUT').length };
}

describe('a change of tags made from an older list (review I1)', () => {
  it('a tag taken off offline and one someone else added meanwhile both stay as they were left', async () => {
    const server = tagServer(['Client', 'Urgent']);
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.tags', payload: { id: 't1', base: ['Urgent', 'Client'], tags: ['Client'] }, userId: A });
    server.set(['Audit', 'Client', 'Urgent']); // someone else, while this device was offline
    expect(await flushQueue(s, makePerformMutation(server.doFetch), { userId: A })).toMatchObject({ synced: 1, failed: 0 });
    expect(server.names()).toEqual(['Audit', 'Client']);
  });

  it('sent now from a drawer opened before someone else’s change, it keeps that change too', async () => {
    const server = tagServer(['Audit', 'Urgent']);
    const r = await sendOrQueue({ kind: 'task.tags', payload: { id: 't1', base: ['Urgent'], tags: ['Urgent', 'Site'] } }, { doFetch: server.doFetch, storage: fakeStorage(), userId: A });
    expect(r.queued).toBe(false);
    expect(server.names()).toEqual(['Audit', 'Site', 'Urgent']);
    expect(r.data.map((t) => t.name)).toEqual(['Audit', 'Site', 'Urgent']);
  });

  it('when the task’s tags can’t be read first, nothing is sent: it waits (offline) or tries again (server trouble), never fails at once', async () => {
    const payload = { id: 't1', base: [], tags: ['X'] };
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect((await sendOrQueue({ kind: 'task.tags', payload }, { doFetch: offline, storage: fakeStorage(), userId: A })).queued).toBe(true);
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.tags', payload, userId: A });
    expect(await flushQueue(s, makePerformMutation(offline), { userId: A })).toMatchObject({ synced: 0, failed: 0, paused: true });
    const trouble = vi.fn(async (path, init) => (init.method === 'GET' ? jsonRes({ error: { message: 'Server error' } }, 500) : jsonRes({ data: [] })));
    expect(await flushQueue(s, makePerformMutation(trouble), { userId: A })).toMatchObject({ synced: 0, failed: 0, paused: true });
    expect((await getQueue(s))[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(trouble.mock.calls.every(([, i]) => i.method === 'GET')).toBe(true);
  });

  it('an older change that failed, tried again after a newer change of the same tags synced, can’t undo it', async () => {
    const server = tagServer([]);
    const s = fakeStorage();
    // X added offline; its tries ran out while the server had trouble…
    await enqueue(s, { kind: 'task.tags', payload: { id: 't1', base: [], tags: ['X'] }, userId: A });
    // …and meanwhile the person took X off again.
    await enqueue(s, { kind: 'task.tags', payload: { id: 't1', base: ['X'], tags: [] }, userId: A });
    const down = vi.fn(async () => jsonRes({ error: { message: 'Server error' } }, 500));
    await flushQueue(s, makePerformMutation(down), { userId: A, maxAttempts: 1 });
    expect((await getQueue(s)).map((i) => i.status)).toEqual(['failed', 'failed']);
    await retryQueued(s, (await getQueue(s))[1].id);
    expect(await flushQueue(s, makePerformMutation(server.doFetch), { userId: A })).toMatchObject({ synced: 1 });
    const [old] = await getQueue(s);
    expect(old).toMatchObject({ status: 'failed', superseded: true, lastError: SUPERSEDED_MESSAGE });
    // Settings offers to discard it, not to try it again; trying anyway changes nothing.
    await retryQueued(s, old.id);
    await flushQueue(s, makePerformMutation(server.doFetch), { userId: A });
    expect(server.names()).toEqual([]);
    expect((await getQueue(s))[0]).toMatchObject({ status: 'failed', superseded: true });
  });

  it('a newer change sent now replaces an older failed one too; one about other tags can still be tried', async () => {
    const server = tagServer([]);
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.tags', payload: { id: 't1', base: [], tags: ['X', 'Y'] }, userId: A });
    await flushQueue(s, makePerformMutation(vi.fn(async () => jsonRes({ error: { message: 'Server error' } }, 500))), { userId: A, maxAttempts: 1 });
    // X taken off again, sent now (a failed change doesn't hold the next one back).
    expect((await sendOrQueue({ kind: 'task.tags', payload: { id: 't1', base: ['X', 'Y'], tags: ['Y'] } }, { doFetch: server.doFetch, storage: s, userId: A })).queued).toBe(false);
    const [old] = await getQueue(s);
    expect(old.superseded).toBeFalsy(); // what is left of it (adding Y) is still the person's to send
    expect(old.payload).toMatchObject({ base: [], tags: ['Y'] });
    await retryQueued(s, old.id);
    await flushQueue(s, makePerformMutation(server.doFetch), { userId: A });
    expect(server.names()).toEqual(['Y']);
  });

  it('while it waits, the drawer and lists show it over the task’s tags as last read', () => {
    const task = { id: 't1', tags: [{ id: 'g1', name: 'Audit', color: '#111111' }, { id: 'g2', name: 'Urgent', color: '#8B1E1E' }] };
    const waiting = { id: 'q1', kind: 'task.tags', payload: { id: 't1', base: ['Urgent'], tags: ['Site'] }, userId: A, status: 'pending', queuedAt: 0 };
    expect(applyPending('task:t1', task, [waiting]).data.tags).toEqual([{ id: 'g1', name: 'Audit', color: '#111111' }, { id: 'tmp-tag:site', name: 'Site', color: null }]);
  });

  it('watching: an older failed watch, tried again after a newer “stop watching” synced, doesn’t watch again', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.watch', payload: { id: 't1' }, userId: A });
    await enqueue(s, { kind: 'task.unwatch', payload: { id: 't1' }, userId: A });
    await flushQueue(s, makePerformMutation(vi.fn(async () => jsonRes({ error: { message: 'Server error' } }, 500))), { userId: A, maxAttempts: 1 });
    await retryQueued(s, (await getQueue(s))[1].id);
    const ok = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    await flushQueue(s, makePerformMutation(ok), { userId: A });
    expect((await getQueue(s))[0]).toMatchObject({ kind: 'task.watch', status: 'failed', superseded: true });
    await retryQueued(s, (await getQueue(s))[0].id);
    await flushQueue(s, makePerformMutation(ok), { userId: A });
    expect(ok.mock.calls.map(([p, i]) => `${i.method} ${p}`)).toEqual(['DELETE /tasks/t1/watch']);
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
