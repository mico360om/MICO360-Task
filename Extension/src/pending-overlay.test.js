import { describe, it, expect } from 'vitest';
import { applyPending, tempId } from './pending-overlay.js';

const QUEUED_AT = Date.parse('2026-10-21T08:00:00Z');
const q = (kind, payload, extra = {}) => ({ id: `q-${kind}`, kind, payload, userId: 'u1', status: 'pending', queuedAt: QUEUED_AT, ...extra });
const BOARD = 'tasks:?projectId=p1&boardDate=2026-10-21';

describe('applyPending (H3: changes waiting to sync are layered over what is read)', () => {
  it('a card moved offline stays in the column it was put in', () => {
    const rows = [{ id: 't1', columnId: 'c1', columnCategory: 'TODO', completedAt: null, progress: 0 }, { id: 't2', columnId: 'c1' }];
    const { data, applied } = applyPending(BOARD, rows, [q('task.move', { id: 't1', columnId: 'c9', position: 0, columnCategory: 'DONE' })]);
    expect(data[0]).toMatchObject({ columnId: 'c9', columnCategory: 'DONE', progress: 100, completedAt: '2026-10-21T08:00:00.000Z' });
    expect(data[1]).toBe(rows[1]);
    expect(applied).toBe(1);
    expect(rows[0].columnId).toBe('c1'); // the saved server copy itself is never changed
  });

  it('moving a done card back clears its completion', () => {
    const rows = [{ id: 't1', columnId: 'c9', columnCategory: 'DONE', completedAt: '2026-10-20T08:00:00Z', progress: 100 }];
    const { data } = applyPending('tasks:mine', rows, [q('task.move', { id: 't1', columnId: 'c1', position: 0, columnCategory: 'TODO' })]);
    expect(data[0]).toMatchObject({ columnId: 'c1', columnCategory: 'TODO', completedAt: null });
  });

  it('an edit made offline shows on the task and in task lists', () => {
    const edit = q('task.update', { id: 't1', patch: { title: 'New title', dueDate: '2026-10-30' }, expectedVersion: 3 });
    const one = applyPending('task:t1', { id: 't1', title: 'Old', version: 3 }, [edit]);
    expect(one.data).toEqual({ id: 't1', title: 'New title', dueDate: '2026-10-30', version: 3 });
    expect(one.applied).toBe(1);
    const list = applyPending('tasks:mine', [{ id: 't1', title: 'Old' }], [edit]);
    expect(list.data[0].title).toBe('New title');
    expect(applyPending('task:t2', { id: 't2', title: 'Other' }, [edit]).applied).toBe(0);
  });

  it('a task added offline shows on its own board day, with a temporary id', () => {
    const create = q('task.create', { projectId: 'p1', columnId: 'c1', title: 'Call the client', priority: 'HIGH', boardDate: '2026-10-21' });
    const { data, applied } = applyPending(BOARD, [], [create]);
    expect(applied).toBe(1);
    expect(data).toEqual([expect.objectContaining({ id: tempId(create), title: 'Call the client', priority: 'HIGH', columnId: 'c1', projectId: 'p1', pending: true })]);
    expect(tempId(create)).toMatch(/^tmp-/);
    expect(applyPending('tasks:?projectId=p1&boardDate=2026-10-22', [], [create]).applied).toBe(0);
    expect(applyPending('tasks:?projectId=p2&boardDate=2026-10-21', [], [create]).applied).toBe(0);
    expect(applyPending('tasks:?projectId=p1&boardDate=2026-10-21&q=call', [], [create]).applied).toBe(0);
  });

  it('checklist items, comments and assignees saved offline show in the task drawer', () => {
    const add = q('checklist.add', { id: 't1', text: 'Step two' });
    const tick = q('checklist.update', { itemId: 'k1', patch: { done: true } });
    const chk = applyPending('checklist:t1', { items: [{ id: 'k1', text: 'Step one', done: false }], done: 0, total: 1 }, [add, tick]);
    expect(chk.data.items).toEqual([{ id: 'k1', text: 'Step one', done: true }, expect.objectContaining({ id: tempId(add), text: 'Step two', done: false })]);
    expect(chk.data).toMatchObject({ done: 1, total: 2 });
    expect(chk.applied).toBe(2);

    const comment = q('comment.add', { id: 't1', body: 'On my way' });
    const cm = applyPending('comments:t1', [], [comment]);
    expect(cm.data).toEqual([expect.objectContaining({ id: tempId(comment), userId: 'u1', body: 'On my way', createdAt: '2026-10-21T08:00:00.000Z' })]);

    const asg = applyPending('assignees:t1', [{ id: 'u2' }], [q('task.assign', { id: 't1', userIds: ['u1'] }), q('task.unassign', { id: 't1', userId: 'u2' })]);
    expect(asg.data).toEqual([{ id: 'u1' }]);
  });

  it('notifications marked read offline stay read, and the unread count follows', () => {
    const list = [{ id: 'n1', readAt: null }, { id: 'n2', readAt: null }, { id: 'n3', readAt: '2026-10-20T08:00:00Z' }];
    const one = applyPending('notifications', list, [q('notification.read', { id: 'n1' })]);
    expect(one.data.map((n) => Boolean(n.readAt))).toEqual([true, false, true]);
    expect(applyPending('unread', { count: 2 }, [q('notification.read', { id: 'n1' })]).data).toEqual({ count: 1 });
    const all = q('notification.readAll', {});
    expect(applyPending('notifications', list, [all]).data.every((n) => n.readAt)).toBe(true);
    expect(applyPending('unread', { count: 2 }, [all]).data).toEqual({ count: 0 });
  });

  it('a chat message waiting to be sent shows in its conversation', () => {
    const send = q('chat.send', { conversationId: 'cv1', body: 'See you at 3' });
    const { data } = applyPending('messages:cv1', [{ id: 'm1', body: 'hi' }], [send]);
    expect(data[1]).toMatchObject({ id: tempId(send), userId: 'u1', body: 'See you at 3', pending: true });
    expect(applyPending('messages:cv2', [], [send]).applied).toBe(0);
  });

  it('ignores changes that failed to sync and data it does not know', () => {
    const failed = q('task.update', { id: 't1', patch: { title: 'Refused' } }, { status: 'failed' });
    expect(applyPending('task:t1', { id: 't1', title: 'Server' }, [failed])).toEqual({ data: { id: 't1', title: 'Server' }, applied: 0 });
    expect(applyPending('projects', [{ id: 'p1' }], [q('task.update', { id: 't1', patch: {} })]).applied).toBe(0);
    expect(applyPending('task:t1', null, [q('task.update', { id: 't1', patch: { title: 'x' } })]).applied).toBe(0);
  });
});
