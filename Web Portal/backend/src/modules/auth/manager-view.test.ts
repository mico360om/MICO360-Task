import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createTokenService } from './token-service';
import { createAuthGuard, type UserState } from './auth-guard';
import { ROUTE_CLASSES } from '../companies/route-classes';
import { routeKeyOf } from '../clients/client-route-table';
import {
  MANAGER_VIEW_ALLOWED,
  MANAGER_VIEW_ALWAYS_REFUSED,
  MANAGER_VIEW_CODE,
  MANAGER_VIEW_SWITCH,
  MANAGER_VIEW_WORDS,
  PROJECT_SETTINGS_ROUTES,
  effectiveRoles,
  inManagerView,
  isEffectiveAdmin,
  managerViewRule,
} from './manager-view';

// Manager View (owner, 10 Nov): one central check. While an administrator has it on, every admin-only
// route answers 403 MANAGER_VIEW (reads and writes), project settings open only for the projects they run
// (and there they act as that project's manager), and the switch itself is never refused. The source is
// scanned, so an admin-only route added later is refused by default unless it is reviewed into
// MANAGER_VIEW_ALLOWED with a reason.

const SRC = resolve(__dirname, '..', '..');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}
const FILES = [...sourceFiles(join(SRC, 'modules')), join(SRC, 'app.ts'), join(SRC, 'server.ts'), join(SRC, 'lib', 'web-app.ts')];
const ROUTE = /\b(?:app|api)\.(get|post|put|patch|delete)\(\s*(['`])([^'`]+)\2([\s\S]{0,200}?)(?:async|\(req|\(_req|preview\(|handler)/g;
/** Every route the server registers, and whether its own guard is `requireRoles('ADMIN')` (directly or by a named const). */
const found = FILES.flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  const adminConsts = [...text.matchAll(/const (\w+) = \{ preHandler: (?:deps\.)?guard\.requireRoles\('ADMIN'\) \}/g)].map((m) => m[1]!);
  return [...text.matchAll(ROUTE)].map((m) => {
    const opts = m[4] ?? '';
    const adminGuard = opts.includes("requireRoles('ADMIN')") || adminConsts.some((c) => new RegExp(`\\b${c}\\b`).test(opts));
    return { key: `${m[1]!.toUpperCase()} ${m[3]}`, file: relative(SRC, file).split(sep).join('/'), adminGuard };
  });
});
const scanned = found.map((r) => r.key);
/** Admin-only: the companies table's administrator class, or a requireRoles('ADMIN') guard. */
const adminOnly = [...new Set([...Object.entries(ROUTE_CLASSES).filter(([, c]) => c === 'admin').map(([k]) => k), ...found.filter((r) => r.adminGuard).map((r) => r.key)])].sort();

describe('Manager View — the routes it refuses (scanned from the source)', () => {
  it('the scan finds the admin-only routes (the scan itself works)', () => {
    expect(scanned.length).toBeGreaterThan(300);
    expect(adminOnly.length).toBeGreaterThan(80);
    // Both ways of being admin-only are seen.
    expect(found.find((r) => r.key === 'GET /audit-logs')?.adminGuard).toBe(true);
    expect(found.find((r) => r.key === 'GET /users')?.adminGuard).toBe(true);
    expect(found.find((r) => r.key === 'DELETE /projects/:id')?.adminGuard).toBe(true);
    expect(found.find((r) => r.key === 'GET /reports/status')?.adminGuard).toBe(true);
    expect(adminOnly).toContain('GET /system-settings');
    expect(adminOnly).toContain('GET /error-log');
  });

  it('every admin-only route is refused while Manager View is on — unless reviewed into the allowed list', () => {
    const open = adminOnly.filter((k) => managerViewRule(k) !== 'refuse' && !(k in MANAGER_VIEW_ALLOWED));
    expect(open).toEqual([]);
  });

  // tbk: the Recycle Bin's "Delete forever" is work, not a setting (owner: an administrator in Manager View still has the Recycle Bin).
  it('the allowed list is exactly the reviewed one (Reports — the owner: they still see Reports; the Recycle Bin’s Delete forever), each with a reason, each a real admin-only route', () => {
    const allowed = Object.keys(MANAGER_VIEW_ALLOWED).sort();
    const reviewed = (k: string) => k.startsWith('GET /reports/') || k === 'POST /recycle-bin/erase';
    expect(allowed.every(reviewed)).toBe(true);
    expect(allowed).toEqual(adminOnly.filter(reviewed));
    expect(allowed).toContain('POST /recycle-bin/erase');
    for (const [k, why] of Object.entries(MANAGER_VIEW_ALLOWED)) {
      expect(why.length, k).toBeGreaterThan(5);
      expect(managerViewRule(k), k).toBe('open');
    }
  });

  it('a route registered with its full path (GET /api/v1/metrics) is judged by its table row too', () => {
    expect(managerViewRule(routeKeyOf('GET', '/api/v1/metrics'))).toBe('refuse');
    expect(managerViewRule(routeKeyOf('GET', '/api/v1/health'))).toBe('open');
  });

  it('the switch is never refused, and it is the person’s own route', () => {
    expect(scanned).toContain(MANAGER_VIEW_SWITCH);
    expect(managerViewRule(MANAGER_VIEW_SWITCH)).toBe('open');
    expect(ROUTE_CLASSES[MANAGER_VIEW_SWITCH]).toBe('own');
    // Nor anything a person does with their own account (password, preferences, sign-out).
    for (const k of ['POST /users/me/password', 'GET /users/me/preferences', 'PUT /users/me/preferences', 'POST /auth/logout', 'POST /auth/refresh']) expect(managerViewRule(k), k).toBe('open');
  });

  it('every refused or project-settings row names a route that exists', () => {
    expect(MANAGER_VIEW_ALWAYS_REFUSED.filter((k) => !scanned.includes(k))).toEqual([]);
    expect(Object.keys(PROJECT_SETTINGS_ROUTES).filter((k) => !scanned.includes(k))).toEqual([]);
    expect(Object.keys(MANAGER_VIEW_ALLOWED).filter((k) => !scanned.includes(k))).toEqual([]);
  });

  it('project settings: editing a project, its picture, archive, columns, team and client links', () => {
    for (const k of [
      'PUT /projects/:id',
      'POST /projects/:id/archive',
      'POST /projects/:id/image',
      'DELETE /projects/:id/image',
      'POST /projects/:id/columns',
      'PUT /columns/:columnId',
      'DELETE /columns/:columnId',
      'POST /projects/:id/members',
      'PATCH /projects/:id/members/:userId',
      'DELETE /projects/:id/members/:userId',
      'GET /projects/:id/client-shares',
      'POST /projects/:id/client-shares',
      'DELETE /projects/:id/client-shares/:shareId',
      'POST /projects/:id/client-shares/:shareId/resend',
    ]) expect(managerViewRule(k), k).toBe('project-settings');
    // Deleting a project is an administrator's alone (not even its managers): refused outright.
    expect(managerViewRule('DELETE /projects/:id')).toBe('refuse');
  });

  it('the work stays an administrator’s: every project’s tasks, boards, meetings, Reports, Management, their own settings', () => {
    for (const k of ['GET /projects', 'GET /projects/:id', 'POST /projects', 'GET /tasks', 'POST /tasks', 'PUT /tasks/:id', 'DELETE /tasks/:id', 'GET /reports/status', 'GET /management/overview', 'GET /meetings', 'PUT /columns/:columnId/tasks/reorder', 'GET /projects/:id/members', 'GET /projects/:id/columns', 'GET /recycle-bin', 'GET /recycle-bin/tasks/:id', 'POST /recycle-bin/restore', 'POST /recycle-bin/erase']) {
      if (scanned.includes(k)) expect(managerViewRule(k), k).toBe('open');
    }
  });
});

describe('Manager View — who it applies to', () => {
  it('only an administrator with the switch on is in Manager View; the switch means nothing for anyone else', () => {
    expect(inManagerView({ roles: ['ADMIN'], managerView: true })).toBe(true);
    expect(inManagerView({ roles: ['ADMIN'], managerView: false })).toBe(false);
    expect(inManagerView({ roles: ['ADMIN'] })).toBe(false);
    expect(inManagerView({ roles: ['EMPLOYEE'], managerView: true })).toBe(false);
    expect(isEffectiveAdmin({ roles: ['ADMIN'], managerView: true })).toBe(false);
    expect(isEffectiveAdmin({ roles: ['ADMIN'] })).toBe(true);
    expect(isEffectiveAdmin({ roles: ['EMPLOYEE'] })).toBe(false);
    expect(effectiveRoles({ roles: ['ADMIN', 'EMPLOYEE'], managerView: true })).toEqual(['EMPLOYEE']);
    expect(effectiveRoles({ roles: ['ADMIN'], managerView: false })).toEqual(['ADMIN']);
  });
});

// ── The guard, over a stand-in app that registers EVERY admin-only route the source has ──────────────────────

function tokens() {
  return createTokenService({
    accessSecret: 'mv-access',
    refreshSecret: 'mv-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
}
const admin = (managerView: boolean): UserState => ({ tokenVersion: 0, active: true, roles: ['ADMIN'], managerView });
const employee = (managerView: boolean): UserState => ({ tokenVersion: 0, active: true, roles: ['EMPLOYEE'], managerView });
/** A route registered at the root with its full path (`/api/v1/metrics`), as app.ts does for a few. */
const atRoot = (path: string) => path.startsWith('/api/v1/');
/** The URL to call for a route pattern (':x' → 'x1'). */
const urlOf = (path: string) => `${atRoot(path) ? '' : '/api/v1'}${path.replace(/:(\w+)/g, '$1-1')}`;

type Lookup = { runsProject(userId: string, projectId: string): Promise<boolean>; projectIdOfColumn(columnId: string): Promise<string | null> };
async function standIn(states: Record<string, UserState>, keys: string[], given?: Lookup) {
  const lookup = given ? { ...given, runsAmong: async (u: string, ids: string[]) => (await Promise.all(ids.map((id) => given.runsProject(u, id)))).flatMap((ok, i) => (ok ? [ids[i]!] : [])) } : undefined;
  const tokenService = tokens();
  const guard = createAuthGuard(tokenService, { userState: async (id) => states[id] ?? null, cacheTtlMs: 0, ...(lookup ? { managerView: lookup } : {}) });
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { status?: number; code?: string; message?: string };
    reply.status(e.status ?? 500).send({ error: { code: e.code ?? 'INTERNAL', message: e.message } });
  });
  const handler = async (req: { user?: { roles: string[]; managerView?: boolean } }) => ({ data: { roles: req.user!.roles, managerView: req.user!.managerView ?? false } });
  const preOf = (key: string) => (found.find((r) => r.key === key)?.adminGuard ? guard.requireRoles('ADMIN') : guard.authenticate);
  // As the server registers them: under /api/v1, or at the root with their full path (review M1).
  for (const key of keys.filter((k) => atRoot(k.split(' ')[1]!))) {
    const [method, path] = key.split(' ') as [string, string];
    app.route({ method: method as 'GET', url: path, preHandler: preOf(key), handler });
  }
  await app.register(
    async (api) => {
      for (const key of keys.filter((k) => !atRoot(k.split(' ')[1]!))) {
        const [method, path] = key.split(' ') as [string, string];
        api.route({ method: method as 'GET', url: path, preHandler: preOf(key), handler });
      }
    },
    { prefix: '/api/v1' },
  );
  const bearer = async (id: string) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles: states[id]!.roles })).accessToken}` });
  const call = async (id: string, key: string) => {
    const [method, path] = key.split(' ') as [string, string];
    return app.inject({ method: method as 'GET', url: urlOf(path), headers: await bearer(id), payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
  };
  return { app, call };
}

describe('Manager View — the guard refuses every admin-only route the server has, and never the switch', () => {
  const refused = adminOnly.filter((k) => managerViewRule(k) === 'refuse');

  it('refuses each one (403 MANAGER_VIEW, in plain words) for an administrator in Manager View', async () => {
    expect(refused.length).toBeGreaterThan(70);
    expect(refused.filter((k) => k.includes('${'))).toEqual([]);
    const { app, call } = await standIn({ a1: admin(true) }, [...refused, MANAGER_VIEW_SWITCH]);
    const wrong: string[] = [];
    for (const key of refused) {
      const res = await call('a1', key);
      if (res.statusCode !== 403 || res.json().error.code !== MANAGER_VIEW_CODE || res.json().error.message !== MANAGER_VIEW_WORDS.refused) wrong.push(`${key} → ${res.statusCode} ${res.body}`);
    }
    expect(wrong).toEqual([]);
    expect(MANAGER_VIEW_WORDS.refused).toBe('Manager View is on — turn it off to change settings.');
    // The switch: never refused, so the last active administrator can always turn it off.
    expect((await call('a1', MANAGER_VIEW_SWITCH)).statusCode).toBe(200);
    await app.close();
  });

  it('opens each one again the moment it is off (the same administrator, no new sign-in)', async () => {
    const states = { a1: admin(true) };
    const { app, call } = await standIn(states, refused.slice(0, 12));
    expect((await call('a1', refused[0]!)).statusCode).toBe(403);
    states.a1 = admin(false);
    for (const key of refused.slice(0, 12)) expect((await call('a1', key)).statusCode, key).toBe(200);
    await app.close();
  });

  it('an employee’s stored switch changes nothing (their admin routes stay 403 FORBIDDEN, their own work open)', async () => {
    const { app, call } = await standIn({ e1: employee(true) }, ['GET /system-settings', 'GET /tasks/mine']);
    const r = await call('e1', 'GET /system-settings');
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('FORBIDDEN');
    const mine = await call('e1', 'GET /tasks/mine');
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data).toEqual({ roles: ['EMPLOYEE'], managerView: false });
    await app.close();
  });

  it('Reports and every project’s work stay open, as an administrator', async () => {
    const keys = ['GET /reports/status', 'GET /tasks/mine', 'GET /projects/:id', 'PUT /tasks/:id'];
    const { app, call } = await standIn({ a1: admin(true) }, keys);
    for (const key of keys) {
      const r = await call('a1', key);
      expect(r.statusCode, key).toBe(200);
      expect(r.json().data, key).toEqual({ roles: ['ADMIN'], managerView: true });
    }
    await app.close();
  });
});

describe('Manager View — project settings only for the projects they run', () => {
  const lookup = {
    async runsProject(userId: string, projectId: string) {
      return userId === 'a1' && projectId === 'id-1';
    },
    async projectIdOfColumn(columnId: string) {
      return columnId === 'columnId-1' ? 'id-1' : null;
    },
  };
  const settings = Object.keys(PROJECT_SETTINGS_ROUTES);

  it('opens a project they run, with their usual rights (an administrator needn’t belong to its company)', async () => {
    const { app, call } = await standIn({ a1: admin(true) }, settings, lookup);
    for (const key of settings) {
      const r = await call('a1', key);
      expect(r.statusCode, `${key} ${r.body}`).toBe(200);
      expect(r.json().data, key).toEqual({ roles: ['ADMIN'], managerView: true });
    }
    await app.close();
  });

  it('refuses a project they don’t run (403 MANAGER_VIEW), and a column of one', async () => {
    const other = { runsProject: async () => false, projectIdOfColumn: async () => 'p9' };
    const { app, call } = await standIn({ a1: admin(true) }, settings, other);
    for (const key of settings) {
      const r = await call('a1', key);
      expect(r.statusCode, key).toBe(403);
      expect(r.json().error.code, key).toBe(MANAGER_VIEW_CODE);
    }
    await app.close();
  });

  it('a column that isn’t there is refused too (never opened by mistake)', async () => {
    const { app, call } = await standIn({ a1: admin(true) }, ['PUT /columns/:columnId'], { runsProject: async () => true, projectIdOfColumn: async () => null });
    expect((await call('a1', 'PUT /columns/:columnId')).json().error.code).toBe(MANAGER_VIEW_CODE);
    await app.close();
  });

  it('without the project lookup wired, project settings are refused (fails closed)', async () => {
    const { app, call } = await standIn({ a1: admin(true) }, ['PUT /projects/:id']);
    expect((await call('a1', 'PUT /projects/:id')).json().error.code).toBe(MANAGER_VIEW_CODE);
    await app.close();
  });

  it('with Manager View off, an administrator changes any project’s settings as an administrator', async () => {
    const { app, call } = await standIn({ a1: admin(false) }, ['PUT /projects/:id'], { runsProject: async () => false, projectIdOfColumn: async () => null });
    const r = await call('a1', 'PUT /projects/:id');
    expect(r.statusCode).toBe(200);
    expect(r.json().data.roles).toEqual(['ADMIN']);
    await app.close();
  });
});
