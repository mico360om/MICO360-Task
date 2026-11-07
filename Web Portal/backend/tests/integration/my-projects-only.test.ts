import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createSearchService } from '../../src/modules/search/search-service';
import { createPrismaSearchDataSource } from '../../src/modules/search/prisma-search-data-source';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import { createMicoAiTools } from '../../src/modules/mico-ai/mico-ai-tools';
import type { Viewer as AiViewer } from '../../src/modules/mico-ai/mico-ai-data';
import { createPrismaChatMemberLookup, createPrismaConversationRepository, createPrismaMessageRepository, createPrismaParticipantRepository, createPrismaReactionRepository } from '../../src/modules/chat/prisma-chat-repository';
import { createMessageService } from '../../src/modules/chat/message-service';
import { createPrismaFinalMinutesRepository } from '../../src/modules/meetings/final-minutes-repository';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { createUserService } from '../../src/modules/users/user-service';
import { createPrismaUserRepository } from '../../src/modules/users/prisma-user-repository';
import { createPrismaPreferences } from '../../src/modules/users/user-preferences';
import type { AuditService } from '../../src/modules/audit/audit-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.22 "Show my projects only": with the setting on, every LIST treats the administrator like a team
// member (owner, named manager or member of the project; with a pick, in that company too); opening one
// thing by its link stays admin-wide; employees and other administrators are unchanged. The real route
// handlers over the real Prisma sources (company-app.ts), wired as server.ts wires them.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let api: CompanyApp;
let tools: ReturnType<typeof createMicoAiTools>;
/** What User Management's changes recorded in the audit log (1.22.3). */
const audited: { action: string; entityId: string | null; newValue: unknown }[] = [];

const DAY = 86_400_000;
const dayKey = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const calendar = () => `/calendar?from=${dayKey(-2)}&to=${dayKey(10)}`;
const timeline = () => `/timeline?from=${dayKey(-7)}&to=${dayKey(21)}`;
const workload = () => `/workload?week=${dayKey(0)}`;
type Row = { id: string; projectId?: string | null };
const projectIdsOf = (rows: unknown) => sorted([...new Set((rows as Row[]).map((r) => r.projectId ?? r.id))]);
const idsOf = (rows: unknown) => sorted((rows as Row[]).map((r) => r.id));
const titlesOf = (rows: unknown) => sorted((rows as { title: string }[]).map((r) => r.title));
type Summary = { conversation: { kind: string; projectId: string | null } };
const channelProjects = (rows: unknown) => sorted((rows as Summary[]).filter((s) => s.conversation.kind === 'PROJECT').map((s) => s.conversation.projectId!));
const setting = (on: boolean) => prisma.user.update({ where: { id: w.people.admin }, data: { myProjectsOnly: on } });
const asAi = (v: { id: string; roles: string[] }, pick: string | null = null): AiViewer => ({ userId: v.id, roles: v.roles, pick });
const refsOf = (out: { rows: { ref?: { type: string; id?: string } | null }[] }, type: string) =>
  sorted(out.rows.map((r) => r.ref).filter((ref): ref is { type: string; id: string } => !!ref && ref.type === type && !!ref.id).map((ref) => ref.id));

/** The Activity calendar around today: the days' counts summed, and every counted day's changes (all pages). */
async function activityCalendar(viewer: { id: string; roles: string[] }, headers: Record<string, string> = {}) {
  const days = (await api.get(viewer, `/activity?from=${dayKey(-1)}&to=${dayKey(1)}`, headers)) as { day: string; count: number }[];
  const rows: Row[] = [];
  for (const { day } of days) {
    let before: string | null = null;
    do {
      const res = await api.getRaw(viewer, `/activity?day=${day}${before ? `&before=${encodeURIComponent(before)}` : ''}`, headers);
      expect(res.statusCode, res.body).toBe(200);
      const page = res.json() as { data: Row[]; next: string | null };
      rows.push(...page.data);
      before = page.next;
    } while (before);
  }
  return { total: days.reduce((n, d) => n + d.count, 0), rows };
}

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  const { people, projects, tasks, meetings } = w;
  // The administrator is on PA's team and PAB's named manager — nothing of PB or PC.
  await prisma.projectMember.create({ data: { projectId: projects.PA, userId: people.admin, role: 'MEMBER' } });
  await prisma.project.update({ where: { id: projects.PAB }, data: { managerId: people.admin } });
  // Every task due tomorrow (the calendar, the timeline, the workload); TA2 and TB2 wait for approval;
  // the administrator is assigned TA1 (PA) and TB1 (PB).
  await prisma.task.updateMany({ where: { id: { in: Object.values(tasks) } }, data: { dueDate: new Date(`${dayKey(1)}T00:00:00.000Z`) } });
  await prisma.project.updateMany({ where: { id: { in: Object.values(projects) } }, data: { startDate: new Date(`${dayKey(-3)}T00:00:00.000Z`), targetDate: new Date(`${dayKey(30)}T00:00:00.000Z`) } });
  await prisma.task.updateMany({ where: { id: { in: [tasks.TA2, tasks.TB2] } }, data: { needsApproval: true, approvalRequestedAt: new Date(), approvalRequestedById: people.cat } });
  await prisma.taskAssignee.createMany({ data: [{ taskId: tasks.TA1, userId: people.admin }, { taskId: tasks.TB1, userId: people.admin }] });
  for (const [taskId, projectId, marker] of [
    [tasks.TA1, projects.PA, 'ZZALPHA'],
    [tasks.TB1, projects.PB, 'ZZBETA'],
    [tasks.TAB1, projects.PAB, 'ZZSHARED'],
    [tasks.TC1, projects.PC, 'ZZGAMMA'],
  ] as const) {
    await prisma.activity.create({ data: { taskId, projectId, userId: people.ana, action: 'UPDATED', meta: { title: `${marker} change` } } });
  }
  await prisma.notification.createMany({
    data: [
      { userId: people.admin, type: 'TASK_COMMENT', title: 'admin ZZALPHA notice', entityType: 'task', entityId: tasks.TA1, projectId: projects.PA },
      { userId: people.admin, type: 'TASK_COMMENT', title: 'admin ZZBETA notice', entityType: 'task', entityId: tasks.TB1, projectId: projects.PB },
      { userId: people.admin, type: 'TASK_DIGEST', title: 'admin digest', entityType: 'digest', entityId: dayKey(0) },
    ],
  });
  // The administrator attends MN_B (no project, Beta) — one of its people, so it stays theirs —
  // and has an action item from MA (PA) and from MB (PB).
  await prisma.meetingAttendee.create({ data: { meetingId: meetings.MN_B, userId: people.admin, invitedAt: new Date() } });
  await prisma.actionItem.createMany({
    data: [
      { meetingId: meetings.MA, projectId: projects.PA, description: 'admin ZZALPHA action', assigneeId: people.admin, createdById: people.ana },
      { meetingId: meetings.MB, projectId: projects.PB, description: 'admin ZZBETA action', assigneeId: people.admin, createdById: people.ben },
    ],
  });
  // Search: the full task index.
  const searchIndex = createTaskSearchIndex({ prisma });
  for (const taskId of Object.values(tasks)) await searchIndex.taskChanged(taskId);
  const taskSearch = createTaskSearchEngine({ prisma, index: searchIndex, timeZone: 'Asia/Muscat' });
  api = await buildCompanyApp(prisma, (base) => ({
    searchService: createSearchService({ data: createPrismaSearchDataSource(prisma), tasks: taskSearch }),
    taskSearch,
    taskMoveService: createTaskMoveService({
      repo: createPrismaTaskMoveRepository(prisma),
      pickerProjectIds: (actor) => base.projectAccess!.accessibleProjectIds(actor.id, actor.roles ?? [], null),
    }),
    // 1.22.3: User Management (PUT /users/:id) over the real users table.
    userService: createUserService({ users: createPrismaUserRepository(prisma) }),
    userPreferences: createPrismaPreferences(prisma),
    auditService: {
      async record(d: { action: string; entityId?: string | null; newValue?: unknown }) {
        audited.push({ action: d.action, entityId: d.entityId ?? null, newValue: d.newValue });
        return {} as never;
      },
      async list() {
        return [];
      },
    } as unknown as AuditService,
  }));
  // MICO AI's tools over the same rules (server.ts wiring).
  const chat = createMessageService({
    conversations: createPrismaConversationRepository(prisma),
    participants: createPrismaParticipantRepository(prisma),
    messages: createPrismaMessageRepository(prisma),
    reactions: createPrismaReactionRepository(prisma),
    members: createPrismaChatMemberLookup(prisma),
  });
  const data = createPrismaMicoAiData({
    prisma,
    projectAccess: api.deps.projectAccess!,
    meetingAccess: api.deps.meetingAccess!,
    conversationIdsFor: (userId) => chat.accessibleConversationIds(userId),
    finalMinutes: createPrismaFinalMinutesRepository(prisma),
  });
  tools = createMicoAiTools({ data, timeZone: 'Asia/Muscat' });
});

afterAll(async () => {
  await api?.close();
  await prisma.actionItem.deleteMany({ where: { assigneeId: w.people.admin } });
  await prisma.meetingAttendee.deleteMany({ where: { userId: w.people.admin } });
  await prisma.taskAssignee.deleteMany({ where: { userId: w.people.admin } });
  await prisma.projectMember.deleteMany({ where: { userId: w.people.admin } });
  await prisma.project.updateMany({ where: { managerId: w.people.admin }, data: { managerId: null } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('“Show my projects only” (1.22): an administrator’s lists follow the team rule', () => {
  it('is off by default: the administrator lists everything, as before', async () => {
    const { admin } = w.as;
    // (The test database is shared: an administrator sees other files' projects too.)
    const all = expect.arrayContaining(Object.values(w.projects));
    expect(projectIdsOf(await api.get(admin, '/projects'))).toEqual(all);
    expect(projectIdsOf(await api.get(admin, '/projects/overview'))).toEqual(all);
    expect(idsOf(await api.get(admin, '/meetings'))).toEqual(expect.arrayContaining(Object.values(w.meetings)));
    expect(titlesOf(await api.get(admin, '/notifications'))).toEqual(sorted(['admin ZZALPHA notice', 'admin ZZBETA notice', 'admin digest']));
  });

  describe('with the setting on', () => {
    beforeAll(() => setting(true));
    afterAll(() => setting(false));

    it('Projects, the All projects board and the approvals hold only PA and PAB', async () => {
      const { admin } = w.as;
      const mine = sorted([w.projects.PA, w.projects.PAB]);
      expect(projectIdsOf(await api.get(admin, '/projects'))).toEqual(mine);
      expect(projectIdsOf(await api.get(admin, '/projects/overview'))).toEqual(mine);
      expect(projectIdsOf(await api.get(admin, '/tasks'))).toEqual(mine);
      expect(idsOf(((await api.get(admin, '/tasks/approvals')) as { tasks: Row[] }).tasks)).toEqual([w.tasks.TA2]);
    });

    // Owner, 4 Nov ("Yes, always show my own" — as My Action Items, e9fe5a9c): the administrator's OWN
    // tasks always show, whatever the project — TB1 (PB, not theirs) too; other people's work narrows.
    it('My Tasks and the calendar always hold the administrator’s own tasks, whatever the project', async () => {
      const { admin } = w.as;
      expect(idsOf(await api.get(admin, '/tasks/mine'))).toEqual(sorted([w.tasks.TA1, w.tasks.TB1]));
      // The calendar: PA's and PAB's tasks, and TB1 (theirs) — not TB2 (PB, someone else's).
      expect(idsOf(((await api.get(admin, calendar())) as { tasks: Row[] }).tasks)).toEqual(sorted([w.tasks.TA1, w.tasks.TA2, w.tasks.TAB1, w.tasks.TB1]));
      // A picked company still applies: Beta holds PB and PAB, Alpha PA and PAB.
      const beta = { 'x-company-id': w.companies.B };
      expect(idsOf(await api.get(admin, '/tasks/mine', beta))).toEqual([w.tasks.TB1]);
      expect(idsOf(await api.get(admin, '/tasks/mine', { 'x-company-id': w.companies.A }))).toEqual([w.tasks.TA1]);
      expect(idsOf(((await api.get(admin, calendar(), beta)) as { tasks: Row[] }).tasks)).toEqual(sorted([w.tasks.TAB1, w.tasks.TB1]));
      // An employee is unchanged: ben (PB's owner, on PAB's team) has his own TB1 and TAB1.
      expect(idsOf(await api.get(w.as.ben, '/tasks/mine'))).toEqual(sorted([w.tasks.TB1, w.tasks.TAB1]));
    });

    it('the Projects page’s untick for this visit (?all=1) shows every project; no other list takes it', async () => {
      const { admin } = w.as;
      expect(projectIdsOf(await api.get(admin, '/projects/overview?all=1'))).toEqual(expect.arrayContaining(Object.values(w.projects)));
      expect(projectIdsOf(await api.get(admin, '/projects?all=1'))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
      // An employee can't widen their list with it.
      expect(projectIdsOf(await api.get(w.as.ana, '/projects/overview?all=1'))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    });

    it('Activity, the bell, Meetings and My Action Items', async () => {
      const { admin } = w.as;
      expect(projectIdsOf(await api.get(admin, '/activity'))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
      // Owner, 4 Nov: the administrator's own notifications always show, whatever the project — the
      // ZZBETA notice (PB, not theirs) too — in the bell, the badge, the Notifications page and its chips.
      const all = sorted(['admin ZZALPHA notice', 'admin ZZBETA notice', 'admin digest']);
      expect(titlesOf(await api.get(admin, '/notifications'))).toEqual(all);
      expect(await api.get(admin, '/notifications/unread-count')).toEqual({ count: 3 });
      expect(titlesOf(await api.get(admin, '/notifications?limit=50&unread=1'))).toEqual(all);
      expect(titlesOf(await api.get(admin, '/notifications?limit=50&kinds=comments'))).toEqual(sorted(['admin ZZALPHA notice', 'admin ZZBETA notice']));
      expect(await api.get(admin, '/notifications/counts')).toMatchObject({ unread: 3, kinds: { comments: 2 } });
      // A picked company still applies: under Alpha the ZZBETA notice (PB is Beta's) is out.
      expect(titlesOf(await api.get(admin, '/notifications', { 'x-company-id': w.companies.A }))).not.toContain('admin ZZBETA notice');
      expect(titlesOf(await api.get(admin, '/notifications', { 'x-company-id': w.companies.B }))).toContain('admin ZZBETA notice');
      // MA (PA), and MN_B — no project, the administrator is one of its people. Not MB (PB) or MN_A.
      expect(idsOf(await api.get(admin, '/meetings'))).toEqual(sorted([w.meetings.MA, w.meetings.MN_B]));
      // Owner, 4 Nov: My Action Items ALWAYS shows the administrator's own items, whatever the project —
      // MB's (PB, not theirs) too; only other people's work and the project lists narrow.
      expect(sorted((await api.get(admin, '/me/action-items') as { description: string }[]).map((i) => i.description))).toEqual(sorted(['admin ZZALPHA action', 'admin ZZBETA action']));
    });

    it('“Mark all read” reads the administrator’s own notifications from every project', async () => {
      const { admin } = w.as;
      try {
        const res = await api.post(admin, '/notifications/read-all');
        expect(res.statusCode, res.body).toBe(200);
        expect(await api.get(admin, '/notifications/unread-count')).toEqual({ count: 0 });
        const beta = await prisma.notification.findFirstOrThrow({ where: { userId: w.people.admin, title: 'admin ZZBETA notice' } });
        expect(beta.readAt).not.toBeNull();
      } finally {
        await prisma.notification.updateMany({ where: { userId: w.people.admin }, data: { readAt: null } });
      }
    });

    // 1.22 integration: lane B's Activity calendar (`?from=&to=` per day, `?day=` a day's changes)
    // follows the setting as the list does — with and without a picked company.
    it('the Activity calendar: its counts and each day’s changes hold only PA and PAB (with a pick, PAB)', async () => {
      const { admin } = w.as;
      for (const [headers, mine] of [
        [{}, sorted([w.projects.PA, w.projects.PAB])],
        [{ 'x-company-id': w.companies.B }, [w.projects.PAB]],
      ] as const) {
        const cal = await activityCalendar(admin, headers);
        expect(projectIdsOf(cal.rows)).toEqual(mine);
        expect(cal.total).toBe(cal.rows.length); // the counts are of the same changes
      }
    });

    it('Timeline, Workload, Management and Reports', async () => {
      const { admin } = w.as;
      const mine = sorted([w.projects.PA, w.projects.PAB]);
      expect(projectIdsOf(((await api.get(admin, timeline())) as { projects: Row[] }).projects)).toEqual(mine);
      const load = (await api.get(admin, workload())) as { scope: string; projects: { id: string }[]; people: { id: string }[] };
      expect(load.scope).toBe('everyone'); // still the administrator's view
      expect(sorted(load.projects.map((p) => p.id))).toEqual(mine);
      expect(sorted(load.people.map((p) => p.id))).toEqual(sorted([w.people.admin, w.people.ana, w.people.ben, w.people.cat])); // the teams of PA and PAB
      expect(sorted(((await api.get(admin, '/management/overview')) as { projects: { id: string }[] }).projects.map((p) => p.id))).toEqual(mine);
      expect(projectIdsOf(await api.get(admin, '/reports/projects'))).toEqual(mine);
      const people = (await api.get(admin, '/reports/workload')) as { userId: string }[];
      expect(people.map((p) => p.userId)).not.toContain(w.people.gus);
      expect(people.map((p) => p.userId)).not.toContain(w.people.bob);
    });

    it('Search, the task search, Chat and the move dialog’s projects', async () => {
      const { admin } = w.as;
      const found = (await api.get(admin, '/search?q=ZZ')) as { tasks: Row[]; projects: Row[]; meetings: Row[] };
      expect(projectIdsOf(found.tasks)).toEqual(sorted([w.projects.PA, w.projects.PAB]));
      expect(idsOf(found.meetings)).toEqual(sorted([w.meetings.MA, w.meetings.MN_B]));
      expect(sorted(((await api.get(admin, '/search/tasks?q=ZZ')) as Row[]).map((t) => t.projectId!))).toEqual(sorted([w.projects.PA, w.projects.PA, w.projects.PAB]));
      expect(channelProjects(await api.get(admin, '/conversations'))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
      const targets = (await api.get(admin, '/tasks/move-targets')) as { managesAll: boolean; projects: { id: string }[] };
      expect(targets.managesAll).toBe(true); // may still move tasks into any project; the picker lists theirs
      expect(sorted(targets.projects.map((p) => p.id))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    });

    it('MICO AI answers from the same projects', async () => {
      const { admin } = w.as;
      expect(refsOf(await tools.run(asAi(admin), 'list_projects', {}), 'project')).toEqual(sorted([w.projects.PA, w.projects.PAB]));
      expect(refsOf(await tools.run(asAi(admin), 'list_meetings', { from: dayKey(-1), to: dayKey(5) }), 'meeting')).toEqual(sorted([w.meetings.MA, w.meetings.MN_B]));
      // Of PB, only the administrator's own TB1 (owner, 4 Nov — as My Tasks); never TB2 or PC's.
      const out = JSON.stringify(await tools.run(asAi(admin), 'search_tasks', {}));
      expect(out).toContain('TB1 ZZBETA task');
      expect(out).not.toContain('TB2 ZZBETA task');
      expect(out).not.toContain('ZZGAMMA task');
    });

    // Owner, 4 Nov (as My Tasks): MICO AI's tasks always include the administrator's own, whatever the
    // project; other people's tasks still follow the team rule, and the picked company still applies.
    it('MICO AI’s tasks always include the administrator’s own, whatever the project', async () => {
      const { admin } = w.as;
      const tasks = async (viewer: AiViewer, args: Record<string, unknown> = {}) => refsOf(await tools.run(viewer, 'search_tasks', args), 'task');
      expect(await tasks(asAi(admin))).toEqual(sorted([w.tasks.TA1, w.tasks.TA2, w.tasks.TAB1, w.tasks.TB1]));
      expect(await tasks(asAi(admin), { assignee: 'me' })).toEqual(sorted([w.tasks.TA1, w.tasks.TB1]));
      expect(await tasks(asAi(admin, w.companies.B), { assignee: 'me' })).toEqual([w.tasks.TB1]);
      expect(await tasks(asAi(admin, w.companies.A), { assignee: 'me' })).toEqual([w.tasks.TA1]);
      // Its details open too; TB2 (someone else's, PB) still doesn't.
      expect((await tools.run(asAi(admin), 'task_details', { task: `task:${w.tasks.TB1}` })).error).toBeUndefined();
      expect((await tools.run(asAi(admin), 'task_details', { task: `task:${w.tasks.TB2}` })).error).toMatch(/No task you can see/);
      // An employee is unchanged: ana (PA, PAB) has none of PB.
      expect(await tasks(asAi(w.as.ana))).toEqual(sorted([w.tasks.TA1, w.tasks.TA2, w.tasks.TAB1]));
    });

    // Owner, 4 Nov (as My Action Items, e9fe5a9c): MICO AI's action items ALWAYS include the
    // administrator's own, whatever the project — MB's (PB, not theirs) too; nobody else's of PB.
    it('MICO AI’s action items always include the administrator’s own, whatever the project', async () => {
      const { admin } = w.as;
      const other = await prisma.actionItem.create({ data: { meetingId: w.meetings.MB, projectId: w.projects.PB, description: 'ben ZZBETA action', assigneeId: w.people.ben, createdById: w.people.ben } });
      try {
        const items = async (viewer: AiViewer, args: Record<string, unknown> = {}) => {
          const out = (await tools.run(viewer, 'list_action_items', { from: dayKey(-1), to: dayKey(5), ...args })) as unknown as { rows: { values: { item: string } }[] };
          return sorted(out.rows.map((r) => r.values.item));
        };
        const pa = [`ZZALPHA action for ${w.people.ana}`, `ZZALPHA action for ${w.people.bob}`, 'admin ZZALPHA action'];
        expect(await items(asAi(admin))).toEqual(sorted([...pa, 'admin ZZBETA action']));
        // Asked for their own ("me"), and with a picked company: that company's only (as in 1.21).
        expect(await items(asAi(admin), { assignee: 'me' })).toEqual(sorted(['admin ZZALPHA action', 'admin ZZBETA action']));
        expect(await items(asAi(admin, w.companies.B))).toEqual(['admin ZZBETA action']);
        expect(await items(asAi(admin, w.companies.A))).toEqual(sorted(pa));
        // An employee is unchanged: cat (on PA's and PB's teams) sees both meetings' items, ben's too.
        expect(await items(asAi(w.as.cat))).toContain('ben ZZBETA action');
      } finally {
        await prisma.actionItem.delete({ where: { id: other.id } });
      }
    });

    it('with a picked company both apply', async () => {
      const { admin } = w.as;
      const beta = { 'x-company-id': w.companies.B };
      expect(projectIdsOf(await api.get(admin, '/projects', beta))).toEqual([w.projects.PAB]);
      expect(projectIdsOf(await api.get(admin, '/tasks', beta))).toEqual([w.projects.PAB]);
      expect(projectIdsOf(await api.get(admin, '/activity', beta))).toEqual([w.projects.PAB]);
      // Beta's meetings: PAB has none; MN_B (Beta, the administrator attends). Not MB (PB).
      expect(idsOf(await api.get(admin, '/meetings', beta))).toEqual([w.meetings.MN_B]);
      expect(projectIdsOf(await api.get(admin, '/projects', { 'x-company-id': w.companies.A }))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
      // My Action Items: the picked company still applies (as in 1.21) — the setting doesn't narrow it.
      const items = async (headers: Record<string, string>) => (await api.get(admin, '/me/action-items', headers) as { description: string }[]).map((i) => i.description);
      expect(await items(beta)).toEqual(['admin ZZBETA action']);
      expect(await items({ 'x-company-id': w.companies.A })).toEqual(['admin ZZALPHA action']);
      // Reports' workload: the people with tasks in PAB — not every Beta member (bob has none there).
      const people = ((await api.get(admin, '/reports/workload', beta)) as { userId: string }[]).map((p) => p.userId);
      expect(people).not.toContain(w.people.bob);
      expect(people).toContain(w.people.ben);
    });

    it('opening one thing by its link stays admin-wide: PB, its task, its board, its meetings tab, its meeting', async () => {
      const { admin } = w.as;
      expect((await api.getRaw(admin, `/projects/${w.projects.PB}`)).statusCode).toBe(200);
      expect((await api.getRaw(admin, `/tasks/${w.tasks.TB1}`)).statusCode).toBe(200);
      expect(idsOf(await api.get(admin, `/tasks?projectId=${w.projects.PB}`))).toEqual(sorted([w.tasks.TB1, w.tasks.TB2]));
      expect(idsOf(await api.get(admin, `/meetings?projectId=${w.projects.PB}`))).toEqual([w.meetings.MB]);
      expect((await api.getRaw(admin, `/meetings/${w.meetings.MB}`)).statusCode).toBe(200);
      expect((await api.getRaw(admin, `/projects/${w.projects.PB}/progress`)).statusCode).toBe(200);
    });

    it('employees and other administrators are unchanged', async () => {
      const { cat, ana } = w.as;
      expect(projectIdsOf(await api.get(cat, '/projects'))).toEqual(sorted([w.projects.PA, w.projects.PB]));
      expect(projectIdsOf(await api.get(ana, '/tasks'))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
      const other = { id: w.people.admin, roles: ['ADMIN'] };
      // The same person with the setting off again sees everything (it is read on each request).
      await setting(false);
      try {
        expect(projectIdsOf(await api.get(other, '/projects'))).toEqual(expect.arrayContaining(Object.values(w.projects)));
      } finally {
        await setting(true);
      }
    });
  });
});

describe('“Show my projects only” set by another administrator in User Management → Manage account (1.22.3)', () => {
  // Another administrator (their token is enough: the route checks the caller's role).
  const boss = { id: 'zz-boss-admin', roles: ['ADMIN'] };
  const stored = async (id: string) => (await prisma.user.findUnique({ where: { id }, select: { myProjectsOnly: true } }))?.myProjectsOnly;
  afterAll(() => setting(false));

  it('turned on for the administrator: stored, audited, and their very next list follows it', async () => {
    const { admin } = w.as;
    expect(projectIdsOf(await api.get(admin, '/projects'))).toEqual(expect.arrayContaining(Object.values(w.projects)));
    const res = await api.put(boss, `/users/${w.people.admin}`, { myProjectsOnly: true });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { myProjectsOnly: boolean } }).data.myProjectsOnly).toBe(true);
    expect(await stored(w.people.admin)).toBe(true);
    expect(audited).toContainEqual({ action: 'user.update', entityId: w.people.admin, newValue: { myProjectsOnly: true, changed: ['myProjectsOnly'] } });
    // The user list shows the saved state.
    const listed = (await api.get(boss, '/users')) as { id: string; myProjectsOnly: boolean }[];
    expect(listed.find((u) => u.id === w.people.admin)?.myProjectsOnly).toBe(true);
    // No sign-in again needed: the next request uses it (it is read on each one).
    expect(projectIdsOf(await api.get(admin, '/projects'))).toEqual(sorted([w.projects.PA, w.projects.PAB]));
    // Their own Settings read the same value.
    expect(((await api.get(admin, '/users/me/preferences')) as { myProjectsOnly: boolean }).myProjectsOnly).toBe(true);
  });

  it('turned off again: every project is back on their next request', async () => {
    const { admin } = w.as;
    expect((await api.put(boss, `/users/${w.people.admin}`, { myProjectsOnly: false })).statusCode).toBe(200);
    expect(await stored(w.people.admin)).toBe(false);
    expect(projectIdsOf(await api.get(admin, '/projects'))).toEqual(expect.arrayContaining(Object.values(w.projects)));
  });

  it('refused for someone who isn’t an administrator; nothing is saved', async () => {
    const res = await api.put(boss, `/users/${w.people.ana}`, { firstName: 'Changed', myProjectsOnly: true });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { message: string } }).error.message).toBe('Only administrators have this setting.');
    expect(await prisma.user.findUnique({ where: { id: w.people.ana }, select: { firstName: true, myProjectsOnly: true } })).toEqual({ firstName: 'Ana', myProjectsOnly: false });
  });

  it('only an administrator may change it for someone (an employee is refused)', async () => {
    expect((await api.put(w.as.ana, `/users/${w.people.admin}`, { myProjectsOnly: true })).statusCode).toBe(403);
    expect(await stored(w.people.admin)).toBe(false);
  });
});
