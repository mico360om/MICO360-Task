import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaTimelineSource } from '../../src/modules/planning/prisma-timeline-source';
import { createPrismaWorkloadStore } from '../../src/modules/planning/prisma-workload-store';
import { loadWorkload } from '../../src/modules/planning/workload-service';
import { resolveWorkloadScope } from '../../src/modules/planning/workload';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const timeline = createPrismaTimelineSource(prisma);
const workload = createPrismaWorkloadStore(prisma);
const CODES = ['PLONE', 'PLTWO', 'PLOLD', 'PLDONE'];
const EMAILS = ['pl-ada@mico360.test', 'pl-bo@mico360.test', 'pl-cy@mico360.test', 'pl-di@mico360.test', 'pl-ed@mico360.test', 'pl-fay@mico360.test'];
const ids: Record<string, string> = {};
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

async function cleanup() {
  const ps = await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } });
  const pids = ps.map((p) => p.id);
  await prisma.meeting.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.taskAssignee.deleteMany({ where: { task: { projectId: { in: pids } } } });
  await prisma.task.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.project.deleteMany({ where: { id: { in: pids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
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
  const user = async (key: string, firstName: string, extra: Record<string, unknown> = {}) => {
    const email = `pl-${key}@mico360.test`;
    ids[key] = (await prisma.user.create({ data: { email, username: `pl-${key}`, passwordHash: 'x', firstName, lastName: 'Plan', ...extra } })).id;
  };
  await user('ada', 'Ada');
  await user('bo', 'Bo');
  await user('cy', 'Cy');
  await user('di', 'Di', { status: 'INACTIVE' });
  await user('ed', 'Ed', { deletedAt: new Date() });
  await user('fay', 'Fay');
  const proj = async (key: string, code: string, extra: Record<string, unknown> = {}) => {
    ids[key] = (await prisma.project.create({ data: { code, name: `Plan ${key}`, createdById: ids.ada!, ...extra } })).id;
  };
  await proj('one', 'PLONE', { ownerId: ids.ada, status: 'ACTIVE' });
  await proj('two', 'PLTWO', { ownerId: ids.fay, managerId: ids.bo, status: 'PLANNING' });
  await proj('old', 'PLOLD', { managerId: ids.bo, status: 'ARCHIVED' });
  await proj('fin', 'PLDONE', { managerId: ids.fay, status: 'COMPLETED' });
  await prisma.projectMember.createMany({
    data: [
      { projectId: ids.one!, userId: ids.bo!, role: 'MANAGER' },
      { projectId: ids.one!, userId: ids.cy! },
      { projectId: ids.one!, userId: ids.di! }, // deactivated: not on the team any more
      { projectId: ids.two!, userId: ids.cy! },
    ],
  });
  const col = async (projectKey: string, name: string, category: 'IN_PROGRESS' | 'DONE', position: number) =>
    (await prisma.kanbanColumn.create({ data: { projectId: ids[projectKey]!, name, category, position } })).id;
  const doing = await col('one', 'Doing', 'IN_PROGRESS', 0);
  const done = await col('one', 'Done', 'DONE', 1);
  const doingTwo = await col('two', 'Doing', 'IN_PROGRESS', 0);
  const doingFin = await col('fin', 'Doing', 'IN_PROGRESS', 0);
  let n = 0;
  const task = async (columnId: string, projectKey: string, extra: Record<string, unknown> = {}, who: string[] = []) => {
    n += 1;
    const t = await prisma.task.create({ data: { key: `PL-${n}`, title: `Task ${n}`, projectId: ids[projectKey]!, columnId, createdById: ids.ada!, ...extra } });
    for (const k of who) await prisma.taskAssignee.create({ data: { taskId: t.id, userId: ids[k]! } });
    return t.id;
  };
  ids.t1 = await task(doing, 'one', { dueDate: day('2026-10-28') }, ['cy']); // in the week
  ids.t2 = await task(doing, 'one', { dueDate: day('2026-10-28'), priority: 'LOW' }, ['cy', 'bo']); // shared
  ids.t3 = await task(doing, 'one', { dueDate: day('2026-10-01') }, ['cy']); // overdue
  await task(done, 'one', { dueDate: day('2026-10-28') }, ['cy']); // done (Done column)
  await task(doing, 'one', { dueDate: day('2026-10-28'), completedAt: new Date() }, ['cy']); // done (completed)
  await task(doing, 'one', { dueDate: day('2026-10-28'), deletedAt: new Date() }, ['cy']); // deleted
  await task(doing, 'one', { dueDate: day('2027-03-01') }, ['cy']); // after the window
  ids.m1 = await task(done, 'one', { dueDate: day('2026-10-10'), isMilestone: true, title: 'Kick-off' }); // reached
  ids.m2 = await task(doing, 'one', { dueDate: day('2026-11-06'), isMilestone: true, title: 'Beta build' });
  ids.t4 = await task(doingTwo, 'two', { dueDate: day('2026-10-29') }, ['cy']);
  ids.t5 = await task(doingFin, 'fin', { dueDate: day('2026-10-28') }, ['cy']); // a completed project's open task
  const meeting = (title: string, startAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.meeting.create({ data: { title, status: 'SCHEDULED', projectId: ids.one!, startAt, organizerId: ids.ada!, createdById: ids.ada!, ...extra } });
  ids.meet = (await meeting('Weekly sync', new Date('2026-10-27T06:00:00Z'))).id;
  await meeting('Cancelled', new Date('2026-10-27T08:00:00Z'), { status: 'CANCELLED' });
  await meeting('Deleted', new Date('2026-10-27T09:00:00Z'), { deletedAt: new Date() });
  await meeting('Too late', new Date('2027-02-01T06:00:00Z'));
});

describe('Timeline source (integration)', () => {
  it('reads totals, open tasks by due date, milestones, meetings and owners in grouped queries', async () => {
    const rows = await timeline.load([ids.one!, ids.two!], [ids.ada!, ids.fay!], { meetingsFrom: day('2026-10-01'), meetingsTo: day('2027-01-01') });
    const total = (key: string) => rows.totals.find((t) => t.projectId === ids[key])?.total;
    expect([total('one'), total('two')]).toEqual([8, 1]); // the deleted task is not counted
    const open = rows.openByDue.filter((g) => g.projectId === ids.one).reduce((s, g) => s + g.count, 0);
    expect(open).toBe(5); // t1, t2, t3, the one after the window, Beta build
    expect(rows.openByDue.find((g) => g.projectId === ids.one && g.dueDate?.toISOString() === '2026-10-28T00:00:00.000Z')?.count).toBe(2);
    expect(rows.milestones.map((m) => [m.title, m.done])).toEqual([
      ['Kick-off', true],
      ['Beta build', false],
    ]);
    expect(rows.meetings.map((m) => [m.id, m.title, m.projectId])).toEqual([[ids.meet, 'Weekly sync', ids.one]]);
    expect(rows.owners.map((o) => o.name).sort()).toEqual(['Ada Plan', 'Fay Plan']);
  });

  it('answers nothing for no projects', async () => {
    expect(await timeline.load([], [], { meetingsFrom: day('2026-10-01'), meetingsTo: day('2027-01-01') })).toEqual({ totals: [], openByDue: [], milestones: [], meetings: [], owners: [] });
  });
});

describe('Workload store (integration)', () => {
  const week = { from: day('2026-10-24'), to: day('2026-11-02') };
  const mine = (list: { id: string }[]) => list.map((p) => p.id).filter((id) => Object.values(ids).includes(id)).sort();

  it('finds the projects someone manages: as its manager, its owner or a MANAGER member — not archived or completed ones', async () => {
    expect((await workload.managedProjectIds(ids.bo!)).sort()).toEqual([ids.one, ids.two].sort());
    expect(await workload.managedProjectIds(ids.fay!)).toEqual([ids.two]); // owner of Two; the completed one doesn't count
    expect(await workload.managedProjectIds(ids.cy!)).toEqual([]);
  });

  it('reads live projects, active people and active members', async () => {
    expect(mine(await workload.liveProjects(null))).toEqual([ids.one, ids.two].sort());
    expect(mine(await workload.liveProjects([ids.one!, ids.fin!, ids.old!]))).toEqual([ids.one]);
    expect(mine(await workload.activeUsers(null))).toEqual([ids.ada, ids.bo, ids.cy, ids.fay].sort());
    expect((await workload.members([ids.one!])).map((m) => m.userId).sort()).toEqual([ids.bo, ids.cy].sort()); // not the deactivated member
  });

  it('reads open tasks due in a window that the given people are on, with everyone on them', async () => {
    const tasks = await workload.openTasks({ projectIds: [ids.one!, ids.two!], assigneeIds: [ids.cy!], ...week });
    expect(tasks.map((t) => t.id).sort()).toEqual([ids.t1, ids.t2, ids.t4].sort());
    expect(tasks.find((t) => t.id === ids.t2)!.assigneeIds.sort()).toEqual([ids.bo, ids.cy].sort());
    expect(tasks.find((t) => t.id === ids.t2)).toMatchObject({ key: expect.stringMatching(/^PL-/), priority: 'LOW', isMilestone: false, version: 0 });
    expect(await workload.openTasks({ projectIds: [ids.two!], assigneeIds: [ids.bo!], ...week })).toEqual([]);
  });

  it('counts overdue work per person in grouped queries', async () => {
    expect(await workload.overdueCounts({ projectIds: [ids.one!, ids.two!], userIds: [ids.cy!, ids.bo!], before: day('2026-10-24') })).toEqual([{ userId: ids.cy, count: 1 }]);
  });

  it('weighs each person’s whole load in every live project — not completed or archived ones', async () => {
    const loads = await workload.openDue({ projectIds: null, userIds: [ids.cy!, ids.bo!], windows: [week] });
    const at = (u: string) => loads.filter((l) => l.userId === u).map((l) => l.dueDate!.toISOString().slice(0, 10)).sort();
    expect(at(ids.cy!)).toEqual(['2026-10-28', '2026-10-28', '2026-10-29']); // t1, t2, t4 — not the completed project's t5
    expect(at(ids.bo!)).toEqual(['2026-10-28']);
  });

  it('end to end: a manager sees their projects’ team, an employee only themselves', async () => {
    const run = async (who: string, visible: string[]) => {
      const scope = resolveWorkloadScope({ id: ids[who]!, roles: ['EMPLOYEE'] }, { managedProjectIds: await workload.managedProjectIds(ids[who]!), visibleProjectIds: visible });
      return loadWorkload(workload, { scope, viewerId: ids[who]!, projectId: null, week: '2026-10-25', today: '2026-10-24', timeZone: 'Asia/Muscat' });
    };
    const bo = await run('bo', [ids.one!, ids.two!]);
    expect(mine(bo.rows.people)).toEqual([ids.ada, ids.bo, ids.cy, ids.fay].sort()); // One's and Two's teams (owners, manager, members)
    const cy = await run('cy', [ids.one!, ids.two!, ids.fin!]);
    expect(mine(cy.rows.people)).toEqual([ids.cy]);
    expect(cy.rows.tasks.map((t) => t.id).sort()).toEqual([ids.t1, ids.t2, ids.t4].sort());
  });
});

describe('Assignee swap and task state (integration)', () => {
  it('hands a task from one person to another in one transaction', async () => {
    const repo = createPrismaAssigneeRepository(prisma);
    await repo.swap!(ids.t1!, ids.cy!, ids.bo!);
    expect((await repo.list(ids.t1!)).map((u) => u.id)).toEqual([ids.bo]);
  });

  it('reads a task’s version and whether it is done', async () => {
    const lookup = createPrismaTaskLookup(prisma);
    expect(await lookup.state!(ids.t1!)).toEqual({ version: 0, done: false });
    expect(await lookup.state!(ids.m1!)).toEqual({ version: 0, done: true }); // in a Done column
    await prisma.task.update({ where: { id: ids.t1! }, data: { completedAt: new Date(), version: { increment: 1 } } });
    expect(await lookup.state!(ids.t1!)).toEqual({ version: 1, done: true });
  });
});
