import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';
import { runBackfill } from './company-helpers';
import { DEFAULT_COMPANY } from '../../src/modules/companies/default-company';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const sources = createPrismaDailyEmailSources(prisma);
const EMAILS = ['dm-ada@mico360.test', 'dm-bo@mico360.test', 'dm-gone@mico360.test'];
let ada = '';
let bo = '';

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: { in: ['DMOPEN', 'DMOLD', 'DMRUN', 'DMOTHER'] } }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.meeting.deleteMany({ where: { title: { startsWith: 'DM meeting' } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.company.deleteMany({ where: { code: { in: ['DMOTHERCO', 'DMSHUTCO'] } } });
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
  const user = (email: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: email[3]!.toUpperCase() + email.slice(4, email.indexOf('@')), lastName: 'Test', ...extra } });
  ada = (await user(EMAILS[0]!, { preferredTimeZone: 'Asia/Kolkata', notificationPrefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '07:00' } } })).id;
  bo = (await user(EMAILS[1]!)).id;
  await user(EMAILS[2]!, { status: 'INACTIVE' });
  const project = async (code: string, status: 'ACTIVE' | 'ARCHIVED', extra: Record<string, unknown> = {}) => {
    const p = await prisma.project.create({ data: { code, name: `Project ${code}`, status, createdById: ada, ownerId: ada, ...extra } });
    const todo = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Doing', category: 'IN_PROGRESS', position: 0 } });
    const done = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 1 } });
    return { p, todo, done };
  };
  const open = await project('DMOPEN', 'ACTIVE', { number: '2026-014', clientName: 'Acme', managerId: bo, color: '#3A6EA5', imageUrl: '/uploads/projects/dm.png', targetDate: new Date('2026-11-30T00:00:00Z') });
  const old = await project('DMOLD', 'ARCHIVED');
  let n = 0;
  const task = (where: { p: { id: string } }, columnId: string, assignees: string[], extra: Record<string, unknown> = {}) =>
    prisma.task.create({ data: { key: `DM-${++n}`, title: `Task ${n}`, projectId: where.p.id, columnId, createdById: ada, priority: 'HIGH', assignees: { create: assignees.map((userId) => ({ userId })) }, ...extra } });
  await task(open, open.todo.id, [ada], { dueDate: new Date('2026-10-19T00:00:00Z') }); // DM-1: Ada's, pending
  await task(open, open.todo.id, [ada, bo]); // DM-2: both, pending
  await task(open, open.todo.id, [bo]); // DM-3: Bo's only
  await task(open, open.done.id, [ada], { completedAt: new Date('2026-10-20T10:00:00Z') }); // DM-4: done yesterday
  await task(open, open.done.id, [ada], { completedAt: new Date('2026-10-18T10:00:00Z') }); // DM-5: done earlier
  await task(open, open.todo.id, [ada], { deletedAt: new Date() }); // DM-6: deleted
  await task(old, old.todo.id, [ada]); // DM-7: archived project
  await task(open, open.todo.id, []); // DM-8: nobody's
  await runBackfill(prisma); // companies: everyone and every project here in the one company, as after the upgrade
});

describe('Daily email sources (integration)', () => {
  it('lists active people with their own time zone and settings', async () => {
    const people = (await sources.people.list()).filter((p) => EMAILS.includes(p.email ?? ''));
    expect(people.map((p) => p.email).sort()).toEqual([EMAILS[0], EMAILS[1]]);
    const a = people.find((p) => p.id === ada)!;
    expect(a).toMatchObject({ name: 'Ada Test', username: 'dm-ada', timeZone: 'Asia/Kolkata', prefs: { dailyEmails: { pending: true, completed: false, time: '07:00' } } });
    expect((await sources.people.find(bo))?.timeZone).toBeNull();
  });

  it('pending: only the person’s own open tasks in projects still going', async () => {
    const tasks = await sources.tasks.pending(ada);
    expect(tasks.map((t) => t.key).sort()).toEqual(['DM-1', 'DM-2']);
    expect(tasks.find((t) => t.key === 'DM-1')).toMatchObject({ title: 'Task 1', priority: 'HIGH', statusLabel: 'Doing', completedAt: null });
    // The project as the email heads its section: details, its manager's name, colour and picture.
    expect(tasks.find((t) => t.key === 'DM-1')!.project).toEqual({
      id: expect.any(String),
      code: 'DMOPEN',
      name: 'Project DMOPEN',
      number: '2026-014',
      clientName: 'Acme',
      managerName: 'Bo Test',
      status: 'ACTIVE',
      color: '#3A6EA5',
      imageUrl: '/uploads/projects/dm.png',
      targetDate: new Date('2026-11-30T00:00:00Z'),
      company: { id: DEFAULT_COMPANY.id, name: expect.any(String) }, // companies: its main company (heads a grouped email)
    });
    expect((await sources.tasks.pending(bo)).map((t) => t.key).sort()).toEqual(['DM-2', 'DM-3']);
  });

  it('pending: a task waiting for approval says since when (the email lists it on its own line)', async () => {
    const waited = new Date('2026-10-20T08:00:00Z');
    await prisma.task.updateMany({ where: { key: 'DM-2', project: { code: 'DMOPEN' } }, data: { needsApproval: true, approvalRequestedAt: waited } });
    const tasks = await sources.tasks.pending(ada);
    expect(tasks.find((t) => t.key === 'DM-2')!.waitingSince).toEqual(waited);
    expect(tasks.find((t) => t.key === 'DM-1')!.waitingSince).toBeNull();
  });

  it('completed: the person’s tasks finished in the window', async () => {
    const tasks = await sources.tasks.completedBetween(ada, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'));
    expect(tasks.map((t) => t.key)).toEqual(['DM-4']);
    expect(await sources.tasks.completedBetween(bo, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'))).toEqual([]);
  });

  it('1.22: completed: never a task of an archived project', async () => {
    await prisma.task.updateMany({ where: { key: 'DM-7', project: { code: 'DMOLD' } }, data: { completedAt: new Date('2026-10-20T11:00:00Z') } });
    const tasks = await sources.tasks.completedBetween(ada, new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z'));
    expect(tasks.map((t) => t.key)).toEqual(['DM-4']);
  });
});

describe('Daily email sources, 1.22: the card’s details, the day’s meetings, the projects the person runs (integration)', () => {
  const byKey = async (key: string) => prisma.task.findFirstOrThrow({ where: { key, project: { code: { in: ['DMOPEN', 'DMOLD'] } } } });

  it('pending: description, start, checklist, the latest update (the newer of the newest comment and change), blocked', async () => {
    const [dm1, dm2, dm3, dm4] = await Promise.all(['DM-1', 'DM-2', 'DM-3', 'DM-4'].map(byKey));
    await prisma.task.update({ where: { id: dm1!.id }, data: { description: 'Fix the pump', startDate: new Date('2026-10-15T00:00:00Z') } });
    await prisma.checklistItem.createMany({ data: [{ taskId: dm1!.id, text: 'a', done: true }, { taskId: dm1!.id, text: 'b' }, { taskId: dm1!.id, text: 'c', done: true }] });
    await prisma.comment.create({ data: { taskId: dm1!.id, userId: bo, body: 'An older comment', createdAt: new Date('2026-10-18T08:00:00Z') } });
    await prisma.activity.create({ data: { taskId: dm1!.id, projectId: dm1!.projectId, userId: bo, action: 'MOVED', meta: { from: 'To Do', to: 'Doing' }, createdAt: new Date('2026-10-19T08:00:00Z') } });
    await prisma.comment.create({ data: { taskId: dm1!.id, userId: bo, body: 'Removed', createdAt: new Date('2026-10-20T08:00:00Z'), deletedAt: new Date() } });
    // DM-2 waits on DM-3 (not done): blocked. DM-1 waits on DM-4 (done): not.
    await prisma.taskDependency.createMany({ data: [{ taskId: dm2!.id, dependsOnTaskId: dm3!.id }, { taskId: dm1!.id, dependsOnTaskId: dm4!.id }] });
    await prisma.comment.create({ data: { taskId: dm2!.id, userId: bo, body: 'The newest   words\n here', createdAt: new Date('2026-10-20T09:00:00Z') } });
    await prisma.activity.create({ data: { taskId: dm2!.id, projectId: dm2!.projectId, userId: ada, action: 'UPDATED', meta: {}, createdAt: new Date('2026-10-19T09:00:00Z') } });

    const tasks = await sources.tasks.pending(ada);
    const one = tasks.find((t) => t.key === 'DM-1')!;
    expect(one).toMatchObject({ description: 'Fix the pump', startDate: new Date('2026-10-15T00:00:00Z'), checklist: { done: 2, total: 3 }, blocked: false });
    expect(one.latest).toEqual({ text: 'Bo Test moved this task (To Do → Doing)', at: new Date('2026-10-19T08:00:00Z') });
    const two = tasks.find((t) => t.key === 'DM-2')!;
    expect(two).toMatchObject({ blocked: true, checklist: null, description: null, startDate: null });
    expect(two.latest).toEqual({ text: 'Bo Test: “The newest words here”', at: new Date('2026-10-20T09:00:00Z') });
  });

  it('meetings: those the person organizes or is invited to and hasn’t declined, starting in the window — not drafts, cancelled, deleted or archived projects’', async () => {
    const open = await prisma.project.findFirstOrThrow({ where: { code: 'DMOPEN' } });
    const old = await prisma.project.findFirstOrThrow({ where: { code: 'DMOLD' } });
    // Another company's project Ada is invited to (she sees it as a guest) and a company that is closed.
    const otherCo = await prisma.company.create({ data: { name: 'DM Other Co', code: 'DMOTHERCO' } });
    const shutCo = await prisma.company.create({ data: { name: 'DM Shut Co', code: 'DMSHUTCO', status: 'ARCHIVED' } });
    const other = await prisma.project.create({ data: { code: 'DMOTHER', name: 'Project DMOTHER', status: 'ACTIVE', createdById: bo, mainCompanyId: otherCo.id, companies: { create: { companyId: otherCo.id } } } });
    const at = (h: number) => new Date(Date.UTC(2026, 10, 4, h));
    const meeting = (title: string, extra: Record<string, unknown> = {}, attendees: Array<{ userId: string; response?: 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' }> = []) =>
      prisma.meeting.create({ data: { title: `DM meeting ${title}`, status: 'SCHEDULED', organizerId: bo, createdById: bo, startAt: at(9), endAt: at(10), ...extra, attendees: { create: attendees } } });
    await meeting('organized', { organizerId: ada, createdById: ada, projectId: open.id, location: 'Room 2', onlineLink: 'https://meet.test/x' });
    await meeting('accepted', { startAt: at(7) }, [{ userId: ada, response: 'ACCEPTED' }]);
    await meeting('maybe', { status: 'IN_PROGRESS', startAt: at(8) }, [{ userId: ada, response: 'TENTATIVE' }]);
    await meeting('guest', { projectId: other.id, startAt: at(11) }, [{ userId: ada }]);
    await meeting('declined', {}, [{ userId: ada, response: 'DECLINED' }]);
    await meeting('draft', { status: 'DRAFT' }, [{ userId: ada }]);
    await meeting('cancelled', { status: 'CANCELLED' }, [{ userId: ada }]);
    await meeting('deleted', { deletedAt: new Date() }, [{ userId: ada }]);
    await meeting('archived project', { projectId: old.id }, [{ userId: ada }]);
    await meeting('closed company', { companyId: shutCo.id }, [{ userId: ada }]);
    await meeting('tomorrow', { startAt: new Date(Date.UTC(2026, 10, 5, 9)) }, [{ userId: ada }]);
    await meeting('not hers', {}, [{ userId: bo }]);

    const got = await sources.tasks.meetingsBetween(ada, new Date('2026-11-04T00:00:00Z'), new Date('2026-11-05T00:00:00Z'));
    expect(got.map((m) => m.title)).toEqual(['DM meeting accepted', 'DM meeting maybe', 'DM meeting organized', 'DM meeting guest']);
    expect(got.find((m) => m.title === 'DM meeting organized')).toMatchObject({ organizer: true, response: null, location: 'Room 2', online: true, projectName: 'Project DMOPEN', startAt: at(9), endAt: at(10), status: 'SCHEDULED' });
    expect(got.find((m) => m.title === 'DM meeting maybe')).toMatchObject({ organizer: false, response: 'TENTATIVE', status: 'IN_PROGRESS', online: false, projectName: null });
    // Archived means no access: with no active company of her own, none.
    await prisma.companyMember.deleteMany({ where: { userId: ada } });
    expect(await sources.tasks.meetingsBetween(ada, new Date('2026-11-04T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))).toEqual([]);
  });

  it('managed: not-done tasks of projects the person runs, assigned to others, that may be overdue or wait for approval — with who has them', async () => {
    // Ada owns DMOPEN; Bo is its named manager. A third project Ada runs as a MANAGER member.
    const run = await prisma.project.create({ data: { code: 'DMRUN', name: 'Project DMRUN', status: 'ACTIVE', createdById: bo, members: { create: [{ userId: ada, role: 'MANAGER' }, { userId: bo }] } } });
    const col = await prisma.kanbanColumn.create({ data: { projectId: run.id, name: 'Doing', category: 'IN_PROGRESS', position: 0 } });
    await runBackfill(prisma);
    const now = new Date('2026-11-04T02:00:00Z');
    const late = new Date('2026-11-01T00:00:00Z');
    await prisma.task.create({ data: { key: 'DM-20', title: 'Late, Bo’s', projectId: run.id, columnId: col.id, createdById: bo, dueDate: late, assignees: { create: [{ userId: bo }] } } });
    await prisma.task.create({ data: { key: 'DM-21', title: 'Not due yet', projectId: run.id, columnId: col.id, createdById: bo, dueDate: new Date('2026-12-01T00:00:00Z'), assignees: { create: [{ userId: bo }] } } });
    await prisma.task.create({ data: { key: 'DM-22', title: 'Late, Ada’s own', projectId: run.id, columnId: col.id, createdById: bo, dueDate: late, assignees: { create: [{ userId: ada }] } } });
    await prisma.task.create({ data: { key: 'DM-23', title: 'Waiting', projectId: run.id, columnId: col.id, createdById: bo, needsApproval: true, approvalRequestedAt: new Date('2026-11-02T08:00:00Z'), assignees: { create: [{ userId: bo }] } } });
    await prisma.task.create({ data: { key: 'DM-24', title: 'Late, deleted', projectId: run.id, columnId: col.id, createdById: bo, dueDate: late, deletedAt: new Date(), assignees: { create: [{ userId: bo }] } } });
    const dm3 = await byKey('DM-3');
    await prisma.task.update({ where: { id: dm3.id }, data: { dueDate: late } }); // Bo's task in DMOPEN (Ada owns it)
    const dm7 = await byKey('DM-7');
    await prisma.task.update({ where: { id: dm7.id }, data: { dueDate: late } }); // archived project: left out

    const got = await sources.tasks.managed(ada, now);
    expect(got.map((t) => t.key).sort()).toEqual(['DM-20', 'DM-23', 'DM-3']);
    expect(got.find((t) => t.key === 'DM-20')).toMatchObject({ assignees: ['Bo Test'], project: { code: 'DMRUN' } });
    expect(got.find((t) => t.key === 'DM-23')!.waitingSince).toEqual(new Date('2026-11-02T08:00:00Z'));
    // Bo runs DMOPEN (named manager): Ada's late task there would be his to see — DM-1 is due 19 Oct.
    expect((await sources.tasks.managed(bo, now)).map((t) => t.key)).toContain('DM-1');
    // Someone who runs nothing: nothing.
    expect(await sources.tasks.managed('nobody', now)).toEqual([]);
  });
});
