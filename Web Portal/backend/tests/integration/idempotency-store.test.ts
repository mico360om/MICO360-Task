import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaIdempotencyStore, PENDING_STATUS } from '../../src/lib/idempotency';

// Review fix #27 (13 Nov 2026), against the database: a key left pending is taken over only once its
// lease is over and only while still pending; the daily clean-up removes records past their 24 hours.
// Only this file's people (emails ending in @idem.test) and their keys are made and removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaIdempotencyStore(prisma);
const DOMAIN = '@idem.test';
let userId = '';

async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
const age = (key: string, minutes: number) =>
  prisma.idempotencyKey.updateMany({ where: { userId, key }, data: { createdAt: new Date(Date.now() - minutes * 60_000) } });

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  await clean();
  userId = (await prisma.user.create({ data: { email: `ada${DOMAIN}`, username: 'idem-ada', passwordHash: 'x', firstName: 'Ada', lastName: 'L' } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('Prisma idempotency store (database)', () => {
  it('find returns when the key was reserved', async () => {
    await store.reserve({ userId, key: 'k1', method: 'POST', path: '/api/v1/tasks' });
    const rec = await store.find(userId, 'k1');
    expect(rec?.statusCode).toBe(PENDING_STATUS);
    expect(rec?.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(rec!.createdAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('reclaim takes over a pending key only past the lease, and never a finished one', async () => {
    await store.reserve({ userId, key: 'young', method: 'POST', path: '/x' });
    await store.reserve({ userId, key: 'old', method: 'POST', path: '/x' });
    await store.reserve({ userId, key: 'done', method: 'POST', path: '/x' });
    await store.complete(userId, 'done', 201, '{"data":1}');
    await age('old', 11);
    await age('done', 11);
    const cutoff = new Date(Date.now() - 10 * 60_000);
    expect(await store.reclaim!(userId, 'young', cutoff)).toBe(false);
    expect(await store.reclaim!(userId, 'done', cutoff)).toBe(false);
    expect(await store.reclaim!(userId, 'old', cutoff)).toBe(true);
    expect(await store.find(userId, 'old')).toBeNull();
    expect(await store.find(userId, 'young')).not.toBeNull();
    expect((await store.find(userId, 'done'))?.statusCode).toBe(201);
    // …and the key is free for the retry.
    expect(await store.reserve({ userId, key: 'old', method: 'POST', path: '/x' })).toBe(true);
  });

  it('purgeOlderThan removes records past their 24 hours, pending or finished', async () => {
    await store.reserve({ userId, key: 'p', method: 'POST', path: '/x' });
    await store.reserve({ userId, key: 'f', method: 'POST', path: '/x' });
    await store.complete(userId, 'f', 201, '{}');
    await store.reserve({ userId, key: 'today', method: 'POST', path: '/x' });
    await age('p', 25 * 60);
    await age('f', 25 * 60);
    await store.purgeOlderThan(new Date(Date.now() - 24 * 60 * 60_000));
    expect(await store.find(userId, 'p')).toBeNull();
    expect(await store.find(userId, 'f')).toBeNull();
    expect(await store.find(userId, 'today')).not.toBeNull();
  });
});
