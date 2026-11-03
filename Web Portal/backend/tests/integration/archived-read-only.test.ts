import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaArchiveLookup, PROJECT_ARCHIVED_MESSAGE } from '../../src/modules/companies/archive-guard';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createPrismaCarryForwardRepo } from '../../src/modules/tasks/prisma-task-repository';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { boardDateFromKey } from '../../src/modules/tasks/board-date';
import type { Viewer } from '../../src/modules/companies/company-access';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.22: an archived project is read-only on the server too — its own status ARCHIVED (PB here) or all
// its companies archived (PC: Gamma is archived). The real route handlers over the real Prisma
// sources, with the archive check wired as server.ts wires it; and the system sweeps skip it.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let api: CompanyApp;
let pbColumn = '';
let benTask = '';

async function send(viewer: Viewer, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown) {
  const token = (await api.deps.tokenService!.issueTokens({ id: viewer.id, roles: viewer.roles })).accessToken;
  return api.app.inject({ method, url: `/api/v1${path}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}
const refused = (res: { statusCode: number; json(): unknown }) => {
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({ error: { code: 'PROJECT_ARCHIVED', message: PROJECT_ARCHIVED_MESSAGE } });
};

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  pbColumn = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PB } })).id;
  // ben's own task in PB (he may delete it under the delete rule), made before PB was archived.
  benTask = (await prisma.task.create({ data: { key: `TB9${w.tag.toUpperCase()}-1`, title: 'ben’s own', projectId: w.projects.PB, columnId: pbColumn, createdById: w.people.ben, assignees: { create: { userId: w.people.ben } } } })).id;
  await prisma.project.update({ where: { id: w.projects.PB }, data: { status: 'ARCHIVED' } });
  api = await buildCompanyApp(prisma, () => ({
    archiveLookup: createPrismaArchiveLookup(prisma),
    taskMoveService: createTaskMoveService({ repo: createPrismaTaskMoveRepository(prisma) }),
  }));
});

afterAll(async () => {
  await api?.close();
  await prisma.meeting.deleteMany({ where: { projectId: { in: Object.values(w.projects) } } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('an archived project is read-only on the server (1.22)', () => {
  it('its owner can’t add a task, change one, move one or change its status', async () => {
    const { ben } = w.as;
    refused(await send(ben, 'POST', '/tasks', { title: 'New', projectId: w.projects.PB, columnId: pbColumn }));
    refused(await send(ben, 'PUT', `/tasks/${w.tasks.TB1}`, { title: 'Changed' }));
    refused(await send(ben, 'PATCH', `/tasks/${w.tasks.TB1}/move`, { columnId: pbColumn, position: 0 }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TB1 } })).title).toBe('TB1 ZZBETA task');
  });

  it('nor a meeting in it, nor change one of its meetings', async () => {
    const { ben } = w.as;
    refused(await send(ben, 'POST', '/meetings', { title: 'Kick-off', projectId: w.projects.PB, startAt: new Date(Date.now() + 86_400_000).toISOString() }));
    refused(await send(ben, 'PUT', `/meetings/${w.meetings.MB}`, { title: 'Renamed' }));
  });

  it('archived by its companies too: an administrator can’t change PC’s task', async () => {
    refused(await send(w.as.admin, 'PUT', `/tasks/${w.tasks.TC1}`, { title: 'Changed' }));
  });

  it('moving a task INTO an archived project is refused', async () => {
    refused(await send(w.as.admin, 'POST', `/tasks/${w.tasks.TA1}/move-to-project`, { projectId: w.projects.PB }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA1 } })).projectId).toBe(w.projects.PA);
  });

  it('someone who can’t see it gets the answer they always got, not a word about it', async () => {
    // gus: his only company (Gamma) is archived — no access, so PC's task is not his to see.
    const res = await send(w.as.gus, 'PUT', `/tasks/${w.tasks.TC1}`, { title: 'Changed' });
    expect(res.statusCode).not.toBe(409);
    expect([403, 404]).toContain(res.statusCode);
  });

  it('reading is not refused, deleting is allowed as today, and reopening it makes it writable again', async () => {
    const { ben } = w.as;
    expect((await api.getRaw(ben, `/tasks/${w.tasks.TB1}`)).statusCode).toBe(200);
    expect((await api.getRaw(ben, `/meetings/${w.meetings.MB}`)).statusCode).toBe(200);
    expect((await api.getRaw(ben, `/tasks?projectId=${w.projects.PB}`)).statusCode).toBe(200);
    expect([200, 204]).toContain((await send(ben, 'DELETE', `/tasks/${benTask}`)).statusCode);
    // Reopen it (its owner may change its status), then the change goes through.
    expect((await send(ben, 'PUT', `/projects/${w.projects.PB}`, { status: 'ACTIVE' })).statusCode).toBe(200);
    const res = await send(ben, 'PUT', `/tasks/${w.tasks.TB1}`, { title: 'Changed after reopening' });
    expect(res.statusCode).toBe(200);
    await prisma.project.update({ where: { id: w.projects.PB }, data: { status: 'ARCHIVED' } });
  });
});

describe('system sweeps skip archived projects (1.22)', () => {
  it('the nightly carry-forward leaves an archived project’s tasks on their days', async () => {
    const past = boardDateFromKey('2026-10-20');
    await prisma.task.updateMany({ where: { id: { in: [w.tasks.TA1, w.tasks.TB1, w.tasks.TC1] } }, data: { boardDate: past } });
    const ids = new Set((await createPrismaCarryForwardRepo(prisma).listCarryCandidates(boardDateFromKey('2026-10-23'))).map((t) => t.id));
    expect(ids.has(w.tasks.TA1)).toBe(true); // PA: live
    expect(ids.has(w.tasks.TB1)).toBe(false); // PB: archived (its own status)
    expect(ids.has(w.tasks.TC1)).toBe(false); // PC: archived (its company)
  });

  it('a repeating meeting of an archived project makes no more meetings', async () => {
    const rule = { freq: 'WEEKLY', interval: 1 };
    const meeting = (projectId: string) =>
      prisma.meeting.create({ data: { title: `Weekly ${w.tag}`, projectId, organizerId: w.people.admin, createdById: w.people.admin, startAt: new Date(Date.now() + 86_400_000), status: 'SCHEDULED', recurrenceRule: rule } });
    const live = await meeting(w.projects.PA);
    const archived = await meeting(w.projects.PB);
    const byCompany = await meeting(w.projects.PC);
    const roots = new Set((await createPrismaMeetingRepository(prisma).listSeriesRoots()).map((m) => m.id));
    expect(roots.has(live.id)).toBe(true);
    expect(roots.has(archived.id)).toBe(false);
    expect(roots.has(byCompany.id)).toBe(false);
  });
});
