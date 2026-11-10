import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaArchiveLookup, TASK_ARCHIVED_MESSAGE } from '../../src/modules/companies/archive-guard';
import { createTaskArchiveService } from '../../src/modules/tasks/task-archive';
import { createPrismaTaskArchiveStore } from '../../src/modules/tasks/prisma-task-archive-store';
import { createPrismaChecklistQueries } from '../../src/modules/tasks/prisma-checklist-queries';
import { createPrismaApprovalSource } from '../../src/modules/tasks/prisma-approval-source';
import { createPrismaCarryForwardRepo } from '../../src/modules/tasks/prisma-task-repository';
import { createPrismaStartingTasksSource, startingWindow } from '../../src/modules/tasks/start-day-reminders';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { boardDateFromKey } from '../../src/modules/tasks/board-date';
import { DATED_SWEEP_TASKS, ESCALATION_SWEEP_TASKS } from '../../src/modules/notifications/prisma-task-audience';
import { createPrismaTimelineSource } from '../../src/modules/planning/prisma-timeline-source';
import { createPrismaWorkloadStore } from '../../src/modules/planning/prisma-workload-store';
import { createPrismaManagementSource } from '../../src/modules/management/prisma-management-source';
import { createPrismaHealthSource } from '../../src/modules/project-health/prisma-health-source';
import { createCompletionCounts } from '../../src/modules/project-health/completion-counts';
import { createPrismaProjectOverviewSource } from '../../src/modules/projects/prisma-project-overview-source';
import { createPrismaColumnRepository } from '../../src/modules/projects/prisma-column-repository';
import { priorityReads } from '../../src/modules/dashboard/prisma-priority-sources';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';
import { createPrismaAgendaSources } from '../../src/modules/meetings/prisma-agenda-sources';
import { createPrismaClientViewSource } from '../../src/modules/client-view/client-view-source';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createPrismaMicoAiData } from '../../src/modules/mico-ai/prisma-mico-ai-data';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';
import { todayKey } from '../../src/lib/due-date';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import type { Viewer } from '../../src/modules/companies/company-access';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Task archive (bulk lane; owner, 10 Nov 2026): an archived task is hidden from every board, list, sweep and
// open count (the app's and the extension's lists too: they read the same routes), still found by search
// (marked), in reports only when asked and in its project's "Archived tasks" list; read-only until
// unarchived. Figures: an archived Done task still counts as done; an archived open task leaves them all.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const lookup = createPrismaArchiveLookup(prisma);
let w: CompanyWorld;
let api: CompanyApp;
let PA = '';
let todo = '';
let doneCol = '';
/** live: open, overdue, a milestone, blocked by `open`; open: archived open overdue; done: archived Done milestone; waiting: archived, waiting for approval. */
const T = { live: '', open: '', done: '', waiting: '' };
const KEYS = { live: '', open: '', done: '', waiting: '' };
const mine = (ids: string[]) => ids.filter((id) => Object.values(T).includes(id));

type Figures = { health: { total: number; done: number }; mgmt: { total: number; done: number; open: number; late: number }; overview: number; timeline: { total: number; milestones: number }; progress: { total: number; completed: number }; client: { total: number; done: number } };
async function figures(): Promise<Figures> {
  const today = todayKey(TZ);
  const [h] = await createPrismaHealthSource(prisma).figures([PA]);
  const [m] = await createPrismaManagementSource(prisma, TZ).taskFigures([PA], today);
  const overview = await createPrismaProjectOverviewSource(prisma).load([PA], []);
  const tl = await createPrismaTimelineSource(prisma).load([PA], [], { shownFrom: day('2026-01-01'), shownTo: day('2027-01-01'), soonFrom: day('2026-01-01'), soonTo: day('2027-01-01'), weekFrom: day('2026-03-08'), weekTo: day('2026-03-15') });
  const progress = (await api.get(w.as.admin, `/projects/${PA}/progress`)) as { total: number; completed: number };
  return {
    health: { total: h!.total, done: h!.done },
    mgmt: { total: m!.total, done: m!.done, open: m!.open, late: m!.late },
    overview: overview.totals.find((t) => t.projectId === PA)!.total,
    timeline: { total: tl.totals.find((t) => t.projectId === PA)!.total, milestones: tl.milestoneCounts.find((c) => c.projectId === PA)?.count ?? 0 },
    progress: { total: progress.total, completed: progress.completed },
    client: await createCompletionCounts(prisma)(PA),
  };
}
let before: Figures;

async function send(viewer: Viewer, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown) {
  const token = (await api.deps.tokenService!.issueTokens({ id: viewer.id, roles: viewer.roles })).accessToken;
  return api.app.inject({ method, url: `/api/v1${path}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}
const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  PA = w.projects.PA;
  todo = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: PA } })).id;
  doneCol = (await prisma.kanbanColumn.create({ data: { projectId: PA, name: 'Done', category: 'DONE', position: 9 } })).id;
  api = await buildCompanyApp(prisma, (base) => ({
    archiveLookup: lookup,
    checklistDue: (o) => createPrismaChecklistQueries(prisma).due(o),
    taskArchiveService: createTaskArchiveService({
      ...createPrismaTaskArchiveStore(prisma),
      canViewTask: (a, id) => (base.projectAccess as unknown as { canViewTask(u: string, r: string[], t: string): Promise<boolean> }).canViewTask(a.id, a.roles, id),
      runsProject: (a, p) => base.projectAuthz!.canManageProject(a.id, a.roles, p),
      isProjectArchived: (p) => lookup.isArchived(p),
    }),
  }));
  const ana = w.people.ana;
  const tag = w.tag.toUpperCase();
  const make = async (n: number, title: string, extra: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({
      data: {
        key: `ARC${tag}-${n}`, title, projectId: PA, columnId: todo, createdById: ana, assignees: { create: { userId: ana } },
        dueDate: day('2026-03-10'), startDate: day('2026-03-10'), boardDate: boardDateFromKey('2026-03-10'), createdAt: day('2026-03-01'), ...extra,
      },
    });
    return { id: t.id, key: t.key };
  };
  const live = await make(1, 'Live pump check ZZLIVEARC', { isMilestone: true });
  const open = await make(2, 'Archived valve ZZARCHWORD');
  const done = await make(3, 'Archived done milestone', { columnId: doneCol, completedAt: day('2026-03-07'), dueDate: day('2026-03-08'), isMilestone: true });
  const waiting = await make(4, 'Archived waiting', { approvalRequestedAt: day('2026-03-09') });
  Object.assign(T, { live: live.id, open: open.id, done: done.id, waiting: waiting.id });
  Object.assign(KEYS, { live: live.key, open: open.key, done: done.key, waiting: waiting.key });
  // The live task waits on the archived one (an archived blocker no longer blocks).
  await prisma.taskDependency.create({ data: { taskId: T.live, dependsOnTaskId: T.open } });
  // A dated checklist item for ana on each of the live and the archived open task.
  for (const taskId of [T.live, T.open]) {
    const list = await prisma.checklistList.create({ data: { taskId, title: 'Checks' } });
    await prisma.checklistItem.create({ data: { taskId, listId: list.id, text: 'Gauge', assigneeId: ana, dueDate: day('2026-03-10') } });
  }
  await createTaskSearchIndex({ prisma }).refresh(Object.values(T));
  before = await figures();
  // Archived through the route, as the task panel does it (an administrator).
  for (const id of [T.open, T.done, T.waiting]) {
    const res = await send(w.as.admin, 'POST', `/tasks/${id}/archive`);
    expect(res.statusCode, res.body).toBe(200);
  }
});

afterAll(async () => {
  await api?.close();
  if (w) {
    const taskIds = (await prisma.task.findMany({ where: { projectId: { in: Object.values(w.projects) } }, select: { id: true } })).map((t) => t.id);
    await prisma.searchIndex.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { projectId: { in: Object.values(w.projects) } }] } });
    await prisma.taskMerge.deleteMany({ where: { mainTaskId: { in: taskIds } } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

describe('an archived task is out of every list the website, the app and the extension read (integration)', () => {
  it('GET /tasks (a project’s board, All projects, a board day, a month), /tasks/mine and the calendar', async () => {
    const { ana, admin } = w.as;
    expect(mine(ids(await api.get(ana, `/tasks?projectId=${PA}`)))).toEqual([T.live]);
    expect(mine(ids(await api.get(admin, '/tasks')))).toEqual([T.live]);
    expect(mine(ids(await api.get(ana, `/tasks?projectId=${PA}&boardDate=2026-03-10`)))).toEqual([T.live]);
    expect(mine(ids(await api.get(ana, `/tasks?projectId=${PA}&month=2026-03`)))).toEqual([T.live]);
    expect(mine(ids(await api.get(ana, '/tasks/mine')))).toEqual([T.live]);
    const cal = (await api.get(ana, '/calendar?from=2026-03-01&to=2026-03-31')) as { tasks: { id: string }[]; checklistItems: { taskId: string }[] };
    expect(mine(ids(cal.tasks))).toEqual([T.live]);
    expect(cal.checklistItems.map((i) => i.taskId).filter((id) => id === T.open)).toEqual([]);
    expect(cal.checklistItems.some((i) => i.taskId === T.live)).toBe(true);
  });

  it('the project’s Archived tasks list: newest archived first, for anyone who sees the project; never another’s', async () => {
    const list = (await api.get(w.as.ana, `/tasks?projectId=${PA}&archived=only`)) as { id: string; archivedAt: string; archivedById: string }[];
    expect(list.map((t) => t.id).sort()).toEqual([T.open, T.done, T.waiting].sort());
    expect(list.every((t) => t.archivedAt && t.archivedById === w.people.admin)).toBe(true);
    expect((await api.getRaw(w.as.ben, `/tasks?projectId=${PA}&archived=only`)).statusCode).toBe(403);
    expect((await api.getRaw(w.as.ana, '/tasks?archived=only')).statusCode).toBe(400);
  });

  it('still opens on its own (read-only): its details say when and by whom', async () => {
    const t = (await api.get(w.as.ana, `/tasks/${T.open}`)) as { id: string; archivedAt: string | null; archivedById: string | null };
    expect(t).toMatchObject({ id: T.open, archivedById: w.people.admin });
    expect(t.archivedAt).not.toBeNull();
  });

  it('is read-only: editing, commenting and moving it are refused (409 TASK_ARCHIVED), with the real lookup', async () => {
    expect(await lookup.subjectOf('task', T.open)).toEqual({ projectId: PA, taskArchived: true });
    expect(await lookup.subjectOf('task', T.live)).toEqual({ projectId: PA, taskArchived: false });
    const refused = (res: { statusCode: number; json(): unknown }) => {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: { code: 'TASK_ARCHIVED', message: TASK_ARCHIVED_MESSAGE } });
    };
    refused(await send(w.as.ana, 'PUT', `/tasks/${T.open}`, { title: 'Changed' }));
    refused(await send(w.as.ana, 'PATCH', `/tasks/${T.open}/move`, { columnId: doneCol, position: 0 }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: T.open } })).title).toBe('Archived valve ZZARCHWORD');
    // Someone who can't see its project hears nothing about it being archived.
    expect((await send(w.as.ben, 'PUT', `/tasks/${T.open}`, { title: 'x' })).statusCode).not.toBe(409);
  });
});

describe('an archived task is in nobody’s open lists, dashboards or sweeps (integration)', () => {
  it('My Tasks’ checklist items, approvals, priorities, workload and the draft agenda', async () => {
    const q = createPrismaChecklistQueries(prisma);
    expect((await q.mine(w.people.ana, null)).map((i) => i.taskId).filter((id) => Object.values(T).includes(id))).toEqual([T.live]);
    const approvals = createPrismaApprovalSource(prisma, { canManageProject: async () => true });
    expect(mine((await approvals.list({ id: w.people.admin, roles: ['ADMIN'] })).map((r) => r.id))).toEqual([]);
    const today = todayKey(TZ);
    expect(mine((await priorityReads(prisma).mineTasks(w.people.ana, null, day('2030-01-01'), today)).map((t) => t.id))).toEqual([T.live]);
    expect(mine((await createPrismaWorkloadStore(prisma).openTasks({ projectIds: [PA], assigneeIds: [w.people.ana], from: day('2026-01-01'), to: day('2027-01-01') })).map((t) => t.id))).toEqual([T.live]);
    expect((await createPrismaAgendaSources(prisma).openTasks(PA, day('2027-01-01'))).map((t) => t.key).filter((k) => Object.values(KEYS).includes(k))).toEqual([KEYS.live]);
  });

  it('the daily email: never listed, and an archived blocker no longer marks a task Blocked', async () => {
    const pending = await createPrismaDailyEmailSources(prisma).tasks.pending(w.people.ana);
    const ours = pending.filter((t) => Object.values(T).includes(t.id));
    expect(ours.map((t) => t.id)).toEqual([T.live]);
    expect(ours[0]!.blocked).toBe(false);
  });

  it('reminders, the digest and escalations; checklist reminders; start-day reminders; carry-forward', async () => {
    expect(mine((await prisma.task.findMany({ where: { ...DATED_SWEEP_TASKS, projectId: PA }, select: { id: true } })).map((t) => t.id))).toEqual([T.live]);
    expect(mine((await prisma.task.findMany({ where: { ...ESCALATION_SWEEP_TASKS, projectId: PA }, select: { id: true } })).map((t) => t.id))).toEqual([T.live]);
    expect((await createPrismaChecklistQueries(prisma).forReminders()).map((i) => i.taskId).filter((id) => Object.values(T).includes(id))).toEqual([T.live]);
    const starting = await createPrismaStartingTasksSource(prisma).startingToday(startingWindow(TZ, new Date('2026-03-10T08:00:00Z')));
    expect(mine(starting.map((t) => t.id))).toEqual([T.live]);
    expect(mine((await createPrismaCarryForwardRepo(prisma).listCarryCandidates(boardDateFromKey('2026-03-11'))).map((t) => t.id))).toEqual([T.live]);
  });

  it('Management’s late lists and milestones, the project health’s open load, the client page', async () => {
    const mgmt = createPrismaManagementSource(prisma, TZ);
    expect(mine((await mgmt.lateTasks({ projectIds: [PA], today: todayKey(TZ), limit: 50 })).rows.map((r) => r.id))).toEqual([T.live]);
    expect(mine((await mgmt.openMilestones([PA])).map((m) => m.id))).toEqual([T.live]);
    expect(mine((await mgmt.awaitingApprovalTasks({ projectIds: [PA], limit: 50 })).rows.map((r) => r.id))).toEqual([]);
    const health = createPrismaHealthSource(prisma);
    expect(mine((await health.attention([PA], day('2030-01-01'))).map((t) => t.id))).toEqual([T.live]);
    await prisma.task.updateMany({ where: { id: { in: Object.values(T) } }, data: { clientVisible: true } });
    expect((await createPrismaClientViewSource(prisma).items(PA)).map((i) => i.key).filter((k) => Object.values(KEYS).includes(k ?? ''))).toEqual([KEYS.live]);
    await prisma.task.updateMany({ where: { id: { in: Object.values(T) } }, data: { clientVisible: false } });
  });
});

describe('figures: an archived Done task still counts as done; an archived open task leaves them all (integration)', () => {
  it('health, Management, the projects list, the Timeline, progress and the client’s percentage', async () => {
    const after = await figures();
    // Two archived open tasks (one overdue, one waiting) leave the totals; the archived Done task stays done.
    expect(after.health).toEqual({ total: before.health.total - 2, done: before.health.done });
    expect(after.mgmt).toEqual({ total: before.mgmt.total - 2, done: before.mgmt.done, open: before.mgmt.open - 2, late: before.mgmt.late - 1 });
    expect(after.overview).toBe(before.overview - 2);
    expect(after.timeline).toEqual({ total: before.timeline.total - 2, milestones: before.timeline.milestones });
    expect(after.progress).toEqual({ total: before.progress.total - 2, completed: before.progress.completed });
    expect(after.client).toEqual({ total: before.client.total - 2, done: before.client.done });
    // The markers (a list) never show the archived Done milestone.
    const tl = await createPrismaTimelineSource(prisma).load([PA], [], { shownFrom: day('2026-01-01'), shownTo: day('2027-01-01'), soonFrom: day('2026-01-01'), soonTo: day('2027-01-01'), weekFrom: day('2026-03-08'), weekTo: day('2026-03-15') });
    expect(mine(tl.milestones.map((m) => m.id))).toEqual([T.live]);
  });
});

describe('search finds archived tasks and says so; reports add them only when asked (integration)', () => {
  it('task search and Search everything: found, marked archived; the “open” filter leaves it out', async () => {
    const engine = createTaskSearchEngine({ prisma, timeZone: TZ });
    const hits = (await engine.search({ q: 'ZZARCHWORD', scope: { projectIds: null }, limit: 20 })).hits;
    expect(hits.map((h) => [h.id, h.archived])).toEqual([[T.open, true]]);
    expect(hits[0]!.archivedAt).not.toBeNull();
    expect((await engine.search({ q: 'ZZARCHWORD', scope: { projectIds: null }, done: false, limit: 20 })).hits).toEqual([]);
    expect((await engine.search({ q: 'ZZLIVEARC', scope: { projectIds: null }, limit: 20 })).hits.map((h) => h.archived)).toEqual([false]);
    const all = await createSearchEngine({ prisma, timeZone: TZ }).search({ q: 'ZZARCHWORD', scope: { projectIds: null, meetings: { full: null, invitee: [], editable: null } }, viewerId: w.people.admin, limit: 20 });
    expect(all.hits.filter((h) => h.kind === 'task').map((h) => [h.id, h.archived])).toEqual([[T.open, true]]);
    // By its number too.
    expect((await engine.search({ q: KEYS.open, scope: { projectIds: null }, limit: 20 })).hits.map((h) => h.id)).toEqual([T.open]);
  });

  it('MICO AI reads it with its archive date (its tools decide: found, never open)', async () => {
    const data = createPrismaMicoAiData({ prisma, projectAccess: {} as never, meetingAccess: {} as never, conversationIdsFor: async () => [], finalMinutes: {} as never });
    const rows = await data.tasks({ projectIds: [PA] });
    expect(rows.find((t) => t.id === T.open)!.archivedAt).not.toBeNull();
    expect(rows.find((t) => t.id === T.live)!.archivedAt).toBeNull();
  });

  it('reports and their task list: left out unless Include archived; then marked', async () => {
    const plain = (await api.get(w.as.admin, `/reports/projects?projectId=${PA}`)) as { total: number; completed: number }[];
    const all = (await api.get(w.as.admin, `/reports/projects?projectId=${PA}&includeArchived=true`)) as { total: number; completed: number }[];
    expect(all[0]!.total - plain[0]!.total).toBe(3);
    expect(all[0]!.completed - plain[0]!.completed).toBe(1);
    const xlsx = await api.getRaw(w.as.admin, `/reports/export.xlsx?projectId=${PA}&includeArchived=true&sections=tasks`);
    expect(xlsx.statusCode).toBe(200);
  });
});

describe('other places keep to the rules (integration)', () => {
  it('a merge refuses an archived task (TASK_ARCHIVED), task by task', async () => {
    const merges = createTaskMergeService({ prisma, timeZone: TZ });
    const admin = { id: w.people.admin, roles: ['ADMIN'] };
    const preview = await merges.preview(admin, { taskIds: [T.live, T.open] });
    expect(preview.tasks.find((t) => t.id === T.open)).toMatchObject({ canMerge: false, reason: 'It is archived — unarchive it first.' });
    await expect(merges.merge(admin, { taskIds: [T.live, T.open], mainTaskId: T.live })).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
  });

  it('an archived repeating task keeps making copies, and a new copy is never archived', async () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1 };
    const head = await prisma.task.create({ data: { key: `ARC${w.tag.toUpperCase()}-20`, title: 'Weekly walk-round', projectId: PA, columnId: todo, createdById: w.people.ana, dueDate: day('2026-03-02'), recurrenceRule: rule, archivedAt: new Date(), archivedById: w.people.admin } });
    const port = createPrismaRecurrencePort(prisma, { timeZone: TZ });
    expect((await port.listSeriesHeads()).some((h) => h.id === head.id)).toBe(true);
    const copy = await port.spawnNext(head.id, day('2026-03-09'), rule);
    expect(copy).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: copy!.id } })).archivedAt).toBeNull();
  });

  it('deleting a column parks its archived tasks (they never keep it), as binned ones are', async () => {
    const spare = (await prisma.kanbanColumn.create({ data: { projectId: PA, name: 'Spare', category: 'TODO', position: 5 } })).id;
    const parked = await prisma.task.create({ data: { key: `ARC${w.tag.toUpperCase()}-30`, title: 'Parked', projectId: PA, columnId: spare, createdById: w.people.ana, archivedAt: new Date() } });
    const columns = createPrismaColumnRepository(prisma);
    expect(await columns.countLiveTasks(spare)).toBe(0);
    expect(await columns.remove(spare)).toEqual({ projectId: PA });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: parked.id } })).columnId).toBe(todo);
  });
});

describe('Unarchive brings it back everywhere (integration)', () => {
  it('lists, My Tasks, the calendar and the figures again; it is editable again', async () => {
    for (const id of [T.open, T.done, T.waiting]) {
      const res = await send(w.as.admin, 'POST', `/tasks/${id}/unarchive`);
      expect(res.statusCode, res.body).toBe(200);
    }
    expect(mine(ids(await api.get(w.as.ana, `/tasks?projectId=${PA}`))).sort()).toEqual(Object.values(T).sort());
    expect(mine(ids(await api.get(w.as.ana, '/tasks/mine'))).sort()).toEqual(Object.values(T).sort());
    expect(mine(ids(await api.get(w.as.ana, `/tasks?projectId=${PA}&archived=only`)))).toEqual([]);
    const cal = (await api.get(w.as.ana, '/calendar?from=2026-03-01&to=2026-03-31')) as { tasks: { id: string }[] };
    expect(mine(ids(cal.tasks))).toContain(T.open);
    expect((await send(w.as.ana, 'PUT', `/tasks/${T.open}`, { title: 'Archived valve ZZARCHWORD again' })).statusCode).toBe(200);
    const [h] = await createPrismaHealthSource(prisma).figures([PA]);
    // The two open ones are back in the totals (plus the copies made by the tests above).
    expect(h!.total).toBeGreaterThanOrEqual(before.health.total);
  });
});
