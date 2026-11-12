import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { prioritiesFromBase } from './dashboard-helpers';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaProjectLookup, createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createAssigneeService } from '../../src/modules/tasks/assignee-service';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createAuditService } from '../../src/modules/audit/audit-service';
import { createPrismaAuditRepository } from '../../src/modules/audit/prisma-audit-repository';
import { createPrismaDashboardLayoutStore, DEFAULTS_KEY } from '../../src/modules/dashboard/dashboard-layout-store';
import { createChecklistService } from '../../src/modules/tasks/checklist-service';
import { createPrismaChecklistStore } from '../../src/modules/tasks/prisma-checklist-store';
import type { PrioritiesAnswer, PrioritiesService } from '../../src/modules/dashboard/priorities-service';
import type { Viewer } from '../../src/modules/companies/company-access';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23.4 Smarter Dashboard — each quick action through the routes the page calls (no new permissions):
// Complete (the approval rule, Undo), Reschedule (the start ≤ due rule, Undo, a stale copy), Assign (Undo),
// Approve / Send back, action items' Mark done and Reschedule, the refusals — the list follows each one,
// also without asking fresh (a task event clears the cache) — and the widget arrangements kept in MySQL.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const due = (days: number) => new Date(`${shiftDayKey(today, days)}T00:00:00.000Z`);

let w: CompanyWorld;
let app: CompanyApp;
let priorities: PrioritiesService;
const cols: Record<string, Record<string, string>> = {};
let n = 0;

/** A task written straight to the database — then, as the server's task event would, the cache is cleared. */
async function task(name: string, projectId: string, o: { assignees?: string[]; column?: string; due?: Date | null; start?: Date | null; needsApproval?: boolean } = {}) {
  n += 1;
  const id = (
    await prisma.task.create({
      data: {
        key: `${name}${w.tag.toUpperCase()}-${n}`,
        title: `${name} ${w.tag}`,
        projectId,
        columnId: cols[projectId]![o.column ?? 'TODO']!,
        createdById: w.people.admin,
        dueDate: o.due ?? null,
        startDate: o.start ?? null,
        needsApproval: o.needsApproval ?? false,
        assignees: { create: (o.assignees ?? []).map((userId) => ({ userId })) },
      },
    })
  ).id;
  priorities.changed();
  return id;
}

/** The list as the page reads it: from the cache when there is one (a change must have cleared it). */
const cached = async (v: Viewer) => (await app.get(v, '/dashboard/priorities')) as PrioritiesAnswer;
const rowOf = (a: PrioritiesAnswer, id: string) => a.items.find((r) => r.task?.id === id || r.actionItem?.id === id);
const send = async (method: 'PATCH' | 'PUT' | 'POST' | 'DELETE', v: Viewer, path: string, payload?: unknown) => {
  const res = await app.app.inject({ method, url: `/api/v1${path}`, headers: { authorization: await app.bearer(v) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as { data?: Record<string, unknown>; error?: { code: string; message: string } }) : {} };
};

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  for (const projectId of Object.values(w.projects)) {
    cols[projectId] = { TODO: (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId, category: 'TODO' } })).id };
    let pos = 1;
    for (const category of ['IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'] as const) cols[projectId]![category] = (await prisma.kanbanColumn.create({ data: { projectId, name: category, category, position: pos++ } })).id;
  }
  // amy runs PA (its named manager, on its team); ben runs PB (its owner).
  await prisma.project.update({ where: { id: w.projects.PA }, data: { managerId: w.people.amy, members: { create: { userId: w.people.amy, role: 'MEMBER' } } } });
  const roleNames = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { roles: { select: { role: { select: { name: true } } } } } })).roles.map((r) => r.role.name);
  app = await buildCompanyApp(prisma, (base) => {
    priorities = prioritiesFromBase(prisma, base);
    return {
      // Approvals wired as on the server (who runs the project approves).
      taskService: createTaskService({
        tasks: createPrismaTaskRepository(prisma),
        projects: createPrismaProjectLookup(prisma),
        timeZone: TZ,
        approvals: {
          canApprove: async (userId, projectId) => base.projectAuthz!.canManageProject(userId, await roleNames(userId), projectId),
          columnsOf: (projectId) => prisma.kanbanColumn.findMany({ where: { projectId }, select: { id: true, category: true, position: true, enabled: true } }),
        },
      }),
      assigneeService: createAssigneeService({ repo: createPrismaAssigneeRepository(prisma), taskLookup: createPrismaTaskLookup(prisma) }),
      // 1.23.3 checklists, as on the server (Tick and Reschedule go through PUT /checklist/:itemId).
      checklistService: createChecklistService({ store: createPrismaChecklistStore(prisma), taskLookup: createPrismaTaskLookup(prisma) }),
      dashboardPriorities: priorities,
      dashboardLayouts: createPrismaDashboardLayoutStore(prisma),
      auditService: createAuditService({ audit: createPrismaAuditRepository(prisma) }),
      // As server.ts: every task event clears everyone's cached priorities.
      onTaskEvent: () => priorities.changed(),
    };
  });
});

afterAll(async () => {
  await app?.close();
  if (w) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(w.people) } } });
    await prisma.systemSetting.deleteMany({ where: { key: DEFAULTS_KEY } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

describe('Complete, with Undo', () => {
  it('moves the task to the project’s Done column; the list drops it at once (no fresh ask needed); Undo puts it back', async () => {
    const id = await task('CMPL', w.projects.PA, { assignees: [w.people.ana], due: due(-1) });
    const row = rowOf(await app.get(w.as.ana, '/dashboard/priorities?fresh=1') as PrioritiesAnswer, id)!.task!;
    expect(rowOf(await cached(w.as.ana), id)).toBeDefined();
    const done = await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: row.doneColumnId });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ columnCategory: 'DONE' });
    expect(done.body.data!.completedAt).toBeTruthy();
    expect(rowOf(await cached(w.as.ana), id)).toBeUndefined();
    // Undo: back to the column it came from — open again, and listed again.
    const undo = await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: row.columnId });
    expect(undo.body.data).toMatchObject({ columnId: row.columnId, completedAt: null });
    expect(rowOf(await cached(w.as.ana), id)).toMatchObject({ reason: { code: 'overdue', days: 1 } });
  });

  it('a task that needs approval goes to wait for a project manager (it leaves her list, joins amy’s approvals); Undo withdraws it', async () => {
    const id = await task('APPR', w.projects.PA, { assignees: [w.people.ana], due: due(0), needsApproval: true });
    const row = rowOf(await cached(w.as.ana), id)!.task!;
    const moved = await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: row.doneColumnId });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ columnCategory: 'REVIEW', completedAt: null });
    expect(moved.body.data!.approvalRequestedAt).toBeTruthy();
    expect(rowOf(await cached(w.as.ana), id)).toBeUndefined();
    expect(rowOf(await cached(w.as.amy), id)).toMatchObject({ kind: 'approval', reason: { code: 'approval' } });
    const undo = await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: row.columnId });
    expect(undo.body.data).toMatchObject({ approvalRequestedAt: null, columnId: row.columnId });
    expect(rowOf(await cached(w.as.ana), id)).toMatchObject({ reason: { code: 'due-today' } });
    expect(rowOf(await cached(w.as.amy), id)).toBeUndefined();
  });

  it('review I1: one already in the Review column waits right there — the column it came from is where it is, so the page offers no Undo', async () => {
    const id = await task('INREVIEW', w.projects.PA, { assignees: [w.people.ana], due: due(0), needsApproval: true, column: 'REVIEW' });
    const row = rowOf(await cached(w.as.ana), id)!.task!;
    const moved = await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: row.doneColumnId });
    expect(moved.body.data).toMatchObject({ columnId: row.columnId, columnCategory: 'REVIEW' });
    expect(moved.body.data!.approvalRequestedAt).toBeTruthy();
    // Moving it "back" to the column it is in changes nothing: it still waits (so an Undo would be a lie).
    const again = await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: row.columnId });
    expect(again.body.data!.approvalRequestedAt).toBeTruthy();
  });

  it('refused for a task the person can’t open (403), and nothing changes', async () => {
    const id = await task('HIDDEN', w.projects.PB, { assignees: [w.people.ben], due: due(-1) });
    const res = await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: cols[w.projects.PB]!.DONE });
    expect(res.status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).completedAt).toBeNull();
  });
});

describe('Approve and Send back from the list', () => {
  async function waiting(name: string) {
    const id = await task(name, w.projects.PA, { assignees: [w.people.ana], due: due(-1), needsApproval: true });
    await send('PATCH', w.as.ana, `/tasks/${id}/move`, { columnId: cols[w.projects.PA]!.DONE });
    return rowOf(await cached(w.as.amy), id)!.task!;
  }

  it('Approve: done, off the list', async () => {
    const r = await waiting('OK');
    const res = await send('POST', w.as.amy, `/tasks/${r.id}/approve`, { expectedVersion: r.version });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ columnCategory: 'DONE' });
    expect(rowOf(await cached(w.as.amy), r.id)).toBeUndefined();
  });

  it('Send back needs a reason; then the task is in progress and back on the person’s list', async () => {
    const r = await waiting('BACK');
    expect((await send('POST', w.as.amy, `/tasks/${r.id}/send-back`, { reason: '  ', expectedVersion: r.version })).status).toBe(400);
    const res = await send('POST', w.as.amy, `/tasks/${r.id}/send-back`, { reason: 'Readings missing', expectedVersion: r.version });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ columnCategory: 'IN_PROGRESS', approvalRequestedAt: null });
    expect(rowOf(await cached(w.as.amy), r.id)).toBeUndefined();
    expect(rowOf(await cached(w.as.ana), r.id)).toMatchObject({ reason: { code: 'overdue', days: 1 } });
  });

  it('someone who doesn’t run the project can’t approve (403); a stale copy is refused (409)', async () => {
    const r = await waiting('NOPE');
    expect((await send('POST', w.as.ana, `/tasks/${r.id}/approve`, {})).status).toBe(403);
    expect((await send('POST', w.as.amy, `/tasks/${r.id}/approve`, { expectedVersion: r.version - 1 })).status).toBe(409);
    expect(rowOf(await cached(w.as.amy), r.id)).toBeDefined();
  });
});

describe('Reschedule, with Undo', () => {
  it('moves the due day; the reason follows; Undo puts the day back', async () => {
    const id = await task('RESCH', w.projects.PA, { assignees: [w.people.ana], due: due(-2) });
    const r = rowOf(await cached(w.as.ana), id)!.task!;
    const res = await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: shiftDayKey(today, 1), expectedVersion: r.version });
    expect(res.status).toBe(200);
    expect(rowOf(await cached(w.as.ana), id)).toMatchObject({ reason: { code: 'due-soon', days: 1 } });
    const undo = await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: r.dueDate, expectedVersion: res.body.data!.version });
    expect(undo.status).toBe(200);
    expect(rowOf(await cached(w.as.ana), id)).toMatchObject({ reason: { code: 'overdue', days: 2 }, task: { dueDate: r.dueDate } });
  });

  it('keeps the start ≤ due rule: an earlier day than the start is refused unless the start moves too; Undo puts both back', async () => {
    const id = await task('START', w.projects.PA, { assignees: [w.people.ana], due: due(3), start: due(2) });
    const r = rowOf(await cached(w.as.ana), id)!.task!;
    expect(r.startDate).toBe(shiftDayKey(today, 2));
    expect((await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: today, expectedVersion: r.version })).status).toBe(400);
    const res = await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: today, startDate: today, expectedVersion: r.version });
    expect(res.status).toBe(200);
    expect(rowOf(await cached(w.as.ana), id)).toMatchObject({ reason: { code: 'due-today' }, task: { startDate: today } });
    const undo = await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: r.dueDate, startDate: r.startAt, expectedVersion: res.body.data!.version });
    expect(undo.status).toBe(200);
    const back = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect([back.dueDate?.toISOString().slice(0, 10), back.startDate?.toISOString().slice(0, 10)]).toEqual([r.dueDate, r.startDate]);
    // Tasks scheduled for the future (owner, 10 Nov 2026): its start back on a later day, the not-started
    // task waits on that day's board — out of My Priorities until then.
    expect(back.boardDate?.toISOString()).toBe(`${r.startDate}T12:00:00.000Z`);
    expect(rowOf(await cached(w.as.ana), id)).toBeUndefined();
  });

  it('a repeating task moves only this occurrence (the rule notes the day it replaced); Undo puts the rule back', async () => {
    const rule = { freq: 'WEEKLY', interval: 1, weekdays: [new Date(`${shiftDayKey(today, 1)}T12:00:00Z`).getUTCDay()] };
    const id = await task('REPEAT', w.projects.PA, { assignees: [w.people.ana], due: due(1) });
    await prisma.task.update({ where: { id }, data: { recurrenceRule: rule } });
    priorities.changed();
    const r = rowOf(await cached(w.as.ana), id)!.task!;
    expect(r.recurrenceRule).toEqual(rule);
    const moved = await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: shiftDayKey(today, 3), recurrenceRule: { ...rule, resumeFrom: r.dueDate }, expectedVersion: r.version });
    expect(moved.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).recurrenceRule).toMatchObject({ resumeFrom: r.dueDate });
    const undo = await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: r.dueDate, recurrenceRule: rule, expectedVersion: moved.body.data!.version });
    expect(undo.status).toBe(200);
    const back = await prisma.task.findUniqueOrThrow({ where: { id } });
    expect((back.recurrenceRule as { resumeFrom?: string }).resumeFrom).toBeUndefined();
    expect(back.dueDate!.toISOString().slice(0, 10)).toBe(r.dueDate);
  });

  it('an Undo made from a copy someone has since changed is refused (409), not silently written', async () => {
    const id = await task('STALE', w.projects.PA, { assignees: [w.people.ana], due: due(0) });
    const r = rowOf(await cached(w.as.ana), id)!.task!;
    await send('PUT', w.as.cat, `/tasks/${id}`, { title: 'Changed by cat' });
    expect((await send('PUT', w.as.ana, `/tasks/${id}`, { dueDate: shiftDayKey(today, 1), expectedVersion: r.version })).status).toBe(409);
  });
});

describe('Assign, with Undo', () => {
  it('ben gives PB’s unassigned task to cat: no longer “No one assigned”; Undo takes her off again', async () => {
    const id = await task('NOBODY', w.projects.PB, {});
    expect(rowOf(await cached(w.as.ben), id)).toMatchObject({ reason: { code: 'unassigned' } });
    const res = await send('POST', w.as.ben, `/tasks/${id}/assignees`, { userIds: [w.people.cat] });
    expect(res.status).toBe(200);
    expect(rowOf(await cached(w.as.ben), id)).toBeUndefined();
    expect((await send('DELETE', w.as.ben, `/tasks/${id}/assignees/${w.people.cat}`)).status).toBe(204);
    expect(rowOf(await cached(w.as.ben), id)).toMatchObject({ reason: { code: 'unassigned' } });
  });

  it('refused for someone who can’t open the task, or a person who isn’t on the project’s team', async () => {
    const id = await task('NOBODY2', w.projects.PB, {});
    expect((await send('POST', w.as.ana, `/tasks/${id}/assignees`, { userIds: [w.people.cat] })).status).toBe(403);
    const outsider = await send('POST', w.as.ben, `/tasks/${id}/assignees`, { userIds: [w.people.amy] });
    expect(outsider.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.taskAssignee.count({ where: { taskId: id } })).toBe(0);
  });
});

describe('action items: Mark done and Reschedule, with Undo', () => {
  it('Mark done drops it, Undo (open again) brings it back; Reschedule moves its reason', async () => {
    const id = w.actionItems.MA_ana;
    await prisma.actionItem.update({ where: { id }, data: { dueDate: due(-1) } });
    priorities.changed();
    expect(rowOf(await cached(w.as.ana), id)).toMatchObject({ reason: { code: 'overdue', days: 1 } });
    expect((await send('PATCH', w.as.ana, `/action-items/${id}`, { status: 'COMPLETED' })).status).toBe(200);
    priorities.changed(); // on the server the action item service's change clears it (server.ts)
    expect(rowOf(await cached(w.as.ana), id)).toBeUndefined();
    await send('PATCH', w.as.ana, `/action-items/${id}`, { status: 'OPEN' });
    await send('PATCH', w.as.ana, `/action-items/${id}`, { dueDate: shiftDayKey(today, 2) });
    priorities.changed();
    expect(rowOf(await cached(w.as.ana), id)).toMatchObject({ reason: { code: 'due-soon', days: 2 } });
    await prisma.actionItem.update({ where: { id }, data: { dueDate: null } });
  });

  it('someone else who can’t open its meeting is refused', async () => {
    expect((await send('PATCH', w.as.ben, `/action-items/${w.actionItems.MA_ana}`, { status: 'COMPLETED' })).status).toBe(403);
  });
});

describe('checklist items (1.23.3): Tick and Reschedule, with Undo', () => {
  it('Tick takes a late item off (the checklist event clears the list), Undo brings it back; a parent refuses a tick; Reschedule moves its reason', async () => {
    const host = await task('CLHOST', w.projects.PA, { assignees: [w.people.cat] });
    const cl = await prisma.checklistList.create({ data: { taskId: host, title: 'Steps', position: 0 } });
    const leaf = (await prisma.checklistItem.create({ data: { taskId: host, listId: cl.id, text: 'Torque the bolts', position: 0, assigneeId: w.people.ana, dueDate: due(-1) } })).id;
    const parent = (await prisma.checklistItem.create({ data: { taskId: host, listId: cl.id, text: 'Pressure test', position: 1, assigneeId: w.people.ana, dueDate: due(0) } })).id;
    await prisma.checklistItem.create({ data: { taskId: host, listId: cl.id, parentId: parent, text: 'Fill the line', position: 0, dueDate: due(5) } });
    priorities.changed();
    const ofItem = (a: PrioritiesAnswer, id: string) => a.items.find((r) => r.checklistItem?.id === id);
    try {
      expect(ofItem(await cached(w.as.ana), leaf)).toMatchObject({ reason: { code: 'overdue', days: 1 }, checklistItem: { can: { tick: true } } });
      expect(ofItem(await cached(w.as.ana), parent)).toMatchObject({ reason: { code: 'due-today' }, checklistItem: { can: { tick: false } } });
      expect((await send('PUT', w.as.ana, `/checklist/${leaf}`, { done: true })).status).toBe(200);
      expect(ofItem(await cached(w.as.ana), leaf)).toBeUndefined();
      expect((await send('PUT', w.as.ana, `/checklist/${leaf}`, { done: false })).status).toBe(200);
      expect(ofItem(await cached(w.as.ana), leaf)).toBeDefined();
      // A parent follows its sub-items: its tick is refused.
      const refused = await send('PUT', w.as.ana, `/checklist/${parent}`, { done: true });
      expect(refused.status).toBe(400);
      expect(refused.body.error!.code).toBe('CHECKLIST_PARENT');
      // Reschedule (its real due-date field) and Undo.
      expect((await send('PUT', w.as.ana, `/checklist/${leaf}`, { dueDate: shiftDayKey(today, 2) })).status).toBe(200);
      expect(ofItem(await cached(w.as.ana), leaf)!.reason).toEqual({ code: 'due-soon', days: 2 });
      expect((await send('PUT', w.as.ana, `/checklist/${leaf}`, { dueDate: shiftDayKey(today, -1) })).status).toBe(200);
      expect(ofItem(await cached(w.as.ana), leaf)!.reason).toEqual({ code: 'overdue', days: 1 });
      // Someone who can't open the task can't tick it.
      expect((await send('PUT', w.as.ben, `/checklist/${leaf}`, { done: true })).status).toBeGreaterThanOrEqual(403);
    } finally {
      await prisma.checklistItem.deleteMany({ where: { taskId: host } });
      await prisma.checklistList.deleteMany({ where: { taskId: host } });
    }
  });
});

describe('widget arrangements are kept in MySQL', () => {
  it('a person’s own arrangement round-trips through the users row; Reset to default empties it', async () => {
    const mine = { widgets: [{ id: 'due-soon', hidden: false, size: 'wide' }, { id: 'priorities', hidden: false, size: 'wide' }, { id: 'stats', hidden: true, size: 'small' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'activity', hidden: false, size: 'small' }] };
    const put = await send('PUT', w.as.ana, '/users/me/dashboard-layout', { layout: mine });
    expect(put.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.people.ana }, select: { dashboardLayout: true } })).dashboardLayout).toEqual(mine);
    expect(await app.get(w.as.ana, '/users/me/dashboard-layout')).toMatchObject({ customized: true, layout: mine });
    await send('PUT', w.as.ana, '/users/me/dashboard-layout', { layout: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.people.ana }, select: { dashboardLayout: true } })).dashboardLayout).toBeNull();
    expect(await app.get(w.as.ana, '/users/me/dashboard-layout')).toMatchObject({ customized: false });
  });

  it('the administrators’ two defaults are kept in system_settings and every change is in the audit log', async () => {
    const everyone = { widgets: [{ id: 'priorities', hidden: false, size: 'wide' }, { id: 'activity', hidden: false, size: 'wide' }, { id: 'stats', hidden: false, size: 'wide' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'approvals', hidden: false, size: 'small' }, { id: 'due-soon', hidden: false, size: 'small' }] };
    expect((await send('PUT', w.as.admin, '/settings/dashboard-default', { group: 'everyone', layout: everyone })).status).toBe(200);
    expect(((await prisma.systemSetting.findUniqueOrThrow({ where: { key: DEFAULTS_KEY } })).value as { everyone: unknown }).everyone).toEqual(everyone);
    // ben (runs PB) follows it, with Approvals; ana can't approve: without it.
    expect(((await app.get(w.as.ben, '/users/me/dashboard-layout')) as { layout: unknown }).layout).toEqual(everyone);
    expect(((await app.get(w.as.ana, '/users/me/dashboard-layout')) as { layout: { widgets: { id: string }[] } }).layout.widgets.map((x) => x.id)).toEqual(['priorities', 'activity', 'stats', 'open-tasks', 'due-soon']);
    const log = await prisma.auditLog.findFirst({ where: { userId: w.people.admin, action: 'dashboard.default.update' }, orderBy: { createdAt: 'desc' } });
    expect(log).toMatchObject({ module: 'settings', entityId: 'everyone' });
    // The generic settings list never shows it.
    expect(((await app.get(w.as.admin, '/system-settings')) as { key: string }[]).map((s) => s.key)).not.toContain(DEFAULTS_KEY);
    expect((await send('PUT', w.as.ana, '/settings/dashboard-default', { group: 'everyone', layout: null })).status).toBe(403);
    await send('PUT', w.as.admin, '/settings/dashboard-default', { group: 'everyone', layout: null });
  });
});
