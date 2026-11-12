import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createGuestService } from '../../src/modules/guests/guest-service';
import { runGuestConversion, alsoRecorded } from '../../src/modules/guests/guest-conversion';
import { createPrismaExternalContactRepository } from '../../src/modules/tasks/prisma-external-contact-repository';
import { createExternalContactService } from '../../src/modules/tasks/external-contact-service';
import { createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';

// 1.24 Guests on tasks, on MySQL (TEST_DATABASE_URL, migrations applied).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const lines: { taskId: string; userId: string; action: string; meta?: Record<string, unknown> }[] = [];
const guests = createGuestService({ prisma, recordActivity: async (e) => void lines.push(e) });

const CODES = ['GST1', 'GST2', 'GST3'];
const COMPANIES = ['gst_company_a', 'gst_company_b'];
let owner = '';
let other = '';
let p1 = '';
let p2 = '';
let pB = '';
let todo = '';
let done = '';
let todoB = '';
let n = 0;

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { task: { projectId: { in: ids } } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.guestContact.deleteMany({ where: { companyId: { in: COMPANIES } } });
  await prisma.companyMember.deleteMany({ where: { companyId: { in: COMPANIES } } });
  await prisma.company.deleteMany({ where: { id: { in: COMPANIES } } });
  await prisma.user.deleteMany({ where: { email: { in: ['gst-owner@mico360.test', 'gst-other@mico360.test'] } } });
}

async function task(projectId: string, columnId: string, extra: { assignees?: string[]; createdById?: string } = {}) {
  n += 1;
  const t = await prisma.task.create({ data: { key: `G-${n}-${Date.now()}`, title: `Task ${n}`, projectId, columnId, createdById: extra.createdById ?? owner } });
  for (const userId of extra.assignees ?? []) await prisma.taskAssignee.create({ data: { taskId: t.id, userId } });
  return t.id;
}
/** A contact row as 1.23 left it: no guest yet. */
async function legacyRow(taskId: string, fields: { name: string; company?: string; designation?: string; email?: string; phone?: string; remarks?: string }, position = 0, createdAt = new Date()) {
  return prisma.taskExternalContact.create({ data: { taskId, position, createdById: owner, createdAt, ...fields } });
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
  lines.length = 0;
  for (const [i, id] of COMPANIES.entries()) await prisma.company.create({ data: { id, name: `Guest Co ${i}`, code: `GC${i}` } });
  owner = (await prisma.user.create({ data: { email: 'gst-owner@mico360.test', username: 'gstowner', passwordHash: 'x', firstName: 'Omar', lastName: 'Owner' } })).id;
  other = (await prisma.user.create({ data: { email: 'gst-other@mico360.test', username: 'gstother', passwordHash: 'x', firstName: 'Sara', lastName: 'Other' } })).id;
  await prisma.companyMember.createMany({ data: COMPANIES.flatMap((companyId) => [owner, other].map((userId) => ({ companyId, userId }))) });
  const project = async (code: string, companyId: string) =>
    (await prisma.project.create({ data: { code, name: code, createdById: owner, ownerId: owner, mainCompanyId: companyId, companies: { create: [{ companyId }] }, members: { create: [{ userId: other, role: 'MEMBER' }] } } })).id;
  p1 = await project('GST1', COMPANIES[0]!);
  p2 = await project('GST2', COMPANIES[0]!);
  pB = await project('GST3', COMPANIES[1]!);
  todo = (await prisma.kanbanColumn.create({ data: { projectId: p1, name: 'To do', category: 'TODO', position: 0 } })).id;
  done = (await prisma.kanbanColumn.create({ data: { projectId: p1, name: 'Done', category: 'DONE', position: 1 } })).id;
  await prisma.kanbanColumn.create({ data: { projectId: p2, name: 'To do', category: 'TODO', position: 0 } });
  todoB = (await prisma.kanbanColumn.create({ data: { projectId: pB, name: 'To do', category: 'TODO', position: 0 } })).id;
});

describe('the company guest list', () => {
  it('adds a guest to the project’s company list; the same person again is offered back (409) unless confirmed', async () => {
    const ahmed = await guests.createForProject(p1, { name: ' Ahmed Al Harthy ', company: 'Acme', email: 'ahmed@acme.com' }, owner);
    expect(ahmed).toMatchObject({ companyId: COMPANIES[0], name: 'Ahmed Al Harthy', company: 'Acme' });
    // Another project of the same company shares the list.
    await expect(guests.createForProject(p2, { name: 'ahmed  al harthy', company: 'acme' }, owner)).rejects.toMatchObject({ status: 409, code: 'GUEST_DUPLICATE' });
    const again = await guests.createForProject(p2, { name: 'Ahmed Al Harthy', company: 'Acme' }, owner, { confirmNew: true });
    expect(again.id).not.toBe(ahmed.id);
    // Another company has its own list: no clash, never listed across.
    await guests.createForProject(pB, { name: 'Ahmed Al Harthy', company: 'Acme' }, owner);
    expect((await guests.listForProject(p1)).map((g) => g.companyId)).toEqual([COMPANIES[0], COMPANIES[0]]);
    expect(await guests.listForProject(pB)).toHaveLength(1);
  });

  it('checks details like the website (name required, email and phone as they look, lengths)', async () => {
    await expect(guests.createForProject(p1, { name: '' }, owner)).rejects.toMatchObject({ status: 400 });
    await expect(guests.createForProject(p1, { name: 'A', email: 'nope' }, owner)).rejects.toMatchObject({ status: 400 });
    await expect(guests.createForProject(p1, { name: 'x'.repeat(121) }, owner)).rejects.toMatchObject({ status: 400 });
  });

  it('finds guests by name, company, email or phone digits; retired and merged ones are not picked', async () => {
    const a = await guests.createForProject(p1, { name: 'Ahmed', company: 'Acme', phone: '+968 9912 3456' }, owner);
    const s = await guests.createForProject(p1, { name: 'Sara', company: 'PDO', email: 'sara@pdo.co.om' }, owner);
    await guests.createForProject(p1, { name: 'Ali', company: 'BP' }, owner);
    expect((await guests.listForProject(p1, 'acme')).map((g) => g.id)).toEqual([a.id]);
    expect((await guests.listForProject(p1, '99123')).map((g) => g.id)).toEqual([a.id]);
    expect((await guests.listForProject(p1, 'sara@')).map((g) => g.id)).toEqual([s.id]);
    await guests.setRetired(s.id, true);
    expect((await guests.listForProject(p1)).map((g) => g.name)).toEqual(['Ahmed', 'Ali']);
  });

  it('the duplicate check: the same person, and same-name others', async () => {
    const a = await guests.createForProject(p1, { name: 'Ahmed', company: 'Acme' }, owner);
    const b = await guests.createForProject(p1, { name: 'Ahmed', company: 'PDO' }, owner);
    const m = await guests.duplicatesFor(p2, { name: 'AHMED', company: 'acme' });
    expect(m.same.map((g) => g.id)).toEqual([a.id]);
    expect(m.similar.map((g) => g.id)).toEqual([b.id]);
  });
});

describe('guests on a task', () => {
  it('needs a team member on the task; then puts the guest on with a copy of their details and a history line', async () => {
    const t = await task(p1, todo);
    const g = await guests.createForProject(p1, { name: 'Ahmed', company: 'Acme', email: 'a@acme.com' }, owner);
    await expect(guests.addToTask(t, g.id, null, owner)).rejects.toMatchObject({ status: 400, message: 'Add at least one person from your team to look after this task.' });
    await prisma.taskAssignee.create({ data: { taskId: t, userId: other } });
    const link = await guests.addToTask(t, g.id, 'Signs the report', owner);
    expect(link).toMatchObject({ guestId: g.id, name: 'Ahmed', company: 'Acme', email: 'a@acme.com', note: 'Signs the report', retired: false });
    await expect(guests.addToTask(t, g.id, null, owner)).rejects.toMatchObject({ status: 409, code: 'GUEST_ON_TASK' });
    expect(lines.map((l) => [l.action, l.meta?.name])).toEqual([['EXTERNAL_CONTACT_ADDED', 'Ahmed']]);
    // Another company's guest never goes on this company's task.
    const theirs = await guests.createForProject(pB, { name: 'Zed' }, owner);
    await expect(guests.addToTask(t, theirs.id, null, owner)).rejects.toMatchObject({ status: 400 });
  });

  it('a retired guest stays on its tasks but can’t be added again; edits show on every task', async () => {
    const t1 = await task(p1, todo, { assignees: [other] });
    const t2 = await task(p1, todo, { assignees: [other] });
    const g = await guests.createForProject(p1, { name: 'Ahmed', company: 'Acme' }, owner);
    await guests.addToTask(t1, g.id, null, owner);
    await guests.adminUpdate(g.id, { phone: '+968 9000 0000', notes: 'Key contact' });
    await guests.setRetired(g.id, true);
    expect((await guests.taskGuests(t1))[0]).toMatchObject({ phone: '+968 9000 0000', retired: true });
    await expect(guests.addToTask(t2, g.id, null, owner)).rejects.toMatchObject({ status: 400 });
    await guests.setRetired(g.id, false);
    await guests.addToTask(t2, g.id, null, owner);
  });

  it('refuses taking the last team member off a task with guests', async () => {
    const t = await task(p1, todo, { assignees: [other] });
    const g = await guests.createForProject(p1, { name: 'Ahmed' }, owner);
    await guests.addToTask(t, g.id, null, owner);
    await expect(guests.assertTeamStays(t, [other])).rejects.toMatchObject({ status: 400 });
    await prisma.taskAssignee.create({ data: { taskId: t, userId: owner } });
    await expect(guests.assertTeamStays(t, [other])).resolves.toBeUndefined();
    await guests.removeFromTask(t, g.id, owner);
    await prisma.taskAssignee.deleteMany({ where: { taskId: t, userId: owner } });
    await expect(guests.assertTeamStays(t, [other])).resolves.toBeUndefined();
  });

  it('never makes a user, an email or a notice for a guest', async () => {
    const users = await prisma.user.count();
    const emails = await prisma.emailLog.count();
    const notices = await prisma.notification.count();
    const t = await task(p1, todo, { assignees: [other] });
    const g = await guests.createForProject(p1, { name: 'Ahmed', email: 'ahmed@acme.com' }, owner);
    await guests.addToTask(t, g.id, null, owner);
    expect([await prisma.user.count(), await prisma.emailLog.count(), await prisma.notification.count()]).toEqual([users, emails, notices]);
  });
});

describe('admins tidy the list', () => {
  it('merges duplicates: every task link moves to the kept guest, a task with both keeps one with both notes', async () => {
    const t1 = await task(p1, todo, { assignees: [other] });
    const t2 = await task(p1, todo, { assignees: [other] });
    const keep = await guests.createForProject(p1, { name: 'Ahmed Al Harthy', company: 'Acme' }, owner);
    const dup = await guests.createForProject(p1, { name: 'Ahmed AlHarthy', company: 'Globex' }, owner);
    await guests.addToTask(t1, keep.id, 'first', owner);
    await guests.addToTask(t1, dup.id, 'second', owner);
    await guests.addToTask(t2, dup.id, null, owner);
    const r = await guests.merge(keep.id, [dup.id], owner);
    expect(r.tasks).toBe(2);
    expect((await guests.taskGuests(t1)).map((g) => [g.guestId, g.note])).toEqual([[keep.id, 'first\nsecond']]);
    expect((await guests.taskGuests(t2))[0]).toMatchObject({ guestId: keep.id, company: 'Acme' });
    expect((await guests.adminList({ companyId: COMPANIES[0], status: 'all' })).map((g) => g.id)).toEqual([keep.id]);
    expect(lines.filter((l) => l.action === 'EXTERNAL_CONTACT_CHANGED')).toHaveLength(2);
    // Only one company's guests merge.
    const theirs = await guests.createForProject(pB, { name: 'Ahmed Al Harthy' }, owner);
    await expect(guests.merge(keep.id, [theirs.id], owner)).rejects.toMatchObject({ status: 400 });
  });

  it('never removes a guest that is on a task — a Recycle Bin task too', async () => {
    const t = await task(p1, todo, { assignees: [other] });
    const g = await guests.createForProject(p1, { name: 'Ahmed' }, owner);
    await guests.addToTask(t, g.id, null, owner);
    await prisma.task.update({ where: { id: t }, data: { deletedAt: new Date() } });
    await expect(guests.remove(g.id)).rejects.toMatchObject({ status: 409, code: 'GUEST_IN_USE' });
    expect((await guests.adminList({ companyId: COMPANIES[0] }))[0]).toMatchObject({ id: g.id, taskCount: 1 });
    await prisma.taskExternalContact.deleteMany({ where: { taskId: t } });
    await guests.remove(g.id);
    expect(await prisma.guestContact.count({ where: { id: g.id } })).toBe(0);
  });
});

describe('the old external-contact way in (Android app, extension) works on guests', () => {
  const repo = createPrismaExternalContactRepository(prisma);
  const service = createExternalContactService({
    repo,
    taskLookup: createPrismaTaskLookup(prisma),
    ensureResponsible: (taskId, actorId) => guests.ensureResponsible(taskId, actorId),
  });
  const none = { company: null, designation: null, email: null, phone: null, remarks: null };

  it('adding a contact links the matching guest (or makes one); the task gets its creator when it has no team member', async () => {
    const t = await task(p1, todo, { createdById: other });
    const g = await guests.createForProject(p1, { name: 'Ahmed Al Harthy', company: 'Acme', email: 'ahmed@acme.com' }, owner);
    const c = await service.add(t, { name: 'ahmed al-harthy ', email: 'AHMED@acme.com', remarks: 'Call first' }, owner);
    // "al-harthy" keeps its hyphen: a different name → a new guest; the exact name matches by email.
    expect(c.name).toBe('ahmed al-harthy');
    const d = await service.add(t, { name: 'Ahmed Al Harthy', email: 'ahmed@acme.com' }, owner);
    expect(d).toMatchObject({ name: 'Ahmed Al Harthy', company: 'Acme' });
    expect((await prisma.taskExternalContact.findUnique({ where: { id: d.id } }))?.guestId).toBe(g.id);
    expect(await prisma.taskAssignee.findMany({ where: { taskId: t }, select: { userId: true } })).toEqual([{ userId: other }]);
    expect(lines.find((l) => l.action === 'ASSIGNED')?.meta).toMatchObject({ assigneeId: other, reason: 'guests' });
  });

  it('editing a contact re-links the task to the guest the new details match; the shared guest is never changed', async () => {
    const t = await task(p1, todo, { assignees: [other] });
    const g = await guests.createForProject(p1, { name: 'Ahmed', company: 'Acme', designation: 'Lead' }, owner);
    const c = await service.add(t, { name: 'Ahmed', company: 'Acme' }, owner);
    const { after } = await service.update(c.id, { company: 'PDO' });
    const row = await prisma.taskExternalContact.findUnique({ where: { id: after.id } });
    expect(row?.guestId).not.toBe(g.id);
    expect(row).toMatchObject({ name: 'Ahmed', company: 'PDO' });
    expect(row?.designation).toBe('Lead');
    expect(await prisma.guestContact.findUnique({ where: { id: g.id } })).toMatchObject({ company: 'Acme', designation: 'Lead' });
    const back = await service.update(after.id, { company: 'Acme', designation: 'Manager', remarks: 'note' });
    // Back to Ahmed (Acme): the shared guest keeps its designation.
    expect(back.after).toMatchObject({ company: 'Acme', designation: 'Lead', remarks: 'note' });
    expect((await prisma.taskExternalContact.findUnique({ where: { id: back.after.id } }))?.guestId).toBe(g.id);
  });

  it('suggestions come from the company’s guest list', async () => {
    await guests.createForProject(p1, { name: 'Ahmed Al-Hassan', company: 'Oman (PDO)' }, owner);
    expect((await service.suggest(p2, 'has')).map((s) => s.name)).toEqual(['Ahmed Al-Hassan']);
    expect(await service.suggest(pB, 'has')).toEqual([]);
    expect((await service.suggest(p1, 'pd'))[0]).toMatchObject({ ...none, name: 'Ahmed Al-Hassan', company: 'Oman (PDO)' });
  });

  it('a new task sent with contacts links guests in the same write', async () => {
    const tasks = createPrismaTaskRepository(prisma);
    const made = await tasks.create({ key: `GN-${Date.now()}`, title: 'From the app', projectId: p1, columnId: todo, createdById: owner, externalContacts: [{ name: 'Ahmed', ...none, company: 'Acme' }] });
    const rows = await prisma.taskExternalContact.findMany({ where: { taskId: made.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.guestId).toBeTruthy();
    expect((await guests.listForProject(p1)).map((g) => g.name)).toEqual(['Ahmed']);
  });
});

describe('today’s external contacts become guests', () => {
  const convert = () => runGuestConversion(prisma, (taskId, actorId, opts) => guests.ensureResponsible(taskId, actorId, opts));

  it('one guest per person in each company (case, spaces, phone digits), the fullest details kept, the rest in notes', async () => {
    const t1 = await task(p1, todo, { assignees: [owner] });
    const t2 = await task(p2, (await prisma.kanbanColumn.findFirstOrThrow({ where: { projectId: p2 } })).id, { assignees: [owner] });
    const t3 = await task(pB, todoB, { assignees: [owner] });
    await legacyRow(t1, { name: 'Ahmed Al Harthy', company: 'Acme', remarks: 'site lead on t1' }, 0, new Date('2026-10-01T00:00:00Z'));
    await legacyRow(t2, { name: 'ahmed  al harthy', phone: '+968 9912 3456', email: 'ahmed@acme.com', company: 'acme', designation: 'Engineer' }, 0, new Date('2026-10-02T00:00:00Z'));
    await legacyRow(t1, { name: 'AHMED AL HARTHY', phone: '96899123456', email: 'a.harthy@gmail.com' }, 1, new Date('2026-10-03T00:00:00Z'));
    await legacyRow(t1, { name: 'Sara', company: 'Acme', email: 'ahmed@acme.com' }, 2);
    await legacyRow(t3, { name: 'Ahmed Al Harthy', company: 'Acme' });
    const r = await convert();
    expect(r).toMatchObject({ rows: 5, guestsMade: 3 });
    const listA = await guests.adminList({ companyId: COMPANIES[0] });
    expect(listA.map((g) => g.name)).toEqual(['ahmed  al harthy', 'Sara']);
    const ahmed = listA[0]!;
    expect(ahmed).toMatchObject({ company: 'acme', email: 'ahmed@acme.com', phone: '+968 9912 3456', designation: 'Engineer', taskCount: 2 });
    expect(ahmed.notes).toMatch(/Also recorded: email a\.harthy@gmail\.com \(G-\d+/);
    // t1 had Ahmed twice: one row stays, its remarks kept; every row shows the guest's details.
    const t1Rows = await prisma.taskExternalContact.findMany({ where: { taskId: t1 }, orderBy: { position: 'asc' } });
    expect(t1Rows.map((x) => [x.name, x.remarks])).toEqual([['ahmed  al harthy', 'site lead on t1'], ['Sara', null]]);
    expect((await guests.adminList({ companyId: COMPANIES[1] })).map((g) => g.name)).toEqual(['Ahmed Al Harthy']);
    // Again: nothing to do.
    expect(await convert()).toMatchObject({ rows: 0, guestsMade: 0, responsible: 0 });
  });

  it('joins an existing guest of the list, and open tasks with no team member get their creator', async () => {
    const g = await guests.createForProject(p1, { name: 'Ahmed', company: 'Acme' }, owner);
    const open = await task(p1, todo, { createdById: other });
    const finished = await task(p1, done);
    const binned = await task(p1, todo);
    await prisma.task.update({ where: { id: binned }, data: { deletedAt: new Date() } });
    for (const t of [open, finished, binned]) await legacyRow(t, { name: 'ahmed', company: 'Acme' });
    const r = await convert();
    expect(r).toMatchObject({ rows: 3, guestsMade: 0, responsible: 1 });
    expect(await prisma.taskExternalContact.count({ where: { guestId: g.id } })).toBe(3);
    expect(await prisma.taskAssignee.findMany({ where: { taskId: { in: [open, finished, binned] } }, select: { taskId: true, userId: true } })).toEqual([{ taskId: open, userId: other }]);
    expect(lines.find((l) => l.action === 'ASSIGNED')).toMatchObject({ taskId: open, userId: other, meta: { reason: 'guests', auto: true } });
  });

  it('notes name each other detail once', () => {
    expect(alsoRecorded({ name: 'A', company: 'Acme', designation: null, email: 'a@x.co', phone: null }, [
      { name: 'A', company: ' acme', designation: null, email: 'b@x.co', phone: '1', task: { key: 'R-1' } },
      { name: 'A', company: null, designation: 'Lead', email: 'B@x.co', phone: null, task: { key: 'R-2' } },
    ] as never)).toBe('Also recorded: email b@x.co (R-1); phone 1 (R-1); designation Lead (R-2)');
  });
});
