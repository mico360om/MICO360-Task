import { describe, it, expect, vi } from 'vitest';
import { mutationRequest, describeMutation, sendOrQueue, enqueue, makePerformMutation } from './queue.js';
import { taskIdOf, DELETE_KINDS } from './task-writes.js';
import { applyPending, tempId } from './pending-overlay.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

// External contacts on a task: each change is sent now or kept on this device and synced later, like
// the task panel's other changes. Adding one carries an Idempotency-Key, so a retry never adds it twice.
const A = 'user-a';
const body = (r) => JSON.parse(r.init.body);
const req = (kind, payload, idempotencyKey) => mutationRequest({ kind, payload, ...(idempotencyKey ? { idempotencyKey } : {}) });
const ahmed = { name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: null };

describe('external contact changes, as requests', () => {
  it('adding one posts its six fields to the task (with its Idempotency-Key); a change or a removal goes to the contact itself', () => {
    const add = req('contact.add', { id: 't1', contact: ahmed }, 'k1');
    expect(add).toMatchObject({ path: '/tasks/t1/external-contacts', init: { method: 'POST', headers: { 'Idempotency-Key': 'k1' } } });
    expect(body(add)).toEqual(ahmed);
    const edit = req('contact.update', { id: 't1', contactId: 'x1', patch: { phone: null, remarks: 'Call first' }, name: 'Ahmed Al Said' });
    expect(edit).toMatchObject({ path: '/external-contacts/x1', init: { method: 'PUT' } });
    expect(body(edit)).toEqual({ phone: null, remarks: 'Call first' });
    expect(req('contact.delete', { id: 't1', contactId: 'x1', name: 'Ahmed Al Said' })).toEqual({ path: '/external-contacts/x1', init: { method: 'DELETE' } });
  });

  it('each is named plainly in Settings → Sync, and knows its task (a task’s delete waits behind them)', () => {
    const named = (kind, payload) => describeMutation({ kind, payload });
    expect(named('contact.add', { id: 't1', contact: ahmed })).toBe('Add the external contact “Ahmed Al Said”');
    expect(named('contact.update', { id: 't1', contactId: 'x1', patch: {}, name: 'Ahmed Al Said' })).toBe('Change the external contact “Ahmed Al Said”');
    expect(named('contact.delete', { id: 't1', contactId: 'x1', name: 'Ahmed Al Said' })).toBe('Remove the external contact “Ahmed Al Said”');
    expect(named('contact.delete', { id: 't1', contactId: 'x1' })).toBe('Remove an external contact');
    for (const kind of ['contact.add', 'contact.update', 'contact.delete']) expect(taskIdOf({ kind, payload: { id: 't1' } }), kind).toBe('t1');
    expect(DELETE_KINDS.has('contact.delete')).toBe(true);
  });

  it('one contact’s changes reach the server in order; another contact’s go at once', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'contact.update', payload: { id: 't1', contactId: 'x1', patch: { phone: '1' } }, userId: A });
    const send = vi.fn(async () => jsonRes({ data: {} }));
    const sent = (kind, payload) => sendOrQueue({ kind, payload }, { doFetch: send, storage: s, userId: A });
    expect((await sent('contact.update', { id: 't1', contactId: 'x1', patch: { phone: '2' } })).queued).toBe(true);
    expect((await sent('contact.delete', { id: 't1', contactId: 'x1' })).queued).toBe(true);
    expect(send).not.toHaveBeenCalled();
    await sent('contact.update', { id: 't1', contactId: 'x2', patch: { phone: '3' } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('removing one that is already gone counts as done when it syncs', async () => {
    const perform = makePerformMutation(async () => jsonRes({ error: { code: 'NOT_FOUND', message: 'This contact isn’t on the task any more. Someone may have removed it.' } }, 404));
    await expect(perform({ kind: 'contact.delete', payload: { id: 't1', contactId: 'x1' } })).resolves.toBeUndefined();
  });
});

describe('external contact changes waiting to sync, shown on the task', () => {
  const task = { id: 't1', key: 'OPS-7', externalContacts: [{ id: 'x1', taskId: 't1', ...ahmed, position: 0 }] };
  const item = (kind, payload, id) => ({ id, kind, payload, userId: A, queuedAt: Date.UTC(2026, 9, 31, 6) });

  it('an added one shows (waiting to sync), a changed one with its changes, a removed one is gone', () => {
    const add = item('contact.add', { id: 't1', contact: { ...ahmed, name: 'Sara Nasser', company: 'PDO' } }, 'q1');
    const { data, applied } = applyPending('task:t1', task, [add, item('contact.update', { id: 't1', contactId: 'x1', patch: { phone: null } }, 'q2')]);
    expect(applied).toBe(2);
    expect(data.externalContacts.map((c) => [c.id, c.name, c.phone, !!c.pending])).toEqual([
      ['x1', 'Ahmed Al Said', null, false],
      [tempId(add), 'Sara Nasser', '+968 9912 3456', true],
    ]);
    expect(task.externalContacts[0].phone).toBe('+968 9912 3456'); // the saved copy is never changed
    const removed = applyPending('task:t1', task, [item('contact.delete', { id: 't1', contactId: 'x1' }, 'q3')]).data;
    expect(removed.externalContacts).toEqual([]);
  });

  it('leaves a task without its contacts (a list row, an older server) alone', () => {
    const row = { id: 't1', key: 'OPS-7' };
    expect(applyPending('task:t1', row, [item('contact.add', { id: 't1', contact: ahmed }, 'q1')]).data).toBe(row);
  });
});
