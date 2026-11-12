import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { createTokenService } from '../auth/token-service';
import { createAuthGuard, type UserState } from '../auth/auth-guard';
import { createMemoryManagerViewStore, registerManagerViewRoutes } from './manager-view-routes';
import { MANAGER_VIEW_CODE } from '../auth/manager-view';

// Manager View's switch (owner, 10 Nov): an administrator's own, saved on their account, recorded in the
// audit log, taking effect at once (no sign-out) and never refused — the last active administrator can
// always turn it off. Anyone else's request is ignored.

function setup(states: Record<string, UserState>) {
  const tokenService = createTokenService({
    accessSecret: 'mvr-access',
    refreshSecret: 'mvr-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const store = createMemoryManagerViewStore();
  // The guard reads the switch from the account, as server.ts wires it (a 10-second cache, forgotten on a change).
  const guard = createAuthGuard(tokenService, { userState: async (id) => (states[id] ? { ...states[id]!, managerView: await store.get(id) } : null) });
  const audits: Array<{ userId: string | null; module: string; action: string; entityId: string | null; oldValue?: unknown; newValue?: unknown }> = [];
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { status?: number; statusCode?: number; code?: string; message?: string };
    reply.status(e.status ?? e.statusCode ?? 500).send({ error: { code: e.code ?? 'INTERNAL', message: e.message } });
  });
  const ready = app.register(
    async (api) => {
      await registerManagerViewRoutes(api, { store, guard, audit: { record: async (e) => void audits.push(e) } });
      api.get('/system-settings', { preHandler: guard.requireRoles('ADMIN') }, async () => ({ data: [] }));
    },
    { prefix: '/api/v1' },
  );
  const as = async (id: string) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles: states[id]!.roles })).accessToken}` });
  const put = async (id: string, payload: unknown) => {
    await ready;
    return app.inject({ method: 'PUT', url: '/api/v1/users/me/manager-view', headers: await as(id), payload: payload as object });
  };
  const get = async (id: string, url = '/api/v1/users/me/manager-view') => {
    await ready;
    return app.inject({ method: 'GET', url, headers: await as(id) });
  };
  return { app, store, audits, put, get };
}

const admin: UserState = { tokenVersion: 0, active: true, roles: ['ADMIN'] };
const employee: UserState = { tokenVersion: 0, active: true, roles: ['EMPLOYEE'] };

describe('GET/PUT /users/me/manager-view', () => {
  it('an administrator starts with it off, and has the switch', async () => {
    const { get } = setup({ a1: admin });
    const r = await get('a1');
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual({ available: true, managerView: false });
  });

  it('turning it on is saved on the account, recorded in the audit log, and takes effect at once (no sign-out)', async () => {
    const { put, get, store, audits } = setup({ a1: admin });
    expect((await get('a1', '/api/v1/system-settings')).statusCode).toBe(200); // caches the state (off)
    const on = await put('a1', { on: true });
    expect(on.statusCode).toBe(200);
    expect(on.json().data).toEqual({ available: true, managerView: true });
    expect(await store.get('a1')).toBe(true);
    expect(audits).toEqual([{ userId: 'a1', ip: expect.anything(), module: 'users', action: 'user.manager_view.on', entityId: 'a1', oldValue: { managerView: false }, newValue: { managerView: true } }]);
    // At once — the guard's cached state is forgotten with the change.
    const blocked = await get('a1', '/api/v1/system-settings');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe(MANAGER_VIEW_CODE);
    expect((await get('a1')).json().data).toEqual({ available: true, managerView: true });
  });

  it('turning it off is never refused (the last administrator can’t lock themselves out) and opens the settings at once', async () => {
    const { put, get, audits } = setup({ a1: admin });
    await put('a1', { on: true });
    expect((await get('a1', '/api/v1/system-settings')).statusCode).toBe(403);
    const off = await put('a1', { on: false });
    expect(off.statusCode).toBe(200);
    expect(off.json().data).toEqual({ available: true, managerView: false });
    expect((await get('a1', '/api/v1/system-settings')).statusCode).toBe(200);
    expect(audits.map((a) => a.action)).toEqual(['user.manager_view.on', 'user.manager_view.off']);
  });

  it('sending what it already is changes nothing and records nothing', async () => {
    const { put, audits } = setup({ a1: admin });
    expect((await put('a1', { on: false })).json().data).toEqual({ available: true, managerView: false });
    expect(audits).toEqual([]);
  });

  it('is ignored for anyone who isn’t an administrator: nothing is saved, it stays off', async () => {
    const { put, get, store, audits } = setup({ e1: employee });
    const r = await put('e1', { on: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual({ available: false, managerView: false });
    expect(await store.get('e1')).toBe(false);
    expect(audits).toEqual([]);
    expect((await get('e1')).json().data).toEqual({ available: false, managerView: false });
  });

  it('checks what it is sent', async () => {
    const { put } = setup({ a1: admin });
    expect((await put('a1', { on: 'yes' })).statusCode).toBe(400);
    expect((await put('a1', {})).statusCode).toBe(400);
    expect((await put('a1', { on: true, extra: 1 })).statusCode).toBe(400);
  });
});
