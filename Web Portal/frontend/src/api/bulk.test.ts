import { describe, it, expect } from 'vitest';
import { bulkApi } from './bulk';
import type { ApiClient } from '../lib/api-client';

function fakeClient(answer: unknown = { data: {} }) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client = {
    post: (path: string, body?: unknown) => {
      calls.push({ method: 'POST', path, body });
      return Promise.resolve(answer);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const RESULT = {
  action: 'status',
  dryRun: false,
  total: 2,
  changed: [{ id: 't1', key: 'RIG-1', title: 'Pour the slab', projectId: 'p1', note: { code: 'WAITS_FOR_APPROVAL', text: 'Waits for approval' } }],
  skipped: [{ id: 't2', code: 'NOT_FOUND', reason: 'Task not found.' }],
  undo: { id: 'b1', until: '2026-11-12T08:00:30.000Z' },
};

describe('bulkApi (POST /tasks/bulk, the contract)', () => {
  it('a dry run sends the ids, the action and dryRun: true, and gives back the data', async () => {
    const { client, calls } = fakeClient({ data: { ...RESULT, dryRun: true, undo: null } });
    const out = await bulkApi(client).run(['t1', 't2'], { type: 'status', status: 'DONE' }, { dryRun: true });
    expect(calls).toEqual([{ method: 'POST', path: '/tasks/bulk', body: { taskIds: ['t1', 't2'], action: { type: 'status', status: 'DONE' }, dryRun: true } }]);
    expect(out.dryRun).toBe(true);
    expect(out.undo).toBeNull();
  });

  it('applying sends no dryRun at all', async () => {
    const { client, calls } = fakeClient({ data: RESULT });
    const out = await bulkApi(client).run(['t1'], { type: 'dueDate', mode: 'shift', days: -3 });
    expect(calls[0]!.body).toEqual({ taskIds: ['t1'], action: { type: 'dueDate', mode: 'shift', days: -3 } });
    expect(out.changed[0]!.note?.code).toBe('WAITS_FOR_APPROVAL');
    expect(out.undo?.id).toBe('b1');
  });

  it('every action shape goes as it is', async () => {
    const { client, calls } = fakeClient({ data: RESULT });
    const api = bulkApi(client);
    await api.run(['t1'], { type: 'unassign' });
    await api.run(['t1'], { type: 'unassign', userIds: ['u1'] });
    await api.run(['t1'], { type: 'project', projectId: 'p2', columnId: 'c9', assignees: 'ADD_TO_TEAM' });
    await api.run(['t1'], { type: 'category', add: ['k1'], remove: ['k2'] });
    await api.run(['t1'], { type: 'guests', add: ['g1'] });
    await api.run(['t1'], { type: 'duplicate' });
    expect(calls.map((c) => (c.body as { action: unknown }).action)).toEqual([
      { type: 'unassign' },
      { type: 'unassign', userIds: ['u1'] },
      { type: 'project', projectId: 'p2', columnId: 'c9', assignees: 'ADD_TO_TEAM' },
      { type: 'category', add: ['k1'], remove: ['k2'] },
      { type: 'guests', add: ['g1'] },
      { type: 'duplicate' },
    ]);
  });

  it('Undo is POST /tasks/bulk/:id/undo (the id made safe for the address)', async () => {
    const { client, calls } = fakeClient({ data: { restored: [{ id: 't1', key: 'RIG-1', title: 'Pour the slab', projectId: 'p1' }], skipped: [] } });
    const out = await bulkApi(client).undo('ckx/1');
    expect(calls).toEqual([{ method: 'POST', path: '/tasks/bulk/ckx%2F1/undo', body: {} }]);
    expect(out.restored).toHaveLength(1);
  });
});
