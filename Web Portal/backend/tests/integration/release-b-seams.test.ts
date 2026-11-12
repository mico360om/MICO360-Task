import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  blocksForWorkload,
  calendarTaskFacts,
  createCalendarPlannedHours,
  createPrismaCalendarStore,
  createPrismaReminderSweepStore,
} from '../../src/modules/calendar/prisma-calendar-store';
import { createNotifyPolicyService } from '../../src/modules/notify-policy/policy-service';
import { createPrismaPolicyStore } from '../../src/modules/notify-policy/policy-store';
import { leadDaysOf, loadPlannerFacts } from '../../src/modules/notify-policy/planner-sweep';
import { projectRunnerIds } from '../../src/modules/projects/prisma-member-repository';
import { createPrismaApprovalSource } from '../../src/modules/tasks/prisma-approval-source';
import { createPrismaChecklistQueries } from '../../src/modules/tasks/prisma-checklist-queries';
import { createPrismaKpiSource } from '../../src/modules/kpis/prisma-kpi-source';
import { createPrismaBinStore } from '../../src/modules/recycle-bin/prisma-bin-store';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { boardDateFromKey } from '../../src/modules/tasks/board-date';

// Release B (1.23.22) on a real database (TEST_DATABASE_URL, migrations applied): the seams between the four
// features (Notification & Scheduling, Calendar scheduling, KPIs, Learning Hub) and the releases before them
// (task archive, Recycle Bin, tasks for the future) — each read the integration changed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TAG = 'rbseam';
const COMPANY = 'company_rbseam';
const TZ = 'Asia/Muscat';
// Tuesday 17 Nov 2026, 10:00 in Muscat.
const NOW = new Date('2026-11-17T06:00:00Z');
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const at = (iso: string) => new Date(iso);
const ids = {} as Record<string, string>;

async function cleanup() {
  await prisma.reminderLog.deleteMany({ where: { dedupeKey: { contains: TAG } } });
  await prisma.task.deleteMany({ where: { project: { code: { in: ['RBS', 'RBX'] } } } });
  await prisma.kanbanColumn.deleteMany({ where: { project: { code: { in: ['RBS', 'RBX'] } } } });
  await prisma.project.deleteMany({ where: { code: { in: ['RBS', 'RBX'] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.company.deleteMany({ where: { id: COMPANY } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  await prisma.company.create({ data: { id: COMPANY, name: 'Release B seams Co', code: 'RBS' } });
  const role = async (name: string) => (await prisma.role.upsert({ where: { name }, update: {}, create: { name } })).id;
  const user = async (name: string, roleName: string) => {
    const u = await prisma.user.create({ data: { email: `${name}@${TAG}.test`, username: `${name}-${TAG}`, passwordHash: 'x', firstName: name, lastName: 'Test', primaryCompanyId: COMPANY } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: await role(roleName) } });
    await prisma.companyMember.create({ data: { companyId: COMPANY, userId: u.id } });
    return u.id;
  };
  ids.ann = await user('ann', 'EMPLOYEE');
  ids.pm = await user('pm', 'PROJECT_MANAGER');
  const project = async (code: string) => {
    const p = await prisma.project.create({ data: { code, name: `${TAG} ${code}`, createdById: ids.pm!, ownerId: ids.pm!, managerId: ids.pm!, mainCompanyId: COMPANY } });
    await prisma.projectCompany.create({ data: { projectId: p.id, companyId: COMPANY } });
    await prisma.projectMember.createMany({ data: [{ projectId: p.id, userId: ids.ann! }, { projectId: p.id, userId: ids.pm!, role: 'MANAGER' }] });
    return p.id;
  };
  ids.project = await project('RBS');
  ids.other = await project('RBX');
  const col = async (projectId: string, name: string, category: 'TODO' | 'BLOCKED' | 'DONE', position: number) => (await prisma.kanbanColumn.create({ data: { projectId, name, category, position } })).id;
  ids.todo = await col(ids.project, 'To do', 'TODO', 0);
  ids.blocked = await col(ids.project, 'Blocked', 'BLOCKED', 1);
  ids.done = await col(ids.project, 'Done', 'DONE', 2);
  ids.otherTodo = await col(ids.other, 'To do', 'TODO', 0);
  const task = async (key: string, columnId: string, extra: Record<string, unknown> = {}, projectId = ids.project!) => {
    const t = await prisma.task.create({ data: { key, title: `${TAG} ${key}`, projectId, columnId, createdById: ids.pm!, createdAt: at('2026-11-01T06:00:00Z'), startDate: day('2026-11-01'), ...extra } });
    await prisma.taskAssignee.create({ data: { taskId: t.id, userId: ids.ann!, assignedAt: at('2026-11-01T06:00:00Z') } });
    return t.id;
  };
  // Due Thursday 12 Nov: late on Tuesday 17th.
  ids.live = await task('RBS-1', ids.todo, { dueDate: day('2026-11-12') });
  // The same, archived (an archived open task leaves every list, sweep and figure).
  ids.archived = await task('RBS-2', ids.todo, { dueDate: day('2026-11-12'), archivedAt: at('2026-11-16T06:00:00Z'), archivedById: ids.pm });
  // Waiting for its start day (tasks for the future, 1.23.17): on 25 Nov's board, due 12 Nov — late on paper, not yet work.
  ids.waiting = await task('RBS-3', ids.todo, { dueDate: day('2026-11-12'), startDate: day('2026-11-25'), boardDate: boardDateFromKey('2026-11-25') });
  // Archived after it was finished: still counted as done.
  ids.archivedDone = await task('RBS-4', ids.done, { dueDate: day('2026-11-10'), completedAt: at('2026-11-09T06:00:00Z'), archivedAt: at('2026-11-16T06:00:00Z'), archivedById: ids.pm });
  // Blocked: one live, one archived.
  ids.blockedLive = await task('RBS-5', ids.blocked, { dueDate: day('2026-12-31') });
  ids.blockedArchived = await task('RBS-6', ids.blocked, { dueDate: day('2026-12-31'), archivedAt: at('2026-11-16T06:00:00Z'), archivedById: ids.pm });
  // Done on 16 Nov (planned time before that is history; after it is hidden).
  ids.doneTask = await task('RBS-7', ids.done, { dueDate: day('2026-11-20'), completedAt: at('2026-11-16T10:00:00Z') });
  ids.otherTask = await task('RBX-1', ids.otherTodo, { dueDate: day('2026-11-30') }, ids.other);
  // RBS-1 waits on the live Blocked RBS-5; RBS-5 waits only on the archived RBS-2 (out of the way).
  await prisma.taskDependency.createMany({ data: [{ taskId: ids.live, dependsOnTaskId: ids.blockedLive }, { taskId: ids.blockedLive, dependsOnTaskId: ids.archived }] });
});

describe('Release B seams — the task archive', () => {
  it('the Calendar: an archived task’s planned time and reminders leave the calendar, Workload, free times and the sweep; its facts say archived', async () => {
    const block = (taskId: string, start: string, end: string) => prisma.taskWorkBlock.create({ data: { taskId, userId: ids.ann!, plannedById: ids.ann!, startAt: at(start), endAt: at(end) } });
    await block(ids.live!, '2026-11-18T05:00:00Z', '2026-11-18T06:00:00Z');
    await block(ids.archived!, '2026-11-18T07:00:00Z', '2026-11-18T08:00:00Z');
    const remind = (taskId: string) => prisma.taskReminder.create({ data: { taskId, userId: ids.ann!, setById: ids.ann!, at: at('2026-11-18T05:00:00Z'), nextAt: at('2026-11-18T05:00:00Z') } });
    await remind(ids.live!);
    await remind(ids.archived!);
    const range = { from: at('2026-11-15T00:00:00Z'), to: at('2026-11-22T00:00:00Z') };
    const store = createPrismaCalendarStore(prisma);

    const onCalendar = await store.blocksBetween({ ...range, userId: ids.ann! });
    expect(onCalendar.map((b) => b.taskId)).toEqual([ids.live]);
    expect((await store.remindersForCalendar({ userId: ids.ann!, ...range })).map((r) => r.taskId)).toEqual([ids.live]);
    expect((await blocksForWorkload(prisma, { userIds: [ids.ann!], ...range, projectIds: null })).length).toBe(1);
    const sweep = createPrismaReminderSweepStore(prisma);
    expect((await sweep.dueBetween(range.from, range.to)).filter((r) => [ids.live, ids.archived].includes(r.taskId)).map((r) => r.taskId)).toEqual([ids.live]);
    // The task panel still opens an archived task (read-only): its facts carry archivedAt.
    const facts = await calendarTaskFacts(prisma, ids.archived!);
    expect(facts?.archivedAt).toBeInstanceOf(Date);
    expect((await calendarTaskFacts(prisma, ids.live!))?.archivedAt).toBeNull();
  });

  it('Notification & Scheduling: the planner leaves out archived tasks and tasks waiting for their start day', async () => {
    const policy = createNotifyPolicyService({
      store: createPrismaPolicyStore(prisma),
      companyHours: async () => ({ weekStart: 0, hours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } }),
      timeZone: TZ,
      now: () => NOW,
      cacheMs: 0,
    });
    const approvals = createPrismaApprovalSource(prisma, { canManageProject: async () => false });
    const checklist = createPrismaChecklistQueries(prisma);
    const facts = await loadPlannerFacts(
      {
        prisma,
        timeZone: TZ,
        rules: (c) => policy.rules(c),
        audience: async () => {
          const users = await prisma.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true, notificationPrefs: true, roles: { select: { role: { select: { name: true } } } }, companies: { select: { companyId: true } } } });
          return { users, activeIds: users.map((u) => u.id), adminIds: [], companiesOf: new Map(users.map((u) => [u.id, u.companies.map((c) => c.companyId)])) };
        },
        runners: (projectIds) => projectRunnerIds(prisma, projectIds),
        approvers: (projectId, except) => approvals.approvers(projectId, except),
        checklistItems: () => checklist.forReminders(),
        leadDays: leadDaysOf,
      },
      NOW,
    );
    const mine = facts.tasks.filter((t) => t.key.startsWith('RBS-')).map((t) => t.key).sort();
    expect(mine).toEqual(['RBS-1', 'RBS-5']);
    // Seam review M-3: a blocker that was archived is out of the way (as Release A's daily email reads it).
    expect(facts.tasks.find((t) => t.key === 'RBS-1')?.hasOpenBlocker).toBe(true);
    expect(facts.tasks.find((t) => t.key === 'RBS-5')?.hasOpenBlocker).toBe(false);
  });

  it('KPIs: an archived open task leaves the open counts and Open blocked; an archived Done task still counts (its archivedAt is read)', async () => {
    const source = createPrismaKpiSource(prisma, TZ);
    const window = await source.windowTasks([ids.project!], at('2026-11-01T00:00:00Z'), at('2026-12-01T00:00:00Z'));
    const byKey = new Map(window.map((t) => [t.key, t]));
    expect(byKey.get('RBS-4')?.archivedAt).toBeInstanceOf(Date);
    expect(byKey.get('RBS-2')?.archivedAt).toBeInstanceOf(Date);
    expect(byKey.get('RBS-1')?.archivedAt).toBeNull();
    expect((await source.blocked([ids.project!])).map((b) => b.key)).toEqual(['RBS-5']);
    // ann's open tasks: RBS-1, the waiting RBS-3, RBS-5 (and RBX-1 in the other project) — never the archived ones.
    expect((await source.openTaskCounts([ids.ann!], [ids.project!])).get(ids.ann!)).toBe(3);
  });
});

describe('Release B seams — KPIs’ planned hours from the Calendar', () => {
  it('sums a person’s planned time in the period (clipped), only on live tasks, a done task’s only before it was done, a manager’s view only their projects', async () => {
    const block = (taskId: string, start: string, end: string) => prisma.taskWorkBlock.create({ data: { taskId, userId: ids.ann!, plannedById: ids.pm!, startAt: at(start), endAt: at(end) } });
    await block(ids.live!, '2026-11-16T05:00:00Z', '2026-11-16T07:00:00Z'); // 2 h
    await block(ids.waiting!, '2026-11-25T05:00:00Z', '2026-11-25T06:30:00Z'); // 1.5 h (planned work ahead counts)
    await block(ids.archived!, '2026-11-16T08:00:00Z', '2026-11-16T09:00:00Z'); // archived: not counted
    await block(ids.doneTask!, '2026-11-15T05:00:00Z', '2026-11-15T06:00:00Z'); // 1 h before it was done: counted
    await block(ids.doneTask!, '2026-11-19T05:00:00Z', '2026-11-19T06:00:00Z'); // after: hidden, not counted
    await block(ids.live!, '2026-11-30T23:00:00Z', '2026-12-01T01:00:00Z'); // 1 h inside November
    await block(ids.otherTask!, '2026-11-17T05:00:00Z', '2026-11-17T06:00:00Z'); // 1 h in the other project
    const planned = createCalendarPlannedHours(prisma, { now: () => NOW });
    const nov = [at('2026-11-01T00:00:00Z'), at('2026-12-01T00:00:00Z')] as const;
    expect(await planned.plannedHours(ids.ann!, null, ...nov)).toBe(6.5);
    expect(await planned.plannedHours(ids.ann!, [ids.project!], ...nov)).toBe(5.5);
    expect(await planned.plannedHours(ids.ann!, [], ...nov)).toBe(0);
    expect(await planned.plannedHours(ids.pm!, null, ...nov)).toBe(0);
    // Binned: gone from the figure; restored: back.
    await createPrismaTaskRepository(prisma).softDelete(ids.otherTask!, { at: NOW, by: ids.pm!, expiresAt: at('2027-01-16T20:00:00Z'), batchId: null });
    expect(await planned.plannedHours(ids.ann!, null, ...nov)).toBe(5.5);
    await createPrismaBinStore(prisma).restore(ids.otherTask!);
    expect(await planned.plannedHours(ids.ann!, null, ...nov)).toBe(6.5);
  });
});

describe('Release B seams — the Recycle Bin and “late stays counted”', () => {
  it('a late task binned through the bin’s own delete is read as removed (deletedAt, with who and until when); restored, it is a live task again', async () => {
    const source = createPrismaKpiSource(prisma, TZ);
    const nov = [at('2026-11-01T00:00:00Z'), at('2026-12-01T00:00:00Z')] as const;
    const removedKeys = async () => (await source.windowTasks([ids.project!], ...nov)).filter((t) => t.removedAt).map((t) => `${t.key}:${t.removedHow}`);
    expect(await removedKeys()).toEqual([]);
    await createPrismaTaskRepository(prisma).softDelete(ids.live!, { at: NOW, by: ids.pm!, expiresAt: at('2027-01-16T20:00:00Z'), batchId: null });
    const row = await prisma.task.findUnique({ where: { id: ids.live! }, select: { deletedAt: true, deletedById: true, binExpiresAt: true } });
    expect(row).toMatchObject({ deletedAt: NOW, deletedById: ids.pm });
    expect(await removedKeys()).toEqual(['RBS-1:binned']);
    await createPrismaBinStore(prisma).restore(ids.live!);
    expect(await removedKeys()).toEqual([]);
    expect((await source.windowTasks([ids.project!], ...nov)).some((t) => t.key === 'RBS-1' && !t.removedAt)).toBe(true);
  });
});
