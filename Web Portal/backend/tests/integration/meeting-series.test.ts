import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildPeopleApp } from './company-people-app';
import { inspectPdf } from '../../src/lib/pdf-inspect';
import { createPrismaNamedSeriesStore } from '../../src/modules/meetings/prisma-named-series-store';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23 Meeting series over HTTP, wired as server.ts wires it, in the companies world: a series of PA
// meetings (Alpha's project; team ana, cat). bob (Beta) is invited to two of them, amy (Alpha, not on
// the team) to one; ben and gus to none. Each sees only the meetings they may open — and nothing
// (titles, dates, counts) of the others.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let h: Awaited<ReturnType<typeof buildPeopleApp>>;
const M: Record<'m1' | 'm2' | 'm3', string> = { m1: '', m2: '', m3: '' };
const ITEMS: Record<string, string> = {};
let seriesId = '';
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 6)).toISOString();

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  h = await buildPeopleApp(prisma, {}, { namedSeries: true });
  const make = async (title: string, d: number) => {
    const res = await h.post(w.as.ana, '/meetings', { title, startAt: day(d), endAt: day(d).replace('T06', 'T07'), projectId: w.projects.PA, location: 'Site office' });
    expect(res.status, res.body).toBe(201);
    return res.data.id as string;
  };
  M.m1 = await make('ZZSER first meeting', 6);
  M.m2 = await make('ZZSER second meeting', 13);
  M.m3 = await make('ZZSER third meeting', 20);
  // bob (another company) is invited to the second and third; amy (Alpha, off the team) to the first.
  await prisma.meetingAttendee.createMany({ data: [{ meetingId: M.m2, userId: w.people.bob }, { meetingId: M.m3, userId: w.people.bob }, { meetingId: M.m1, userId: w.people.amy }] });
  const item = async (key: string, meetingId: string, assigneeId: string, status: 'OPEN' | 'COMPLETED' = 'OPEN') => {
    ITEMS[key] = (await prisma.actionItem.create({ data: { meetingId, projectId: w.projects.PA, description: `ZZITEM ${key}`, assigneeId, createdById: w.people.ana, status } })).id;
  };
  await item('m1-ana', M.m1, w.people.ana);
  await item('m1-bob', M.m1, w.people.bob);
  await item('m1-done', M.m1, w.people.ana, 'COMPLETED');
  await item('m2-bob', M.m2, w.people.bob);
  await item('m3-own', M.m3, w.people.ana);
  const made = await h.post(w.as.ana, '/meeting-series', { name: 'Monthly site review', meetingId: M.m1 });
  expect(made.status, made.body).toBe(201);
  seriesId = made.data.id;
  expect((await h.post(w.as.ana, `/meeting-series/${seriesId}/meetings`, { meetingIds: [M.m2, M.m3] })).status).toBe(204);
});

afterAll(async () => {
  await h?.close();
  if (w) {
    await prisma.meetingSeries.deleteMany({ where: { projectId: { in: Object.values(w.projects) } } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

const ids = (list: Array<{ id: string }>) => list.map((m) => m.id);

describe('Meeting series and who sees what (integration)', () => {
  it('the team sees every meeting, "3 of 3", Previous, and the open items of the earlier meetings', async () => {
    for (const who of [w.as.ana, w.as.cat, w.as.admin]) {
      const ctx = await h.get(who, `/meetings/${M.m3}/series`);
      expect(ctx.status).toBe(200);
      expect(ctx.data).toMatchObject({ series: { id: seriesId, name: 'Monthly site review' }, position: 3, total: 3, previous: { id: M.m2 }, next: null });
      expect(ids(ctx.data.meetings)).toEqual([M.m1, M.m2, M.m3]);
      expect(sorted(ids(ctx.data.openFromEarlier))).toEqual(sorted([ITEMS['m1-ana']!, ITEMS['m1-bob']!, ITEMS['m2-bob']!]));
    }
  });

  it('bob, invited to two of them from another company, sees those two and only his own items from them', async () => {
    const ctx = await h.get(w.as.bob, `/meetings/${M.m3}/series`);
    expect(ctx.status).toBe(200);
    expect(ids(ctx.data.meetings)).toEqual([M.m2, M.m3]);
    expect(ctx.data).toMatchObject({ position: 2, total: 2, previous: { id: M.m2 }, canManage: false, canRemove: false });
    // His item from the first meeting stays out: he can't open that meeting.
    expect(ids(ctx.data.openFromEarlier)).toEqual([ITEMS['m2-bob']]);
    expect(ctx.body).not.toContain('first meeting');
    expect(ctx.body).not.toContain(M.m1);
  });

  it('amy, on the first meeting only, sees just the series name — no count, no links, no other titles', async () => {
    const ctx = await h.get(w.as.amy, `/meetings/${M.m1}/series`);
    expect(ctx.status).toBe(200);
    expect(ids(ctx.data.meetings)).toEqual([M.m1]);
    expect(ctx.data).toMatchObject({ position: null, previous: null, next: null, openFromEarlier: [] });
    expect(ctx.body).not.toMatch(/second meeting|third meeting/);
  });

  it('someone who can’t open the meeting, or any meeting of the series, gets 404 — not even its name', async () => {
    for (const who of [w.as.ben, w.as.gus]) {
      expect((await h.get(who, `/meetings/${M.m1}/series`)).status).toBe(404);
      const page = await h.get(who, `/meeting-series/${seriesId}`);
      expect(page.status).toBe(404);
      expect(page.body).not.toContain('Monthly site review');
    }
  });

  it('the Series page lists exactly the meetings each person may open (the meeting rule, same answers)', async () => {
    for (const [name, who] of Object.entries(w.as)) {
      const opens: string[] = [];
      for (const id of [M.m1, M.m2, M.m3]) if ((await h.get(who, `/meetings/${id}`)).status === 200) opens.push(id);
      const page = await h.get(who, `/meeting-series/${seriesId}`);
      if (opens.length === 0) expect(page.status, name).toBe(404);
      else expect(sorted(ids(page.data.meetings)), name).toEqual(sorted(opens));
    }
  });

  it('the meetings list names the series on each card', async () => {
    const list = await h.get(w.as.ana, `/meetings?projectId=${w.projects.PA}`);
    const mine = (list.data as Array<{ id: string; seriesName: string | null }>).filter((m) => Object.values(M).includes(m.id));
    expect(mine.every((m) => m.seriesName === 'Monthly site review')).toBe(true);
  });

  it('the minutes PDF names the series and lists the open items from earlier meetings — bob’s own copy only his', async () => {
    const pdf = async (who: typeof w.as.ana) => {
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/meetings/${M.m3}/minutes.pdf`, headers: { authorization: `Bearer ${h.tokenFor(who)}` } });
      return { status: res.statusCode, text: res.statusCode === 200 ? inspectPdf(res.rawPayload).pages.flat().join('\n') : '' };
    };
    const team = await pdf(w.as.ana);
    expect(team.status).toBe(200);
    expect(team.text).toContain('Monthly site review');
    expect(team.text).toContain('Open from earlier meetings');
    expect(team.text).toContain('ZZITEM m1-ana');
    expect(team.text).toContain('ZZITEM m2-bob');
    expect(team.text).not.toContain('ZZITEM m1-done');
    // bob gets his copy once the minutes are final: only his own item, and only from a meeting he may open.
    const FINAL = { summary: 'Agreed', discussion: [], decisions: [], risks: [], nextSteps: [] };
    expect((await h.post(w.as.ana, `/meetings/${M.m3}/final-minutes/approve`, { content: FINAL })).status).toBe(200);
    const own = await pdf(w.as.bob);
    expect(own.status).toBe(200);
    expect(own.text).toContain('ZZITEM m2-bob');
    expect(own.text).not.toContain('ZZITEM m1-bob');
    expect(own.text).not.toContain('ZZITEM m1-ana');
  });

  it('"New meeting in this series" pre-fills from the latest meeting with the people the picker offers', async () => {
    const pre = await h.get(w.as.ana, `/meeting-series/${seriesId}/prefill`);
    expect(pre.status).toBe(200);
    expect(pre.data).toMatchObject({ title: 'Monthly site review', projectId: w.projects.PA, location: 'Site office', durationMinutes: 60 });
    // bob (Beta) isn't someone ana may invite to an Alpha project's meeting: left out.
    expect(pre.data.people.map((p: { id?: string }) => p.id)).not.toContain(w.people.bob);
    const joined = await h.post(w.as.ana, '/meetings', { title: 'ZZSER fourth meeting', startAt: day(27), projectId: w.projects.PA, seriesId });
    expect(joined.status, joined.body).toBe(201);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: joined.data.id } })).seriesId).toBe(seriesId);
  });

  it('a repeating meeting gets a series of its own with all its repeats; moving one away takes it out', async () => {
    const res = await h.post(w.as.ana, '/meetings', {
      title: 'ZZSER weekly', startAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), projectId: w.projects.PA,
      recurrenceRule: { freq: 'WEEKLY', interval: 1, count: 3 },
    });
    expect(res.status, res.body).toBe(201);
    const family = await prisma.meeting.findMany({ where: { OR: [{ id: res.data.id }, { recurrenceParentId: res.data.id }], deletedAt: null } });
    expect(family).toHaveLength(3);
    const own = family[0]!.seriesId;
    expect(own).toBeTruthy();
    expect(family.every((m) => m.seriesId === own)).toBe(true);
    expect(await prisma.meetingSeries.findUniqueOrThrow({ where: { id: own! } })).toMatchObject({ name: 'ZZSER weekly', auto: true, projectId: w.projects.PA });

    // A one-off of the named series moved to another project (ana is on PAB's team) leaves it.
    expect((await h.put(w.as.ana, `/meetings/${M.m2}`, { projectId: w.projects.PAB })).status).toBe(200);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: M.m2 } })).seriesId).toBeNull();
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: M.m1 } })).seriesId).toBe(seriesId);
  });

  it('the store: a family, the picker’s meetings in no series, and deleting a series leaves its meetings', async () => {
    const store = createPrismaNamedSeriesStore(prisma);
    const loose = await prisma.meeting.create({ data: { title: 'ZZSER loose', startAt: new Date(day(28)), projectId: w.projects.PA, organizerId: w.people.ana, createdById: w.people.ana } });
    const free = await store.unseriedOfPlace({ projectId: w.projects.PA, companyId: null }, 50);
    expect(ids(free)).toContain(loose.id);
    expect(ids(free)).not.toContain(M.m1);
    const temp = await store.create({ name: 'ZZSER temp', projectId: w.projects.PA, companyId: null, auto: false, createdById: w.people.ana });
    await store.link([loose.id], temp.id);
    expect(ids(await store.meetingsOf(temp.id))).toEqual([loose.id]);
    await store.remove(temp.id);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: loose.id } })).seriesId).toBeNull(); // ON DELETE SET NULL
    expect(await store.find(temp.id)).toBeNull();
  });
});
