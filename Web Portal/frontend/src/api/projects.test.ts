import { describe, it, expect } from 'vitest';
import { projectsApi } from './projects';
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

describe('projectsApi', () => {
  it('list() calls GET /projects', async () => {
    const { client, calls } = fakeClient();
    await projectsApi(client).list();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/projects' });
  });

  it('create() POSTs to /projects with the code', async () => {
    const { client, calls } = fakeClient();
    await projectsApi(client).create({ code: 'MICO', name: 'MICO360' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/projects', body: { code: 'MICO', name: 'MICO360' } });
  });
});
