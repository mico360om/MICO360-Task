import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { inspectPdf } from '../../src/lib/pdf-inspect';
import { createProjectHealthService, type CardHealth, type NextActionsAnswer, type ProjectHealthDetail, type ProjectHealthService } from '../../src/modules/project-health/health-service';
import { createPrismaHealthSource, healthProbe } from '../../src/modules/project-health/prisma-health-source';
import { createHealthExtrasLoader } from '../../src/modules/project-health/health-extras-loader';
import { createCompletionCounts } from '../../src/modules/project-health/completion-counts';
import type { Viewer } from '../../src/modules/companies/company-access';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23.5 Project overview & health on a real database: weighted completion (both modes, the project's
// defaults, merged and deleted tasks left out) everywhere it shows; every new health reason and level
// (progress against time, blocked hold-ups, milestones at risk and their linked work, workload and its
// exemption); each risk with its accountable person; Next actions' order and permissions; the Management
// page and its PDF by the same rule; and MariaDB-safe SQL.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const due = (days: number) => new Date(`${shiftDayKey(today, days)}T00:00:00.000Z`);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

let w: CompanyWorld;
let app: CompanyApp;
let health: ProjectHealthService;
let n = 0;
const cols: Record<string, Record<string, string>> = {};
const made: string[] = [];

type Cat = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
async function project(code: string, o: { members: string[]; managerId?: string | null; ownerId?: string | null; start?: Date; target?: Date; mode?: 'COUNT' | 'WEIGHT' } = { members: [] }) {
  const p = await prisma.project.create({
    data: {
      code: `${code}${w.tag.toUpperCase()}`,
      name: `Health ${code} ${w.tag}`,
      status: 'ACTIVE',
      createdById: w.people.admin,
      ownerId: o.ownerId ?? null,
      managerId: o.managerId ?? null,
      startDate: o.start ?? null,
      targetDate: o.target ?? null,
      completionMode: o.mode ?? 'COUNT',
      mainCompanyId: w.companies.A,
      companies: { create: { companyId: w.companies.A } },
      members: { create: o.members.map((userId) => ({ userId, role: 'MEMBER' as const })) },
    },
  });
  cols[p.id] = {};
  let position = 0;
  for (const category of ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const) cols[p.id]![category] = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: category, category, position: position++ } })).id;
  made.push(p.id);
  return p.id;
}

async function task(
  projectId: string,
  o: { assignees?: string[]; column?: Cat; due?: Date | null; start?: Date | null; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; weight?: number | null; done?: boolean; waiting?: boolean; deleted?: boolean; mergedInto?: string; milestone?: boolean; title?: string } = {},
) {
  n += 1;
  const t = await prisma.task.create({
    data: {
      key: `HL${w.tag.toUpperCase()}-${n}`,
      title: o.title ?? `Health task ${n}`,
      projectId,
      columnId: cols[projectId]![o.done ? 'DONE' : (o.column ?? 'TODO')]!,
      createdById: w.people.admin,
      priority: o.priority ?? 'NORMAL',
      weight: o.weight ?? null,
      dueDate: o.due ?? null,
      startDate: o.start ?? null,
      isMilestone: o.milestone ?? false,
      completedAt: o.done ? new Date() : null,
      approvalRequestedAt: o.waiting ? new Date() : null,
      needsApproval: o.waiting ?? false,
      deletedAt: o.deleted || o.mergedInto ? new Date() : null,
      mergedIntoId: o.mergedInto ?? null,
      assignees: { create: (o.assignees ?? []).map((userId) => ({ userId })) },
    },
  });
  return t.id;
}
const blocks = (taskId: string, dependsOnTaskId: string) => prisma.taskDependency.create({ data: { taskId, dependsOnTaskId } });
const movedAt = (taskId: string, projectId: string, at: Date) => prisma.activity.create({ data: { taskId, projectId, userId: w.people.admin, action: 'MOVED', meta: { from: 'To Do', to: 'Blocked' }, createdAt: at } });
const lastUpdate = (taskId: string, at: Date) => prisma.$executeRaw`UPDATE tasks SET updatedAt = ${at} WHERE id = ${taskId}`;

const cards = async (viewer: Viewer) => {
  health.changed();
  const list = (await app.get(viewer, '/projects/overview')) as { id: string; health?: CardHealth }[];
  return new Map(list.map((p) => [p.id, p.health]));
};
const detail = async (viewer: Viewer, id: string) => {
  health.changed(id);
  return (await app.get(viewer, `/projects/${id}/health`)) as ProjectHealthDetail;
};
const codes = (h: { reasons: { code: string }[] } | undefined) => (h?.reasons ?? []).map((r) => r.code);

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  const source = createPrismaHealthSource(prisma);
  app = await buildCompanyApp(prisma, (base) => {
    health = createProjectHealthService({
      health: (ids) => base.management!.service.healthFor(ids),
      people: (ids) => source.people(ids),
      doneColumns: (projectId) => prisma.kanbanColumn.findMany({ where: { projectId, category: 'DONE' }, select: { id: true, enabled: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      timeZone: TZ,
    });
    return { projectHealth: health };
  });
});

afterAll(async () => {
  await app?.close();
  // Its own projects first (their tasks, links, history), then the world — other DB tests count every person.
  if (made.length) {
    await prisma.activity.deleteMany({ where: { projectId: { in: made } } });
    await prisma.task.updateMany({ where: { projectId: { in: made } }, data: { mergedIntoId: null } });
    await prisma.task.deleteMany({ where: { projectId: { in: made } } });
    await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: made } } });
    await prisma.projectCompany.deleteMany({ where: { projectId: { in: made } } });
    await prisma.project.deleteMany({ where: { id: { in: made } } });
  }
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('weighted completion (owner answer 1)', () => {
  let H1 = '';
  beforeAll(async () => {
    H1 = await project('W', { members: [w.people.ana, w.people.cat] });
    const urgentDone = await task(H1, { priority: 'URGENT', done: true }); // default 4
    await task(H1, { weight: 10, done: true });
    await task(H1, { priority: 'LOW' }); // 1
    await task(H1, { priority: 'HIGH' }); // 3
    await task(H1, { priority: 'URGENT', done: true, deleted: true });
    await task(H1, { priority: 'HIGH', weight: 9, done: true, mergedInto: urgentDone });
  });

  it('counted by number until the project switches; the weight is worked out beside it (merged and deleted left out)', async () => {
    expect((await cards(w.as.ana)).get(H1)!.completion).toEqual({ mode: 'COUNT', pct: 50, countPct: 50, weightPct: 78 });
    expect(await createCompletionCounts(prisma)(H1)).toEqual({ total: 4, done: 2 });
  });

  it('by weight once the project counts so — the cards, the project page, the Management page, Reports, the client pages', async () => {
    const res = await app.put(w.as.admin, `/projects/${H1}`, { completionMode: 'WEIGHT' });
    expect(res.statusCode).toBe(200);
    expect((await cards(w.as.ana)).get(H1)!.completion).toEqual({ mode: 'WEIGHT', pct: 78, countPct: 50, weightPct: 78 });
    expect((await detail(w.as.ana, H1)).completion).toMatchObject({ mode: 'WEIGHT', pct: 78, countPct: 50, total: 4, done: 2, weightTotal: 18, weightDone: 14 });
    const mgmt = (await app.get(w.as.admin, `/management/overview?projectIds=${H1}`)) as { projects: { id: string; completionPct: number; completionBy: string }[] };
    expect(mgmt.projects[0]).toMatchObject({ id: H1, completionPct: 78, completionBy: 'WEIGHT' });
    const reports = (await app.get(w.as.admin, '/reports/projects')) as { projectId: string; completionPct: number; completionBy: string }[];
    expect(reports.find((r) => r.projectId === H1)).toMatchObject({ completionPct: 78, completionBy: 'WEIGHT' });
    expect(await createCompletionCounts(prisma)(H1)).toEqual({ total: 18, done: 14 });
  });

  it('the project’s own defaults by priority count for tasks without a weight of their own', async () => {
    await app.put(w.as.admin, `/projects/${H1}`, { weightUrgent: 1 });
    // Done: 1 (urgent, default now 1) + 10; in all: 1 + 10 + 1 + 3.
    expect((await cards(w.as.ana)).get(H1)!.completion).toMatchObject({ mode: 'WEIGHT', pct: 73 });
  });
});

describe('the health rule’s new reasons and levels', () => {
  it('blocked over 7 days: a Blocked column since its move (else its last update), a real hold-up on a late blocker — never a planned sequence or a blocker elsewhere; red from five', async () => {
    const { ana, cat } = w.people;
    const P = await project('B', { members: [ana, cat] });
    const OTHER = await project('BX', { members: [ana] });
    const s1 = await task(P, { column: 'BLOCKED', assignees: [ana] });
    await movedAt(s1, P, ago(9));
    const s2 = await task(P, { column: 'BLOCKED', assignees: [cat] });
    await movedAt(s2, P, ago(3));
    const s3 = await task(P, { column: 'BLOCKED', assignees: [cat] });
    await lastUpdate(s3, ago(10));
    const b1 = await task(P, { due: due(-12), assignees: [cat] });
    const d1 = await task(P, { assignees: [ana] });
    await blocks(d1, b1);
    const b2 = await task(P, { due: due(5) });
    const d2 = await task(P, { due: due(10) });
    await blocks(d2, b2);
    const x1 = await task(OTHER, { due: due(-20) });
    const d3 = await task(P, {});
    await blocks(d3, x1);

    const h = (await cards(w.as.ana)).get(P)!;
    expect(h.reasons.find((r) => r.code === 'BLOCKED')).toEqual({ code: 'BLOCKED', level: 'AMBER', text: '3 tasks blocked for over 7 days' });
    const risk = (await detail(w.as.ana, P)).risks.find((r) => r.code === 'BLOCKED')!;
    expect(risk.tasks.map((t) => t.id)).toEqual([d1, s3, s1]);
    expect(risk.accountable.map((p) => p.id).sort()).toEqual([ana, cat].sort());

    for (const days of [15, 20]) {
      const s = await task(P, { column: 'BLOCKED', assignees: [ana] });
      await movedAt(s, P, ago(days));
    }
    const red = (await cards(w.as.ana)).get(P)!;
    expect(red.rag).toBe('RED');
    expect(red.reasons[0]).toEqual({ code: 'MANY_BLOCKED', level: 'RED', text: '5 tasks blocked for over 7 days' });
  });

  it('milestones: late is red; at risk (its blockers, else the work due before it) is amber — each with its accountable person', async () => {
    const { ana, cat, amy } = w.people;
    const P = await project('M', { members: [ana, cat, amy], managerId: amy });
    const m1 = await task(P, { milestone: true, title: 'Frame up', due: due(3), assignees: [cat] });
    const k1 = await task(P, {});
    const k2 = await task(P, { done: true });
    const k3 = await task(P, {});
    for (const k of [k1, k2, k3]) await blocks(m1, k);
    const m2 = await task(P, { milestone: true, title: 'Roof on', due: due(6) });
    await task(P, { due: due(-2), done: true });
    await task(P, { due: due(1) });
    await task(P, { due: due(6) });
    const m3 = await task(P, { milestone: true, title: 'Foundations', due: due(-2), assignees: [ana] });
    const m4 = await task(P, { milestone: true, title: 'Handover', due: due(4) });
    await blocks(m4, await task(P, { done: true }));

    const h = (await cards(w.as.ana)).get(P)!;
    expect(h.rag).toBe('RED');
    expect(h.reasons.map((r) => [r.code, r.level])).toEqual(expect.arrayContaining([['MILESTONE_LATE', 'RED'], ['MILESTONE_AT_RISK', 'AMBER']]));
    expect(h.reasons.find((r) => r.code === 'MILESTONE_AT_RISK')!.text).toBe('2 milestones are at risk');
    const d = await detail(w.as.ana, P);
    const byTask = (id: string) => d.risks.find((r) => r.tasks.some((t) => t.id === id) && r.code.startsWith('MILESTONE'));
    expect(byTask(m3)).toMatchObject({ code: 'MILESTONE_LATE', level: 'RED', title: 'Milestone “Foundations” is 2 days late', accountable: [{ id: ana }] });
    expect(byTask(m1)).toMatchObject({ code: 'MILESTONE_AT_RISK', detail: 'Due in 3 days with 2 of 3 linked tasks still open.', accountable: [{ id: cat }] });
    // No one on it: the project manager (its named manager) is accountable.
    expect(byTask(m2)).toMatchObject({ code: 'MILESTONE_AT_RISK', accountable: [{ id: amy }] });
    expect(byTask(m4)).toBeUndefined();
    // Accountable owners: the owner (none here), the manager, each open milestone's owners.
    expect(d.owners.managers.map((p) => p.id)).toEqual([amy]);
    expect(d.owners.milestones.map((m) => [m.title, m.owners.map((o) => o.id)])).toEqual([
      ['Foundations', [ana]],
      ['Frame up', [cat]],
      ['Handover', []],
      ['Roof on', []],
    ]);
  });

  it('workload: one person with 8+ open tasks and 40%+ of them is amber, the project manager accountable; two people or fewer are exempt', async () => {
    const { ana, cat, amy } = w.people;
    const P = await project('L', { members: [ana, cat, amy], managerId: amy });
    for (let i = 0; i < 8; i++) await task(P, { assignees: [ana] });
    await task(P, { assignees: [cat] });
    await task(P, { assignees: [cat, amy] });
    await task(P, { assignees: [amy] });
    await task(P, { assignees: [ana], waiting: true }); // handed in: not work in hand
    await task(P, {});
    const h = (await cards(w.as.ana)).get(P)!;
    expect(h.reasons).toEqual([{ code: 'WORKLOAD', level: 'AMBER', text: `Ana Alpha ${w.tag} holds 8 of 12 open tasks (67%)` }]);
    expect((await detail(w.as.ana, P)).risks.find((r) => r.code === 'WORKLOAD')).toMatchObject({ accountable: [{ id: amy }] });

    const TWO = await project('L2', { members: [ana, cat] });
    for (let i = 0; i < 10; i++) await task(TWO, { assignees: [ana] });
    await task(TWO, { assignees: [cat] });
    expect(codes((await cards(w.as.ana)).get(TWO))).not.toContain('WORKLOAD');
  });

  it('progress against time: 40+ points behind is red, 20+ amber, in the project’s own completion', async () => {
    const { ana } = w.people;
    // 30 days gone of 40 planned: 75% of the time used.
    const P = await project('T', { members: [ana], start: due(-30), target: due(10) });
    await task(P, { done: true, weight: 10 });
    for (let i = 0; i < 3; i++) await task(P, { priority: 'LOW' });
    expect((await cards(w.as.ana)).get(P)!.reasons).toEqual([{ code: 'FAR_BEHIND', level: 'RED', text: '25% done, 75% of the time used' }]);
    await app.put(w.as.admin, `/projects/${P}`, { completionMode: 'WEIGHT' });
    // 10 of 13 points: 77% done.
    expect((await cards(w.as.ana)).get(P)!.rag).toBe('GREEN');
  });

  it('unassigned work due within 7 days, the overdue cluster and a quiet project are risks with their people', async () => {
    const { ana, cat } = w.people;
    const P = await project('R', { members: [ana, cat], ownerId: cat });
    for (const [days, who] of [[-9, ana], [-8, cat], [-7, null]] as const) await task(P, { due: due(days), assignees: who ? [who] : [] });
    await task(P, { due: due(2) });
    const d = await detail(w.as.ana, P);
    expect(d.risks.find((r) => r.code === 'OVERDUE')).toMatchObject({ level: 'RED', title: '3 tasks overdue by 7 days or more' });
    expect(d.risks.find((r) => r.code === 'OVERDUE')!.accountable.map((p) => p.id).sort()).toEqual([ana, cat].sort());
    // No manager and no MANAGER member: the owner runs it.
    expect(d.risks.find((r) => r.code === 'UNASSIGNED')).toMatchObject({ title: '2 tasks due within 7 days have no one assigned', accountable: [{ id: cat }] });

    const Q = await project('Q', { members: [ana], ownerId: ana });
    const quiet = await task(Q, { due: due(30) });
    await lastUpdate(quiet, ago(12));
    await prisma.$executeRaw`UPDATE projects SET updatedAt = ${ago(12)} WHERE id = ${Q}`;
    expect((await detail(w.as.ana, Q)).risks).toEqual([expect.objectContaining({ code: 'NO_ACTIVITY', title: 'No activity for 12 days', accountable: [expect.objectContaining({ id: ana })] })]);
  });
});

describe('Next actions: order and permissions', () => {
  let P = '';
  const T: Record<string, string> = {};
  beforeAll(async () => {
    const { ana, cat, amy } = w.people;
    P = await project('N', { members: [ana, cat, amy], managerId: amy });
    T.n1 = await task(P, { due: due(-3), assignees: [ana] });
    T.n2 = await task(P, { due: due(0), assignees: [cat] });
    T.n3 = await task(P, { due: due(4), assignees: [ana] });
    T.n4 = await task(P, { due: due(20), assignees: [ana] });
    T.n5 = await task(P, { due: due(30) });
    T.n6 = await task(P, { column: 'BLOCKED', assignees: [ana] });
    T.n7 = await task(P, { due: due(10), assignees: [cat] });
    await blocks(T.n7, T.n3);
    T.n8 = await task(P, { assignees: [cat] });
    await blocks(T.n8, T.n1);
    T.wait = await task(P, { due: due(-5), assignees: [ana], waiting: true });
  });

  it('overdue · blocks others · due today · no one assigned · blocked · due soon — never far-off work, planned sequences or work handed in', async () => {
    const a = (await app.get(w.as.ana, `/projects/${P}/next-actions?fresh=1`)) as NextActionsAnswer;
    expect(a.items.map((i) => [i.task!.id, i.reason.code])).toEqual([
      [T.n1, 'overdue'],
      [T.n3, 'blocking'],
      [T.n2, 'due-today'],
      [T.n5, 'unassigned'],
      [T.n6, 'blocked-status'],
      [T.n8, 'blocked-by'],
    ]);
    expect(a.items.find((i) => i.task!.id === T.n1)!.also).toEqual([{ code: 'blocking', count: 1 }]);
    // The 1.23.4 quick actions: a task waiting on an open blocker offers Open and Reschedule only.
    expect(a.items.find((i) => i.task!.id === T.n1)!.task!.can).toEqual({ complete: true, reschedule: true, assign: true, approve: false });
    expect(a.items.find((i) => i.task!.id === T.n8)!.task!.can).toEqual({ complete: false, reschedule: true, assign: false, approve: false });
  });

  it('only people who may see the project (404 otherwise); nothing may be done once it is archived', async () => {
    expect((await app.getRaw(w.as.bob, `/projects/${P}/next-actions`)).statusCode).toBe(404);
    expect((await app.getRaw(w.as.bob, `/projects/${P}/health`)).statusCode).toBe(404);
    expect((await app.getRaw(w.as.admin, `/projects/${P}/next-actions`)).statusCode).toBe(200);
    expect((await app.post(w.as.admin, `/projects/${P}/archive`)).statusCode).toBe(200);
    const a = (await app.get(w.as.ana, `/projects/${P}/next-actions?fresh=1`)) as NextActionsAnswer;
    expect(a.items.length).toBeGreaterThan(0);
    for (const i of a.items) expect(i.task!.can).toEqual({ complete: false, reschedule: false, assign: false, approve: false });
  });

  it('Recent activity: the project’s latest entries, to its people only', async () => {
    await prisma.activity.create({ data: { taskId: T.n1, projectId: P, userId: w.people.ana, action: 'CREATED' } });
    const rows = (await app.get(w.as.ana, `/projects/${P}/activity`)) as { projectId: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows.every((r) => r.projectId === P)).toBe(true);
    expect((await app.getRaw(w.as.bob, `/projects/${P}/activity`)).statusCode).toBe(404);
  });
});

describe('the Management page and its PDF use the same rule', () => {
  it('the new reasons and completion by weight on the page and in the PDF', async () => {
    const { ana, cat } = w.people;
    const P = await project('G', { members: [ana, cat], mode: 'WEIGHT' });
    const s = await task(P, { column: 'BLOCKED', assignees: [ana], weight: 3 });
    await movedAt(s, P, ago(10));
    await task(P, { done: true, weight: 1 });
    const page = (await app.get(w.as.admin, `/management/overview?projectIds=${P}`)) as { projects: { id: string; rag: string; reasons: { code: string }[]; completionPct: number; completionBy: string }[] };
    expect(page.projects[0]).toMatchObject({ rag: 'AMBER', completionPct: 25, completionBy: 'WEIGHT' });
    expect(codes(page.projects[0])).toEqual(['BLOCKED']);
    // The card says the same.
    expect((await cards(w.as.ana)).get(P)).toMatchObject({ rag: 'AMBER', reasons: [{ code: 'BLOCKED' }] });
    const pdf = await app.getRaw(w.as.admin, `/management/overview.pdf?projectIds=${P}`);
    expect(pdf.statusCode).toBe(200);
    const text = inspectPdf(pdf.rawPayload).pages.flat().join(' ');
    expect(text).toContain('25% by weight');
    expect(text).toContain('1 task blocked for over 7 days');
  });
});

describe('MariaDB-safe SQL', () => {
  it('every statement the health extras send is portable, and the start-up check sends each once', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    try {
      const extras = await createHealthExtrasLoader(createPrismaHealthSource(client), TZ)(made);
      expect(extras.size).toBe(made.length);
      await healthProbe(client, '~database-check~');
      await createCompletionCounts(client)(made[0]!);
      expect(sent.some((q) => /SUM\(COALESCE\(t\.weight/.test(q))).toBe(true);
      expect(sent.some((q) => /JOIN task_assignees a/.test(q))).toBe(true);
      expect(sent.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`))).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });
});
