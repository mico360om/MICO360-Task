import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { BinService } from './bin-service';

const tokenService = createTokenService({
  accessSecret: 'bin-access',
  refreshSecret: 'bin-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

let calls: { name: string; args: unknown[] }[] = [];

/** A bin service that records what it is asked: the routes' own work (checks, limits) is tested here. */
function fakeService(): BinService {
  const log = (name: string, result: unknown) => async (...args: unknown[]) => {
    calls.push({ name, args });
    return result;
  };
  return {
    list: log('list', { rows: [{ id: 't1' }], total: 1, offset: 0, limit: 50, facets: { projects: [], deleters: [] }, canErase: false }),
    detail: log('detail', { task: { id: 't1' } }),
    restore: log('restore', { restored: [], notRestored: [] }),
    erase: log('erase', { erased: [], notErased: [] }),
    sweep: log('sweep', 0),
    deleted: log('deleted', undefined),
    noticeFor: log('noticeFor', null),
  } as unknown as BinService;
}

async function makeApp() {
  calls = [];
  return buildApp({ authService, tokenService, binService: fakeService() });
}
let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('GET /recycle-bin', () => {
  it('passes the search, filters, sort and page through, checked', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/recycle-bin?q=RIG-12&project=p1&deletedBy=unknown&from=2026-11-01&to=2026-11-09&soon=1&company=c1&sort=daysLeft&limit=20&offset=40', headers: await bearer('sara') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: 't1' }], meta: { total: 1, offset: 0, limit: 50, facets: { projects: [], deleters: [] }, canErase: false } });
    expect(calls[0]).toEqual({
      name: 'list',
      args: [{ id: 'sara', roles: ['EMPLOYEE'] }, null, { q: 'RIG-12', projectId: 'p1', deletedById: 'unknown', deletedFrom: '2026-11-01', deletedTo: '2026-11-09', soon: true, companyId: 'c1', sort: 'daysLeft', limit: 20, offset: 40 }],
    });
  });

  it('refuses what it can’t read: a long search, a made-up date, a page too big, an unknown sort', async () => {
    for (const q of [`q=${'a'.repeat(201)}`, 'from=2026-02-30', 'limit=500', 'sort=title', 'offset=-1']) {
      expect((await app.inject({ method: 'GET', url: `/api/v1/recycle-bin?${q}`, headers: await bearer('sara') })).statusCode).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('needs a signed-in staff member: no session 401, a client account refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/recycle-bin' })).statusCode).toBe(401);
    const client = await app.inject({ method: 'GET', url: '/api/v1/recycle-bin', headers: await bearer('cli', ['CLIENT']) });
    expect(client.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('POST /recycle-bin/restore and /erase', () => {
  it('restore takes 1–200 task ids and says whether to bring back the whole batch', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/recycle-bin/restore', headers: await bearer('sara'), payload: { taskIds: ['t1'], wholeBatch: true } });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.args.slice(0, 2)).toEqual([{ id: 'sara', roles: ['EMPLOYEE'] }, ['t1']]);
    expect(calls[0]!.args[2]).toMatchObject({ wholeBatch: true });
    for (const payload of [{ taskIds: [] }, { taskIds: Array.from({ length: 201 }, (_, i) => `t${i}`) }, { taskIds: ['t1'], wholeBatch: 'yes' }, {}]) {
      expect((await app.inject({ method: 'POST', url: '/api/v1/recycle-bin/restore', headers: await bearer('sara'), payload })).statusCode).toBe(400);
    }
  });

  it('delete forever: administrators only (403 before the service is asked)', async () => {
    const refused = await app.inject({ method: 'POST', url: '/api/v1/recycle-bin/erase', headers: await bearer('sara'), payload: { taskIds: ['t1'] } });
    expect(refused.statusCode).toBe(403);
    expect(calls).toEqual([]);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/recycle-bin/erase', headers: await bearer('aisha', ['ADMIN']), payload: { taskIds: ['t1'] } });
    expect(ok.statusCode).toBe(200);
    expect(calls.map((c) => c.name)).toEqual(['erase']);
  });

  it('a deleted task read-only', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/recycle-bin/tasks/t1', headers: await bearer('sara') })).json()).toEqual({ data: { task: { id: 't1' } } });
  });
});
