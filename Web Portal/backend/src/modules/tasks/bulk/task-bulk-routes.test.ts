import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { HttpError } from '../../../lib/http-errors';
import { registerTaskBulkRoutes } from './task-bulk-routes';
import type { TaskBulkService } from './task-bulk';
import type { AuthGuard } from '../../auth/auth-guard';

// POST /tasks/bulk and its Undo: the body is checked (every action's shape), the service decides.

const guard = {
  authenticate: async (req: { user?: unknown }) => {
    req.user = { id: 'sara', roles: ['EMPLOYEE'] };
  },
} as unknown as AuthGuard;

async function app(perMinute?: number) {
  const calls: unknown[] = [];
  const service = {
    run: async (actor: unknown, input: unknown) => (calls.push({ actor, input }), { action: 'priority', dryRun: false, total: 1, changed: [], skipped: [], undo: null }),
    undo: async (actor: unknown, id: string) => (calls.push({ actor, id }), { restored: [], skipped: [] }),
  } as unknown as TaskBulkService;
  const f = Fastify();
  await f.register(rateLimit, { global: false });
  f.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid input.' } });
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { message: String(err) } });
  });
  await f.register(async (api) => registerTaskBulkRoutes(api, { service, guard, ...(perMinute ? { perMinute } : {}) }));
  return { f, calls };
}

const post = (f: Awaited<ReturnType<typeof app>>['f'], payload: unknown) => f.inject({ method: 'POST', url: '/tasks/bulk', payload: payload as object });

describe('POST /tasks/bulk', () => {
  it('takes every action of the contract', async () => {
    const { f, calls } = await app();
    const actions = [
      { type: 'status', status: 'DONE' },
      { type: 'priority', priority: 'HIGH' },
      { type: 'assign', userIds: ['u1'] },
      { type: 'reassign', userIds: ['u1', 'u2'] },
      { type: 'unassign' },
      { type: 'unassign', userIds: ['u1'] },
      { type: 'dueDate', mode: 'set', date: '2026-11-20' },
      { type: 'dueDate', mode: 'clear' },
      { type: 'dueDate', mode: 'shift', days: -3 },
      { type: 'project', projectId: 'p2', assignees: 'UNASSIGN' },
      { type: 'category', add: ['c1'], remove: ['c2'] },
      { type: 'guests', add: ['g1'] },
      { type: 'duplicate' },
      { type: 'archive' },
      { type: 'unarchive' },
      { type: 'delete' },
    ];
    for (const action of actions) expect((await post(f, { taskIds: ['t1'], action })).statusCode, JSON.stringify(action)).toBe(200);
    expect(calls).toHaveLength(actions.length);
    expect(calls[0]).toEqual({ actor: { id: 'sara', roles: ['EMPLOYEE'] }, input: { taskIds: ['t1'], action: { type: 'status', status: 'DONE' }, dryRun: false, ip: '127.0.0.1' } });
  });

  it('refuses a body that isn’t one (unknown action, a status that isn’t one, a shift of 0 days, no tasks, 21 people)', async () => {
    const { f, calls } = await app();
    for (const body of [
      { taskIds: ['t1'], action: { type: 'explode' } },
      { taskIds: ['t1'], action: { type: 'status', status: 'LATER' } },
      { taskIds: ['t1'], action: { type: 'dueDate', mode: 'shift', days: 0 } },
      { taskIds: ['t1'], action: { type: 'dueDate', mode: 'set', date: 'tomorrow' } },
      { taskIds: [], action: { type: 'delete' } },
      { taskIds: ['t1'], action: { type: 'assign', userIds: Array.from({ length: 21 }, (_, i) => `u${i}`) } },
    ]) {
      expect((await post(f, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('a dry run says so to the service', async () => {
    const { f, calls } = await app();
    await post(f, { taskIds: ['t1'], action: { type: 'delete' }, dryRun: true });
    expect(calls[0]).toMatchObject({ input: { dryRun: true } });
  });

  it('is limited per person a minute (each request can touch 500 tasks)', async () => {
    const { f } = await app(2);
    const body = { taskIds: ['t1'], action: { type: 'archive' } };
    expect((await post(f, body)).statusCode).toBe(200);
    expect((await post(f, body)).statusCode).toBe(200);
    expect((await post(f, body)).statusCode).toBe(429);
  });
});

describe('POST /tasks/bulk/:bulkId/undo', () => {
  it('passes the person and the id', async () => {
    const { f, calls } = await app();
    expect((await f.inject({ method: 'POST', url: '/tasks/bulk/ckabc123/undo', payload: {} })).statusCode).toBe(200);
    expect(calls).toEqual([{ actor: { id: 'sara', roles: ['EMPLOYEE'] }, id: 'ckabc123' }]);
  });
});
