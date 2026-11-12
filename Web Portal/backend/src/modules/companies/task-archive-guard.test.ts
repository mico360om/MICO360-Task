import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ARCHIVE_ALLOWED, ARCHIVE_REFUSED, TASK_ARCHIVED_MESSAGE, createArchiveGuard, installArchiveGuard, type ArchiveKind, type ArchiveLookup } from './archive-guard';
import { HttpError } from '../../lib/http-errors';

// Task archive (bulk lane): an archived TASK is read-only — every write an archived project's tasks
// refuse is refused for it (409 TASK_ARCHIVED, "unarchive it first"); deleting stays as today; moving
// another task, making a new task or copying an archived one changes nothing archived. Nobody learns from
// the answer that a task they can't open exists.

/** Ids "tarch…" are archived tasks (and their comments, checklists…) in the live project PL; "live…" live ones. */
const lookup: ArchiveLookup = {
  async subjectOf(_kind: ArchiveKind, id: string) {
    if (id.startsWith('tarch')) return { projectId: 'PL', taskArchived: true };
    if (id.startsWith('live')) return { projectId: 'PL', taskArchived: false };
    return null;
  },
  async isArchived() {
    return false;
  },
};
const guard = createArchiveGuard({ lookup, canSeeProject: async (userId) => userId !== 'nobody', canSeeMeeting: async (userId) => userId !== 'nobody' });

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    return reply.status(500).send({ error: { message: String(err) } });
  });
  await app.register(
    async (api) => {
      installArchiveGuard(api, guard, '/api/v1');
      const signIn = async (req: FastifyRequest) => {
        req.user = { id: String(req.headers['x-user'] ?? 'someone'), roles: ['EMPLOYEE'] } as FastifyRequest['user'];
      };
      for (const key of [...Object.keys(ARCHIVE_REFUSED), ...Object.keys(ARCHIVE_ALLOWED)]) {
        const [method, url] = key.split(' ') as [string, string];
        api.route({ method: method as 'POST', url, preHandler: signIn, handler: async () => ({ ok: true }) });
      }
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
});
afterAll(() => app.close());

const ask = (key: string, side: 'tarch' | 'live', user = 'someone', body: Record<string, unknown> = { projectId: 'PL' }) => {
  const [method, path] = key.split(' ') as [string, string];
  return app.inject({ method: method as 'POST', url: `/api/v1${path.replace(/:(\w+)/g, (_m, n: string) => `${side}-${n}`)}`, payload: body, headers: { 'x-user': user } });
};

/** The refused routes about one existing task (or its comment, checklist item or list, contact). */
const TASK_KINDS = new Set(['task', 'comment', 'checklistItem', 'checklistList', 'externalContact', 'taskToProject']);
const taskWrites = Object.entries(ARCHIVE_REFUSED)
  .filter(([, target]) => TASK_KINDS.has(target))
  .map(([key]) => key);

describe('an archived task is read-only', () => {
  it('the routes about one task are the ones checked', () => {
    for (const key of ['PUT /tasks/:id', 'PATCH /tasks/:id/move', 'POST /tasks/:id/comments', 'PUT /comments/:commentId', 'POST /tasks/:id/checklist', 'PUT /checklist/:itemId', 'POST /tasks/:id/assignees', 'PUT /tasks/:id/categories', 'POST /tasks/:id/guests', 'POST /tasks/:id/move-to-project', 'POST /tasks/:id/approve']) {
      expect(taskWrites, key).toContain(key);
    }
  });

  it.each(taskWrites)('%s: refused with 409 TASK_ARCHIVED and the plain sentence; a live task goes through', async (key) => {
    const res = await ask(key, 'tarch');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'TASK_ARCHIVED', message: TASK_ARCHIVED_MESSAGE } });
    expect((await ask(key, 'live')).statusCode).toBe(200);
  });

  it('says nothing to someone who can’t open its project (the route answers as it does today)', async () => {
    expect((await ask('PUT /tasks/:id', 'tarch', 'nobody')).statusCode).toBe(200);
  });

  it('deleting it (to the Recycle Bin), following it, and copying it are never refused', async () => {
    for (const key of ['DELETE /tasks/:id', 'POST /tasks/:id/watch', 'DELETE /tasks/:id/watch', 'POST /tasks/:id/duplicate']) {
      expect((await ask(key, 'tarch')).statusCode, key).toBe(200);
    }
  });
});
