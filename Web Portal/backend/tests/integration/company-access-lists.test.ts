import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createNotificationService } from '../../src/modules/notifications/notification-service';
import { createPrismaNotificationRepository } from '../../src/modules/notifications/prisma-notification-repository';
import { createPrismaInspectionScheduleSource } from '../../src/modules/inspections/prisma-inspection-schedule-source';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// companies (Task 8): every list and count follows the person's companies and the picked one
// (X-Company-Id) — the real route handlers over the real Prisma sources (company-app.ts).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let api: CompanyApp;

const DAY = 86_400_000;
const dayKey = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const calendar = () => `/calendar?from=${dayKey(-2)}&to=${dayKey(10)}`;
type Row = { id: string; projectId?: string | null; key?: string };
const projectIdsOf = (rows: unknown) => sorted([...new Set((rows as Row[]).map((r) => r.projectId ?? r.id))]);
const idsOf = (rows: unknown) => sorted((rows as Row[]).map((r) => r.id));
const keysOf = (rows: unknown) => sorted((rows as Row[]).map((r) => r.key!));
type Summary = { conversation: { id: string; kind: string; projectId: string | null } };
const channelProjects = (rows: unknown) => sorted((rows as Summary[]).filter((s) => s.conversation.kind === 'PROJECT').map((s) => s.conversation.projectId!));
const dmCount = (rows: unknown) => (rows as Summary[]).filter((s) => s.conversation.kind === 'DIRECT').length;
const titlesOf = (rows: unknown) => sorted((rows as { title: string }[]).map((r) => r.title));

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  const { people, projects, tasks } = w;
  // cat runs PA and PB (MANAGER on both teams), so she can approve tasks in both.
  await prisma.projectMember.updateMany({ where: { userId: people.cat, projectId: { in: [projects.PA, projects.PB] } }, data: { role: 'MANAGER' } });
  // Every world task is due tomorrow (the calendar), and TA2 / TB2 wait for approval.
  await prisma.task.updateMany({ where: { id: { in: Object.values(tasks) } }, data: { dueDate: new Date(`${dayKey(1)}T00:00:00.000Z`) } });
  await prisma.task.updateMany({ where: { id: { in: [tasks.TA2, tasks.TB2] } }, data: { needsApproval: true, approvalRequestedAt: new Date(), approvalRequestedById: people.cat } });
  // A history line in each project.
  for (const [taskId, projectId, marker] of [
    [tasks.TA1, projects.PA, 'ZZALPHA'],
    [tasks.TB1, projects.PB, 'ZZBETA'],
    [tasks.TAB1, projects.PAB, 'ZZSHARED'],
    [tasks.TC1, projects.PC, 'ZZGAMMA'],
  ] as const) {
    await prisma.activity.create({ data: { taskId, projectId, userId: people.admin, action: 'UPDATED', meta: { title: `${marker} change` } } });
  }
  // Notices: cat's about TA2 (Alpha) and TB2 (Beta), and a digest that is about no project.
  await prisma.notification.createMany({
    data: [
      { userId: people.cat, type: 'TASK_COMMENT', title: 'cat ZZALPHA notice', entityType: 'task', entityId: tasks.TA2, projectId: projects.PA },
      { userId: people.cat, type: 'TASK_COMMENT', title: 'cat ZZBETA notice', entityType: 'task', entityId: tasks.TB2, projectId: projects.PB },
      { userId: people.cat, type: 'TASK_DIGEST', title: 'cat digest', entityType: 'digest', entityId: dayKey(0) },
      { userId: people.ana, type: 'TASK_ASSIGNED', title: 'ana ZZALPHA notice', entityType: 'task', entityId: tasks.TA1, projectId: projects.PA },
    ],
  });
  api = await buildCompanyApp(prisma);
});

afterAll(async () => {
  await api?.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('lists follow companies and the pick (companies)', () => {
  it('cat with pick Beta: every list holds only Beta’s items', async () => {
    const { cat, ben } = w.as;
    const { PB } = w.projects;
    const h = { 'x-company-id': w.companies.B };
    expect(projectIdsOf(await api.get(cat, '/projects', h))).toEqual([PB]);
    expect(projectIdsOf(await api.get(cat, '/projects/overview', h))).toEqual([PB]);
    expect(keysOf(await api.get(cat, '/tasks/mine', h))).toEqual([`TB2${w.tag.toUpperCase()}-1`]); // not TA2 (Alpha)
    expect(projectIdsOf(await api.get(cat, '/tasks', h))).toEqual([PB]);
    expect(projectIdsOf(((await api.get(cat, calendar(), h)) as { tasks: Row[] }).tasks)).toEqual([PB]);
    expect(idsOf(((await api.get(cat, '/tasks/approvals', h)) as { tasks: Row[] }).tasks)).toEqual([w.tasks.TB2]);
    expect(projectIdsOf(await api.get(cat, '/activity', h))).toEqual([PB]);
    expect(titlesOf(await api.get(cat, '/notifications', h))).toEqual(sorted(['cat ZZBETA notice', 'cat digest']));
    expect(await api.get(cat, '/notifications/unread-count', h)).toEqual({ count: 2 });
    expect(idsOf(await api.get(ben, '/meetings', { 'x-company-id': w.companies.B }))).toEqual(sorted([w.meetings.MB, w.meetings.MN_B]));
    const conversations = await api.get(cat, '/conversations', h);
    expect(channelProjects(conversations)).toEqual([PB]);
    expect(dmCount(conversations)).toBe(1); // cat–ana: direct chats are always kept
  });

  it('without a pick cat sees both her companies; with pick Alpha only Alpha', async () => {
    const { cat } = w.as;
    const { PA, PB } = w.projects;
    expect(projectIdsOf(await api.get(cat, '/projects'))).toEqual(sorted([PA, PB]));
    expect(idsOf(((await api.get(cat, '/tasks/approvals')) as { tasks: Row[] }).tasks)).toEqual(sorted([w.tasks.TA2, w.tasks.TB2]));
    expect(await api.get(cat, '/notifications/unread-count')).toEqual({ count: 3 });
    const a = { 'x-company-id': w.companies.A };
    expect(projectIdsOf(await api.get(cat, '/tasks', a))).toEqual([PA]);
    expect(projectIdsOf(await api.get(cat, '/activity', a))).toEqual([PA]);
    expect(channelProjects(await api.get(cat, '/conversations', a))).toEqual([PA]);
  });

  it('an administrator’s pick narrows to that company (PA and PAB for Alpha)', async () => {
    const { admin } = w.as;
    const { PA, PAB } = w.projects;
    const a = { 'x-company-id': w.companies.A };
    expect(projectIdsOf(await api.get(admin, '/projects', a))).toEqual(sorted([PA, PAB]));
    expect(projectIdsOf(await api.get(admin, '/tasks', a))).toEqual(sorted([PA, PAB]));
    expect(projectIdsOf(await api.get(admin, '/activity', a))).toEqual(sorted([PA, PAB]));
    // No-project meetings of Alpha, and Alpha's project meetings.
    expect(idsOf(await api.get(admin, '/meetings', a))).toEqual(sorted([w.meetings.MA, w.meetings.MN_A]));
  });

  it('ana’s lists never hold Beta or Gamma', async () => {
    const { ana } = w.as;
    for (const path of ['/projects', '/projects/overview', '/tasks', '/tasks/mine', calendar(), '/tasks/approvals', '/activity', '/notifications', '/me/action-items', '/conversations'])
      expect(JSON.stringify(await api.get(ana, path)), path).not.toMatch(/ZZBETA|ZZGAMMA|Betaonly|Gammaonly/);
    // Her meetings: MA lists bob ("Bob Betaonly"), whom she invited — an attendee's name shows on the
    // meeting as an author's does (§8.7); nothing of Beta's or Gamma's own.
    expect(JSON.stringify(await api.get(ana, '/meetings'))).not.toMatch(/ZZBETA|ZZGAMMA|Gammaonly/);
  });

  it('a pick that isn’t yours is refused; opening one item ignores the pick', async () => {
    const { ana, cat } = w.as;
    const res = await api.getRaw(ana, '/tasks', { 'x-company-id': w.companies.B });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('COMPANY_NOT_AVAILABLE');
    expect((await api.getRaw(w.as.gus, '/projects', { 'x-company-id': w.companies.C })).statusCode).toBe(403); // archived: no access
    const a = { 'x-company-id': w.companies.A };
    expect((await api.getRaw(cat, `/tasks/${w.tasks.TB1}`, a)).statusCode).toBe(200);
    expect((await api.getRaw(cat, `/projects/${w.projects.PB}`, a)).statusCode).toBe(200);
    // A board opened by its link: the project is named, so its own rule decides.
    expect(projectIdsOf(await api.get(cat, `/tasks?projectId=${w.projects.PB}`, a))).toEqual([w.projects.PB]);
    // …and so is a project's meetings tab.
    expect(idsOf(await api.get(cat, `/meetings?projectId=${w.projects.PB}`, a))).toEqual([w.meetings.MB]);
  });

  it('an invitee’s meeting shows under “All my companies” only; their own action items too', async () => {
    const { bob } = w.as;
    expect(idsOf(await api.get(bob, '/meetings'))).toEqual([w.meetings.MA]);
    expect(idsOf(await api.get(bob, '/meetings', { 'x-company-id': w.companies.B }))).toEqual([]);
    expect(idsOf(await api.get(bob, '/me/action-items'))).toEqual([w.actionItems.MA_bob]);
    expect(idsOf(await api.get(bob, '/me/action-items', { 'x-company-id': w.companies.B }))).toEqual([]);
    expect(idsOf(await api.get(w.as.ana, '/me/action-items', { 'x-company-id': w.companies.A }))).toEqual([w.actionItems.MA_ana]);
  });

  it('a colleague invited to a project meeting without being on its team keeps it under the pick', async () => {
    const { amy } = w.as;
    // amy (Alpha, not on PA's team) attends MA and has an item from it: Alpha's meeting, so it shows under Alpha.
    const attendee = await prisma.meetingAttendee.create({ data: { meetingId: w.meetings.MA, userId: amy.id, invitedAt: new Date() } });
    const item = await prisma.actionItem.create({ data: { meetingId: w.meetings.MA, projectId: w.projects.PA, description: 'ZZALPHA action for amy', assigneeId: amy.id, createdById: w.people.ana } });
    try {
      const a = { 'x-company-id': w.companies.A };
      expect(idsOf(await api.get(amy, '/meetings', a))).toEqual(sorted([w.meetings.MA, w.meetings.MN_A]));
      expect(idsOf(await api.get(amy, '/me/action-items', a))).toEqual([item.id]);
      expect(idsOf(await api.get(amy, '/meetings'))).toEqual(sorted([w.meetings.MA, w.meetings.MN_A]));
    } finally {
      await prisma.actionItem.delete({ where: { id: item.id } });
      await prisma.meetingAttendee.delete({ where: { id: attendee.id } });
    }
  });

  it('notifications: an old notice about TB1 is hidden from ana; the count agrees', async () => {
    const { ana } = w.as;
    await prisma.notification.create({ data: { userId: ana.id, type: 'TASK_COMMENT', title: 'ZZBETA', entityType: 'task', entityId: w.tasks.TB1, projectId: w.projects.PB } });
    expect(JSON.stringify(await api.get(ana, '/notifications'))).not.toContain('ZZBETA');
    const unreadVisible = await prisma.notification.count({ where: { userId: ana.id, readAt: null, OR: [{ projectId: null }, { projectId: { in: [w.projects.PA, w.projects.PAB] } }] } });
    expect(unreadVisible).toBe(1);
    expect(await api.get(ana, '/notifications/unread-count')).toEqual({ count: unreadVisible });
  });

  // A one-company site is unchanged: 1.20's bell shows a task's notices to its assignee even when they
  // aren't on the project's team (the demo and the owner's data have such assignees). Companies add one
  // condition only: the project must be in one of the person's active companies.
  it('notifications: an assignee off the team still sees the task’s notices inside their company — not outside it', async () => {
    const { amy, bob } = w.as;
    await prisma.notification.createMany({
      data: [
        { userId: amy.id, type: 'TASK_OVERDUE', title: 'amy ZZALPHA overdue', entityType: 'task', entityId: w.tasks.TA1, projectId: w.projects.PA },
        { userId: bob.id, type: 'TASK_OVERDUE', title: 'bob ZZALPHA overdue', entityType: 'task', entityId: w.tasks.TA1, projectId: w.projects.PA },
      ],
    });
    expect(titlesOf(await api.get(amy, '/notifications'))).toEqual(['amy ZZALPHA overdue']); // amy: Alpha, not on PA's team
    expect(await api.get(amy, '/notifications/unread-count')).toEqual({ count: 1 });
    expect(titlesOf(await api.get(amy, '/notifications', { 'x-company-id': w.companies.A }))).toEqual(['amy ZZALPHA overdue']);
    expect(titlesOf(await api.get(bob, '/notifications'))).toEqual([]); // bob: Beta only
    expect(await api.get(bob, '/notifications/unread-count')).toEqual({ count: 0 });
  });

  it('new notices carry their project', async () => {
    const notifications = createNotificationService({ notifications: createPrismaNotificationRepository(prisma) });
    await notifications.notify({ userId: w.people.ana, type: 'TASK_COMMENT', title: 'New comment on your task', entityType: 'task', entityId: w.tasks.TA1 });
    expect(await prisma.notification.findFirst({ where: { entityId: w.tasks.TA1, type: 'TASK_COMMENT' } })).toMatchObject({ projectId: w.projects.PA });
    await notifications.notify({ userId: w.people.ana, type: 'PROJECT_ADDED', title: 'You were added', entityType: 'project', entityId: w.projects.PAB });
    expect(await prisma.notification.findFirst({ where: { entityId: w.projects.PAB, type: 'PROJECT_ADDED' } })).toMatchObject({ projectId: w.projects.PAB });
    await notifications.notify({ userId: w.people.ana, type: 'CHAT_MENTION', title: 'Mentioned', entityType: 'conversation', entityId: w.chats.PA });
    expect(await prisma.notification.findFirst({ where: { entityId: w.chats.PA, type: 'CHAT_MENTION' } })).toMatchObject({ projectId: w.projects.PA });
    await notifications.notify({ userId: w.people.ana, type: 'CHAT_MESSAGE', title: 'From Amy', entityType: 'conversation', entityId: w.chats.anaAmy });
    expect(await prisma.notification.findFirst({ where: { entityId: w.chats.anaAmy, type: 'CHAT_MESSAGE' } })).toMatchObject({ projectId: null });
  });

  it('a form’s usage counts only the projects the person sees, in the pick', async () => {
    const source = createPrismaInspectionScheduleSource(prisma, { workingDays: async () => [0, 1, 2, 3, 4] });
    const form = await prisma.inspectionForm.create({ data: { title: `Usage ${w.tag}`, sections: [], createdById: w.people.admin } });
    try {
      await prisma.task.updateMany({ where: { id: { in: [w.tasks.TA1, w.tasks.TB1] } }, data: { inspectionFormId: form.id, recurrenceRule: { freq: 'WEEKLY', interval: 1 } } });
      expect(await source.formUsage(form.id, null)).toMatchObject({ schedules: 2 });
      expect(await source.formUsage(form.id, [w.projects.PA, w.projects.PAB])).toMatchObject({ schedules: 1 });
      expect(await source.formUsage(form.id, [])).toMatchObject({ schedules: 0, openChecks: 0 });
    } finally {
      await prisma.task.updateMany({ where: { id: { in: [w.tasks.TA1, w.tasks.TB1] } }, data: { inspectionFormId: null, recurrenceRule: Prisma.DbNull } });
      await prisma.inspectionForm.delete({ where: { id: form.id } });
    }
  });

  it('reading all with a pick reads only what that pick shows', async () => {
    const { cat } = w.as;
    const notifications = await prisma.notification.findMany({ where: { userId: cat.id }, select: { id: true } });
    try {
      const token = (await api.deps.tokenService!.issueTokens({ id: cat.id, roles: cat.roles })).accessToken;
      const res = await api.app.inject({ method: 'POST', url: '/api/v1/notifications/read-all', headers: { authorization: `Bearer ${token}`, 'x-company-id': w.companies.A }, payload: {} });
      expect(res.statusCode).toBe(200);
      expect(await api.get(cat, '/notifications/unread-count', { 'x-company-id': w.companies.B })).toEqual({ count: 1 }); // Beta's notice is still unread
      expect(await api.get(cat, '/notifications/unread-count')).toEqual({ count: 1 });
    } finally {
      await prisma.notification.updateMany({ where: { id: { in: notifications.map((n) => n.id) } }, data: { readAt: null } });
    }
  });
});
