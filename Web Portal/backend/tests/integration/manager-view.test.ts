import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { createPrismaUserStateLookup } from '../../src/modules/auth/prisma-user-state-lookup';
import { createPrismaManagerViewStore } from '../../src/modules/users/manager-view-routes';
import { createPrismaManagerViewLookup } from '../../src/modules/auth/prisma-manager-view-lookup';
import { createColumnService } from '../../src/modules/projects/column-service';
import { createPrismaColumnRepository } from '../../src/modules/projects/prisma-column-repository';
import { createAuditService } from '../../src/modules/audit/audit-service';
import { createPrismaAuditRepository } from '../../src/modules/audit/prisma-audit-repository';
import { MANAGER_VIEW_CODE } from '../../src/modules/auth/manager-view';
import { createSearchScope } from '../../src/modules/search/search-scope';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Manager View (owner, 10 Nov 2026) over the real route handlers and the real account state, wired as
// server.ts wires it: the switch is saved on the account (users.managerView) and audited; while it is on,
// the administrator's admin pages answer 403 MANAGER_VIEW, project settings open only for a project they
// run (and there they act as its manager), and every project's work stays theirs — for the website, the
// Android app and the extension alike (they call the same routes with the same session).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let api: CompanyApp;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  // The administrator runs PA (a MANAGER member of its team — with no company of their own, as administrators
  // often are); PB they don't.
  await prisma.projectMember.create({ data: { projectId: w.projects.PA, userId: w.people.admin, role: 'MANAGER' } });
  api = await buildCompanyApp(prisma, () => ({
    userState: createPrismaUserStateLookup(prisma),
    managerViewStore: createPrismaManagerViewStore(prisma),
    managerViewLookup: createPrismaManagerViewLookup(prisma),
    columnService: createColumnService({ columns: createPrismaColumnRepository(prisma) }),
    auditService: createAuditService({ audit: createPrismaAuditRepository(prisma) }),
  }));
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(w.people) } } });
  await api.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

async function setSwitch(on: boolean) {
  const res = await api.app.inject({ method: 'PUT', url: '/api/v1/users/me/manager-view', payload: { on }, headers: { authorization: await api.bearer(w.as.admin) } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { data: { available: boolean; managerView: boolean } };
}
const send = async (method: 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown) =>
  api.app.inject({ method, url: `/api/v1${path}`, ...(body !== undefined ? { payload: body as object } : {}), headers: { authorization: await api.bearer(w.as.admin) } });

beforeEach(async () => {
  await prisma.user.update({ where: { id: w.people.admin }, data: { managerView: false } });
  // The guard caches the account state for a few seconds; a switch through the route forgets it.
  await setSwitch(false);
});

describe('Manager View on the real routes', () => {
  it('the switch is saved on the account and recorded in the audit log, both ways', async () => {
    expect((await setSwitch(true)).data).toEqual({ available: true, managerView: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.people.admin }, select: { managerView: true } })).managerView).toBe(true);
    await setSwitch(false);
    const rows = await prisma.auditLog.findMany({ where: { userId: w.people.admin, module: 'users', action: { startsWith: 'user.manager_view.' } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action).slice(-2)).toEqual(['user.manager_view.on', 'user.manager_view.off']);
    expect(rows.at(-1)!.entityId).toBe(w.people.admin);
  });

  it('while on: System Settings answers 403 MANAGER_VIEW (reads too); off: open again at once', async () => {
    await setSwitch(true);
    const r = await api.getRaw(w.as.admin, '/system-settings');
    expect(r.statusCode).toBe(403);
    expect((r.json() as { error: { code: string; message: string } }).error).toEqual({ code: MANAGER_VIEW_CODE, message: 'Manager View is on — turn it off to change settings.' });
    expect((await send('PUT', '/system-settings/workload.dailyLimit', { value: 9 })).statusCode).toBe(403);
    await setSwitch(false);
    expect((await api.getRaw(w.as.admin, '/system-settings')).statusCode).toBe(200);
  });

  it('while on: every project’s work stays theirs — projects, tasks, Reports, Management', async () => {
    await setSwitch(true);
    const projects = (await api.get(w.as.admin, '/projects')) as { id: string; canManage: boolean }[];
    // Still every project…
    expect(projects.map((p) => p.id)).toEqual(expect.arrayContaining([w.projects.PA, w.projects.PB, w.projects.PAB]));
    // …but "may change it" only where they run it (the website, the app and the extension show settings by it).
    expect(projects.find((p) => p.id === w.projects.PA)!.canManage).toBe(true);
    expect(projects.find((p) => p.id === w.projects.PB)!.canManage).toBe(false);
    expect(((await api.get(w.as.admin, `/projects/${w.projects.PB}`)) as { canManage: boolean }).canManage).toBe(false);
    // Tasks of a project they don't run (the board, a task, My Tasks), Reports and Management.
    expect((await api.getRaw(w.as.admin, `/tasks?projectId=${w.projects.PB}`)).statusCode).toBe(200);
    expect((await api.getRaw(w.as.admin, `/tasks/${w.tasks.TB1}`)).statusCode).toBe(200);
    expect((await api.getRaw(w.as.admin, '/tasks/mine')).statusCode).toBe(200);
    expect((await api.getRaw(w.as.admin, '/reports/status')).statusCode).toBe(200);
    expect((await api.getRaw(w.as.admin, '/management/overview')).statusCode).toBe(200);
    const edit = await send('PUT', `/tasks/${w.tasks.TB1}`, { title: 'Still an administrator’s work' });
    expect(edit.statusCode, edit.body).toBe(200);
  });

  it('while on: a project they don’t run — its settings are refused (403 MANAGER_VIEW), nothing changes', async () => {
    await setSwitch(true);
    const before = await prisma.project.findUniqueOrThrow({ where: { id: w.projects.PB }, select: { name: true } });
    const r = await send('PUT', `/projects/${w.projects.PB}`, { name: 'Renamed in Manager View' });
    expect(r.statusCode).toBe(403);
    expect((r.json() as { error: { code: string } }).error.code).toBe(MANAGER_VIEW_CODE);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: w.projects.PB }, select: { name: true } })).name).toBe(before.name);
    expect((await send('POST', `/projects/${w.projects.PB}/archive`)).statusCode).toBe(403);
    expect((await send('POST', `/projects/${w.projects.PB}/columns`, { name: 'Extra' })).statusCode).toBe(403);
    const column = await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PB } });
    expect((await send('PUT', `/columns/${column.id}`, { name: 'Renamed' })).statusCode).toBe(403);
    // Deleting a project is an administrator's alone — refused even for one they run.
    expect((await send('DELETE', `/projects/${w.projects.PA}`)).statusCode).toBe(403);
    expect(await prisma.project.count({ where: { id: w.projects.PA, deletedAt: null } })).toBe(1);
  });

  it('while on: a project they run — its settings open (though they belong to none of its companies)', async () => {
    await setSwitch(true);
    const r = await send('PUT', `/projects/${w.projects.PA}`, { description: 'Changed by its manager in Manager View' });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as { data: { canManage: boolean } }).data.canManage).toBe(true);
    const column = await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PA } });
    const c = await send('PUT', `/columns/${column.id}`, { name: column.name });
    expect(c.statusCode, c.body).toBe(200);
  });

  it('off: an administrator changes any project’s settings again', async () => {
    const r = await send('PUT', `/projects/${w.projects.PB}`, { description: 'Changed by an administrator' });
    expect(r.statusCode, r.body).toBe(200);
  });

  it('an employee’s request to turn it on is ignored, and changes nothing for them', async () => {
    const res = await api.app.inject({ method: 'PUT', url: '/api/v1/users/me/manager-view', payload: { on: true }, headers: { authorization: await api.bearer(w.as.ana) } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown }).data).toEqual({ available: false, managerView: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.people.ana }, select: { managerView: true } })).managerView).toBe(false);
  });

  it('while on: search no longer finds client portal accounts (the Clients page’s); the work it finds is unchanged', async () => {
    const scope = createSearchScope({ prisma, accessibleProjectIds: async () => null, manageableProjectIds: async (_u, _r, ids) => new Set(ids) });
    const off = await scope.forViewer({ id: w.people.admin, roles: ['ADMIN'] }, null);
    const on = await scope.forViewer({ id: w.people.admin, roles: ['ADMIN'], managerView: true }, null);
    expect(off.clientAccounts).toBe(true);
    expect(on.clientAccounts).toBeFalsy();
    expect(on.projectIds).toEqual(off.projectIds);
    expect(on.meetings).toEqual(off.meetings);
  });
});
