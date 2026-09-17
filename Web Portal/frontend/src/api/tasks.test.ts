import { describe, it, expect } from 'vitest';
import { tasksApi } from './tasks';
import type { ApiClient } from '../lib/api-client';

function fakeClient() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client = {
    get: (path: string) => { calls.push({ method: 'GET', path }); return Promise.resolve({ data: [] }); },
    post: (path: string, body?: unknown) => { calls.push({ method: 'POST', path, body }); return Promise.resolve({ data: {} }); },
    put: (path: string, body?: unknown) => { calls.push({ method: 'PUT', path, body }); return Promise.resolve({ data: {} }); },
    patch: (path: string, body?: unknown) => { calls.push({ method: 'PATCH', path, body }); return Promise.resolve({ data: {} }); },
    del: (path: string) => { calls.push({ method: 'DELETE', path }); return Promise.resolve({ data: {} }); },
  } as unknown as ApiClient;
  return { client, calls };
}

describe('tasksApi', () => {
  it('list() calls GET /tasks with the projectId query', async () => {
    const { client, calls } = fakeClient();
    await tasksApi(client).list('p1');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/tasks?projectId=p1' });
  });

  it('list() without a project calls GET /tasks', async () => {
    const { client, calls } = fakeClient();
    await tasksApi(client).list();
    expect(calls[0]!.path).toBe('/tasks');
  });

  it('move() calls PATCH /tasks/:id/move with the columnId', async () => {
    const { client, calls } = fakeClient();
    await tasksApi(client).move('t1', 'c2');
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/tasks/t1/move', body: { columnId: 'c2' } });
  });

  it('create() POSTs to /tasks', async () => {
    const { client, calls } = fakeClient();
    await tasksApi(client).create({ title: 'x', projectId: 'p1', columnId: 'c1' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/tasks' });
  });
});
