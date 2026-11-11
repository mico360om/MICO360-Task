import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaPolicyStore } from '../../src/modules/notify-policy/policy-store';
import { createNotifyPolicyService } from '../../src/modules/notify-policy/policy-service';
import { createPrismaHoldStore } from '../../src/modules/notify-policy/holds';
import { createPlannerSweep, createPrismaFirstRun, createPrismaReminderKeys, leadDaysOf, PLANNER_SINCE_KEY } from '../../src/modules/notify-policy/planner-sweep';
import { projectRunnerIds } from '../../src/modules/projects/prisma-member-repository';
import { createPrismaApprovalSource } from '../../src/modules/tasks/prisma-approval-source';
import { createPrismaChecklistQueries } from '../../src/modules/tasks/prisma-checklist-queries';
import { createPrismaPreferenceStore, pruneReminderLog } from '../../src/modules/notifications/prisma-notification-repository';
import { portabilityProblems } from '../../src/lib/sql-portability';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const url = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const queries: string[] = [];
const watched = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
watched.$on('query', (e) => void queries.push(e.query));

const TAG = 'ntit';
const COMPANY = 'company_ntit';
const OTHER = 'company_ntit2';
const TZ = 'Asia/Muscat';
// Tuesday 17 Nov 2026, 10:00 in Muscat.
const NOW = new Date('2026-11-17T06:00:00Z');
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const ids = {} as Record<string, string>;

async function cleanup() {
  await prisma.reminderLog.deleteMany({ where: { dedupeKey: { contains: TAG } } });
  await prisma.notification.deleteMany({ where: { user: { email: { endsWith: `@${TAG}.test` } } } });
  await prisma.notificationHold.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.task.deleteMany({ where: { project: { code: { in: ['NTIT', 'NTIT2'] } } } });
  await prisma.project.deleteMany({ where: { code: { in: ['NTIT', 'NTIT2'] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${TAG}.test` } } });
  await prisma.company.deleteMany({ where: { id: { in: [COMPANY, OTHER] } } });
  await prisma.systemSetting.deleteMany({ where: { key: PLANNER_SINCE_KEY } });
}

const service = () =>
  createNotifyPolicyService({
    store: createPrismaPolicyStore(watched),
    companyHours: async () => ({ weekStart: 0, hours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } }),
    timeZone: TZ,
    now: () => NOW,
    cacheMs: 0,
  });

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await watched.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  await prisma.company.create({ data: { id: COMPANY, name: 'NT Integration Co', code: 'NTIT' } });
  await prisma.company.create({ data: { id: OTHER, name: 'NT Other Co', code: 'NTIT2' } });
  const role = async (name: string) => (await prisma.role.upsert({ where: { name }, update: {}, create: { name } })).id;
  const user = async (name: string, roleName: string, extra: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({ data: { email: `${name}@${TAG}.test`, username: `${name}-${TAG}`, passwordHash: 'x', firstName: name, lastName: 'Test', primaryCompanyId: COMPANY, ...extra } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: await role(roleName) } });
    await prisma.companyMember.create({ data: { companyId: COMPANY, userId: u.id } });
    return u.id;
  };
  ids.ann = await user('ann', 'EMPLOYEE', { notificationPrefs: { muted: ['TASK_COMMENT'], reminderLeadMinutes: 2880 } });
  ids.pm = await user('pm', 'PROJECT_MANAGER');
  ids.admin = await user('admin', 'ADMIN');
  const p = await prisma.project.create({ data: { code: 'NTIT', name: `${TAG} project`, createdById: ids.pm, ownerId: ids.pm, managerId: ids.pm, mainCompanyId: COMPANY } });
  ids.project = p.id;
  await prisma.projectCompany.create({ data: { projectId: p.id, companyId: COMPANY } });
  await prisma.projectMember.createMany({ data: [{ projectId: p.id, userId: ids.ann }, { projectId: p.id, userId: ids.pm, role: 'MANAGER' }] });
  const col = async (name: string, category: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE', position: number) =>
    (await prisma.kanbanColumn.create({ data: { projectId: p.id, name, category, position } })).id;
  ids.todo = await col('To do', 'TODO', 0);
  ids.doing = await col('Doing', 'IN_PROGRESS', 1);
  ids.blocked = await col('Blocked', 'BLOCKED', 2);
  const task = async (key: string, columnId: string, extra: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { key, title: `${TAG} ${key}`, projectId: p.id, columnId, createdById: ids.pm!, createdAt: new Date('2026-11-01T06:00:00Z'), startDate: day('2026-11-01'), ...extra } });
    await prisma.taskAssignee.create({ data: { taskId: t.id, userId: ids.ann! } });
    return t.id;
  };
  // Due Thursday 12 Nov: 3 working days late on Tuesday 17th.
  ids.late = await task('NTIT-1', ids.todo, { dueDate: day('2026-11-12') });
  // Due Thursday 19 Nov: 2 working days ahead (Standard's first reminder).
  ids.soon = await task('NTIT-2', ids.todo, { dueDate: day('2026-11-19') });
  // In progress since 8 Nov with nothing since: 7 working days idle.
  ids.idle = await task('NTIT-3', ids.doing, { dueDate: day('2026-12-31') });
  await prisma.activity.create({ data: { taskId: ids.idle, projectId: p.id, userId: ids.ann, action: 'MOVED', meta: { from: 'To do', to: 'Doing' }, createdAt: new Date('2026-11-08T06:00:00Z') } });
  // Blocked since Monday.
  ids.stuck = await task('NTIT-4', ids.blocked, { dueDate: day('2026-12-31') });
  await prisma.activity.create({ data: { taskId: ids.stuck, projectId: p.id, userId: ids.ann, action: 'MOVED', meta: { from: 'Doing', to: 'Blocked' }, createdAt: new Date('2026-11-16T06:00:00Z') } });
});

function sweep(now: () => Date, sent: { userId: string; type: string; title: string }[]) {
  const policy = service();
  const approvals = createPrismaApprovalSource(watched, { canManageProject: async () => false });
  const checklist = createPrismaChecklistQueries(watched);
  return createPlannerSweep({
    prisma: watched,
    timeZone: TZ,
    rules: (c) => policy.rules(c),
    audience: async () => {
      const users = await watched.user.findMany({ where: { deletedAt: null, status: 'ACTIVE', email: { endsWith: `@${TAG}.test` } }, select: { id: true, notificationPrefs: true, roles: { select: { role: { select: { name: true } } } }, companies: { select: { companyId: true } } } });
      return {
        users,
        activeIds: users.map((u) => u.id),
        adminIds: users.filter((u) => u.roles.some((r) => r.role.name === 'ADMIN')).map((u) => u.id),
        companiesOf: new Map(users.map((u) => [u.id, u.companies.map((c) => c.companyId)])),
      };
    },
    runners: (projectIds) => projectRunnerIds(watched, projectIds),
    approvers: (projectId, except) => approvals.approvers(projectId, except),
    checklistItems: () => checklist.forReminders(),
    keys: createPrismaReminderKeys(watched),
    notify: async (n) => {
      if (n.title.includes(TAG) || n.body.includes(TAG) || n.body.includes('NTIT')) sent.push({ userId: n.userId, type: n.type, title: n.title });
      return null;
    },
    leadDays: leadDaysOf,
    firstRun: createPrismaFirstRun(watched),
    now,
  });
}

describe('Notification & Scheduling centre (integration)', () => {
  it('sets a company up once: starter holidays this year and next, Standard (default) + Critical', async () => {
    await service().ensureCompany(COMPANY);
    await service().ensureCompany(COMPANY);
    const holidays = await prisma.companyHoliday.findMany({ where: { companyId: COMPANY } });
    expect(holidays.length).toBeGreaterThan(20);
    expect(new Set(holidays.map((h) => `${h.day}|${h.name}`)).size).toBe(holidays.length);
    expect(holidays.find((h) => h.day === '2026-11-20')).toMatchObject({ name: 'National Day', source: 'STARTER', expected: false });
    const schedules = await service().schedules(COMPANY);
    expect(schedules.map((s) => [s.name, s.isDefault])).toEqual([
      ['Standard', true],
      ['Critical', false],
    ]);
    expect((await prisma.notificationPolicy.findUnique({ where: { companyId: COMPANY } }))?.holidaysSeededAt).toBeInstanceOf(Date);
    // Another company is set up apart.
    await service().ensureCompany(OTHER);
    expect(await prisma.reminderSchedule.count({ where: { companyId: OTHER } })).toBe(2);
  });

  it('a person’s settings from before carry over unchanged (muted types, lead time)', async () => {
    const prefs = await createPrismaPreferenceStore(prisma).get(ids.ann!);
    expect(prefs.muted).toEqual(['TASK_COMMENT']);
    expect(prefs.reminderLeadMinutes).toBe(2880);
    expect(leadDaysOf({ reminderLeadMinutes: 2880 })).toBe(2);
  });

  it('the first run after the upgrade records what is due without sending; later runs send each step once', async () => {
    const sent: { userId: string; type: string; title: string }[] = [];
    queries.length = 0;
    const first = await sweep(() => NOW, sent).run();
    expect(first.recordedOnly).toBe(true);
    expect(first.planned).toBeGreaterThan(0);
    expect(sent).toEqual([]);
    expect(await prisma.systemSetting.count({ where: { key: PLANNER_SINCE_KEY } })).toBe(1);
    // Every query the sweep sent reads alike on MySQL 8 and MariaDB.
    expect(queries.flatMap((q) => portabilityProblems(q))).toEqual([]);

    // The same moment again: nothing new.
    expect((await sweep(() => NOW, sent).run()).sent).toBe(0);
    expect(sent).toEqual([]);

    // Wednesday 18th: no new step anywhere (the late task stays at step 3, the idle one at step 1).
    await sweep(() => new Date('2026-11-18T06:00:00Z'), sent).run();
    expect(sent).toEqual([]);
    // Thursday 19th: the late task's next step (5 working days), and the soon one is due today.
    const thu = new Date('2026-11-19T06:00:00Z');
    await sweep(() => thu, sent).run();
    expect(sent.map((x) => `${x.type} ${x.title}`).sort()).toEqual(['TASK_DUE_SOON A task is due today', 'TASK_OVERDUE A task is 5 working days overdue']);
    expect(sent.every((x) => x.userId === ids.ann)).toBe(true);
    // Run again on the same day: nothing more.
    const before = sent.length;
    await sweep(() => thu, sent).run();
    expect(sent.length).toBe(before);
  });

  it('inactivity and Blocked read the activity log; escalations go to whoever runs the project', async () => {
    // Skip the upgrade's record-only run.
    await prisma.systemSetting.create({ data: { key: PLANNER_SINCE_KEY, value: NOW.toISOString() } });
    const sent: { userId: string; type: string; title: string }[] = [];
    await sweep(() => NOW, sent).run();
    const by = (type: string) => sent.filter((s) => s.type === type);
    expect(by('TASK_INACTIVE')).toEqual([expect.objectContaining({ userId: ids.ann, title: 'No activity on NTIT-3 for 7 working days' })]);
    expect(by('TASK_ESCALATION').map((s) => s.title).sort()).toEqual(['Escalation: NTIT-1 is 3 working days overdue', 'Escalation: NTIT-4 is Blocked']);
    expect(by('TASK_ESCALATION').every((s) => s.userId === ids.pm)).toBe(true);
    expect(by('TASK_OVERDUE')).toEqual([expect.objectContaining({ userId: ids.ann, title: 'A task is 3 working days overdue' })]);
    // Ann's own 2-day lead: one extra "due soon" for NTIT-2 (due Thu 19, today Tue 17).
    expect(by('TASK_DUE_SOON')).toEqual([expect.objectContaining({ userId: ids.ann })]);
    // Each recorded once in reminder_logs under np:.
    const keys = await prisma.reminderLog.findMany({ where: { dedupeKey: { startsWith: 'np:' } }, select: { dedupeKey: true } });
    expect(keys.filter((k) => k.dedupeKey.includes(ids.late!)).length).toBeGreaterThanOrEqual(2);
  });

  it('the planner’s keys outlive the 35-day clean-up of other reminder markers', async () => {
    const old = new Date(Date.now() - 60 * 86_400_000);
    await prisma.reminderLog.createMany({ data: [{ dedupeKey: `np:esc2:${TAG}`, createdAt: old }, { dedupeKey: `TASK_OVERDUE:${TAG}:x:2026-01-01`, createdAt: old }] });
    await pruneReminderLog(prisma);
    expect((await prisma.reminderLog.findMany({ where: { dedupeKey: { contains: TAG } } })).map((r) => r.dedupeKey)).toEqual([`np:esc2:${TAG}`]);
  });

  it('held notices: each is taken once; emails wait to be folded in, then are done', async () => {
    const holds = createPrismaHoldStore(watched);
    const base = { userId: ids.ann!, notificationId: null, type: 'TASK_OVERDUE', body: 'NTIT-1 · x', entityType: 'task', entityId: ids.late!, expiresAt: null };
    await holds.add({ ...base, channel: 'PUSH', title: `${TAG} push 1`, releaseAt: NOW });
    await holds.add({ ...base, channel: 'PUSH', title: `${TAG} push 2`, releaseAt: NOW });
    await holds.add({ ...base, channel: 'EMAIL', title: `${TAG} email`, releaseAt: NOW });
    await holds.add({ ...base, channel: 'PUSH', title: `${TAG} later`, releaseAt: new Date(NOW.getTime() + 3600_000) });
    queries.length = 0;
    expect(await holds.dueUsers(NOW, 10)).toContain(ids.ann);
    const [a, b] = await Promise.all([holds.claimDue(ids.ann!, 'PUSH', NOW), holds.claimDue(ids.ann!, 'PUSH', NOW)]);
    expect(a.length + b.length).toBe(2);
    expect(await holds.claimDue(ids.ann!, 'PUSH', NOW)).toEqual([]);
    const emails = await holds.openEmails(ids.ann!);
    expect(emails.map((e) => e.title)).toEqual([`${TAG} email`]);
    await holds.finish(emails.map((e) => e.id), 'FOLDED', NOW);
    expect(await holds.openEmails(ids.ann!)).toEqual([]);
    expect(queries.flatMap((q) => portabilityProblems(q))).toEqual([]);
  });
});
