import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { createKpisFromPrisma } from '../../src/modules/kpis/kpi-wiring';
import { kpiProbe } from '../../src/modules/kpis/prisma-kpi-source';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createProjectAuthz } from '../../src/modules/projects/project-authz';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import type { Viewer } from '../../src/modules/companies/company-access';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Project KPIs and User KPIs on a real database: the definitions over real task history (the agreed due
// date when the assignee moved it, a hand-in for approval, binned and merged tasks left out, Blocked), who
// may see whose KPIs (self / the project's manager — that project only / an administrator; a colleague
// and a client refused), targets and a project's own KPIs, the snapshots, the monthly reminder's projects,
// and MariaDB-safe SQL.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const ALL_DAYS = { calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, hours: { start: '08:00', end: '17:00' } };
/** A moment `days` from today at a Muscat wall-clock time. */
const at = (days: number, hhmm = '10:00') => new Date(`${shiftDayKey(today, days)}T${hhmm}:00+04:00`);
const dueOn = (days: number) => new Date(`${shiftDayKey(today, days)}T00:00:00.000Z`);
const range = `period=custom&from=${shiftDayKey(today, -20)}&to=${today}`;

let w: CompanyWorld;
let app: CompanyApp;
let P: string;
let other: string;
let client: Viewer;
const cols: Record<string, string> = {};
let n = 0;

function wiring(now?: () => Date, notify: (n: unknown) => Promise<unknown> = async () => {}) {
  const projects = createPrismaProjectRepository(prisma);
  const managers = createPrismaProjectManagerLookup(prisma);
  return createKpisFromPrisma(prisma, {
    timeZone: TZ,
    projectAccess: createProjectAccess({ projects, managers }),
    projectAuthz: createProjectAuthz({ managers }),
    rules: async () => ALL_DAYS,
    weekStart: async () => 0,
    notify,
    ...(now ? { now } : {}),
  });
}

async function task(o: { assignee?: string; due?: number | null; done?: number | null; created?: number; column?: string; deleted?: boolean; merged?: string; waiting?: number; title?: string }) {
  n += 1;
  const created = at(o.created ?? -20, '08:00');
  const t = await prisma.task.create({
    data: {
      key: `KP${w.tag.toUpperCase()}-${n}`,
      title: o.title ?? `KPI task ${n}`,
      projectId: P,
      columnId: cols[o.column ?? (o.done !== undefined && o.done !== null ? 'DONE' : o.waiting !== undefined ? 'REVIEW' : 'TODO')]!,
      createdById: w.people.admin,
      dueDate: o.due === null || o.due === undefined ? null : dueOn(o.due),
      completedAt: o.done === null || o.done === undefined ? null : at(o.done, '11:00'),
      approvalRequestedAt: o.waiting !== undefined ? at(o.waiting) : null,
      createdAt: created,
      deletedAt: o.deleted || o.merged ? at(-1) : null,
      mergedIntoId: o.merged ?? null,
      ...(o.assignee ? { assignees: { create: { userId: o.assignee, assignedAt: created } } } : {}),
    },
  });
  return t.id;
}

let t1: string;
let t2: string;
let t3: string;
beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  app = await buildCompanyApp(prisma, () => ({ kpis: { service: wiring().service, userName: async () => 'Admin World' } }));
  const p = await prisma.project.create({
    data: {
      code: `KP${w.tag.toUpperCase()}`,
      name: `KPI project ${w.tag}`,
      status: 'ACTIVE',
      createdById: w.people.admin,
      mainCompanyId: w.companies.A,
      companies: { create: { companyId: w.companies.A } },
      members: { create: [{ userId: w.people.ana, role: 'MEMBER' }, { userId: w.people.cat, role: 'MEMBER' }, { userId: w.people.amy, role: 'MANAGER' }] },
    },
  });
  P = p.id;
  let position = 0;
  for (const category of ['TODO', 'BLOCKED', 'REVIEW', 'DONE'] as const) cols[category] = (await prisma.kanbanColumn.create({ data: { projectId: P, name: category, category, position: position++ } })).id;
  other = w.projects.PB;

  // Late against the agreed day: due -10; Ana (the assignee) moved it to -3 herself; finished -5 → 5 days late.
  t1 = await task({ assignee: w.people.ana, due: -3, done: -5 });
  await prisma.activity.create({ data: { taskId: t1, projectId: P, userId: w.people.ana, action: 'UPDATED', meta: { changes: [{ field: 'dueDate', from: shiftDayKey(today, -10), to: shiftDayKey(today, -3) }] }, createdAt: at(-12) } });
  // On time: due tomorrow, finished today (well, this morning).
  t2 = await task({ assignee: w.people.ana, due: 1, done: 0, title: 'KPI on time' });
  // Handed in for approval on -5 (due -4), approved by Amy on -4: on time, 9 working hours to decide.
  t3 = await task({ assignee: w.people.ana, due: -4, done: -4 });
  await prisma.activity.createMany({
    data: [
      { taskId: t3, projectId: P, userId: w.people.ana, action: 'APPROVAL_REQUESTED', meta: {}, createdAt: at(-5, '10:00') },
      { taskId: t3, projectId: P, userId: w.people.amy, action: 'APPROVED', meta: {}, createdAt: at(-4, '10:00') },
    ],
  });
  // Open and overdue (Cat's); a binned done task and a merged one never count; one in a Blocked column.
  await task({ assignee: w.people.cat, due: -2 });
  await task({ assignee: w.people.ana, due: -3, done: -4, deleted: true });
  await task({ assignee: w.people.ana, due: -9, done: -2, merged: t2 });
  await task({ assignee: w.people.ana, column: 'BLOCKED' });
  // Amy asks Ana something on t2; Ana answers two hours later.
  await prisma.comment.create({ data: { taskId: t2, userId: w.people.amy, body: 'Where are we with this?', createdAt: at(-2, '09:00') } });
  await prisma.comment.create({ data: { taskId: t2, userId: w.people.ana, body: 'Nearly done.', createdAt: at(-2, '11:00') } });

  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  const c = await prisma.user.create({ data: { email: `client.${w.tag}@world.test`, username: `client_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } });
  client = { id: c.id, roles: ['CLIENT'] };
});

afterAll(async () => {
  await prisma.kpiSnapshot.deleteMany({ where: { projectId: { in: [P, ...Object.values(w.projects)] } } });
  await prisma.kpiTarget.deleteMany({ where: { scopeKey: { in: [`project:${P}`, `company:${w.companies.A}`] } } });
  await prisma.projectKpi.deleteMany({ where: { projectId: P } });
  await prisma.activity.deleteMany({ where: { projectId: P } });
  await prisma.comment.deleteMany({ where: { task: { projectId: P } } });
  await prisma.task.deleteMany({ where: { projectId: P } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: P } });
  await prisma.project.deleteMany({ where: { id: P } });
  await prisma.user.deleteMany({ where: { id: client.id } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

type Tiles = { tiles: { metric: string; value: number | null; light: string }[] };
const fig = (k: Tiles, m: string) => k.tiles.find((t) => t.metric === m)!.value;

describe('a project’s KPIs over real task history', () => {
  it('on time against the agreed due day; days late; hand-in counts; binned and merged left out; Blocked; approval turnaround', async () => {
    const k = (await app.get(w.as.ana, `/kpis/projects/${P}?${range}`)) as Tiles;
    expect(fig(k, 'onTime')).toBe(67); // 2 of 3
    expect(fig(k, 'daysLate')).toBe(5); // the assignee's own move doesn't count
    expect(fig(k, 'overdue')).toBe(100); // Cat's: the only open task with a due day (the Blocked one has none)
    expect(fig(k, 'blocked')).toBe(1);
    expect(fig(k, 'approvalTurnaround')).toBe(9);
  });

  it('the list behind a number names the tasks it counted', async () => {
    const list = (await app.get(w.as.ana, `/kpis/projects/${P}/items?metric=onTime&${range}`)) as { total: number; rows: { id: string; days: number }[] };
    expect(list.total).toBe(3);
    expect(list.rows[0]).toMatchObject({ id: t1, days: 5 });
  });

  it('someone who can’t see the project gets a 404; a client account is refused', async () => {
    expect((await app.getRaw(w.as.gus, `/kpis/projects/${P}`)).statusCode).toBe(404);
    expect((await app.getRaw(w.as.ben, `/kpis/projects/${P}`)).statusCode).toBe(404);
    expect((await app.getRaw(client, `/kpis/projects/${P}`)).statusCode).toBe(403);
    expect((await app.getRaw(client, '/kpis/people/me')).statusCode).toBe(403);
  });

  it('PDF and Excel', async () => {
    const pdf = await app.getRaw(w.as.amy, `/kpis/projects/${P}/export.pdf?${range}`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const xlsx = await app.getRaw(w.as.amy, `/kpis/projects/${P}/export.xlsx?${range}`);
    expect(xlsx.statusCode).toBe(200);
  });
});

describe('a person’s KPIs (owner 2)', () => {
  it('themselves: their own tasks; on time, responsiveness', async () => {
    const k = (await app.get(w.as.ana, `/kpis/people/me?${range}`)) as Tiles & { scope: string };
    expect(k.scope).toBe('self');
    expect(fig(k, 'completed')).toBe(3);
    expect(fig(k, 'onTime')).toBe(67);
    expect(fig(k, 'responsiveness')).toBe(2);
  });

  it('the project’s manager sees a member’s, counting only the projects they run', async () => {
    const k = (await app.get(w.as.amy, `/kpis/people/${w.people.ana}?${range}`)) as Tiles & { scope: string; projects: { id: string }[] };
    expect(k.scope).toBe('manager');
    expect(k.projects.map((p) => p.id)).toEqual([P]);
    expect(fig(k, 'completed')).toBe(3);
  });

  it('an administrator sees anyone’s; a colleague and a manager of another project are refused', async () => {
    expect(((await app.get(w.as.admin, `/kpis/people/${w.people.ana}?${range}`)) as { scope: string }).scope).toBe('admin');
    expect((await app.getRaw(w.as.cat, `/kpis/people/${w.people.ana}`)).statusCode).toBe(403);
    expect((await app.getRaw(w.as.ben, `/kpis/people/${w.people.ana}`)).statusCode).toBe(403);
    expect((await app.getRaw(w.as.admin, `/kpis/people/${client.id}`)).statusCode).toBe(404);
  });

  it('the approver’s turnaround counts for the approver', async () => {
    const k = (await app.get(w.as.amy, `/kpis/people/me?${range}`)) as Tiles;
    expect(fig(k, 'approvalTurnaround')).toBe(9);
  });
});

describe('targets and a project’s own KPIs', () => {
  it('the company default, then the project’s own (whoever runs it), never a team member', async () => {
    expect((await app.put(w.as.admin, '/kpis/targets', { companyId: w.companies.A, targets: [{ metric: 'onTime', target: 60 }] })).statusCode).toBe(200);
    expect(((await app.get(w.as.ana, `/kpis/projects/${P}?${range}`)) as Tiles).tiles.find((t) => t.metric === 'onTime')!.light).toBe('green');
    expect((await app.put(w.as.ana, `/kpis/projects/${P}/targets`, { targets: [{ metric: 'onTime', target: 99 }] })).statusCode).toBe(403);
    expect((await app.put(w.as.amy, `/kpis/projects/${P}/targets`, { targets: [{ metric: 'onTime', target: 99 }] })).statusCode).toBe(200);
    expect(((await app.get(w.as.ana, `/kpis/projects/${P}?${range}`)) as Tiles).tiles.find((t) => t.metric === 'onTime')!.light).toBe('red');
    expect((await app.put(w.as.amy, '/kpis/targets', { companyId: w.companies.A, targets: [] })).statusCode).toBe(403);
  });

  it('whoever runs it adds a KPI and enters a month; the reminder finds what is missing', async () => {
    const add = await app.post(w.as.amy, `/kpis/projects/${P}/custom`, { name: 'Safety incidents', unit: 'incidents', direction: 'LOWER', target: 0 });
    expect(add.statusCode).toBe(201);
    const id = (add.json() as { data: { id: string }[] }).data[0]!.id;
    const month = today.slice(0, 7);
    expect((await app.put(w.as.amy, `/kpis/projects/${P}/custom/${id}/values/${month}`, { value: 1, note: 'A slip' })).statusCode).toBe(200);
    expect((await app.put(w.as.cat, `/kpis/projects/${P}/custom/${id}/values/${month}`, { value: 0 })).statusCode).toBe(403);
    // The first working morning of next month (every day is a working day here): last month's value is missing → Amy is reminded once.
    const next = new Date(`${today.slice(0, 7)}-28T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    const sent: { userId: string; type: string; entityId: string | null }[] = [];
    const k = wiring(() => new Date(`${next.toISOString().slice(0, 7)}-01T09:00:00+04:00`), async (x) => void sent.push(x as never));
    await prisma.projectKpiValue.deleteMany({ where: { kpiId: id } });
    expect(await k.reminder.run()).toBeGreaterThanOrEqual(1);
    expect(sent.filter((s) => s.entityId === P)).toEqual([expect.objectContaining({ userId: w.people.amy, type: 'KPI_VALUES_DUE' })]);
    expect(await k.reminder.run()).toBe(0);
    await prisma.reminderLog.deleteMany({ where: { dedupeKey: { startsWith: `np:kpi-values:${P}:` } } });
  });
});

describe('snapshots on the database', () => {
  it('the rebuild writes this project’s slices (its own row and its people) and a second run is the same', async () => {
    const k = wiring();
    await k.job.rebuild();
    const rows = await prisma.kpiSnapshot.findMany({ where: { projectId: P } });
    expect(rows.some((r) => r.userId === '')).toBe(true);
    expect(rows.every((r) => r.rebuilt)).toBe(true);
    const before = rows.length;
    await k.job.rebuild();
    expect(await prisma.kpiSnapshot.count({ where: { projectId: P } })).toBe(before);
  });
});

describe('MariaDB-safe SQL', () => {
  it('every statement the KPIs send is portable, and the start-up check sends each once', async () => {
    const sent: string[] = [];
    const client2 = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    client2.$on('query', (e) => void sent.push(e.query));
    try {
      await kpiProbe(client2, '~database-check~');
      const projects = createPrismaProjectRepository(client2);
      const managers = createPrismaProjectManagerLookup(client2);
      const k = createKpisFromPrisma(client2, { timeZone: TZ, projectAccess: createProjectAccess({ projects, managers }), projectAuthz: createProjectAuthz({ managers }), rules: async () => ALL_DAYS, weekStart: async () => 0, notify: async () => {} });
      await k.service.projectKpis(w.as.admin, P, { kind: 'month' });
      await k.service.personKpis(w.as.admin, w.people.ana, { kind: 'quarter' });
      await k.service.managementKpis(w.as.admin, { projectIds: [P, other], ownerId: null, statuses: ['ACTIVE'] }, null, { kind: 'month' });
      expect(sent.some((q) => /SUM\(COALESCE\(t\.weight/.test(q))).toBe(true);
      expect(sent.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`))).toEqual([]);
    } finally {
      await client2.$disconnect();
    }
  });
});

describe('review fixes on the database', () => {
  it('a merge’s moved-over lines are not the main task’s own history (I4)', async () => {
    // tB's history: a PM extension 30 days out. Merged into a new main task tA (due -6, finished -2): still late.
    const tA = await task({ assignee: w.people.ana, due: -6, done: -2, title: 'KPI merge main' });
    const tB = await task({ assignee: w.people.ana, due: 20, merged: tA, title: 'KPI merge merged' });
    const moved = await prisma.activity.create({ data: { taskId: tA, projectId: P, userId: w.people.amy, action: 'UPDATED', meta: { changes: [{ field: 'dueDate', from: shiftDayKey(today, -7), to: shiftDayKey(today, 25) }] }, createdAt: at(-15) } });
    const m = await prisma.taskMerge.create({
      data: { mainTaskId: tA, mainKeyBefore: 'A', mainKeyAfter: 'A', mainProjectBefore: P, mainProjectAfter: P, taskIds: [{ id: tB, key: 'B' }], changes: {}, summary: {}, mergedById: w.people.amy, mergedAt: at(-3), items: { create: [{ kind: 'activity', rowId: moved.id, fromTaskId: tB }] } },
    });
    try {
      const list = (await app.get(w.as.amy, `/kpis/projects/${P}/items?metric=onTime&${range}`)) as { rows: { id: string; days: number }[] };
      expect(list.rows.find((r) => r.id === tA)).toMatchObject({ days: 4 });
    } finally {
      await prisma.taskMerge.deleteMany({ where: { id: m.id } });
    }
  });

  it('someone taken off the project keeps their record there for administrators and its managers (I3); the lines say who released them', async () => {
    const t = await task({ assignee: w.people.cat, due: -1, title: 'KPI leaver' });
    await prisma.activity.create({ data: { taskId: t, projectId: P, userId: w.people.cat, action: 'MOVED', meta: {}, createdAt: at(-1) } });
    const members = (await import('../../src/modules/projects/prisma-member-repository')).createPrismaMemberRepository(prisma);
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: P, userId: w.people.cat } } });
    await members.removeTaskLinks!(P, w.people.cat, w.people.amy);
    const line = await prisma.activity.findFirst({ where: { taskId: t, action: 'UNASSIGNED' } });
    expect(line).toMatchObject({ userId: w.people.amy, meta: { assigneeId: w.people.cat, released: true } });
    const asAdmin = (await app.get(w.as.admin, `/kpis/people/${w.people.cat}?${range}`)) as { projects: { id: string }[] };
    expect(asAdmin.projects.map((p) => p.id)).toContain(P);
    const asManager = (await app.get(w.as.amy, `/kpis/people/${w.people.cat}?${range}`)) as { scope: string };
    expect(asManager.scope).toBe('manager');
  });
});
