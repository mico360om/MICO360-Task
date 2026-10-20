import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type MeetingStatus } from '@prisma/client';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaMeetingRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.meeting.deleteMany();
});

const NOW = new Date('2026-10-21T10:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

async function meeting(title: string, status: MeetingStatus, startAt: Date, endAt: Date | null, deleted = false) {
  return prisma.meeting.create({
    data: { title, status, startAt, endAt, organizerId: 'u1', createdById: 'u1', deletedAt: deleted ? ago(1) : null },
  });
}

describe('PrismaMeetingRepository.completeEnded (integration)', () => {
  it('marks scheduled and started meetings Completed once their end time has passed, and nothing else', async () => {
    const ended = await meeting('Ended', 'SCHEDULED', ago(120), ago(60));
    const started = await meeting('Started, ran past its end', 'IN_PROGRESS', ago(90), ago(30));
    const noEnd = await meeting('No end, started over an hour ago', 'SCHEDULED', ago(61), null);
    const stillOn = await meeting('Still on', 'SCHEDULED', ago(30), new Date(NOW.getTime() + 30 * 60_000));
    const noEndRecent = await meeting('No end, started 59 min ago', 'SCHEDULED', ago(59), null);
    const draft = await meeting('Draft', 'DRAFT', ago(120), ago(60));
    const cancelled = await meeting('Cancelled', 'CANCELLED', ago(120), ago(60));
    const deleted = await meeting('Deleted', 'SCHEDULED', ago(120), ago(60), true);

    const done = await repo.completeEnded(NOW);

    expect(done.sort()).toEqual([ended.id, started.id, noEnd.id].sort());
    const status = async (id: string) => (await prisma.meeting.findUniqueOrThrow({ where: { id } })).status;
    for (const m of [ended, started, noEnd]) expect(await status(m.id)).toBe('COMPLETED');
    expect(await status(stillOn.id)).toBe('SCHEDULED');
    expect(await status(noEndRecent.id)).toBe('SCHEDULED');
    expect(await status(draft.id)).toBe('DRAFT');
    expect(await status(cancelled.id)).toBe('CANCELLED');
    expect(await status(deleted.id)).toBe('SCHEDULED');
  });

  it('returns nothing when no meeting has ended', async () => {
    await meeting('Tomorrow', 'SCHEDULED', new Date(NOW.getTime() + 864e5), null);
    expect(await repo.completeEnded(NOW)).toEqual([]);
  });
});
