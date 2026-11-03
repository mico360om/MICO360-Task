import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ROUTE_CLASSES } from './route-classes';
import {
  ARCHIVE_ALLOWED,
  ARCHIVE_REFUSED,
  PROJECT_ARCHIVED_MESSAGE,
  createArchiveGuard,
  installArchiveGuard,
  type ArchiveKind,
  type ArchiveLookup,
  type ArchiveTarget,
} from './archive-guard';
import { HttpError } from '../../lib/http-errors';

// 1.22: an archived project is read-only on the server too. Every write route about one project,
// task or meeting says whether an archived project refuses it — and each refused route is tried here
// through the real hook, against an archived project, a live one and someone who can't see it.

const writes = Object.entries(ROUTE_CLASSES)
  .filter(([key, cls]) => cls === 'object' && !key.startsWith('GET '))
  .map(([key]) => key);

describe('every write route says whether an archived project refuses it', () => {
  it('each one-project write route is refused or allowed — exactly one', () => {
    const unsaid = writes.filter((k) => !(k in ARCHIVE_REFUSED) && !(k in ARCHIVE_ALLOWED));
    expect(unsaid).toEqual([]);
    expect(Object.keys(ARCHIVE_REFUSED).filter((k) => k in ARCHIVE_ALLOWED)).toEqual([]);
  });

  it('the tables name only routes the server has, and only writes', () => {
    for (const key of [...Object.keys(ARCHIVE_REFUSED), ...Object.keys(ARCHIVE_ALLOWED)]) {
      expect(ROUTE_CLASSES[key], key).toBeDefined();
      expect(key.startsWith('GET '), key).toBe(false);
    }
  });

  it('the owner’s list: new tasks, task edits, moves and status changes, comments, files, checklists, meetings, moving a task INTO it', () => {
    for (const key of [
      'POST /tasks',
      'PUT /tasks/:id',
      'PATCH /tasks/:id/move',
      'POST /tasks/:id/approve',
      'POST /tasks/:id/comments',
      'POST /tasks/:id/attachments',
      'POST /tasks/:id/checklist',
      'POST /meetings',
      'PUT /meetings/:id',
      'POST /tasks/:id/move-to-project',
      'POST /tasks/move-to-project',
    ])
      expect(ARCHIVE_REFUSED[key], key).toBeDefined();
    // …and what is never refused: deleting, reopening it, its team.
    for (const key of ['DELETE /tasks/:id', 'DELETE /comments/:commentId', 'DELETE /meetings/:id', 'PUT /projects/:id', 'POST /projects/:id/members']) expect(ARCHIVE_ALLOWED[key], key).toBeDefined();
  });
});

// ── The hook, route by route ──────────────────────────────────────────────────────────────────

/** Ids: "arch…" belong to the archived project PX, "live…" to the live project PL. */
const lookup: ArchiveLookup = {
  async subjectOf(kind: ArchiveKind, id: string) {
    const projectId = id.startsWith('arch') ? 'PX' : id.startsWith('live') ? 'PL' : null;
    if (!projectId) return null;
    if (kind === 'meeting') return { projectId, meetingId: id };
    if (kind === 'actionItem') return { projectId, meetingId: `${id}-meeting` };
    return { projectId };
  },
  async isArchived(projectId) {
    return projectId === 'PX' || projectId.startsWith('arch'); // (a project named in the path: arch-id)
  },
};
/** "nobody" sees nothing; everyone else sees everything. */
const guard = createArchiveGuard({
  lookup,
  canSeeProject: async (userId) => userId !== 'nobody',
  canSeeMeeting: async (userId) => userId !== 'nobody',
});

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    return reply.status(500).send({ error: { message: String(err) } });
  });
  // As app.ts: the API under /api/v1, the check installed before its routes, sign-in first.
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

/** A request to the route, every :param and body id belonging to `side`'s project. */
function ask(key: string, side: 'arch' | 'live', opts: { user?: string; body?: Record<string, unknown> } = {}) {
  const [method, path] = key.split(' ') as [string, string];
  const url = `/api/v1${path.replace(/:(\w+)/g, (_m, name: string) => `${side}-${name}`)}`;
  const project = side === 'arch' ? 'PX' : 'PL';
  const body = opts.body ?? { projectId: project, columnId: `${side}-column`, taskIds: [`${side}-task`] };
  return app.inject({ method: method as 'POST', url, payload: body, headers: { 'x-user': opts.user ?? 'someone' } });
}

/** The new-meeting route's body names a project only when the meeting has one. */
const BODY: Partial<Record<ArchiveTarget, (side: 'arch' | 'live') => Record<string, unknown>>> = {
  meeting: () => ({}),
};

describe.each(Object.entries(ARCHIVE_REFUSED))('%s (an archived project refuses it)', (key, target) => {
  const body = BODY[target];
  it('is refused with 409 PROJECT_ARCHIVED and the plain sentence', async () => {
    const res = await ask(key, 'arch', body ? { body: body('arch') } : {});
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'PROJECT_ARCHIVED', message: PROJECT_ARCHIVED_MESSAGE } });
  });
  it('goes through for a live project', async () => {
    expect((await ask(key, 'live', body ? { body: body('live') } : {})).statusCode).toBe(200);
  });
  it('says nothing to someone who can’t see it (the route answers as it does today)', async () => {
    expect((await ask(key, 'arch', { user: 'nobody', ...(body ? { body: body('arch') } : {}) })).statusCode).toBe(200);
  });
});

describe('moving tasks between projects', () => {
  it('refuses moving a task INTO an archived project, and out of one', async () => {
    const into = await app.inject({ method: 'POST', url: '/api/v1/tasks/live-1/move-to-project', payload: { projectId: 'PX' } });
    expect(into.statusCode).toBe(409);
    const out = await app.inject({ method: 'POST', url: '/api/v1/tasks/arch-1/move-to-project', payload: { projectId: 'PL' } });
    expect(out.statusCode).toBe(409);
    const several = await app.inject({ method: 'POST', url: '/api/v1/tasks/move-to-project', payload: { projectId: 'PL', taskIds: ['live-1', 'arch-2'] } });
    expect(several.statusCode).toBe(409);
    const fine = await app.inject({ method: 'POST', url: '/api/v1/tasks/move-to-project', payload: { projectId: 'PL', taskIds: ['live-1', 'live-2'] } });
    expect(fine.statusCode).toBe(200);
  });

  it('a meeting moved INTO an archived project is refused; a new meeting without a project is not', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/meetings/live-1', payload: { projectId: 'PX' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/v1/meetings', payload: { title: 'Weekly' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/meetings', payload: { projectId: 'PX' } })).statusCode).toBe(409);
  });
});

describe.each(Object.keys(ARCHIVE_ALLOWED))('%s (allowed on an archived project)', (key) => {
  it('goes through', async () => {
    expect((await ask(key, 'arch')).statusCode).toBe(200);
  });
});
