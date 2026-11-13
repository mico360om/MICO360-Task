import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaJobLockStore, runExclusive } from '../../src/lib/job-lock';

// N7 + #34 (13 Nov 2026): job leases were never handed back, so a job ran at the slower of its lease and
// its interval (meeting completion every 10 minutes instead of 5, guest conversion every 10 instead of 1).
// A run now hands its lease back when it ends — even when it throws — and only while it still holds it.
// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaJobLockStore(prisma);
const NAMES = ['sb4a-sweep', 'sb4a-throws', 'sb4a-owner'];

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await prisma.jobLock.deleteMany({ where: { name: { in: NAMES } } });
});
afterAll(async () => {
  await prisma.jobLock.deleteMany({ where: { name: { in: NAMES } } });
  await prisma.$disconnect();
});

describe('job leases on the database (N7)', () => {
  it('a finished run hands its lease back: the next tick, minutes later and well inside the old lease, runs', async () => {
    let t = Date.now();
    const now = () => new Date(t);
    let ran = 0;
    expect(await runExclusive(store, 'sb4a-sweep', 10 * 60_000, now, async () => void ran++)).toBe(true);
    t += 5 * 60_000;
    expect(await runExclusive(store, 'sb4a-sweep', 10 * 60_000, now, async () => void ran++)).toBe(true);
    expect(ran).toBe(2);
    const row = await prisma.jobLock.findUniqueOrThrow({ where: { name: 'sb4a-sweep' } });
    expect(row.lockedUntil.getTime()).toBeLessThanOrEqual(t);
  });

  it('a run that throws hands its lease back too', async () => {
    const now = () => new Date();
    await expect(runExclusive(store, 'sb4a-throws', 10 * 60_000, now, async () => { throw new Error('the sweep failed'); })).rejects.toThrow('the sweep failed');
    expect(await runExclusive(store, 'sb4a-throws', 10 * 60_000, now, async () => {})).toBe(true);
  });

  it('while a run is going its lease holds; a hand-back by a holder whose lease was taken over changes nothing', async () => {
    const t = Date.now();
    expect(await store.tryAcquire('sb4a-owner', 60_000, new Date(t), 'holder-a')).toBe(true);
    expect(await store.tryAcquire('sb4a-owner', 60_000, new Date(t + 1000), 'holder-b')).toBe(false);
    // A's lease ran out while it was still going; B takes the lock.
    expect(await store.tryAcquire('sb4a-owner', 10 * 60_000, new Date(t + 2 * 60_000), 'holder-b')).toBe(true);
    await store.release!('sb4a-owner', 'holder-a', new Date(t + 3 * 60_000));
    expect(await store.tryAcquire('sb4a-owner', 60_000, new Date(t + 3 * 60_000), 'holder-c')).toBe(false);
    await store.release!('sb4a-owner', 'holder-b', new Date(t + 4 * 60_000));
    expect(await store.tryAcquire('sb4a-owner', 60_000, new Date(t + 4 * 60_000), 'holder-c')).toBe(true);
  });
});
