import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { clientShareStoreContract } from '../../src/modules/client-view/client-share-store.contract';
import { createPrismaClientShareStore } from '../../src/modules/client-view/prisma-client-share-store';
import { createPrismaClientViewSource } from '../../src/modules/client-view/client-view-source';
import { createPrismaFinalMinutesRepository } from '../../src/modules/meetings/final-minutes-repository';
import { createPrismaClientFlags } from '../../src/modules/client-view/prisma-client-flags';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Only this file's projects
// (codes CVA, CVB) and its person (cv-owner@mico360.test) are made and removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaClientShareStore(prisma);
const source = createPrismaClientViewSource(prisma);
const CODES = ['CVA', 'CVB'];
const EMAIL = 'cv-owner@mico360.test';
let ownerId = '';
let a = { id: '', todo: '', done: '' };
let b = { id: '', todo: '', done: '' };

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.meeting.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } }); // shares, codes and sessions cascade
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function project(code: string) {
  const p = await prisma.project.create({ data: { code, name: `Project ${code}`, createdById: ownerId, ownerId, clientName: 'Oman Drilling Co.' } });
  const todo = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Waiting on Ahmed', category: 'TODO', position: 0 } });
  const done = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'Done', category: 'DONE', position: 1 } });
  return { id: p.id, todo: todo.id, done: done.id };
}

async function setup() {
  await cleanup();
  ownerId = (await prisma.user.create({ data: { email: EMAIL, username: 'cv-owner', passwordHash: 'x', firstName: 'Omar', lastName: 'Ahmed' } })).id;
  a = await project('CVA');
  b = await project('CVB');
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

clientShareStoreContract('MySQL (Prisma)', async () => {
  await setup();
  return { store, projectA: a.id, projectB: b.id };
});

describe('client view in the database', () => {
  beforeEach(setup);

  let n = 0;
  const task = (projectId: string, columnId: string, title: string, extra: Record<string, unknown> = {}) =>
    prisma.task.create({ data: { key: `CV-${++n}-${Date.now()}`, title, projectId, columnId, createdById: ownerId, description: 'INTERNAL description', ...extra } });

  it('deleting a project removes its shares, their codes and their sessions', async () => {
    const s = await store.create({ projectId: a.id, name: 'Fatma', email: 'fatma@client.example', linkHash: 'a'.repeat(64), createdById: ownerId });
    await store.createCode({ shareId: s.id, codeHash: 'x', expiresAt: new Date(Date.now() + 60_000) });
    await store.createSession({ shareId: s.id, tokenHash: 's'.repeat(64), expiresAt: new Date(Date.now() + 60_000) });
    await prisma.project.delete({ where: { id: a.id } });
    expect(await prisma.clientShare.count({ where: { id: s.id } })).toBe(0);
    expect(await prisma.clientAccessCode.count({ where: { shareId: s.id } })).toBe(0);
    expect(await prisma.clientSession.count({ where: { shareId: s.id } })).toBe(0);
  });

  it('reads only marked, live tasks of that project — with their stage, never their column’s name', async () => {
    await task(a.id, a.todo, 'Marked milestone', { isMilestone: true, clientVisible: true, dueDate: new Date('2026-11-01T00:00:00Z') });
    await task(a.id, a.done, 'Marked and done', { clientVisible: true });
    await task(a.id, a.todo, 'Not marked');
    await task(a.id, a.todo, 'Marked but deleted', { clientVisible: true, deletedAt: new Date() });
    await task(b.id, b.todo, 'Another project’s marked task', { clientVisible: true });
    const items = await source.items(a.id);
    expect(items.map((i) => i.title).sort()).toEqual(['Marked and done', 'Marked milestone']);
    expect(items.find((i) => i.title === 'Marked and done')).toEqual({ title: 'Marked and done', isMilestone: false, clientVisible: true, dueDate: null, completedAt: null, columnCategory: 'DONE' });
    expect(JSON.stringify(items)).not.toContain('INTERNAL');
    expect(JSON.stringify(items)).not.toContain('Waiting on Ahmed');
  });

  it('counts every live task of the project for % done (marked or not)', async () => {
    await task(a.id, a.done, 'Done one');
    await task(a.id, a.todo, 'Completed elsewhere', { completedAt: new Date() });
    await task(a.id, a.todo, 'Open one');
    await task(a.id, a.todo, 'Deleted', { deletedAt: new Date() });
    await task(b.id, b.done, 'Other project');
    expect(await source.counts(a.id)).toEqual({ total: 3, done: 2 });
  });

  it('reads only approved, marked final minutes of the project’s live meetings', async () => {
    const meeting = (projectId: string, title: string, extra: Record<string, unknown> = {}) =>
      prisma.meeting.create({ data: { title, projectId, organizerId: ownerId, createdById: ownerId, startAt: new Date('2026-10-05T06:00:00Z'), ...extra } });
    const content = JSON.stringify({ summary: 'Agreed.', discussion: [], decisions: ['Go'], risks: [], nextSteps: [] });
    const shown = await meeting(a.id, 'Kick-off');
    const draft = await meeting(a.id, 'Draft one');
    const unmarked = await meeting(a.id, 'Not marked');
    const deleted = await meeting(a.id, 'Deleted meeting', { deletedAt: new Date() });
    const other = await meeting(b.id, 'Other project');
    await prisma.meetingMinutes.createMany({
      data: [
        { meetingId: shown.id, content, status: 'APPROVED', approvedAt: new Date('2026-10-06T06:00:00Z'), approvedById: ownerId, clientVisible: true, clientVisibleProjectId: a.id },
        { meetingId: draft.id, content, status: 'DRAFT', clientVisible: true, clientVisibleProjectId: a.id },
        { meetingId: unmarked.id, content, status: 'APPROVED', clientVisible: false },
        { meetingId: deleted.id, content, status: 'APPROVED', clientVisible: true, clientVisibleProjectId: a.id },
        { meetingId: other.id, content, status: 'APPROVED', clientVisible: true, clientVisibleProjectId: b.id },
      ],
    });
    const minutes = await source.minutes(a.id);
    expect(minutes).toEqual([
      expect.objectContaining({ meetingId: shown.id, title: 'Kick-off', status: 'APPROVED', clientVisible: true, content: { summary: 'Agreed.', discussion: [], decisions: ['Go'], risks: [], nextSteps: [] } }),
    ]);
    expect(await source.minutesOf(a.id, shown.id)).toMatchObject({ meetingId: shown.id });
    for (const id of [draft.id, unmarked.id, deleted.id, other.id]) expect(await source.minutesOf(a.id, id)).toBeNull();
    // Another project's minutes are never read through this project.
    expect(await source.minutesOf(b.id, shown.id)).toBeNull();
  });

  it('minutes that go back to a draft leave the client page; approving them again doesn’t bring them back', async () => {
    const repo = createPrismaFinalMinutesRepository(prisma);
    const m = await prisma.meeting.create({ data: { title: 'Review', projectId: a.id, organizerId: ownerId, createdById: ownerId, startAt: new Date() } });
    const content = { summary: 'S', discussion: [], decisions: [], risks: [], nextSteps: [] };
    await repo.save(m.id, { content, status: 'APPROVED', approvedById: ownerId, approvedAt: new Date() });
    await prisma.meetingMinutes.update({ where: { meetingId: m.id }, data: { clientVisible: true } });
    // Approving again (same status) keeps it shown.
    await repo.save(m.id, { content, status: 'APPROVED', approvedById: ownerId, approvedAt: new Date() });
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: m.id } })).clientVisible).toBe(true);
    // Reopened: hidden.
    await repo.save(m.id, { content, status: 'DRAFT', approvedById: null, approvedAt: null });
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: m.id } })).clientVisible).toBe(false);
    await repo.save(m.id, { content, status: 'APPROVED', approvedById: ownerId, approvedAt: new Date() });
    expect((await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: m.id } })).clientVisible).toBe(false);
  });

  it('the task switch: only live tasks of live projects, and it says what the flag was', async () => {
    const flags = createPrismaClientFlags(prisma, async (id) => ({ id }) as never);
    const t = await task(a.id, a.todo, 'Pour the foundation');
    const gone = await task(a.id, a.todo, 'Deleted', { deletedAt: new Date() });
    expect(await flags.tasks.projectOf(t.id)).toBe(a.id);
    expect(await flags.tasks.projectOf(gone.id)).toBeNull();
    expect(await flags.tasks.projectOf('nope')).toBeNull();
    expect(await flags.tasks.setClientVisible(t.id, true)).toEqual({ before: false, task: { id: t.id } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).clientVisible).toBe(true);
    expect((await flags.tasks.setClientVisible(t.id, true)).before).toBe(true);
    await prisma.project.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    expect(await flags.tasks.projectOf(t.id)).toBeNull();
  });

  it('the minutes switch: on only while approved; a standalone meeting has no project; a deleted one is gone', async () => {
    const flags = createPrismaClientFlags(prisma, async () => ({}) as never);
    const content = JSON.stringify({ summary: 'S', discussion: [], decisions: [], risks: [], nextSteps: [] });
    const mk = (projectId: string | null, extra: Record<string, unknown> = {}) =>
      prisma.meeting.create({ data: { title: 'M', projectId, organizerId: ownerId, createdById: ownerId, startAt: new Date(), ...extra } });
    const approved = await mk(a.id);
    const draft = await mk(a.id);
    const none = await mk(a.id);
    const alone = await mk(null);
    const deleted = await mk(a.id, { deletedAt: new Date() });
    await prisma.meetingMinutes.createMany({ data: [{ meetingId: approved.id, content, status: 'APPROVED' }, { meetingId: draft.id, content, status: 'DRAFT' }] });
    expect(await flags.minutes.projectOf(approved.id)).toBe(a.id);
    expect(await flags.minutes.projectOf(alone.id)).toBeNull();
    expect(await flags.minutes.projectOf(deleted.id)).toBeUndefined();
    expect(await flags.minutes.state(none.id)).toBeNull();
    expect(await flags.minutes.state(draft.id)).toEqual({ approved: false, clientVisible: false, includeRisks: false });
    expect(await flags.minutes.set(draft.id, true, { includeRisks: false })).toBe(false);
    expect(await flags.minutes.state(draft.id)).toEqual({ approved: false, clientVisible: false, includeRisks: false });
    expect(await flags.minutes.set(none.id, true, { includeRisks: false })).toBe(false);
    expect(await flags.minutes.set(approved.id, true, { includeRisks: true })).toBe(true);
    expect(await flags.minutes.state(approved.id)).toEqual({ approved: true, clientVisible: true, includeRisks: true });
    // Shown for the project the meeting is filed under at that moment.
    expect(await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: approved.id } })).toMatchObject({ clientVisibleProjectId: a.id, clientShowRisks: true });
    expect(await flags.minutes.set(approved.id, false, { includeRisks: false })).toBe(true);
    expect(await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: approved.id } })).toMatchObject({ clientVisible: false, clientVisibleProjectId: null, clientShowRisks: false });
    expect(await flags.minutes.set(none.id, false, { includeRisks: false })).toBe(true); // nothing to hide
  });

  it('the names minutes may mention: the project’s owner and team, the meeting’s organizer and attendees, guests too', async () => {
    const flags = createPrismaClientFlags(prisma, async () => ({}) as never);
    const mate = await prisma.user.create({ data: { email: 'cv-mate@mico360.test', username: 'cv-mate', passwordHash: 'x', firstName: 'Layla', lastName: 'Hassan' } });
    try {
      await prisma.projectMember.create({ data: { projectId: a.id, userId: mate.id } });
      const m = await prisma.meeting.create({ data: { title: 'Review', projectId: a.id, organizerId: ownerId, createdById: ownerId, startAt: new Date() } });
      await prisma.meetingAttendee.create({ data: { meetingId: m.id, externalName: 'Guest Visitor', externalEmail: 'guest@x.example' } });
      const content = JSON.stringify({ summary: 'With Layla.', discussion: [], decisions: [], risks: ['Internal risk'], nextSteps: ['Send the form — Omar Ahmed, by 20 Oct'] });
      await prisma.meetingMinutes.create({ data: { meetingId: m.id, content, status: 'APPROVED' } });
      const preview = await flags.minutes.preview(m.id);
      expect(preview!.names).toEqual(expect.arrayContaining(['Omar Ahmed', 'Omar', 'Layla Hassan', 'Layla', 'Guest Visitor']));
      await flags.minutes.set(m.id, true, { includeRisks: false });
      const [shown] = await source.minutes(a.id);
      expect(shown).toMatchObject({ showRisks: false });
      expect(shown!.people).toEqual(expect.arrayContaining(['Omar Ahmed', 'Layla Hassan', 'Guest Visitor']));
    } finally {
      await prisma.projectMember.deleteMany({ where: { userId: mate.id } });
      await prisma.meeting.deleteMany({ where: { projectId: a.id } });
      await prisma.user.delete({ where: { id: mate.id } });
    }
  });

  describe('a meeting re-filed under another project takes its minutes off the old client page', () => {
    const content = JSON.stringify({ summary: 'Shown on A', discussion: [], decisions: [], risks: [], nextSteps: [] });
    async function shownOnA() {
      const flags = createPrismaClientFlags(prisma, async () => ({}) as never);
      const m = await prisma.meeting.create({ data: { title: 'Kick-off', projectId: a.id, organizerId: ownerId, createdById: ownerId, startAt: new Date() } });
      await prisma.meetingMinutes.create({ data: { meetingId: m.id, content, status: 'APPROVED' } });
      expect(await flags.minutes.set(m.id, true, { includeRisks: false })).toBe(true);
      expect((await source.minutes(a.id)).map((x) => x.meetingId)).toEqual([m.id]);
      return m;
    }

    it('a single edit: hidden in the same write, neither A’s client nor B’s sees them, and it is reported', async () => {
      const moved: unknown[] = [];
      const repo = createPrismaMeetingRepository(prisma, { onClientMinutesHidden: (e) => void moved.push(e) });
      const m = await shownOnA();
      await repo.update(m.id, { projectId: b.id });
      expect(await source.minutes(a.id)).toEqual([]);
      expect(await source.minutes(b.id)).toEqual([]);
      expect(await prisma.meetingMinutes.findUniqueOrThrow({ where: { meetingId: m.id } })).toMatchObject({ clientVisible: false, clientVisibleProjectId: null });
      expect(moved).toEqual([{ meetingId: m.id, fromProjectId: a.id, toProjectId: b.id }]);
    });

    it('an edit that keeps the project (the form sends it anyway) keeps them shown', async () => {
      const moved: unknown[] = [];
      const repo = createPrismaMeetingRepository(prisma, { onClientMinutesHidden: (e) => void moved.push(e) });
      const m = await shownOnA();
      await repo.update(m.id, { projectId: a.id, title: 'Kick-off (renamed)' });
      expect((await source.minutes(a.id)).map((x) => x.meetingId)).toEqual([m.id]);
      expect(moved).toEqual([]);
    });

    it('a series edit that re-files its meetings hides them too', async () => {
      const moved: unknown[] = [];
      const repo = createPrismaMeetingRepository(prisma, { onClientMinutesHidden: (e) => void moved.push(e) });
      const m = await shownOnA();
      await repo.applySeriesChanges([{ id: m.id, patch: { projectId: b.id } }]);
      expect(await source.minutes(a.id)).toEqual([]);
      expect(await source.minutes(b.id)).toEqual([]);
      expect(moved).toEqual([{ meetingId: m.id, fromProjectId: a.id, toProjectId: b.id }]);
    });

    it('defence in depth: minutes still flagged but filed elsewhere (any other way) are never shown', async () => {
      const m = await shownOnA();
      await prisma.meeting.update({ where: { id: m.id }, data: { projectId: b.id } }); // around every service
      expect(await source.minutes(b.id)).toEqual([]);
      expect(await source.minutesOf(b.id, m.id)).toBeNull();
      expect(await source.minutes(a.id)).toEqual([]);
    });
  });

  it('a project marked deleted reads as gone', async () => {
    await prisma.project.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    expect(await source.project(a.id)).toMatchObject({ name: 'Project CVA', gone: true });
    expect(await source.project('no-such-project')).toBeNull();
  });
});
