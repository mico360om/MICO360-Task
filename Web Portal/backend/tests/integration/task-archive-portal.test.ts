import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildClientWorld, dropClientWorld, type ClientWorld } from './client-world';
import { buildClientPortalApp } from './client-portal-app';
import { inspectPdf } from '../../src/lib/pdf-inspect';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Task archive (bulk lane): a client never sees an archived task — not on the project page, not by its
// link (404), not in the task list PDF; the percentage follows the figures rule (an archived Done task
// still counts as done, an archived open task leaves). Unarchived, it is back.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: ClientWorld;
let a: Awaited<ReturnType<typeof buildClientPortalApp>>;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildClientWorld(prisma);
  a = await buildClientPortalApp(prisma);
});
afterAll(async () => {
  await a?.close();
  if (w) await dropClientWorld(prisma, w);
  await prisma.$disconnect();
});

const archive = (id: string, on: boolean) => prisma.task.update({ where: { id }, data: on ? { archivedAt: new Date(), archivedById: w.people.omar } : { archivedAt: null, archivedById: null } });

describe('the Client portal and archived tasks (integration)', () => {
  it('an archived task is hidden from the client entirely; the percentage keeps an archived Done task', async () => {
    // P1: S1 shown (open), D1 shown (Done), H1 hidden (open) — 1 of 3 done before.
    await archive(w.tasks.S1, true);
    await archive(w.tasks.D1, true);
    const page = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}`);
    expect(page.status).toBe(200);
    expect(page.data.progress.tasks).toEqual([]);
    // S1 (archived, open) leaves the figures; D1 (archived, Done) still counts: 1 of 2.
    const me = await a.get(w.as.c1, '/portal/me');
    expect(me.data.projects.find((p: { id: string }) => p.id === w.projects.P1).percentDone).toBe(50);
    for (const id of [w.tasks.S1, w.tasks.D1]) expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${id}`)).status).toBe(404);
    expect(page.body).not.toMatch(/Install pump|Survey site/);
  });

  it('nor in the task list PDF', async () => {
    const pdf = await a.app.inject({ method: 'GET', url: `/api/v1/portal/projects/${w.projects.P1}/tasks.pdf`, headers: { authorization: `Bearer ${a.tokenFor(w.as.c1)}` } });
    expect(pdf.statusCode).toBe(200);
    const text = inspectPdf(pdf.rawPayload).pages.flat().join(' ');
    expect(text).not.toMatch(/Install pump|Survey site/);
  });

  it('unarchived, it is back for the client', async () => {
    await archive(w.tasks.S1, false);
    await archive(w.tasks.D1, false);
    const page = await a.get(w.as.c1, `/portal/projects/${w.projects.P1}`);
    expect(page.data.progress.tasks.map((t: { id: string }) => t.id).sort()).toEqual([w.tasks.S1, w.tasks.D1].sort());
    expect((await a.get(w.as.c1, `/portal/projects/${w.projects.P1}/tasks/${w.tasks.S1}`)).status).toBe(200);
  });
});
