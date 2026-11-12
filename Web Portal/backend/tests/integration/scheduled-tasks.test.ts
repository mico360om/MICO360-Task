import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { prioritiesFromBase } from './dashboard-helpers';
import { shiftDayKey, todayKey, zonedStartOfDay } from '../../src/lib/due-date';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { boardDateFromKey, DEFAULT_CARRY_STATUSES } from '../../src/modules/tasks/board-date';
import { createCarryForwardService, type CarryForwardRepo } from '../../src/modules/tasks/carry-forward-service';
import { createPrismaCarryForwardRepo } from '../../src/modules/tasks/prisma-task-repository';
import { createPrismaStartingTasksSource, createStartDayReminders, startingWindow } from '../../src/modules/tasks/start-day-reminders';
import { createPrismaReminderLogStore } from '../../src/modules/notifications/prisma-notification-repository';
import type { CreateNotificationData } from '../../src/modules/notifications/notification-repository';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';
import { writeStartingTasks } from '../../src/modules/projects/prisma-starting-content';
import type { PrioritiesAnswer } from '../../src/modules/dashboard/priorities-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Tasks scheduled for the future (owner, 10 Nov 2026) on a real database: every way a task is created
// (an app/extension payload with only a start date, a board day given, a template), the edit moves,
// today's board and the start day's, carry-forward, My Priorities, the daily email's source, and the
// start-day reminder job (once; not for deleted, merged, done, under-way or archived ones; moved start).
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const later = shiftDayKey(today, 10);
const anchorIso = (key: string) => `${key}T12:00:00.000Z`;

let w: CompanyWorld;
let app: CompanyApp;
const cols = { TODO: '', DOING: '', DONE: '' };

type Task = { id: string; key: string; boardDate: string | null; startDate: string | null; dueDate: string | null };
async function create(body: Record<string, unknown>, viewer = w.as.ana): Promise<Task> {
  const res = await app.post(viewer, '/tasks', { title: 'Scheduled', projectId: w.projects.PA, columnId: cols.TODO, assigneeIds: [w.people.ana], ...body });
  if (res.statusCode !== 201) throw new Error(`POST /tasks → ${res.statusCode}: ${res.body}`);
  return (res.json() as { data: Task }).data;
}
async function edit(id: string, body: Record<string, unknown>): Promise<Task> {
  const res = await app.put(w.as.ana, `/tasks/${id}`, body);
  if (res.statusCode !== 200) throw new Error(`PUT /tasks/${id} → ${res.statusCode}: ${res.body}`);
  return (res.json() as { data: Task }).data;
}
const boardOf = async (key: string) => ((await app.get(w.as.ana, `/tasks?projectId=${w.projects.PA}&boardDate=${key}`)) as Task[]).map((t) => t.id);

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  cols.TODO = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: w.projects.PA, category: 'TODO' } })).id;
  cols.DOING = (await prisma.kanbanColumn.create({ data: { projectId: w.projects.PA, name: 'Doing', category: 'IN_PROGRESS', position: 1 } })).id;
  cols.DONE = (await prisma.kanbanColumn.create({ data: { projectId: w.projects.PA, name: 'Done', category: 'DONE', position: 2 } })).id;
  app = await buildCompanyApp(prisma, (base) => ({ dashboardPriorities: prioritiesFromBase(prisma, base) }));
});

afterAll(async () => {
  await app?.close();
  if (w) await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('creating a task with a later start (every way in)', () => {
  it('an app/extension payload with only a start date waits on that day’s board — off today’s board', async () => {
    const t = await create({ title: 'From the app', startDate: later });
    expect(t.boardDate).toBe(new Date(anchorIso(later)).toISOString());
    expect(await boardOf(today)).not.toContain(t.id);
    expect(await boardOf(later)).toContain(t.id);
  });

  it('a board day given explicitly still wins', async () => {
    const board = shiftDayKey(today, 3);
    const t = await create({ title: 'From a later board', startDate: later, boardDate: board });
    expect(t.boardDate).toBe(new Date(anchorIso(board)).toISOString());
  });

  it('a start today (or none) stays on today’s board', async () => {
    expect((await create({ title: 'Starts today', startDate: today })).boardDate).toBe(new Date(anchorIso(today)).toISOString());
    expect((await create({ title: 'No start' })).boardDate).toBe(new Date(anchorIso(today)).toISOString());
  });

  it('a project made from a template that starts later: its tasks wait on their start day’s board', async () => {
    const project = await prisma.project.create({
      data: { code: `TPL${w.tag.toUpperCase()}`, name: `Template ${w.tag}`, status: 'ACTIVE', createdById: w.people.admin, mainCompanyId: w.companies.A, companies: { create: { companyId: w.companies.A } } },
    });
    // Cleaned up with the world's projects.
    (w.projects as Record<string, string>).TPL = project.id;
    const todo = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To Do', category: 'TODO', position: 0 } });
    const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
    await prisma.$transaction((tx) =>
      writeStartingTasks(tx, { id: project.id, code: project.code, ownerId: null, createdById: w.people.admin }, { id: todo.id, category: 'TODO' }, {
        columns: [],
        startColumn: 0,
        boardDate: boardDateFromKey(today),
        templateName: 'Site start',
        tasks: [
          { title: 'Kick-off', description: null, priority: 'NORMAL', startDate: day(later), dueDate: null, boardDate: boardDateFromKey(later), assigneeIds: [], checklists: [] },
          { title: 'Paperwork', description: null, priority: 'NORMAL', startDate: day(today), dueDate: null, assigneeIds: [], checklists: [] },
        ],
      }),
    );
    const rows = await prisma.task.findMany({ where: { projectId: project.id }, orderBy: { key: 'asc' }, select: { title: true, boardDate: true } });
    expect(rows.map((r) => [r.title, r.boardDate?.toISOString()])).toEqual([
      ['Kick-off', new Date(anchorIso(later)).toISOString()],
      ['Paperwork', new Date(anchorIso(today)).toISOString()],
    ]);
  });
});

describe('editing the start date', () => {
  it('a not-started task moves with its start; moved to today, it comes onto today’s board', async () => {
    const t = await create({ title: 'Edit me' });
    expect((await edit(t.id, { startDate: later })).boardDate).toBe(new Date(anchorIso(later)).toISOString());
    expect(await boardOf(today)).not.toContain(t.id);
    expect((await edit(t.id, { startDate: today })).boardDate).toBe(new Date(anchorIso(today)).toISOString());
    expect(await boardOf(today)).toContain(t.id);
  });

  it('a task under way stays on its board', async () => {
    const t = await create({ title: 'Under way', columnId: cols.DOING });
    expect((await edit(t.id, { startDate: later })).boardDate).toBe(new Date(anchorIso(today)).toISOString());
  });
});

describe('until its start day', () => {
  it('the nightly carry-forward never moves it (it is on a later day, not a past one)', async () => {
    const t = await create({ title: 'Carry me not', startDate: later });
    const past = await create({ title: 'Left yesterday' });
    await prisma.task.update({ where: { id: past.id }, data: { boardDate: boardDateFromKey(shiftDayKey(today, -1)) } });
    const real = createPrismaCarryForwardRepo(prisma);
    const repo: CarryForwardRepo = {
      listCarryCandidates: async (before) => (await real.listCarryCandidates(before)).filter((c) => c.id === t.id || c.id === past.id),
      applyCarry: (id, to, entry) => real.applyCarry(id, to, entry),
    };
    const sweep = createCarryForwardService({ repo, timeZone: TZ, config: async () => ({ enabled: true, statuses: DEFAULT_CARRY_STATUSES }) });
    expect(await sweep.run()).toEqual({ carried: 1 });
    const after = await prisma.task.findMany({ where: { id: { in: [t.id, past.id] } }, select: { id: true, boardDate: true } });
    expect(Object.fromEntries(after.map((r) => [r.id, r.boardDate?.toISOString()]))).toEqual({
      [t.id]: new Date(anchorIso(later)).toISOString(),
      [past.id]: new Date(anchorIso(today)).toISOString(),
    });
  });

  it('it isn’t one of My Priorities, however urgent; the same task on today’s board is', async () => {
    const waiting = await create({ title: 'Urgent later', priority: 'URGENT', startDate: later });
    const now = await create({ title: 'Urgent now', priority: 'URGENT' });
    const a = (await app.get(w.as.ana, '/dashboard/priorities?fresh=1')) as PrioritiesAnswer;
    const ids = a.items.map((r) => r.task?.id);
    expect(ids).toContain(now.id);
    expect(ids).not.toContain(waiting.id);
  });

  it('My Tasks still returns it (the apps place it), and the daily email’s source says its board day', async () => {
    const t = await create({ title: 'Email me later', startDate: later });
    expect(((await app.get(w.as.ana, '/tasks/mine')) as Task[]).map((x) => x.id)).toContain(t.id);
    const pending = await createPrismaDailyEmailSources(prisma).tasks.pending(w.people.ana);
    // The redesign reads the board day itself (a noon-UTC anchor: its UTC date is the day).
    expect(pending.find((x) => x.id === t.id)?.boardDate?.toISOString().slice(0, 10)).toBe(later);
    expect(pending.find((x) => x.title === 'No start')?.boardDate?.toISOString().slice(0, 10)).toBe(today);
  });
});

describe('the start-day reminder', () => {
  const morning = (key: string) => new Date(zonedStartOfDay(key, TZ).getTime() + 8 * 3600_000); // 08:00 company time
  const yesterday = new Date(zonedStartOfDay(shiftDayKey(today, -1), TZ).getTime() + 10 * 3600_000);
  async function scheduled(title: string, o: { start?: string; column?: string; createdAt?: Date; projectId?: string } = {}) {
    const start = o.start ?? today;
    const projectId = o.projectId ?? w.projects.PA;
    const columnId = o.column ?? (projectId === w.projects.PA ? cols.TODO : (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId, category: 'TODO' } })).id);
    return prisma.task.create({
      data: {
        key: `SD${w.tag.toUpperCase()}-${title.replace(/\W/g, '')}`,
        title,
        projectId,
        columnId,
        createdById: w.people.admin,
        startDate: new Date(`${start}T00:00:00.000Z`),
        boardDate: boardDateFromKey(start),
        createdAt: o.createdAt ?? yesterday,
        assignees: { create: [{ userId: projectId === w.projects.PC ? w.people.gus : w.people.ana }] },
      },
    });
  }

  it('the morning it starts, its people hear once — never for deleted, merged, done, under-way or archived ones; a moved start on its new day', async () => {
    const due = await scheduled('Starts today');
    const tomorrow = await scheduled('Starts tomorrow', { start: shiftDayKey(today, 1) });
    const madeToday = await scheduled('Made today', { createdAt: new Date() });
    const deleted = await scheduled('Deleted');
    await prisma.task.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const merged = await scheduled('Merged');
    await prisma.task.update({ where: { id: merged.id }, data: { deletedAt: new Date(), mergedIntoId: due.id, mergedAt: new Date() } });
    const done = await scheduled('Done', { column: cols.DONE });
    await prisma.task.update({ where: { id: done.id }, data: { completedAt: new Date() } });
    const underWay = await scheduled('Under way', { column: cols.DOING });
    const archived = await scheduled('Archived', { projectId: w.projects.PC });
    await prisma.project.update({ where: { id: w.projects.PC }, data: { status: 'ARCHIVED' } });
    const mine = new Set([due.id, tomorrow.id, madeToday.id, deleted.id, merged.id, done.id, underWay.id, archived.id]);

    const sent: CreateNotificationData[] = [];
    const store = createPrismaReminderLogStore(prisma);
    const real = createPrismaStartingTasksSource(prisma);
    let clock = morning(today);
    const job = createStartDayReminders({
      source: { startingToday: async (win) => (await real.startingToday(win)).filter((t) => mine.has(t.id)) },
      visibleRecipients: async (_taskId, ids) => ids,
      store,
      notify: async (n) => void sent.push(n),
      timeZone: TZ,
      now: () => clock,
    });
    try {
      expect(await job.run()).toEqual({ sent: 1 });
      expect(await job.run()).toEqual({ sent: 0 });
      expect(sent).toEqual([{ userId: w.people.ana, type: 'TASK_ASSIGNED', title: 'A task starts today', body: `${due.key} · Starts today`, entityType: 'task', entityId: due.id }]);
      // The next morning: the one that starts then (its start was "moved" to tomorrow), once.
      clock = morning(shiftDayKey(today, 1));
      expect(await job.run()).toEqual({ sent: 1 });
      expect(sent[1]).toMatchObject({ entityId: tomorrow.id, title: 'A task starts today' });
    } finally {
      await prisma.project.update({ where: { id: w.projects.PC }, data: { status: 'ACTIVE' } });
      await prisma.reminderLog.deleteMany({ where: { dedupeKey: { in: [`TASK_ASSIGNED:starts:${due.id}:${w.people.ana}:${today}`, `TASK_ASSIGNED:starts:${tomorrow.id}:${w.people.ana}:${shiftDayKey(today, 1)}`] } } });
    }
  });

  it('its query is portable to MariaDB', async () => {
    const statements: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void statements.push(e.query));
    try {
      await createPrismaStartingTasksSource(client).startingToday(startingWindow(TZ, new Date()));
      expect(statements.some((s) => /`tasks`/.test(s))).toBe(true);
      expect(statements.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`))).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });
});
