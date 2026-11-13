import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createColumnService } from './column-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { ColumnRecord, ColumnRepository, CreateColumnData } from './column-repository';

function inMemory(): ColumnRepository {
  const rows: ColumnRecord[] = [];
  let seq = 0;
  return {
    async countLiveTasks(id) { return id === 'busy' ? 1 : 0; },
    async listForProject(projectId) { return rows.filter((c) => c.projectId === projectId); },
    async create(data: CreateColumnData) {
      const c = { id: `c${seq++}`, projectId: data.projectId, name: data.name, category: data.category ?? 'TODO', position: data.position, color: data.color ?? '#948985', enabled: true } as ColumnRecord;
      rows.push(c);
      return c;
    },
    async update(id, patch) { const c = rows.find((r) => r.id === id)!; Object.assign(c, patch); return c; },
    async changeStatus(id, patch, check) {
      const c = rows.find((r) => r.id === id)!;
      check({ category: c.category, live: c.name === 'Full' ? 2 : 0, archived: 0, binned: 0, waiting: 0 });
      Object.assign(c, patch);
      return c;
    },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      const [removed] = rows.splice(i, 1);
      return { projectId: removed!.projectId };
    },
  };
}

const tokenService = createTokenService({ accessSecret: 'col-a', refreshSecret: 'col-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });

const events: { projectId: string; event: string; payload: unknown }[] = [];

async function makeApp() {
  const columnService = createColumnService({ columns: inMemory() });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({
    authService,
    tokenService,
    columnService,
    onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
  });
}
async function token(roles: string[]) {
  return (await tokenService.issueTokens({ id: 'u1', roles })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  events.length = 0;
  app = await makeApp();
});

describe('Column routes', () => {
  it('lists a project’s columns for any authenticated user (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/columns', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('lets an admin add a column (201)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: { authorization: `Bearer ${await token(['ADMIN'])}` }, payload: { name: 'Review', category: 'REVIEW' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.name).toBe('Review');
  });

  it('forbids an employee from adding a column (403)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
  });

  it('broadcasts column:changed on add, update (rename/reorder) and delete', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const created = await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: admin, payload: { name: 'Review', category: 'REVIEW' } });
    const columnId = created.json().data.id;

    await app.inject({ method: 'PUT', url: `/api/v1/columns/${columnId}`, headers: admin, payload: { name: 'In Review', position: 2 } });
    await app.inject({ method: 'DELETE', url: `/api/v1/columns/${columnId}`, headers: admin });

    const colEvents = events.filter((e) => e.event === 'column:changed');
    expect(colEvents.map((e) => (e.payload as { action: string }).action)).toEqual(['created', 'updated', 'deleted']);
    expect(colEvents.every((e) => e.projectId === 'p1')).toBe(true);
    expect((colEvents[2]!.payload as { columnId: string }).columnId).toBe(columnId);
  });

  it('validates column input (blank/overlong names, fractional positions)', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    expect((await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: admin, payload: { name: '   ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: admin, payload: { name: 'x'.repeat(192) } })).statusCode).toBe(400);
    const id = (await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: admin, payload: { name: 'Ok' } })).json().data.id;
    expect((await app.inject({ method: 'PUT', url: `/api/v1/columns/${id}`, headers: admin, payload: { position: 1.5 } })).statusCode).toBe(400);
    // The board swaps columns through a temporary negative position.
    expect((await app.inject({ method: 'PUT', url: `/api/v1/columns/${id}`, headers: admin, payload: { position: -1001 } })).statusCode).toBe(200);
  });

  it('answers a delete of a column with tasks with a clear 409, not a 500', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/columns/busy', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('COLUMN_NOT_EMPTY');
  });

  it('review fix #13: a status change into Done on a column holding tasks answers 409 with plain words', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const id = (await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: admin, payload: { name: 'Full' } })).json().data.id;
    const res = await app.inject({ method: 'PUT', url: `/api/v1/columns/${id}`, headers: admin, payload: { category: 'DONE' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'COLUMN_HAS_TASKS', message: 'Move the tasks out of this column first, then change its status.' });
    expect(events.filter((e) => e.event === 'column:changed').map((e) => (e.payload as { action: string }).action)).toEqual(['created']);
  });

  it('review fix #26: PUT /projects/:id/columns/order saves the whole order in one request (admins and whoever runs the project)', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const a = (await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: admin, payload: { name: 'A' } })).json().data.id;
    const b = (await app.inject({ method: 'POST', url: '/api/v1/projects/p1/columns', headers: admin, payload: { name: 'B' } })).json().data.id;
    const res = await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/columns/order', headers: admin, payload: { columnIds: [b, a] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((c: { name: string; position: number }) => `${c.name}@${c.position}`)).toEqual(['B@0', 'A@1']);
    const last = events.filter((e) => e.event === 'column:changed').at(-1)!;
    expect(last.projectId).toBe('p1');
    expect((last.payload as { action: string }).action).toBe('reordered');
    // A list that isn't the project's columns (one added or removed meanwhile): a plain 409.
    const stale = await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/columns/order', headers: admin, payload: { columnIds: [a] } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('COLUMNS_CHANGED');
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/columns/order', headers: admin, payload: { columnIds: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/columns/order', headers: admin, payload: { columnIds: [a, a] } })).statusCode).toBe(409);
    const employee = { authorization: `Bearer ${await token(['EMPLOYEE'])}` };
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/columns/order', headers: employee, payload: { columnIds: [a, b] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/projects/p1/columns/order', payload: { columnIds: [a, b] } })).statusCode).toBe(401);
  });
});
