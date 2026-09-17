import { describe, it, expect } from 'vitest';
import { resourcesApi } from './resources';
import type { ApiClient } from './api-client';

/** A fake client that records every call and returns a benign envelope. */
function fakeClient() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client = {
    get: (path: string) => { calls.push({ method: 'GET', path }); return Promise.resolve({ data: [] }); },
    post: (path: string, body?: unknown) => { calls.push({ method: 'POST', path, body }); return Promise.resolve({ data: {} }); },
    put: (path: string, body?: unknown) => { calls.push({ method: 'PUT', path, body }); return Promise.resolve({ data: [] }); },
    patch: (path: string, body?: unknown) => { calls.push({ method: 'PATCH', path, body }); return Promise.resolve({ data: {} }); },
    del: (path: string) => { calls.push({ method: 'DELETE', path }); return Promise.resolve(undefined); },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('resourcesApi.tasks', () => {
  it('POSTs /tasks with the create body including tags', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.create({ title: 'X', projectId: 'p1', columnId: 'c1', priority: 'HIGH', estimatedHours: 3, tags: ['urgent'] });
    expect(calls[0]).toEqual({ method: 'POST', path: '/tasks', body: { title: 'X', projectId: 'p1', columnId: 'c1', priority: 'HIGH', estimatedHours: 3, tags: ['urgent'] } });
  });

  it('PUTs /tasks/:id with an estimatedHours patch', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.update('t1', { estimatedHours: 5, dueDate: '2026-09-10' });
    expect(calls[0]).toEqual({ method: 'PUT', path: '/tasks/t1', body: { estimatedHours: 5, dueDate: '2026-09-10' } });
  });

  it('PUTs /tasks/:id with an "entire series" edit scope for a recurring task', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.update('t1', { priority: 'URGENT', scope: 'series' });
    expect(calls[0]).toEqual({ method: 'PUT', path: '/tasks/t1', body: { priority: 'URGENT', scope: 'series' } });
  });

  it('PATCHes /tasks/:id/move with column + position', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.move('t1', 'c2', 3);
    expect(calls[0]).toEqual({ method: 'PATCH', path: '/tasks/t1/move', body: { columnId: 'c2', position: 3 } });
  });

  it('reads, replaces and detaches task tags', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.tags('t1');
    await api.setTags('t1', ['a', 'b']);
    await api.removeTag('t1', 'tag9');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/tags' });
    expect(calls[1]).toEqual({ method: 'PUT', path: '/tasks/t1/tags', body: { tags: ['a', 'b'] } });
    expect(calls[2]).toMatchObject({ method: 'DELETE', path: '/tasks/t1/tags/tag9' });
  });

  it('reads the shared tag catalog', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tagCatalog();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tags' });
  });

  it('POSTs /tasks with assigneeIds when creating and assigning at once', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.create({ title: 'X', projectId: 'p1', columnId: 'c1', assigneeIds: ['u1', 'u2'] });
    expect(calls[0]).toEqual({ method: 'POST', path: '/tasks', body: { title: 'X', projectId: 'p1', columnId: 'c1', assigneeIds: ['u1', 'u2'] } });
  });

  it('lists, assigns and unassigns task assignees', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.assignees('t1');
    await api.assign('t1', ['u1', 'u2']);
    await api.unassign('t1', 'u2');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/assignees' });
    expect(calls[1]).toEqual({ method: 'POST', path: '/tasks/t1/assignees', body: { userIds: ['u1', 'u2'] } });
    expect(calls[2]).toMatchObject({ method: 'DELETE', path: '/tasks/t1/assignees/u2' });
  });

  it('reads project members (the assignable pool)', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).projects.members('p1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/projects/p1/members' });
  });

  it('lists tasks with combined filter + sort query params', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).tasks.list({ projectId: 'p1', q: 'fix', priority: 'HIGH,URGENT', sort: 'priority', order: 'desc', overdue: true });
    expect(calls[0]!.method).toBe('GET');
    const path = calls[0]!.path;
    expect(path).toContain('projectId=p1');
    expect(path).toContain('q=fix');
    expect(path).toContain('priority=HIGH%2CURGENT');
    expect(path).toContain('sort=priority');
    expect(path).toContain('order=desc');
    expect(path).toContain('overdue=true');
  });

  it('reads per-project progress', async () => {
    const { client, calls } = fakeClient();
    await resourcesApi(client).projects.progress('p1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/projects/p1/progress' });
  });

  it('manages a checklist: list, add, toggle/edit, reorder, remove', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.checklist('t1');
    await api.addChecklistItem('t1', 'Do X');
    await api.updateChecklistItem('i1', { done: true });
    await api.updateChecklistItem('i1', { text: 'Do Y' });
    await api.reorderChecklist('t1', ['i2', 'i1']);
    await api.removeChecklistItem('i1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/checklist' });
    expect(calls[1]).toEqual({ method: 'POST', path: '/tasks/t1/checklist', body: { text: 'Do X' } });
    expect(calls[2]).toEqual({ method: 'PUT', path: '/checklist/i1', body: { done: true } });
    expect(calls[3]).toEqual({ method: 'PUT', path: '/checklist/i1', body: { text: 'Do Y' } });
    expect(calls[4]).toEqual({ method: 'PUT', path: '/tasks/t1/checklist/reorder', body: { orderedIds: ['i2', 'i1'] } });
    expect(calls[5]).toMatchObject({ method: 'DELETE', path: '/checklist/i1' });
  });

  it('manages comments: list, add, edit, remove', async () => {
    const { client, calls } = fakeClient();
    const api = resourcesApi(client).tasks;
    await api.comments('t1');
    await api.addComment('t1', 'hello @ada');
    await api.editComment('c1', 'edited');
    await api.removeComment('c1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks/t1/comments' });
    expect(calls[1]).toEqual({ method: 'POST', path: '/tasks/t1/comments', body: { body: 'hello @ada' } });
    expect(calls[2]).toEqual({ method: 'PUT', path: '/comments/c1', body: { body: 'edited' } });
    expect(calls[3]).toMatchObject({ method: 'DELETE', path: '/comments/c1' });
  });
});
