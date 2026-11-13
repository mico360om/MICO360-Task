import { describe, it, expect, vi } from 'vitest';
import type { ApiClient } from '../lib/api-client';
import { trainingApi } from './training';

// The module editor, Duplicate and the Audience filter (1.23.30): the routes and bodies the server takes
// (backend training-manage-routes.ts — Task 6 of the Learning Hub one-course plan).
function fakeClient() {
  const answer = vi.fn(async () => ({ data: { ok: true } }));
  const client = { get: answer, post: answer, put: answer, patch: answer, del: answer, upload: answer, getText: vi.fn(), getBlob: vi.fn() };
  return { client: client as unknown as ApiClient, calls: client };
}

describe('Training Center API: modules, Duplicate and the Audience filter', () => {
  it('adds, changes, removes (moving its lessons) and reorders modules', async () => {
    const { client, calls } = fakeClient();
    const api = trainingApi(client);
    await api.addModule('c 1', { title: 'Reports', moduleKey: 'reports' });
    expect(calls.post).toHaveBeenLastCalledWith('/training/manage/courses/c%201/modules', { title: 'Reports', moduleKey: 'reports' });
    await api.updateModule('m1', { enabled: false });
    expect(calls.patch).toHaveBeenLastCalledWith('/training/manage/modules/m1', { enabled: false });
    await api.removeModule('m1', 'm2');
    expect(calls.post).toHaveBeenLastCalledWith('/training/manage/modules/m1/remove', { moveTo: 'm2' });
    await api.removeModule('m1', null);
    expect(calls.post).toHaveBeenLastCalledWith('/training/manage/modules/m1/remove', { moveTo: null });
    await api.reorderModules('c1', ['m2', 'm1']);
    expect(calls.put).toHaveBeenLastCalledWith('/training/manage/courses/c1/module-order', { moduleIds: ['m2', 'm1'] });
  });

  it('moves a lesson to a module (or to none) through the lesson’s PATCH', async () => {
    const { client, calls } = fakeClient();
    const api = trainingApi(client);
    await api.updateLesson('l1', { moduleId: 'm2' });
    expect(calls.patch).toHaveBeenLastCalledWith('/training/manage/lessons/l1', { moduleId: 'm2' });
    await api.updateLesson('l1', { moduleId: null });
    expect(calls.patch).toHaveBeenLastCalledWith('/training/manage/lessons/l1', { moduleId: null });
  });

  it('duplicates a course', async () => {
    const { client, calls } = fakeClient();
    await trainingApi(client).duplicateCourse('c1');
    expect(calls.post).toHaveBeenLastCalledWith('/training/manage/courses/c1/duplicate');
  });

  it('filters the Courses list by audience (left out when All)', async () => {
    const { client, calls } = fakeClient();
    const api = trainingApi(client);
    await api.courses({ status: 'PUBLISHED', audience: 'CLIENTS' });
    expect(calls.get).toHaveBeenLastCalledWith('/training/manage/courses?status=PUBLISHED&audience=CLIENTS');
    await api.courses({ status: '', module: '', q: '', audience: '' });
    expect(calls.get).toHaveBeenLastCalledWith('/training/manage/courses');
  });
});
