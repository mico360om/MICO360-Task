import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type MeetingStatus } from '@prisma/client';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaMeetingRepository(prisma);
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+04:00`);

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.meeting.deleteMany();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.meeting.deleteMany();
});

async function meeting(title: string, start: string, end: string | null, opts: { organizer?: string; attendees?: string[]; status?: MeetingStatus; deleted?: boolean } = {}) {
  return prisma.meeting.create({
    data: {
      title,
      status: opts.status ?? 'SCHEDULED',
      startAt: at(start),
      endAt: end ? at(end) : null,
      organizerId: opts.organizer ?? 'someone',
      createdById: 'someone',
      deletedAt: opts.deleted ? new Date() : null,
      attendees: { create: (opts.attendees ?? []).map((userId) => ({ userId })) },
    },
  });
}

describe('PrismaMeetingRepository.busyBetween (integration)', () => {
  it('finds meetings a person organizes or attends in the window, not cancelled or deleted ones, and an hour for no end', async () => {
    const organized = await meeting('Organized by Omar', '2026-10-26 09:00', '2026-10-26 10:00', { organizer: 'omar' });
    const attended = await meeting('Sara attends', '2026-10-26 11:00', null, { attendees: ['sara', 'ali'] });
    await meeting('Cancelled', '2026-10-26 12:00', '2026-10-26 13:00', { organizer: 'omar', status: 'CANCELLED' });
    await meeting('Deleted', '2026-10-26 13:00', '2026-10-26 14:00', { organizer: 'omar', deleted: true });
    await meeting('Nobody asked', '2026-10-26 14:00', '2026-10-26 15:00', { organizer: 'zaid' });
    await meeting('Next week', '2026-11-05 09:00', '2026-11-05 10:00', { organizer: 'omar' });

    const busy = await repo.busyBetween(['omar', 'sara'], at('2026-10-26 00:00'), at('2026-10-27 00:00'));
    expect(busy.map((b) => b.title).sort()).toEqual(['Organized by Omar', 'Sara attends']);
    const a = busy.find((b) => b.meetingId === attended.id)!;
    expect(a.end.toISOString()).toBe(at('2026-10-26 12:00').toISOString()); // no end: an hour
    expect(a.userIds).toEqual(['sara']); // only the people asked about
    expect(busy.find((b) => b.meetingId === organized.id)!.userIds).toEqual(['omar']);
  });

  it('leaves out the meeting being edited', async () => {
    const m = await meeting('This one', '2026-10-26 09:00', '2026-10-26 10:00', { organizer: 'omar' });
    expect(await repo.busyBetween(['omar'], at('2026-10-26 00:00'), at('2026-10-27 00:00'), m.id)).toEqual([]);
  });

  it('counts a meeting that started before the window but runs into it', async () => {
    await meeting('Long one', '2026-10-25 22:00', '2026-10-26 09:00', { organizer: 'omar' });
    expect((await repo.busyBetween(['omar'], at('2026-10-26 00:00'), at('2026-10-27 00:00'))).map((b) => b.title)).toEqual(['Long one']);
  });

  it('says in one look-up which meetings a person may see: theirs, or in a project they can see', async () => {
    const owner = await prisma.user.create({ data: { email: 'bm-owner@mico360.test', username: 'bm-owner', passwordHash: 'x', firstName: 'Busy', lastName: 'Owner' } });
    const project = await prisma.project.create({ data: { code: 'BMVIS', name: 'Busy visibility', status: 'ACTIVE', createdById: owner.id, ownerId: owner.id } });
    try {
      const organized = await meeting('Hers', '2026-10-26 09:00', null, { organizer: 'sara' });
      const invited = await meeting('Invited', '2026-10-26 10:00', null, { organizer: 'omar', attendees: ['sara'] });
      const inProject = await prisma.meeting.create({ data: { title: 'Project one', status: 'SCHEDULED', startAt: at('2026-10-26 11:00'), organizerId: 'omar', createdById: 'omar', projectId: project.id } });
      const secret = await meeting('Not hers', '2026-10-26 12:00', null, { organizer: 'omar' });
      const ids = [organized.id, invited.id, inProject.id, secret.id];
      expect(await repo.visibleTo!(ids, 'sara', [])).toEqual(new Set([organized.id, invited.id]));
      expect(await repo.visibleTo!(ids, 'sara', [project.id])).toEqual(new Set([organized.id, invited.id, inProject.id]));
      expect(await repo.visibleTo!(ids, 'sara', null)).toEqual(new Set(ids)); // an admin
    } finally {
      await prisma.meeting.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });
});
