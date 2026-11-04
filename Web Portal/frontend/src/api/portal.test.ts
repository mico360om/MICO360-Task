import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../lib/api-client';
import { ApiError } from '../lib/api-client';
import { portalApi, portalProblem, NOT_SHARED } from './portal';

function fakeClient() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const answer = { data: { ok: true } };
  const client: ApiClient = {
    get: vi.fn(async (path: string) => (calls.push({ method: 'GET', path }), answer)) as ApiClient['get'],
    post: vi.fn(async (path: string, body?: unknown) => (calls.push({ method: 'POST', path, body }), answer)) as ApiClient['post'],
    put: vi.fn() as ApiClient['put'],
    patch: vi.fn() as ApiClient['patch'],
    del: vi.fn() as ApiClient['del'],
    upload: vi.fn() as ApiClient['upload'],
    getText: vi.fn() as ApiClient['getText'],
    getBlob: vi.fn(async (path: string) => (calls.push({ method: 'BLOB', path }), new Blob(['%PDF']))) as ApiClient['getBlob'],
  };
  return { client, calls };
}

describe('portalApi', () => {
  it('asks only the portal routes (and the own-password route), unwrapping { data }', async () => {
    const { client, calls } = fakeClient();
    const api = portalApi(client);
    expect(await api.me()).toEqual({ ok: true });
    await api.project('p 1');
    await api.task('p1', 't1');
    await api.comment('p1', 't1', 'Looks good');
    await api.accept('p1', 't1');
    await api.sendBack('p1', 't1', 'The door is missing');
    await api.taskListPdf('p1');
    await api.meetings('p1');
    await api.meeting('p1', 'm1');
    await api.respond('p1', 'm1', 'TENTATIVE');
    await api.minutesPdf('p1', 'm1');
    await api.markDone('p1', 'a1');
    await api.whereIs('m1');
    await api.changePassword('Old1pass', 'New1pass');
    expect(calls).toEqual([
      { method: 'GET', path: '/portal/me' },
      { method: 'GET', path: '/portal/projects/p%201' },
      { method: 'GET', path: '/portal/projects/p1/tasks/t1' },
      { method: 'POST', path: '/portal/projects/p1/tasks/t1/comments', body: { body: 'Looks good' } },
      { method: 'POST', path: '/portal/projects/p1/tasks/t1/accept', body: undefined },
      { method: 'POST', path: '/portal/projects/p1/tasks/t1/send-back', body: { reason: 'The door is missing' } },
      { method: 'BLOB', path: '/portal/projects/p1/tasks.pdf' },
      { method: 'GET', path: '/portal/projects/p1/meetings' },
      { method: 'GET', path: '/portal/projects/p1/meetings/m1' },
      { method: 'POST', path: '/portal/projects/p1/meetings/m1/response', body: { response: 'TENTATIVE' } },
      { method: 'BLOB', path: '/portal/projects/p1/meetings/m1/minutes.pdf' },
      { method: 'POST', path: '/portal/projects/p1/action-items/a1/done', body: undefined },
      { method: 'GET', path: '/portal/meetings/m1' },
      { method: 'POST', path: '/users/me/password', body: { currentPassword: 'Old1pass', newPassword: 'New1pass' } },
    ]);
    for (const c of calls) expect(c.path.startsWith('/portal/') || c.path === '/users/me/password').toBe(true);
  });
});

describe('portalProblem', () => {
  it('says plainly what went wrong', () => {
    expect(portalProblem(new ApiError(404, 'NOT_FOUND', 'This isn’t shared with you.'), 'Couldn’t save.')).toBe(NOT_SHARED);
    expect(portalProblem(new ApiError(403, 'FORBIDDEN', 'You can’t do that on this project. Ask the project team if you need to.'), 'x')).toBe(
      'You can’t do that on this project. Ask the project team if you need to.',
    );
    expect(portalProblem(new ApiError(403, 'FORBIDDEN', 'Request failed (403)'), 'x')).toBe('You can’t do that on this project. Ask the project team if you need to.');
    expect(portalProblem(new ApiError(409, 'NOT_DONE', 'Only a finished task can be signed off.'), 'x')).toBe('Only a finished task can be signed off.');
    expect(portalProblem(new ApiError(429, 'RATE_LIMITED', 'Rate limit exceeded'), 'x')).toBe('Too many downloads at once. Wait a minute and try again.');
    expect(portalProblem(new TypeError('Failed to fetch'), 'Couldn’t send your comment.')).toBe('Couldn’t send your comment. Check your connection and try again.');
    expect(portalProblem(new ApiError(500, 'ERROR', 'Request failed (500)'), 'Couldn’t send your comment.')).toBe('Couldn’t send your comment. Check your connection and try again.');
  });
});
