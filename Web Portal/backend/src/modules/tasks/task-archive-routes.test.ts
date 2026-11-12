import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { HttpError } from '../../lib/http-errors';
import { registerTaskArchiveRoutes } from './task-archive-routes';
import type { ArchiveResult, TaskArchiveService } from './task-archive';
import type { AuthGuard } from '../auth/auth-guard';

// POST /tasks/:id/archive and /unarchive: one task (the task panel's Archive / Unarchive). The service
// decides; the route answers its verdict with the status that goes with it.

const guard = {
  authenticate: async (req: { user?: unknown; headers: Record<string, unknown> }) => {
    req.user = { id: String(req.headers['x-user'] ?? 'mona'), roles: ['EMPLOYEE'] };
  },
} as unknown as AuthGuard;

function app(verdict: (id: string) => ArchiveResult) {
  const calls: { what: string; ids: string[] }[] = [];
  const service = {
    plan: async () => ({ done: [], refused: [] }),
    archive: async (_a: unknown, ids: string[]) => (calls.push({ what: 'archive', ids }), verdict(ids[0]!)),
    unarchive: async (_a: unknown, ids: string[]) => (calls.push({ what: 'unarchive', ids }), verdict(ids[0]!)),
  } as unknown as TaskArchiveService;
  const f = Fastify();
  f.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    return reply.status(500).send({ error: { message: String(err) } });
  });
  const announced: { id: string; archived: boolean }[] = [];
  void f.register(async (api) => registerTaskArchiveRoutes(api, { service, guard, getTask: async (id) => ({ id, key: 'RIG-1', archivedAt: null }) as never }));
  return { f, calls, announced };
}

const done = (id: string): ArchiveResult => ({ done: [{ id, key: 'RIG-1', title: 'Pour', projectId: 'rig' }], refused: [] });
const refused = (id: string, code: string, message: string): ArchiveResult => ({ done: [], refused: [{ id, code, message }] });

describe('POST /tasks/:id/archive and /unarchive', () => {
  it('archives one task and answers it as it is now', async () => {
    const { f, calls } = app(done);
    const res = await f.inject({ method: 'POST', url: '/tasks/t1/archive' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: 't1', key: 'RIG-1' });
    expect(calls).toEqual([{ what: 'archive', ids: ['t1'] }]);
    expect((await f.inject({ method: 'POST', url: '/tasks/t1/unarchive' })).statusCode).toBe(200);
  });

  it.each([
    ['NOT_FOUND', 404],
    ['FORBIDDEN', 403],
    ['PROJECT_ARCHIVED', 409],
    ['ALREADY_ARCHIVED', 409],
    ['NOT_ARCHIVED', 409],
  ])('a refusal %s is answered %i with its sentence', async (code, status) => {
    const { f } = app((id) => refused(id, code, `Because ${code}.`));
    const res = await f.inject({ method: 'POST', url: '/tasks/t1/archive' });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: { code, message: `Because ${code}.` } });
  });
});
