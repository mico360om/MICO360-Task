import { describe, it, expect } from 'vitest';
import { mutationRequest } from './queue.js';

const body = (r) => JSON.parse(r.init.body);

describe('mutationRequest (offline write mapping)', () => {
  it('task.create → POST /tasks', () => {
    const r = mutationRequest({ kind: 'task.create', payload: { title: 'x', projectId: 'p', columnId: 'c' } });
    expect(r.path).toBe('/tasks');
    expect(r.init.method).toBe('POST');
    expect(body(r)).toEqual({ title: 'x', projectId: 'p', columnId: 'c' });
  });

  it('task.move → PATCH /tasks/:id/move with columnId + position', () => {
    const r = mutationRequest({ kind: 'task.move', payload: { id: 't1', columnId: 'c2', position: 3 } });
    expect(r.path).toBe('/tasks/t1/move');
    expect(r.init.method).toBe('PATCH');
    expect(body(r)).toEqual({ columnId: 'c2', position: 3 });
  });

  it('task.update → PUT /tasks/:id with the patch', () => {
    const r = mutationRequest({ kind: 'task.update', payload: { id: 't1', patch: { title: 'new' } } });
    expect(r.path).toBe('/tasks/t1');
    expect(r.init.method).toBe('PUT');
    expect(body(r)).toEqual({ title: 'new' });
  });

  it('task.assign / task.unassign', () => {
    expect(mutationRequest({ kind: 'task.assign', payload: { id: 't1', userIds: ['u1'] } })).toMatchObject({ path: '/tasks/t1/assignees', init: { method: 'POST' } });
    expect(mutationRequest({ kind: 'task.unassign', payload: { id: 't1', userId: 'u1' } })).toEqual({ path: '/tasks/t1/assignees/u1', init: { method: 'DELETE' } });
  });

  it('comment.add / checklist.add / checklist.update', () => {
    expect(body(mutationRequest({ kind: 'comment.add', payload: { id: 't1', body: 'hi' } }))).toEqual({ body: 'hi' });
    expect(body(mutationRequest({ kind: 'checklist.add', payload: { id: 't1', text: 'step' } }))).toEqual({ text: 'step' });
    const cu = mutationRequest({ kind: 'checklist.update', payload: { itemId: 'k1', patch: { done: true } } });
    expect(cu.path).toBe('/checklist/k1');
    expect(body(cu)).toEqual({ done: true });
  });

  it('notification.read → PUT, chat.send → POST', () => {
    expect(mutationRequest({ kind: 'notification.read', payload: { id: 'n1' } })).toEqual({ path: '/notifications/n1/read', init: { method: 'PUT' } });
    const cs = mutationRequest({ kind: 'chat.send', payload: { conversationId: 'cv1', body: 'yo' } });
    expect(cs.path).toBe('/conversations/cv1/messages');
    expect(body(cs)).toEqual({ body: 'yo' });
  });

  it('returns null for an unknown kind', () => {
    expect(mutationRequest({ kind: 'nope', payload: {} })).toBeNull();
  });
});
