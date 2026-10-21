import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaMeetingRepository(prisma);
const HOUR = 3_600_000;

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

const row = (title: string, startAt: Date) => ({ title, status: 'SCHEDULED' as const, startAt, organizerId: 'someone', createdById: 'someone' });

describe('PrismaMeetingRepository.list without a range (integration)', () => {
  it('keeps today’s and the recent meetings when many repeats lie ahead, newest first', async () => {
    const now = Date.now();
    // Twenty repeating meetings make hundreds of copies weeks ahead.
    await prisma.meeting.createMany({ data: Array.from({ length: 520 }, (_, i) => row(`Repeat ${i}`, new Date(now + (48 + i) * HOUR))) });
    await prisma.meeting.createMany({
      data: [row('Later today', new Date(now + 2 * HOUR)), row('Earlier today', new Date(now - 2 * HOUR)), row('Last week', new Date(now - 7 * 24 * HOUR))],
    });

    const list = await repo.list({});
    const titles = list.map((m) => m.title);
    expect(titles).toContain('Later today');
    expect(titles).toContain('Earlier today');
    expect(titles).toContain('Last week');
    expect(titles).toHaveLength(523);
    // Newest first, as before.
    const starts = list.map((m) => m.startAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
  });

  it('keeps the 500 most recent past meetings and every upcoming one (up to 2000)', async () => {
    const now = Date.now();
    await prisma.meeting.createMany({ data: Array.from({ length: 510 }, (_, i) => row(`Past ${i}`, new Date(now - (1 + i) * HOUR))) });
    await prisma.meeting.createMany({ data: Array.from({ length: 30 }, (_, i) => row(`Next ${i}`, new Date(now + (1 + i) * HOUR))) });

    const titles = (await repo.list({})).map((m) => m.title);
    expect(titles.filter((t) => t.startsWith('Next'))).toHaveLength(30);
    expect(titles.filter((t) => t.startsWith('Past'))).toHaveLength(500);
    expect(titles).toContain('Past 0'); // the most recent past one
    expect(titles).not.toContain('Past 509'); // the oldest are left out
  });

  it('lists a range in order, as before', async () => {
    const now = Date.now();
    await prisma.meeting.createMany({ data: [row('B', new Date(now + 3 * HOUR)), row('A', new Date(now + 1 * HOUR)), row('Out', new Date(now + 30 * HOUR))] });
    const titles = (await repo.list({ from: new Date(now), to: new Date(now + 10 * HOUR) })).map((m) => m.title);
    expect(titles).toEqual(['A', 'B']);
  });
});
