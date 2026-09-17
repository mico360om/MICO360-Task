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
    async listForProject(projectId) { return rows.filter((c) => c.projectId === projectId); },
    async create(data: CreateColumnData) {
      const c = { id: `c${seq++}`, projectId: data.projectId, name: data.name, category: data.category ?? 'TODO', position: data.position, color: data.color ?? '#948985', enabled: true } as ColumnRecord;
      rows.push(c);
      return c;
    },
    async update(id, patch) { const c = rows.find((r) => r.id === id)!; Object.assign(c, patch); return c; },
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
});
