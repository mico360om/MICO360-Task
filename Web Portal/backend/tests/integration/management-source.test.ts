import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isOverdue } from '../../src/lib/due-date';
import { createPrismaManagementSource } from '../../src/modules/management/prisma-management-source';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const source = createPrismaManagementSource(prisma, TZ);
const CODES = ['MGRIG', 'MGMICO', 'MGOLD', 'MGGONE'];
const EMAILS = ['mg-sara@mico360.test', 'mg-bilal@mico360.test', 'mg-zara@mico360.test', 'mg-layla@mico360.test', 'mg-omar@mico360.test'];
const ids: Record<string, string> = {};
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const TODAY = '2026-10-27';
// Tuesday 27 October 2026, 10:00 in Muscat.
const NOW = new Date('2026-10-27T06:00:00.000Z');
const STRUCTURE = {
  sections: [{ id: 's1', title: 'Rig', items: [{ id: 'valve', kind: 'CHECK', label: 'Valve sealed', help: null }, { id: 'hose', kind: 'CHECK', label: 'Hose intact', help: null }, { id: 'gauge', kind: 'CHECK', label: 'Gauge reads', help: null }, { id: 'light', kind: 'CHECK', label: 'Light works', help: null }] }],
  clientSignature: 'NONE',
  supervisorSignature: 'NONE',
};

async function cleanup() {
  const ps = await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } });
  const pids = ps.map((p) => p.id);
  await prisma.actionItem.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.meeting.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.inspection.deleteMany({ where: { projectId: { in: pids } } });
  await prisma.inspectionForm.deleteMany({ where: { title: 'MG rig check' } });
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
    ids[key] = (await prisma.user.create({ data: { email: `mg-${key}@mico360.test`, username: `mg-${key}`, passwordHash: 'x', firstName, lastName: 'Mgmt', ...extra } })).id;
  };
  await user('sara', 'Sara');
  await user('bilal', 'Bilal');
  await user('zara', 'Zara');
  await user('layla', 'Layla', { status: 'INACTIVE' });
  await user('omar', 'Omar');
  const proj = async (key: string, code: string, extra: Record<string, unknown> = {}) => {
    ids[key] = (await prisma.project.create({ data: { code, name: `MG ${key}`, createdById: ids.sara!, ...extra } })).id;
  };
  await proj('rig', 'MGRIG', { managerId: ids.sara, status: 'ACTIVE' });
  await proj('mico', 'MGMICO', { ownerId: ids.omar, status: 'ACTIVE' });
  await proj('old', 'MGOLD', { managerId: ids.sara, status: 'ARCHIVED' });
  await proj('gone', 'MGGONE', { managerId: ids.sara, status: 'ACTIVE', deletedAt: new Date() });
  await prisma.projectMember.create({ data: { projectId: ids.mico!, userId: ids.bilal!, role: 'MANAGER' } });
  const cols: Record<string, { todo: string; done: string }> = {};
  for (const key of ['rig', 'mico', 'old', 'gone']) {
    cols[key] = {
      todo: (await prisma.kanbanColumn.create({ data: { projectId: ids[key]!, name: 'To do', category: 'TODO', position: 0 } })).id,
      done: (await prisma.kanbanColumn.create({ data: { projectId: ids[key]!, name: 'Done', category: 'DONE', position: 1 } })).id,
    };
  }
  ids.form = (await prisma.inspectionForm.create({ data: { title: 'MG rig check', sections: STRUCTURE.sections } })).id;
  let n = 0;
  const task = async (key: string, projectKey: string, extra: Record<string, unknown> = {}, who: string[] = [], done = false) => {
    n += 1;
    const t = await prisma.task.create({
      data: { key: `MG-${n}`, title: key, projectId: ids[projectKey]!, columnId: done ? cols[projectKey]!.done : cols[projectKey]!.todo, createdById: ids.sara!, createdAt: new Date('2026-10-01T08:00:00.000Z'), ...extra },
    });
    for (const k of who) await prisma.taskAssignee.create({ data: { taskId: t.id, userId: ids[k]! } });
    ids[key] = t.id;
  };
  // RIG
  await task('late1', 'rig', { dueDate: day('2026-10-24') }, ['bilal']);
  await task('today', 'rig', { dueDate: day(TODAY) }, ['bilal']);
  // Kept as moments, not days: 26 Oct 21:00 UTC is 27 Oct 01:00 in Muscat (today: not late); 19:00 UTC is the 26th there (late).
  await task('bandToday', 'rig', { dueDate: new Date('2026-10-26T21:00:00.000Z') }, ['zara']);
  await task('bandLate', 'rig', { dueDate: new Date('2026-10-26T19:00:00.000Z') }, ['zara']);
  await task('doneCol', 'rig', { dueDate: day('2026-10-01'), updatedAt: new Date('2026-10-02T08:00:00.000Z') }, ['bilal'], true); // a Done column, no completion time
  await task('completed', 'rig', { dueDate: day('2026-10-01'), completedAt: new Date('2026-10-02T08:00:00.000Z') }, ['bilal']);
  await task('deleted', 'rig', { dueDate: day('2026-10-01'), deletedAt: new Date() }, ['bilal']);
  await task('milestone', 'rig', { dueDate: day('2026-10-20'), isMilestone: true, title: 'Handover' }, []);
  await task('msDone', 'rig', { dueDate: day('2026-10-10'), isMilestone: true, completedAt: new Date('2026-10-10T08:00:00.000Z') }, [], true);
  const check = (extra: Record<string, unknown>) => ({ inspectionFormId: ids.form, ...extra });
  // Due 20 October: finished 23:59 there (on time), and 00:01 the next day (late, no report).
  await task('chOnTime', 'rig', check({ dueDate: day('2026-10-20'), completedAt: new Date('2026-10-20T19:59:00.000Z') }), [], true);
  await task('chLate', 'rig', check({ dueDate: day('2026-10-20'), completedAt: new Date('2026-10-20T20:01:00.000Z') }), [], true);
  await task('chMissing', 'rig', check({ dueDate: day('2026-10-22') }), ['zara']);
  await task('chFuture', 'rig', check({ dueDate: day('2026-10-30') }), ['zara']);
  await task('chOld', 'rig', check({ dueDate: day('2026-06-01') }), ['zara']); // long missing
  await task('chOldDone', 'rig', check({ dueDate: day('2026-06-01'), completedAt: new Date('2026-10-21T08:00:00.000Z') }), [], true); // finished late last week
  await task('chDeleted', 'rig', check({ dueDate: day('2026-10-22'), deletedAt: new Date() }), ['zara']);
  await task('fOpen', 'rig', { dueDate: day('2026-10-30') }, []);
  await task('fDone', 'rig', { dueDate: day('2026-10-21'), completedAt: new Date('2026-10-21T08:00:00.000Z') }, [], true);
  await task('fDeleted', 'rig', { dueDate: day('2026-10-21'), deletedAt: new Date() }, []);
  // MICO
  await task('mLate', 'mico', { dueDate: day('2026-10-25'), createdAt: new Date('2026-10-19T08:00:00.000Z') }, ['bilal', 'layla']);
  await task('mNew', 'mico', { dueDate: day('2026-11-02'), createdAt: new Date('2026-10-26T08:00:00.000Z') }, ['bilal']);
  // OLD (archived) and GONE (deleted): late too
  await task('oLate', 'old', { dueDate: day('2026-10-01') }, ['zara']);
  await task('gLate', 'gone', { dueDate: day('2026-10-01') }, ['zara']);

  const inspection = async (key: string, projectKey: string, extra: Record<string, unknown>, answers: Array<[string, string | null, string?]>) => {
    const i = await prisma.inspection.create({
      data: { projectId: ids[projectKey]!, formId: ids.form, formVersion: 1, title: 'MG rig check', structure: STRUCTURE, inspectorId: ids.zara!, startedById: ids.zara!, ...extra },
    });
    for (const [itemId, result, note] of answers) await prisma.inspectionAnswer.create({ data: { inspectionId: i.id, itemId, result, note: note ?? null, editedAt: new Date(), answeredById: ids.zara! } });
    ids[key] = i.id;
  };
  const finished = (at: string, extra: Record<string, unknown> = {}) => ({ status: 'FINISHED', finishedAt: new Date(at), ...extra });
  await inspection('in1', 'rig', finished('2026-10-21T08:00:00.000Z', { taskId: ids.chOnTime, place: 'Rig 3' }), [['valve', 'FAIL', 'Leaking'], ['hose', 'FAIL'], ['gauge', 'PASS'], ['light', 'NA']]);
  await inspection('in2', 'rig', finished('2026-10-26T08:00:00.000Z'), [['valve', 'FAIL'], ['hose', 'PASS'], ['gauge', 'PASS'], ['light', null]]);
  await inspection('in3', 'rig', { status: 'IN_PROGRESS' }, [['valve', 'FAIL']]);
  await inspection('in4', 'rig', finished('2026-10-22T08:00:00.000Z', { deletedAt: new Date() }), [['valve', 'FAIL']]);
  await inspection('in5', 'mico', finished('2026-10-15T08:00:00.000Z'), [['valve', 'FAIL']]);
  await inspection('in6', 'rig', finished('2026-07-01T08:00:00.000Z'), [['hose', 'FAIL']]);
  // A finished inspection linked to the late check, but deleted: still "closed without a report".
  await inspection('in7', 'rig', finished('2026-10-21T09:00:00.000Z', { taskId: ids.chLate, deletedAt: new Date() }), []);
  await prisma.inspectionFollowUp.createMany({
    data: [
      { inspectionId: ids.in1!, itemId: 'valve', taskId: ids.fOpen, createdById: ids.sara! },
      { inspectionId: ids.in1!, itemId: 'hose', taskId: ids.fDone, createdById: ids.sara! },
      { inspectionId: ids.in2!, itemId: 'valve', taskId: ids.fDeleted, createdById: ids.sara! },
    ],
  });

  const live = await prisma.meeting.create({ data: { title: 'Rig weekly', status: 'SCHEDULED', projectId: ids.rig!, startAt: new Date('2026-10-19T06:00:00.000Z'), organizerId: ids.sara!, createdById: ids.sara! } });
  const binned = await prisma.meeting.create({ data: { title: 'Binned', status: 'SCHEDULED', projectId: ids.rig!, startAt: new Date('2026-10-19T08:00:00.000Z'), organizerId: ids.sara!, createdById: ids.sara!, deletedAt: new Date() } });
  ids.meeting = live.id;
  const action = (key: string, extra: Record<string, unknown>) =>
    prisma.actionItem.create({ data: { description: key, projectId: ids.rig!, meetingId: live.id, createdById: ids.sara!, ...extra } }).then((a) => (ids[key] = a.id));
  await action('a1', { assigneeId: ids.zara, dueDate: day('2026-10-20'), status: 'OPEN' });
  await action('a2', { assigneeId: ids.zara, dueDate: day('2026-11-05'), status: 'IN_PROGRESS' });
  await action('a3', { assigneeId: ids.zara, status: 'COMPLETED' });
  await action('a4', { assigneeId: ids.zara, status: 'CANCELLED' });
  await action('a5', { assigneeId: ids.zara, status: 'OPEN', meetingId: binned.id });
  await action('a6', { assigneeId: ids.bilal, status: 'PENDING', projectId: ids.mico });
  await action('a7', { assigneeId: ids.zara, status: 'OPEN' }); // no due date: listed after the dated ones
  await action('a8', { assigneeId: null, status: 'OPEN' });
});

const RIG_MICO = () => [ids.rig!, ids.mico!];

describe('Management source (integration)', () => {
  it('projects: every live one, or those a person runs (owner, named manager, MANAGER member); deleted never', async () => {
    const all = (await source.projects(null)).map((p) => p.code).filter((c) => CODES.includes(c)).sort();
    expect(all).toEqual(['MGMICO', 'MGOLD', 'MGRIG']);
    expect((await source.projects(ids.sara!)).map((p) => p.code).sort()).toEqual(['MGOLD', 'MGRIG']);
    expect((await source.projects(ids.bilal!)).map((p) => p.code)).toEqual(['MGMICO']);
    expect(await source.runCount(ids.omar!)).toBe(1);
    expect(await source.runCount(ids.zara!)).toBe(0);
    expect((await source.people([ids.sara!, ids.layla!])).map((p) => p.name).sort()).toEqual(['Layla Mgmt', 'Sara Mgmt']);
  });

  it('task figures: live tasks, done (a Done column or a completion time), open and late by the company day — the same as isOverdue', async () => {
    const figures = await source.taskFigures(RIG_MICO(), TODAY);
    const rig = figures.find((f) => f.projectId === ids.rig)!;
    expect(rig).toMatchObject({ total: 16, done: 7, open: 9, late: 5 });
    expect(figures.find((f) => f.projectId === ids.mico)).toMatchObject({ total: 2, done: 0, open: 2, late: 1 });
    // The SQL's "late" is lib/due-date isOverdue, row for row.
    const open = await prisma.task.findMany({ where: { projectId: ids.rig, deletedAt: null, completedAt: null, column: { category: { not: 'DONE' } } }, select: { dueDate: true } });
    expect(open.filter((t) => isOverdue(t.dueDate, TZ, NOW)).length).toBe(rig.late);
    expect(await source.taskFigures([], TODAY)).toEqual([]);
  });

  it('open milestones', async () => {
    expect((await source.openMilestones([ids.rig!])).map((m) => [m.title, m.key.startsWith('MG-')])).toEqual([['Handover', true]]);
  });

  it('checks: due in the window, open past due, finished in a window; whether a finished, live inspection is linked', async () => {
    const rows = await source.checks([ids.rig!], { dueFrom: day('2026-10-03'), dueTo: day('2026-10-29'), openBefore: day('2026-10-28') });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual([ids.chLate, ids.chMissing, ids.chOld, ids.chOnTime].sort());
    expect(byId.get(ids.chOnTime!)).toMatchObject({ hasReport: true, columnCategory: 'DONE' });
    expect(byId.get(ids.chLate!)).toMatchObject({ hasReport: false });
    expect(byId.get(ids.chOld!)!.dueDate!.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    const withDone = await source.checks([ids.rig!], { dueFrom: day('2026-10-03'), dueTo: day('2026-10-29'), openBefore: day('2026-10-28'), doneFrom: new Date('2026-10-17T20:00:00.000Z'), doneTo: new Date('2026-10-24T20:00:00.000Z') });
    expect(withDone.map((r) => r.id)).toContain(ids.chOldDone);
  });

  it('finished inspections with their passed and failed answers; the most-failed items; their checklists', async () => {
    const from = new Date('2026-10-03T20:00:00.000Z');
    const to = new Date('2026-10-31T20:00:00.000Z');
    const list = await source.finishedInspections(RIG_MICO(), from, to);
    const by = new Map(list.map((i) => [i.id, i]));
    expect([...by.keys()].sort()).toEqual([ids.in1, ids.in2, ids.in5].sort());
    expect(by.get(ids.in1!)).toMatchObject({ passed: 1, failed: 2, place: 'Rig 3', taskId: ids.chOnTime, title: 'MG rig check', formId: ids.form });
    expect(by.get(ids.in2!)).toMatchObject({ passed: 2, failed: 1 });
    const failed = await source.failedItems(RIG_MICO(), from, to, 10);
    expect(failed.map((f) => [f.itemId, f.failures])).toEqual([['valve', 3], ['hose', 1]]);
    expect(failed[0]!.formId).toBe(ids.form);
    expect((await source.failedItems(RIG_MICO(), from, to, 1)).length).toBe(1);
    const [st] = await source.structures([failed[0]!.sampleId]);
    expect((st!.structure as typeof STRUCTURE).sections[0]!.items[0]!.label).toBe('Valve sealed');
    const where = await source.failedOccurrences({ projectIds: [ids.rig!], from, to, formId: ids.form!, itemId: 'valve', limit: 10 });
    expect(where.total).toBe(2);
    expect(where.rows.map((r) => [r.inspectionId, r.note])).toEqual([[ids.in2, null], [ids.in1, 'Leaking']]);
  });

  it('open follow-ups (their task open and live, the inspection live)', async () => {
    expect(await source.openFollowUps(RIG_MICO())).toEqual([{ projectId: ids.rig, count: 1 }]);
    const list = await source.followUpTasks({ projectIds: [ids.rig!], limit: 10 });
    expect([list.total, list.rows.map((r) => r.title)]).toEqual([1, ['fOpen']]);
  });

  it('late work per active person, and open action items (live meetings) with the overdue ones', async () => {
    const late = new Map((await source.lateByPerson(RIG_MICO(), TODAY)).map((l) => [l.userId, l.count]));
    expect(late.get(ids.bilal!)).toBe(2); // late1, mLate
    expect(late.get(ids.zara!)).toBe(3); // bandLate, chMissing, chOld
    expect(late.has(ids.layla!)).toBe(false); // not active
    const acts = new Map((await source.actionItems(RIG_MICO(), TODAY)).map((a) => [a.userId, a]));
    expect(acts.get(ids.zara!)).toMatchObject({ open: 3, overdue: 1 });
    expect(acts.get(ids.bilal!)).toMatchObject({ open: 1, overdue: 0 });
    const list = await source.actionItemList({ projectIds: RIG_MICO(), personId: ids.zara!, limit: 10 });
    expect(list.total).toBe(3);
    expect(list.rows.map((r) => r.description)).toEqual(['a1', 'a2', 'a7']);
    expect(list.rows[0]).toMatchObject({ meetingId: ids.meeting, meetingTitle: 'Rig weekly', assigneeName: 'Zara Mgmt' });
    expect((await source.actionItemList({ projectIds: RIG_MICO(), limit: 2 })).rows.length).toBe(2);
  });

  it('the trend: created, completed and late per week (late judged at the week’s end; now for the current week)', async () => {
    const t = await source.trend(RIG_MICO(), [
      { from: new Date('2026-10-17T20:00:00.000Z'), to: new Date('2026-10-24T20:00:00.000Z'), lateDay: '2026-10-24', lateAt: new Date('2026-10-24T20:00:00.000Z') },
      { from: new Date('2026-10-24T20:00:00.000Z'), to: new Date('2026-10-31T20:00:00.000Z'), lateDay: TODAY, lateAt: NOW },
    ]);
    expect(t.created).toEqual([1, 1]); // mLate (19 Oct), mNew (26 Oct)
    expect(t.completed).toEqual([4, 0]); // chOnTime, chLate (20 Oct, either side of Muscat midnight), chOldDone, fDone (21 Oct)
    // At the end of 24 October: milestone (20th), chMissing (22nd), chOld (June) were late; late1 was due that day.
    expect(t.late[0]).toBe(3);
    // Now: the live figure.
    const live = (await source.taskFigures(RIG_MICO(), TODAY)).reduce((n, f) => n + f.late, 0);
    expect(t.late[1]).toBe(live);
    expect(await source.trend([], [])).toEqual({ created: [], completed: [], late: [] });
  });

  it('lists: late tasks (of a person, milestones only) most overdue first; tasks by id with their people', async () => {
    const rig = await source.lateTasks({ projectIds: [ids.rig!], today: TODAY, limit: 3 });
    expect(rig.total).toBe(5);
    expect(rig.rows.map((r) => r.title)).toEqual(['chOld', 'Handover', 'chMissing']);
    const zara = await source.lateTasks({ projectIds: RIG_MICO(), today: TODAY, personId: ids.zara!, limit: 10 });
    expect(zara.rows.map((r) => r.title)).toEqual(['chOld', 'chMissing', 'bandLate']);
    const marks = await source.lateTasks({ projectIds: RIG_MICO(), today: TODAY, milestonesOnly: true, limit: 10 });
    expect(marks.rows.map((r) => [r.title, r.isMilestone])).toEqual([['Handover', true]]);
    const [line] = await source.tasksByIds([ids.mLate!]);
    expect(line).toMatchObject({ title: 'mLate', columnCategory: 'TODO', assignees: ['Bilal Mgmt', 'Layla Mgmt'] });
    expect(await source.tasksByIds([ids.deleted!])).toEqual([]);
  });
});
