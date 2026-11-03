import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.22: the Activity calendar — changes per day (`?from=&to=`) and one day's changes (`?day=`) — over
// the real route and the real Prisma source, with the feed's own scope and the picked company. Days
// are the site's (Asia/Muscat, UTC+4); the rows sit in 2031 so no other test's rows land on them.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let api: CompanyApp;
const DAY = '2031-03-14';
const BUSY = '2031-03-20';

type Count = { day: string; count: number };
type Row = { id: string; action: string; projectId: string | null; actor?: { name: string } | null; task?: { key: string } | null; project?: { name: string } | null };
type Page = { data: Row[]; next: string | null };
const counts = async (viewer: CompanyWorld['as']['ana'], query: string, headers?: Record<string, string>) =>
  (await api.get(viewer, `/activity?from=2031-03-13&to=2031-03-16${query}`, headers)) as Count[];
const dayPage = async (viewer: CompanyWorld['as']['ana'], query: string, headers?: Record<string, string>) =>
  (await api.getRaw(viewer, `/activity?${query}`, headers)).json() as Page;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  const { people, projects, tasks } = w;
  const line = (projectId: string, taskId: string, action: string, iso: string) =>
    prisma.activity.create({ data: { projectId, taskId, userId: people.admin, action, createdAt: new Date(iso) } });
  await line(projects.PA, tasks.TA1, 'CREATED', '2031-03-13T21:30:00Z'); // 14 Mar 01:30 in Muscat
  await line(projects.PA, tasks.TA1, 'COMPLETED', '2031-03-14T08:00:00Z');
  await line(projects.PA, tasks.TA1, 'REOPENED', '2031-03-15T08:00:00Z');
  await line(projects.PB, tasks.TB1, 'MOVED', '2031-03-14T09:00:00Z');
  await line(projects.PAB, tasks.TAB1, 'ASSIGNED', '2031-03-14T10:00:00Z');
  await line(projects.PC, tasks.TC1, 'MOVED', '2031-03-14T11:00:00Z');
  // A busy day: 105 changes, 60 of them at the very same moment (the page break falls among them).
  const same = new Date(`${BUSY}T06:00:00Z`);
  await prisma.activity.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      projectId: projects.PA,
      taskId: tasks.TA2,
      userId: people.admin,
      action: 'MOVED',
      createdAt: i < 60 ? same : new Date(same.getTime() + (i - 59) * 1000),
    })),
  });
  api = await buildCompanyApp(prisma);
});

afterAll(async () => {
  await api?.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('Activity calendar: changes per day (companies scope, site days)', () => {
  it('ana (PA and PAB) counts her projects’ changes on the site’s days', async () => {
    expect(await counts(w.as.ana, '')).toEqual([
      { day: '2031-03-14', count: 3 },
      { day: '2031-03-15', count: 1 },
    ]);
  });

  it('cat (PA and PB) counts both her companies; with Beta picked, Beta’s only', async () => {
    expect(await counts(w.as.cat, '')).toEqual([
      { day: '2031-03-14', count: 3 },
      { day: '2031-03-15', count: 1 },
    ]);
    expect(await counts(w.as.cat, '', { 'x-company-id': w.companies.B })).toEqual([{ day: '2031-03-14', count: 1 }]);
  });

  it('an administrator with Alpha picked counts PA and PAB', async () => {
    expect(await counts(w.as.admin, '', { 'x-company-id': w.companies.A })).toEqual([
      { day: '2031-03-14', count: 3 },
      { day: '2031-03-15', count: 1 },
    ]);
  });

  it('a filter counts only its kind (Completed: reopenings too)', async () => {
    expect(await counts(w.as.ana, '&kind=COMPLETED')).toEqual([
      { day: '2031-03-14', count: 1 },
      { day: '2031-03-15', count: 1 },
    ]);
  });

  it('gus (only an archived company) sees nothing', async () => {
    expect(await counts(w.as.gus, '')).toEqual([]);
  });
});

describe('Activity calendar: one day’s changes', () => {
  it('lists the day’s changes newest first, with who, which task and which project', async () => {
    const page = await dayPage(w.as.ana, `day=${DAY}`);
    expect(page.data.map((r) => r.action)).toEqual(['ASSIGNED', 'COMPLETED', 'CREATED']);
    expect(page.next).toBeNull();
    expect(page.data[0]!.project?.name).toBe(`Project PAB ${w.tag}`);
    expect(page.data[0]!.task?.key).toBe(`TAB1${w.tag.toUpperCase()}-1`);
    expect(page.data[0]!.actor?.name).toBe(`Admin World ${w.tag}`);
  });

  it('with Beta picked, cat’s day holds Beta’s change only; with a filter, that kind only', async () => {
    const beta = await dayPage(w.as.cat, `day=${DAY}`, { 'x-company-id': w.companies.B });
    expect(beta.data.map((r) => r.projectId)).toEqual([w.projects.PB]);
    const done = await dayPage(w.as.cat, `day=${DAY}&kind=COMPLETED`);
    expect(done.data.map((r) => r.action)).toEqual(['COMPLETED']);
  });

  it('pages a busy day 100 at a time, with no change twice or missed — even among changes at the same moment', async () => {
    const first = await dayPage(w.as.ana, `day=${BUSY}`);
    expect(first.data).toHaveLength(100);
    expect(first.next).toBe(first.data[99]!.id);
    const second = await dayPage(w.as.ana, `day=${BUSY}&before=${first.next}`);
    expect(second.data).toHaveLength(5);
    expect(second.next).toBeNull();
    const ids = [...first.data, ...second.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(105);
  });

  it('a place to carry on from that no longer exists gives an empty page', async () => {
    expect(await dayPage(w.as.ana, `day=${BUSY}&before=gone-for-good`)).toEqual({ data: [], next: null });
  });
});
