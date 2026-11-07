import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { portabilityProblems } from '../../src/lib/sql-portability';
import type { PrioritiesAnswer, PriorityRow } from '../../src/modules/dashboard/priorities-service';
import { createActionItemPrioritySource, priorityProbe } from '../../src/modules/dashboard/prisma-priority-sources';
import { createActionItemService } from '../../src/modules/meetings/action-item-service';
import { createPrismaActionItemRepository } from '../../src/modules/meetings/prisma-action-item-repository';
import type { Viewer } from '../../src/modules/companies/company-access';
import { prioritiesFromBase } from './dashboard-helpers';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23.4 Smarter Dashboard — "My Priorities Today" on a real database, through GET /dashboard/priorities:
// every inclusion rule and the order, the company pick and "Show my projects only", managers vs
// employees, approvals, action items, both kinds of blocked, what stays hidden, and MariaDB-safe SQL.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const due = (days: number) => new Date(`${shiftDayKey(today, days)}T00:00:00.000Z`);

let w: CompanyWorld;
let app: CompanyApp;
const cols: Record<string, Record<string, string>> = {};
let n = 0;

async function task(name: string, projectId: string, o: { assignees?: string[]; column?: string; due?: Date | null; priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; completed?: boolean; waiting?: boolean; deleted?: boolean } = {}) {
  n += 1;
  const t = await prisma.task.create({
    data: {
      key: `${name}${w.tag.toUpperCase()}-${n}`,
      title: `${name} ${w.tag}`,
      projectId,
      columnId: cols[projectId]![o.column ?? 'TODO']!,
      createdById: w.people.admin,
      priority: o.priority ?? 'NORMAL',
      dueDate: o.due ?? null,
      completedAt: o.completed ? new Date() : null,
      approvalRequestedAt: o.waiting ? new Date() : null,
      needsApproval: o.waiting ?? false,
      deletedAt: o.deleted ? new Date() : null,
      assignees: { create: (o.assignees ?? []).map((userId) => ({ userId })) },
    },
  });
  return t.id;
}

const list = async (viewer: Viewer, headers: Record<string, string> = {}) => (await app.get(viewer, '/dashboard/priorities?fresh=1', headers)) as PrioritiesAnswer;
const row = (a: PrioritiesAnswer, taskId: string) => a.items.find((r) => r.task?.id === taskId || r.actionItem?.id === taskId);
const has = (a: PrioritiesAnswer, id: string) => Boolean(row(a, id));

type Named = 'blockedStatus' | 'blocker' | 'blocks' | 'catA' | 'catB' | 'deletedLate' | 'dep' | 'doneBlocker' | 'doneLate' | 'far' | 'freed' | 'hiddenBlocker' | 'late2' | 'late5low' | 'onlyHidden' | 'pbBenLate' | 'pbBlocked' | 'pbLate2' | 'pbLate4' | 'pbNobody' | 'soon2' | 'today' | 'urgent' | 'waitingLate';
const T = {} as Record<Named, string>;

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  // Every world project gets the board's other stages (the world made only To Do).
  for (const projectId of Object.values(w.projects)) {
    const todo = (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId, category: 'TODO' } })).id;
    cols[projectId] = { TODO: todo };
    let pos = 1;
    for (const category of ['IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'] as const) {
      cols[projectId]![category] = (await prisma.kanbanColumn.create({ data: { projectId, name: category, category, position: pos++ } })).id;
    }
  }
  // The world's own tasks get no date, so they are on nobody's list.
  // ben runs PB (its owner); amy runs PA (made its named manager here); ana and cat are team members.
  await prisma.project.update({ where: { id: w.projects.PA }, data: { managerId: w.people.amy, members: { create: { userId: w.people.amy, role: 'MEMBER' } } } });

  const { ana, cat, ben } = w.people;
  const { PA, PB, PAB } = w.projects;
  T.late2 = await task('LATE2', PA, { assignees: [ana], due: due(-2) });
  T.late5low = await task('LATE5', PA, { assignees: [ana], due: due(-5), priority: 'LOW' });
  T.today = await task('TODAY', PA, { assignees: [ana], due: due(0) });
  T.soon2 = await task('SOON2', PA, { assignees: [ana], due: due(2) });
  T.far = await task('FAR', PA, { assignees: [ana], due: due(10) });
  T.urgent = await task('URGENT', PA, { assignees: [ana], priority: 'URGENT' });
  T.blockedStatus = await task('BLKSTATUS', PA, { assignees: [ana], column: 'BLOCKED' });
  T.doneLate = await task('DONELATE', PA, { assignees: [ana], due: due(-3), column: 'DONE', completed: true });
  T.waitingLate = await task('WAITLATE', PA, { assignees: [ana], due: due(-3), column: 'REVIEW', waiting: true });
  T.deletedLate = await task('DELLATE', PA, { assignees: [ana], due: due(-3), deleted: true });
  // Dependencies: ana's DEP waits on an open task of cat's (visible to ana) and on a hidden one in PB.
  T.dep = await task('DEP', PA, { assignees: [ana] });
  T.blocker = await task('BLOCKER', PA, { assignees: [cat] });
  T.hiddenBlocker = await task('HIDBLK', PB, { assignees: [ben] });
  await prisma.taskDependency.create({ data: { taskId: T.dep, dependsOnTaskId: T.blocker } });
  // ana's BLOCKS holds up two open tasks she can open, one done one, and one she can't open.
  T.blocks = await task('BLOCKS', PA, { assignees: [ana], due: due(0) });
  for (const [name, projectId, extra] of [['W1', PA, {}], ['W2', PAB, {}], ['WDONE', PA, { column: 'DONE', completed: true }], ['WHID', PB, {}]] as const) {
    const waiting = await task(name, projectId, { assignees: [cat], ...extra });
    await prisma.taskDependency.create({ data: { taskId: waiting, dependsOnTaskId: T.blocks } });
  }
  // A task blocked only by something hidden is not "blocked" for ana.
  T.onlyHidden = await task('ONLYHID', PA, { assignees: [ana] });
  await prisma.taskDependency.create({ data: { taskId: T.onlyHidden, dependsOnTaskId: T.hiddenBlocker } });
  // A blocker that is done blocks nothing.
  T.doneBlocker = await task('DONEBLK', PA, { assignees: [cat], column: 'DONE', completed: true });
  T.freed = await task('FREED', PA, { assignees: [ana] });
  await prisma.taskDependency.create({ data: { taskId: T.freed, dependsOnTaskId: T.doneBlocker } });

  // PB (ben runs it): a task with no one assigned, cat's 4 and 2 days late, cat's in a Blocked column.
  T.pbNobody = await task('PBNOBODY', PB, {});
  T.pbLate4 = await task('PBLATE4', PB, { assignees: [cat], due: due(-4) });
  T.pbLate2 = await task('PBLATE2', PB, { assignees: [cat], due: due(-2) });
  T.pbBlocked = await task('PBBLOCKED', PB, { assignees: [cat], column: 'BLOCKED' });
  T.pbBenLate = await task('PBBENLATE', PB, { assignees: [ben], due: due(-1) });
  // cat in both companies: late work in each.
  T.catA = await task('CATA', PA, { assignees: [cat], due: due(-1) });
  T.catB = await task('CATB', PB, { assignees: [cat], due: due(-1) });

  app = await buildCompanyApp(prisma, (base) => ({ dashboardPriorities: prioritiesFromBase(prisma, base) }));
});

afterAll(async () => {
  await app?.close();
  if (w) {
    await prisma.taskDependency.deleteMany({ where: { task: { projectId: { in: Object.values(w.projects) } } } });
    await dropCompanyWorld(prisma, w);
  }
  await prisma.$disconnect();
});

describe('an employee’s own open tasks (ana)', () => {
  it('lists exactly the open tasks with a reason, most urgent first, each once with its strongest reason', async () => {
    const a = await list(w.as.ana);
    const mine = a.items.filter((r) => r.kind === 'task').map((r) => r.task!.id);
    expect(mine).toEqual([T.late5low, T.late2, T.blocks, T.today, T.urgent, T.blockedStatus, T.dep, T.soon2]);
    expect(row(a, T.late5low)).toMatchObject({ reason: { code: 'overdue', days: 5 }, group: 1, chips: ['overdue'] });
    expect(row(a, T.blocks)).toMatchObject({ reason: { code: 'blocking', count: 2 }, also: [{ code: 'due-today' }] });
    expect(row(a, T.urgent)!.reason).toEqual({ code: 'urgent' });
    expect(row(a, T.soon2)!.reason).toEqual({ code: 'due-soon', days: 2 });
    expect(a.manager).toBe(false);
    expect(a.counts.team).toBe(0);
  });

  it('leaves out done, waiting-for-approval, deleted and far-off tasks, and other people’s work', async () => {
    const a = await list(w.as.ana);
    for (const id of [T.far, T.doneLate, T.waitingLate, T.deletedLate, T.freed, T.pbNobody, T.pbLate4, T.catA, w.tasks.TA1]) expect(has(a, id), id).toBe(false);
  });

  it('both kinds of blocked: a Blocked column, and waiting on an open task — named only when she can open it', async () => {
    const a = await list(w.as.ana);
    expect(row(a, T.blockedStatus)).toMatchObject({ reason: { code: 'blocked-status' }, chips: ['blocked'] });
    expect(row(a, T.blockedStatus)!.task!.can).toEqual({ complete: true, reschedule: true, assign: true, approve: false });
    const dep = row(a, T.dep)!;
    expect(dep.reason.code).toBe('blocked-by');
    expect(dep.task!.blockers).toEqual([{ id: T.blocker, key: expect.stringMatching(/^BLOCKER/) }]);
    // Waiting on another task: Open and Reschedule only (design call 2).
    expect(dep.task!.can).toEqual({ complete: false, reschedule: true, assign: false, approve: false });
    // Blocked only by a task in a project she can't open: nothing at all.
    expect(has(a, T.onlyHidden)).toBe(false);
    expect(a.counts.blocked).toBe(2);
  });

  it('a row says what Complete needs: the project’s Done column, the column it came from, its version and dates', async () => {
    const r = row(await list(w.as.ana), T.late2)!.task!;
    expect(r.doneColumnId).toBe(cols[w.projects.PA]!.DONE);
    expect(r.columnId).toBe(cols[w.projects.PA]!.TODO);
    expect(r.dueDate).toBe(shiftDayKey(today, -2));
    expect(r.project).toMatchObject({ id: w.projects.PA, name: expect.stringContaining('Project PA') });
    expect(r.assignees).toEqual([{ id: w.people.ana, name: expect.stringContaining('Ana') }]);
    expect(typeof r.version).toBe('number');
  });

  it('an archived project’s tasks are left out (nothing there can be done)', async () => {
    const archived = await task('ARCH', w.projects.PA, { assignees: [w.people.ana], due: due(-1) });
    expect(has(await list(w.as.ana), archived)).toBe(true);
    await prisma.project.update({ where: { id: w.projects.PA }, data: { status: 'ARCHIVED' } });
    try {
      expect(has(await list(w.as.ana), archived)).toBe(false);
    } finally {
      await prisma.project.update({ where: { id: w.projects.PA }, data: { status: 'ACTIVE' } });
      await prisma.task.update({ where: { id: archived }, data: { deletedAt: new Date() } });
    }
  });
});

describe('the picked company', () => {
  it('cat (in Alpha and Beta) sees both companies’ late work; with Alpha picked, only Alpha’s', async () => {
    const all = await list(w.as.cat);
    expect(has(all, T.catA)).toBe(true);
    expect(has(all, T.catB)).toBe(true);
    const alpha = await list(w.as.cat, { 'x-company-id': w.companies.A });
    expect(has(alpha, T.catA)).toBe(true);
    expect(has(alpha, T.catB)).toBe(false);
    const beta = await list(w.as.cat, { 'x-company-id': w.companies.B });
    expect(has(beta, T.catB)).toBe(true);
    expect(has(beta, T.catA)).toBe(false);
  });

  it('a company that isn’t hers is refused, not widened', async () => {
    const res = await app.getRaw(w.as.ana, '/dashboard/priorities', { 'x-company-id': w.companies.B });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('managers and administrators: the projects they run (owner 2)', () => {
  it('ben (runs PB) sees its task with no one assigned, cat’s 4-day-late and Blocked tasks — not the 2-day-late one', async () => {
    const b = await list(w.as.ben);
    expect(b.manager).toBe(true);
    expect(row(b, T.pbNobody)).toMatchObject({ reason: { code: 'unassigned' }, group: 7, chips: ['team'] });
    expect(row(b, T.pbLate4)).toMatchObject({ reason: { code: 'team-overdue', days: 4 }, group: 6, chips: ['overdue', 'team'] });
    expect(row(b, T.pbLate4)!.task!.assignees.map((p) => p.id)).toEqual([w.people.cat]);
    expect(row(b, T.pbBlocked)).toMatchObject({ reason: { code: 'team-blocked' }, chips: ['blocked', 'team'] });
    expect(has(b, T.pbLate2)).toBe(false);
    // His own late task is his own row (group 1), not a team row.
    expect(row(b, T.pbBenLate)).toMatchObject({ reason: { code: 'overdue', days: 1 }, group: 1 });
    // The hidden blocker in PB is his, and has no reason.
    expect(has(b, T.hiddenBlocker)).toBe(false);
    expect(b.counts.team).toBe(3);
  });

  it('a team member who doesn’t run the project sees none of it', async () => {
    const c = await list(w.as.cat);
    expect(c.manager).toBe(false);
    expect(has(c, T.pbNobody)).toBe(false);
    // cat's own 4-day-late task is hers (group 1).
    expect(row(c, T.pbLate4)).toMatchObject({ reason: { code: 'overdue', days: 4 }, group: 1 });
  });

  it('an administrator: every project’s team rows; with “Show my projects only” on, only the projects they’re on (their own tasks always)', async () => {
    const ownLate = await task('ADMLATE', w.projects.PC, { assignees: [w.people.admin], due: due(-1) });
    try {
      const a = await list(w.as.admin);
      expect(a.manager).toBe(true);
      expect(has(a, T.pbNobody)).toBe(true);
      expect(has(a, T.pbLate4)).toBe(true);
      await prisma.user.update({ where: { id: w.people.admin }, data: { myProjectsOnly: true } });
      const mine = await list(w.as.admin);
      expect(has(mine, T.pbNobody)).toBe(false);
      expect(has(mine, T.pbLate4)).toBe(false);
      // PC's company is archived: its tasks are no one's to act on, own or not.
      expect(has(mine, ownLate)).toBe(false);
    } finally {
      await prisma.user.update({ where: { id: w.people.admin }, data: { myProjectsOnly: false } });
      await prisma.task.update({ where: { id: ownLate }, data: { deletedAt: new Date() } });
    }
  });

  it('an administrator’s own task stays on their list with “Show my projects only” on', async () => {
    const own = await task('ADMOWN', w.projects.PB, { assignees: [w.people.admin], due: due(0) });
    await prisma.user.update({ where: { id: w.people.admin }, data: { myProjectsOnly: true } });
    try {
      expect(row(await list(w.as.admin), own)).toMatchObject({ reason: { code: 'due-today' } });
    } finally {
      await prisma.user.update({ where: { id: w.people.admin }, data: { myProjectsOnly: false } });
      await prisma.task.update({ where: { id: own }, data: { deletedAt: new Date() } });
    }
  });
});

describe('approvals waiting for the person', () => {
  it('ben sees cat’s finished PB task waiting for his OK (group 2, who finished it); cat and ana don’t', async () => {
    const waiting = await task('WAITPB', w.projects.PB, { assignees: [w.people.cat], column: 'REVIEW', waiting: true, due: due(-6) });
    await prisma.task.update({ where: { id: waiting }, data: { approvalRequestedById: w.people.cat } });
    try {
      const b = await list(w.as.ben);
      const r = row(b, waiting)!;
      expect(r).toMatchObject({ kind: 'approval', reason: { code: 'approval' }, group: 2, chips: ['approvals'] });
      expect(r.task!.requestedBy).toMatchObject({ id: w.people.cat });
      expect(r.task!.can).toEqual({ complete: false, reschedule: false, assign: false, approve: true });
      expect(b.counts.approvals).toBe(1);
      // Waiting, it is nobody's late task.
      expect(has(await list(w.as.cat), waiting)).toBe(false);
      expect(has(await list(w.as.ana), waiting)).toBe(false);
      // With Alpha picked, PB's approval isn't ben's to see there — ben has no Alpha: refused; the admin with Alpha picked doesn't see it.
      expect(has(await list(w.as.admin, { 'x-company-id': w.companies.A }), waiting)).toBe(false);
      expect(has(await list(w.as.admin, { 'x-company-id': w.companies.B }), waiting)).toBe(true);
    } finally {
      await prisma.task.update({ where: { id: waiting }, data: { deletedAt: new Date() } });
    }
  });
});

describe('meeting action items', () => {
  it('overdue or due within 3 days, naming the meeting; no date, done, or later: not listed', async () => {
    const id = w.actionItems.MA_ana;
    expect(has(await list(w.as.ana), id)).toBe(false); // no due date
    await prisma.actionItem.update({ where: { id }, data: { dueDate: due(-1) } });
    let a = await list(w.as.ana);
    expect(row(a, id)).toMatchObject({ kind: 'action-item', reason: { code: 'overdue', days: 1 }, actionItem: { id, meeting: { id: w.meetings.MA, title: expect.stringContaining('MA') }, can: { done: true, reschedule: true } } });
    await prisma.actionItem.update({ where: { id }, data: { dueDate: due(3) } });
    expect(row(await list(w.as.ana), id)!.reason).toEqual({ code: 'due-soon', days: 3 });
    await prisma.actionItem.update({ where: { id }, data: { dueDate: due(4) } });
    expect(has(await list(w.as.ana), id)).toBe(false);
    await prisma.actionItem.update({ where: { id }, data: { dueDate: due(0), status: 'COMPLETED' } });
    expect(has(await list(w.as.ana), id)).toBe(false);
    // Tracked as one of her listed tasks: the task stands for it.
    await prisma.actionItem.update({ where: { id }, data: { status: 'OPEN', taskId: T.late2 } });
    a = await list(w.as.ana);
    expect(has(a, id)).toBe(false);
    expect(has(a, T.late2)).toBe(true);
    await prisma.actionItem.update({ where: { id }, data: { dueDate: null, taskId: null } });
  });

  it('an invitee from another company (bob) has his item, naming the meeting; with his own company picked, an Alpha meeting’s item isn’t listed', async () => {
    const id = w.actionItems.MA_bob;
    await prisma.actionItem.update({ where: { id }, data: { dueDate: due(0) } });
    try {
      expect(row(await list(w.as.bob), id)).toMatchObject({ reason: { code: 'due-today' }, actionItem: { meeting: { id: w.meetings.MA } } });
      expect(has(await list(w.as.bob, { 'x-company-id': w.companies.B }), id)).toBe(false);
    } finally {
      await prisma.actionItem.update({ where: { id }, data: { dueDate: null } });
    }
  });
});

describe('checklist items given to the person (1.23.3)', () => {
  it('open items overdue or due within 3 days; a parent is listed but can’t be ticked; done, far, undated and other people’s are not', async () => {
    const host = await task('CLHOST', w.projects.PA, { assignees: [w.people.cat] });
    const checklist = await prisma.checklistList.create({ data: { taskId: host, title: `Commissioning ${w.tag}`, position: 0 } });
    let pos = 0;
    const item = async (text: string, o: { assignee?: string | null; due?: Date | null; done?: boolean; parentId?: string } = {}) =>
      (await prisma.checklistItem.create({ data: { taskId: host, listId: checklist.id, text: `${text} ${w.tag}`, position: pos++, assigneeId: o.assignee === undefined ? w.people.ana : o.assignee, dueDate: o.due ?? null, done: o.done ?? false, parentId: o.parentId ?? null } })).id;
    const late = await item('Torque the bolts', { due: due(-2) });
    const soon = await item('Fit the gauge', { due: due(2) });
    const far = await item('Paint the rail', { due: due(10) });
    const done = await item('Clean the site', { due: due(-1), done: true });
    const undated = await item('Order gaskets');
    const parent = await item('Pressure test', { due: due(-1) });
    const child = await item('Fill the line', { assignee: w.people.cat, due: due(10), parentId: parent });
    const cats = await item('Cat’s step', { assignee: w.people.cat, due: due(-1) });
    try {
      const a = await list(w.as.ana);
      const ids = a.items.filter((r) => r.kind === 'checklist-item').map((r) => r.checklistItem!.id);
      expect(ids.sort()).toEqual([late, parent, soon].sort());
      const lateRow = a.items.find((r) => r.checklistItem?.id === late)!;
      expect(lateRow).toMatchObject({ kind: 'checklist-item', reason: { code: 'overdue', days: 2 }, group: 1, chips: ['overdue'] });
      expect(lateRow.checklistItem).toMatchObject({ text: `Torque the bolts ${w.tag}`, dueDate: shiftDayKey(today, -2), listTitle: `Commissioning ${w.tag}`, task: { id: host, title: `CLHOST ${w.tag}`, projectId: w.projects.PA }, can: { tick: true, reschedule: true } });
      expect(a.items.find((r) => r.checklistItem?.id === soon)!.reason).toEqual({ code: 'due-soon', days: 2 });
      // A parent follows its sub-items: listed (it's late) but no tick.
      expect(a.items.find((r) => r.checklistItem?.id === parent)!.checklistItem!.can).toEqual({ tick: false, reschedule: true });
      expect(a.watch).toContain(w.projects.PA);
      // cat's own late step is hers; the sub-item due in 10 days isn't.
      const c = await list(w.as.cat);
      expect(c.items.filter((r) => r.kind === 'checklist-item').map((r) => r.checklistItem!.id)).toEqual([cats]);
      for (const id of [far, done, undated, child]) expect(a.items.some((r) => r.checklistItem?.id === id), id).toBe(false);
    } finally {
      await prisma.checklistItem.deleteMany({ where: { taskId: host } });
      await prisma.checklistList.deleteMany({ where: { taskId: host } });
      await prisma.task.update({ where: { id: host }, data: { deletedAt: new Date() } });
    }
  });

  it('a finished task’s items, an archived project’s, and another company’s (with a pick) are left out', async () => {
    const doneHost = await task('CLDONE', w.projects.PA, { assignees: [w.people.cat], column: 'DONE', completed: true });
    const liveHost = await task('CLLIVE', w.projects.PA, { assignees: [w.people.cat] });
    const pbHost = await task('CLPB', w.projects.PB, { assignees: [w.people.ben] });
    const mk = async (taskId: string, assigneeId: string) => {
      const l = await prisma.checklistList.create({ data: { taskId, title: 'Steps', position: 0 } });
      return (await prisma.checklistItem.create({ data: { taskId, listId: l.id, text: `step ${taskId}`, position: 0, assigneeId, dueDate: due(0) } })).id;
    };
    const inDone = await mk(doneHost, w.people.ana);
    const inLive = await mk(liveHost, w.people.ana);
    const catB = await mk(pbHost, w.people.cat);
    const has = (a: PrioritiesAnswer, id: string) => a.items.some((r) => r.checklistItem?.id === id);
    try {
      const a = await list(w.as.ana);
      expect(has(a, inDone)).toBe(false);
      expect(has(a, inLive)).toBe(true);
      expect(has(await list(w.as.cat), catB)).toBe(true);
      expect(has(await list(w.as.cat, { 'x-company-id': w.companies.A }), catB)).toBe(false);
      await prisma.project.update({ where: { id: w.projects.PA }, data: { status: 'ARCHIVED' } });
      expect(has(await list(w.as.ana), inLive)).toBe(false);
    } finally {
      await prisma.project.update({ where: { id: w.projects.PA }, data: { status: 'ACTIVE' } });
      for (const t of [doneHost, liveHost, pbHost]) {
        await prisma.checklistItem.deleteMany({ where: { taskId: t } });
        await prisma.checklistList.deleteMany({ where: { taskId: t } });
        await prisma.task.update({ where: { id: t }, data: { deletedAt: new Date() } });
      }
    }
  });
});

describe('review I5: an item due later is never looked at', () => {
  it('only the meetings of items with a date reason are checked, all at once', async () => {
    const later = await prisma.meeting.create({ data: { title: `Later ${w.tag}`, projectId: w.projects.PA, organizerId: w.people.ana, createdById: w.people.ana, startAt: new Date(), status: 'SCHEDULED' } });
    const soonItem = await prisma.actionItem.create({ data: { meetingId: w.meetings.MA, projectId: w.projects.PA, description: `soon ${w.tag}`, assigneeId: w.people.ana, createdById: w.people.ana, dueDate: due(1) } });
    const laterItem = await prisma.actionItem.create({ data: { meetingId: later.id, projectId: w.projects.PA, description: `later ${w.tag}`, assigneeId: w.people.ana, createdById: w.people.ana, dueDate: due(20) } });
    try {
      const asked: string[] = [];
      const source = createActionItemPrioritySource({
        prisma,
        actionItems: createActionItemService({ actionItems: createPrismaActionItemRepository(prisma), timeZone: TZ }),
        canOpenMeeting: async (_v, meetingId) => {
          asked.push(meetingId);
          return true;
        },
      });
      const rows = await source.collect({ viewer: w.as.ana, pick: null, today, timeZone: TZ });
      expect(rows.map((r) => r.id)).toContain(soonItem.id);
      expect(rows.map((r) => r.id)).not.toContain(laterItem.id);
      expect(asked).toEqual([w.meetings.MA]);
    } finally {
      await prisma.actionItem.deleteMany({ where: { id: { in: [soonItem.id, laterItem.id] } } });
      await prisma.meeting.delete({ where: { id: later.id } });
    }
  });
});

describe('nothing hidden leaks', () => {
  it('no row, blocker, project or count of a project the person can’t open', async () => {
    const a = await list(w.as.ana);
    const projects = new Set(a.items.map((r: PriorityRow) => r.task?.project.id ?? r.actionItem?.projectId).filter(Boolean));
    expect([...projects].every((p) => p === w.projects.PA || p === w.projects.PAB)).toBe(true);
    const blockerIds = a.items.flatMap((r) => r.task?.blockers.map((b) => b.id) ?? []);
    expect(blockerIds).not.toContain(T.hiddenBlocker);
    expect(a.watch).not.toContain(w.projects.PB);
    expect(JSON.stringify(a)).not.toContain('HIDBLK');
    expect(JSON.stringify(a)).not.toContain('WHID');
  });
});

describe('the SQL is portable to MariaDB, and quick', () => {
  it('every statement the priorities send (several people, picks, the start-up probe) holds nothing MariaDB reads otherwise or refuses', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    try {
      const own = await buildCompanyApp(client, (base) => ({ dashboardPriorities: prioritiesFromBase(client, base) }));
      await prisma.actionItem.update({ where: { id: w.actionItems.MA_ana }, data: { dueDate: due(0) } });
      try {
        for (const v of [w.as.ana, w.as.ben, w.as.cat, w.as.admin]) await own.get(v, '/dashboard/priorities?fresh=1');
        await own.get(w.as.cat, '/dashboard/priorities?fresh=1', { 'x-company-id': w.companies.A });
        await priorityProbe(client, '~database-check~', TZ);
      } finally {
        await own.close();
        await prisma.actionItem.update({ where: { id: w.actionItems.MA_ana }, data: { dueDate: null } });
      }
      expect(sent.some((s) => /task_dependencies/.test(s))).toBe(true);
      expect(sent.some((s) => /kanban_columns/.test(s))).toBe(true);
      expect(sent.some((s) => /action_items/.test(s))).toBe(true);
      expect(sent.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`))).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });

  it('2,000 open tasks in one person’s scope: under 300 ms (design §Performance, measured)', async () => {
    const PERF = `PERF${w.tag.toUpperCase()}`;
    const p = await prisma.project.create({
      data: { code: PERF, name: `Perf ${w.tag}`, status: 'ACTIVE', createdById: w.people.admin, ownerId: w.people.ana, mainCompanyId: w.companies.A, companies: { create: { companyId: w.companies.A } }, members: { create: { userId: w.people.ana } } },
    });
    const todo = (await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To Do', category: 'TODO', position: 0 } })).id;
    await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 1 } });
    try {
      const rows = Array.from({ length: 2000 }, (_, i) => ({
        key: `${PERF}-${i + 1}`,
        title: `Perf ${i}`,
        projectId: p.id,
        columnId: todo,
        createdById: w.people.admin,
        dueDate: due((i % 12) - 6),
        priority: i % 17 === 0 ? ('URGENT' as const) : ('NORMAL' as const),
      }));
      await prisma.task.createMany({ data: rows });
      const ids = (await prisma.task.findMany({ where: { projectId: p.id }, select: { id: true } })).map((t) => t.id);
      // Half are hers; the rest have no one (team rows for her: she owns the project).
      await prisma.taskAssignee.createMany({ data: ids.slice(0, 1000).map((taskId) => ({ taskId, userId: w.people.ana })) });
      await list(w.as.ana); // warm up
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const a = await list(w.as.ana);
        times.push(performance.now() - t0);
        expect(a.total).toBeGreaterThan(1500);
        expect(a.items).toHaveLength(300);
      }
      const best = Math.min(...times);
      console.log(`[dashboard] 2,000 open tasks in scope: ${times.map((t) => t.toFixed(0)).join(' / ')} ms`);
      expect(best).toBeLessThan(300);
    } finally {
      await prisma.task.deleteMany({ where: { projectId: p.id } });
      await prisma.kanbanColumn.deleteMany({ where: { projectId: p.id } });
      await prisma.projectCompany.deleteMany({ where: { projectId: p.id } });
      await prisma.project.delete({ where: { id: p.id } });
    }
  });
});
