import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inspectPdf } from '../../src/lib/pdf-inspect';
import { inspectXlsx } from '../../src/lib/xlsx-inspect';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// companies (Task 11): Timeline, Workload, Management and Reports — and their exports — count only
// the person's companies, and the picked one (X-Company-Id). ben owns PB.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let api: CompanyApp;

const DAY = 86_400_000;
const dayKey = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const timeline = () => `/timeline?from=${dayKey(-7)}&to=${dayKey(21)}`;
const workload = () => `/workload?week=${dayKey(0)}`;
type Row = { id?: string; projectId?: string };
const projectIdsOf = (rows: unknown) => sorted([...new Set((rows as Row[]).map((r) => r.projectId ?? r.id!))]);
const peopleOf = (data: unknown) => (data as { people: { id: string }[] }).people.map((p) => p.id);
const textOf = (raw: { rawPayload: Buffer; body: string }, kind: 'csv' | 'xlsx' | 'pdf') =>
  kind === 'pdf' ? inspectPdf(raw.rawPayload).pages.flat().join('\n') : kind === 'xlsx' ? inspectXlsx(raw.rawPayload).text.flat().join('\n') : raw.body;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  // Every world task is due in the coming days (the week the Workload page shows, the timeline's weeks).
  await prisma.task.updateMany({ where: { id: { in: Object.values(w.tasks) } }, data: { dueDate: new Date(`${dayKey(1)}T00:00:00.000Z`) } });
  // The projects have dates, so they have bars on the timeline.
  await prisma.project.updateMany({ where: { id: { in: Object.values(w.projects) } }, data: { startDate: new Date(`${dayKey(-3)}T00:00:00.000Z`), targetDate: new Date(`${dayKey(30)}T00:00:00.000Z`) } });
  api = await buildCompanyApp(prisma);
});

afterAll(async () => {
  await api?.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('figures follow companies and the pick (companies)', () => {
  it('admin with pick Alpha: Reports, Timeline and Workload count only Alpha’s projects', async () => {
    const { admin } = w.as;
    const { PA, PAB } = w.projects;
    const h = { 'x-company-id': w.companies.A };
    expect(projectIdsOf(await api.get(admin, '/reports/projects', h))).toEqual(sorted([PA, PAB]));
    expect(projectIdsOf(((await api.get(admin, timeline(), h)) as { projects: Row[] }).projects)).toEqual(sorted([PA, PAB]));
    const { ana, amy, cat, ben } = w.people;
    expect(peopleOf(await api.get(admin, workload(), h)).sort()).toEqual(sorted([ana, amy, cat, ben])); // members of A + ben (on PAB's team, a task in PAB)
    // The report's people: Alpha's members and whoever has a task in its projects.
    const people = (await api.get(admin, '/reports/workload', h)) as { userId: string }[];
    expect(people.map((p) => p.userId).sort()).toEqual(sorted([ana, amy, cat, ben]));
    expect(await api.get(admin, '/reports/status', h)).toEqual({ TODO: 3 }); // TA1, TA2, TAB1
  });

  it('a pick narrows; without one an administrator still sees every company', async () => {
    const { admin } = w.as;
    const all = projectIdsOf(await api.get(admin, '/reports/projects'));
    expect(all).toEqual(expect.arrayContaining([w.projects.PA, w.projects.PB, w.projects.PAB, w.projects.PC]));
    expect(projectIdsOf(await api.get(admin, '/reports/projects', { 'x-company-id': w.companies.B }))).toEqual(sorted([w.projects.PB, w.projects.PAB]));
    // A pick that isn't a company at all is refused, never widened.
    expect((await api.getRaw(admin, '/reports/projects', { 'x-company-id': 'nope' })).statusCode).toBe(403);
  });

  it('Management for ben: the project he runs, inside his companies', async () => {
    const { ben, admin, cat } = w.as;
    const projects = (data: unknown) => sorted((data as { projects: { id: string }[] }).projects.map((p) => p.id));
    expect(projects(await api.get(ben, '/management/overview'))).toEqual([w.projects.PB]);
    expect(projects(await api.get(admin, '/management/overview', { 'x-company-id': w.companies.A }))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    // cat runs PA and PB: with pick Alpha only PA; a project outside the pick is "not found".
    await prisma.projectMember.updateMany({ where: { userId: cat.id, projectId: { in: [w.projects.PA, w.projects.PB] } }, data: { role: 'MANAGER' } });
    try {
      expect(projects(await api.get(cat, '/management/overview'))).toEqual(sorted([w.projects.PA, w.projects.PB]));
      expect(projects(await api.get(cat, '/management/overview', { 'x-company-id': w.companies.A }))).toEqual([w.projects.PA]);
      expect((await api.getRaw(cat, `/management/overview?projectIds=${w.projects.PB}`, { 'x-company-id': w.companies.A })).statusCode).toBe(404);
      expect((await api.getRaw(cat, `/management/items?metric=late-tasks&projectId=${w.projects.PB}`, { 'x-company-id': w.companies.A })).statusCode).toBe(404);
      // Running projects only in Alpha, cat with pick Beta sees an empty page, not a refusal.
      await prisma.projectMember.updateMany({ where: { userId: cat.id, projectId: w.projects.PB }, data: { role: 'MEMBER' } });
      expect(projects(await api.get(cat, '/management/overview', { 'x-company-id': w.companies.B }))).toEqual([]);
      // …and someone who runs nothing at all is still refused.
      expect((await api.getRaw(w.as.ana, '/management/overview', { 'x-company-id': w.companies.A })).statusCode).toBe(403);
    } finally {
      await prisma.projectMember.updateMany({ where: { userId: cat.id, projectId: { in: [w.projects.PA, w.projects.PB] } }, data: { role: 'MEMBER' } });
    }
  });

  it('exports and PDFs hold only the scope', async () => {
    const { admin, ben } = w.as;
    const h = { 'x-company-id': w.companies.A };
    const foreign = new RegExp(`ZZBETA|ZZGAMMA|Project PB ${w.tag}|Project PC ${w.tag}|${w.projects.PB}|${w.projects.PC}`);
    for (const f of ['csv', 'xlsx', 'pdf'] as const) {
      const raw = await api.getRaw(admin, `/reports/projects.${f}`, h);
      expect(raw.statusCode, f).toBe(200);
      const text = textOf(raw, f);
      expect(text, f).toContain(`Project PA ${w.tag}`);
      expect(text, f).not.toMatch(foreign);
    }
    // The full report: its task list names every task in scope.
    for (const f of ['xlsx', 'pdf'] as const) {
      const text = textOf(await api.getRaw(admin, `/reports/export.${f}`, h), f);
      expect(text, f).toContain('ZZALPHA');
      expect(text, f).not.toMatch(/ZZBETA|ZZGAMMA/);
    }
    const mgmt = textOf(await api.getRaw(ben, '/management/overview.pdf'), 'pdf');
    expect(mgmt).toContain(`Project PB ${w.tag}`);
    expect(mgmt).not.toMatch(new RegExp(`ZZALPHA|ZZSHARED|Project PA ${w.tag}|Project PAB ${w.tag}`));
    const picked = textOf(await api.getRaw(admin, '/management/overview.pdf', h), 'pdf');
    expect(picked).not.toMatch(new RegExp(`Project PB ${w.tag}|Project PC ${w.tag}`));
  });

  it('ana’s Timeline and Workload stay inside her companies; with pick Alpha too', async () => {
    const { ana } = w.as;
    const { PA, PAB } = w.projects;
    expect(projectIdsOf(((await api.get(ana, timeline())) as { projects: Row[] }).projects)).toEqual(sorted([PA, PAB]));
    expect(JSON.stringify(await api.get(ana, workload()))).not.toMatch(/ZZBETA|ZZGAMMA|Betaonly|Gammaonly/);
    expect(projectIdsOf(((await api.get(w.as.cat, timeline(), { 'x-company-id': w.companies.B })) as { projects: Row[] }).projects)).toEqual([w.projects.PB]);
    // A timeline row opened from the page (one named project) answers by the project's own rule.
    expect((await api.getRaw(w.as.cat, `/timeline/projects/${PA}/tasks?from=${dayKey(-7)}&to=${dayKey(21)}`, { 'x-company-id': w.companies.B })).statusCode).toBe(200);
  });
});
