import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type MeetingStatus } from '@prisma/client';
import { createPrismaMeetingReminderSource, createPrismaMeetingReminderStore } from '../../src/modules/meetings/prisma-meeting-reminders';
import { reminderKey, type ReminderSendKey } from '../../src/modules/meetings/meeting-reminder-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaMeetingReminderStore(prisma);
const source = createPrismaMeetingReminderSource(prisma);

const TAG = 'reminders-it';
const NOW = new Date('2026-10-31T04:45:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
let org = '';
let ann = '';
let gone = '';

async function cleanup() {
  await prisma.meeting.deleteMany({ where: { title: { startsWith: TAG } } }); // its reminder sends go with it
  await prisma.project.deleteMany({ where: { code: 'RMDIT' } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@reminders-it.test' } } });
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
  const user = (name: string, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email: `${name}@reminders-it.test`, username: `${name}-rmd`, passwordHash: 'x', firstName: name, lastName: 'Test', ...extra } });
  org = (await user('org', { preferredTimeZone: 'Europe/London' })).id;
  ann = (await user('ann', { notificationPrefs: { muted: ['MEETING_REMINDER', 'MENTION'] } })).id;
  gone = (await user('gone', { status: 'INACTIVE' })).id;
});

async function meeting(title: string, startAt: Date, over: { status?: MeetingStatus; deleted?: boolean; projectId?: string | null } = {}) {
  return prisma.meeting.create({
    data: {
      title: `${TAG} ${title}`, status: over.status ?? 'SCHEDULED', startAt, endAt: new Date(startAt.getTime() + 3600_000), organizerId: org, createdById: org,
      timeZone: 'Asia/Muscat', location: 'Room 2', projectId: over.projectId ?? null, deletedAt: over.deleted ? NOW : null,
    },
  });
}

describe('the meeting reminder sends store (integration)', () => {
  type Reservation = ReminderSendKey & { userId: string | null; email: string | null };
  const key = (meetingId: string, over: Partial<Reservation> = {}): Reservation => ({
    meetingId, recipientKey: `user:${org}`, offsetMinutes: 15, startAt: at(15), channel: 'APP', userId: org, email: null, ...over,
  });

  it('takes each send once — also when several servers try at the same moment', async () => {
    const m = await meeting('Review', at(15));
    const tries = await Promise.all([1, 2, 3, 4].map(() => store.reserve(key(m.id))));
    expect(tries.filter(Boolean)).toHaveLength(1);
    // Another way, time, start or person is another send.
    expect(await store.reserve(key(m.id, { channel: 'EMAIL', email: 'org@reminders-it.test' }))).not.toBeNull();
    expect(await store.reserve(key(m.id, { offsetMinutes: 720 }))).not.toBeNull();
    expect(await store.reserve(key(m.id, { startAt: at(75) }))).not.toBeNull();
    expect(await store.reserve(key(m.id, { recipientKey: 'guest:a@client.test', userId: null }))).not.toBeNull();
    const taken = await store.takenFor([m.id]);
    expect(taken.size).toBe(5);
    expect(taken.has(reminderKey(key(m.id)))).toBe(true);
  });

  it('a send written down as sent stays taken; one given back can be taken again', async () => {
    const m = await meeting('Review', at(15));
    const id = (await store.reserve(key(m.id)))!;
    await store.finish(id, 'SENT', NOW);
    expect(await prisma.meetingReminderSend.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'SENT', sentAt: NOW });
    await store.release(id); // only a send still being sent can be given back
    expect(await store.reserve(key(m.id))).toBeNull();

    const other = (await store.reserve(key(m.id, { channel: 'EMAIL' })))!;
    await store.release(other);
    expect(await store.reserve(key(m.id, { channel: 'EMAIL' }))).not.toBeNull();
  });

  it('forgets the sends of meetings long past, and a deleted meeting’s with it', async () => {
    const old = await meeting('Old', at(-60 * 24 * 40));
    const soon = await meeting('Soon', at(15));
    await store.reserve(key(old.id, { startAt: old.startAt }));
    await store.reserve(key(soon.id));
    expect(await store.prune(at(-60 * 24 * 30))).toBe(1);
    expect((await store.takenFor([old.id, soon.id])).size).toBe(1);
    await prisma.meeting.delete({ where: { id: soon.id } });
    expect(await prisma.meetingReminderSend.count({ where: { meetingId: soon.id } })).toBe(0);
  });
});

describe('the meeting reminder source (integration)', () => {
  it('finds scheduled meetings starting in a window — not drafts, cancelled, started, deleted or outside it', async () => {
    const project = await prisma.project.create({ data: { name: 'Core switch', code: 'RMDIT', ownerId: org, createdById: org } });
    const due = await meeting('Due', at(15), { projectId: project.id });
    await meeting('Draft', at(15), { status: 'DRAFT' });
    await meeting('Cancelled', at(14), { status: 'CANCELLED' });
    await meeting('Started early', at(13), { status: 'IN_PROGRESS' });
    await meeting('Deleted', at(12), { deleted: true });
    await meeting('Too late', at(5));
    await meeting('Not yet', at(16));
    const tomorrow = await meeting('Tomorrow', at(24 * 60));
    await prisma.meetingAttendee.createMany({
      data: [
        { meetingId: due.id, userId: ann, response: 'ACCEPTED' },
        { meetingId: due.id, externalName: 'Guest', externalEmail: 'guest@client.test' },
      ],
    });

    const found = await source.dueMeetings([
      { from: at(5), to: at(15) },
      { from: at(24 * 60 - 10), to: at(24 * 60) },
    ]);
    expect(found.map((m) => m.title).sort()).toEqual([`${TAG} Due`, `${TAG} Tomorrow`]);
    const d = found.find((m) => m.id === due.id)!;
    expect(d).toMatchObject({ projectName: 'Core switch', timeZone: 'Asia/Muscat', location: 'Room 2', organizerId: org, status: 'SCHEDULED' });
    expect(d.attendees.map((a) => a.userId ?? a.externalEmail).sort()).toEqual([ann, 'guest@client.test'].sort());
    expect(found.find((m) => m.id === tomorrow.id)!.projectName).toBeNull();
    expect(await source.dueMeetings([])).toEqual([]);
  });

  it('looks up active colleagues only, with their own time zone and the meeting-reminder switch', async () => {
    const people = await source.people([org, ann, gone, 'nobody']);
    expect([...people.keys()].sort()).toEqual([org, ann].sort());
    expect(people.get(org)).toEqual({ userId: org, name: 'org Test', email: 'org@reminders-it.test', timeZone: 'Europe/London', muted: false });
    expect(people.get(ann)).toMatchObject({ timeZone: null, muted: true });
    expect((await source.people([])).size).toBe(0);
  });
});
