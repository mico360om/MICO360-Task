import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDailyEmailRepository } from '../../src/modules/daily-emails/prisma-daily-email-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaDailyEmailRepository(prisma);
let userId = '';

async function cleanup() {
  await prisma.dailyTaskEmail.deleteMany({ where: { user: { email: 'daily@mico360.test' } } });
  await prisma.user.deleteMany({ where: { email: 'daily@mico360.test' } });
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
  userId = (await prisma.user.create({ data: { email: 'daily@mico360.test', username: 'daily', passwordHash: 'x', firstName: 'Dai', lastName: 'Ly' } })).id;
});

describe('PrismaDailyEmailRepository (integration)', () => {
  it('lets only one claim through for a person, day and email, even at the same moment', async () => {
    const claims = await Promise.all([1, 2, 3, 4].map(() => repo.claim(userId, '2026-10-21', 'PENDING')));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ status: 'SENDING', attempts: 1, day: '2026-10-21', kind: 'PENDING' });
    // The other email, and the next day, are separate.
    expect(await repo.claim(userId, '2026-10-21', 'COMPLETED')).not.toBeNull();
    expect(await repo.claim(userId, '2026-10-22', 'PENDING')).not.toBeNull();
  });

  it('finds retries that are due and sends stuck since a crash, and only one sweep retakes each', async () => {
    const now = new Date('2026-10-21T03:00:00Z');
    const a = (await repo.claim(userId, '2026-10-21', 'PENDING'))!;
    await repo.finish(a, { status: 'RETRY', nextAttemptAt: new Date('2026-10-21T02:55:00Z'), lastError: 'HTTP 503' });
    const b = (await repo.claim(userId, '2026-10-21', 'COMPLETED'))!;
    await repo.finish(b, { status: 'RETRY', nextAttemptAt: new Date('2026-10-21T03:30:00Z') }); // not yet
    const stuck = (await repo.claim(userId, '2026-10-20', 'PENDING'))!;
    await prisma.dailyTaskEmail.update({ where: { id: stuck.id }, data: { updatedAt: new Date('2026-10-21T02:00:00Z') } });

    const due = await repo.dueForRetry(now, new Date('2026-10-21T02:45:00Z'));
    expect(due.map((r) => r.id).sort()).toEqual([a.id, stuck.id].sort());

    const row = due.find((r) => r.id === a.id)!;
    const [first, second] = await Promise.all([repo.retake(row), repo.retake(row)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((first ?? second)!).toMatchObject({ status: 'SENDING', attempts: 2 });
  });

  it('keeps the delivery log, with who it was for, newest first and filtered', async () => {
    const a = (await repo.claim(userId, '2026-10-21', 'PENDING'))!;
    await repo.finish(a, { status: 'SENT', taskCount: 4, sentAt: new Date('2026-10-21T02:00:05Z') });
    const b = (await repo.claim(userId, '2026-10-21', 'COMPLETED'))!;
    await repo.finish(b, { status: 'SKIPPED', taskCount: 0 });
    const all = await repo.list({ day: '2026-10-21' });
    expect(all.map((r) => r.kind)).toEqual(['COMPLETED', 'PENDING']);
    expect(all[1]).toMatchObject({ status: 'SENT', taskCount: 4, userName: 'Dai Ly', email: 'daily@mico360.test' });
    expect((await repo.list({ day: '2026-10-21', status: 'SENT' })).map((r) => r.kind)).toEqual(['PENDING']);
  });

  it('finds one person’s record for a day and email, or none', async () => {
    const a = (await repo.claim(userId, '2026-10-21', 'PENDING'))!;
    await repo.finish(a, { status: 'SENT', taskCount: 2, sentAt: new Date('2026-10-21T02:00:05Z') });
    expect(await repo.find(userId, '2026-10-21', 'PENDING')).toMatchObject({ id: a.id, status: 'SENT', taskCount: 2 });
    expect(await repo.find(userId, '2026-10-21', 'COMPLETED')).toBeNull();
    expect(await repo.find(userId, '2026-10-22', 'PENDING')).toBeNull();
  });

  it('reads every record of the days asked for (the admins’ overview)', async () => {
    await repo.claim(userId, '2026-10-20', 'PENDING');
    await repo.claim(userId, '2026-10-21', 'PENDING');
    await repo.claim(userId, '2026-10-21', 'COMPLETED');
    await repo.claim(userId, '2026-10-22', 'PENDING');
    const mine = (await repo.forDays(['2026-10-21', '2026-10-22'])).filter((r) => r.userId === userId);
    expect(mine.map((r) => `${r.day} ${r.kind}`).sort()).toEqual(['2026-10-21 COMPLETED', '2026-10-21 PENDING', '2026-10-22 PENDING']);
    expect(await repo.forDays([])).toEqual([]);
  });

  it('writes down how an attempt went only while that attempt still holds the row', async () => {
    const a = (await repo.claim(userId, '2026-10-21', 'PENDING'))!; // attempt 1
    // It hung so long it was taken again (attempt 2), and that one went.
    await prisma.dailyTaskEmail.update({ where: { id: a.id }, data: { updatedAt: new Date('2026-10-21T02:00:00Z') } });
    const again = (await repo.retake(a))!;
    expect(await repo.finish(again, { status: 'SENT', taskCount: 1, sentAt: new Date('2026-10-21T02:20:00Z'), nextAttemptAt: null, lastError: null })).toBe(true);
    // The first attempt finally fails: what the second one wrote down stands.
    expect(await repo.finish(a, { status: 'RETRY', lastError: 'Timed out', nextAttemptAt: new Date('2026-10-21T02:25:00Z') })).toBe(false);
    expect(await repo.find(userId, '2026-10-21', 'PENDING')).toMatchObject({ status: 'SENT', attempts: 2, lastError: null, nextAttemptAt: null });
    // Nor twice by the same attempt.
    expect(await repo.finish(again, { status: 'FAILED', lastError: 'x' })).toBe(false);
  });

  it('an administrator’s failed try sets the attempts back, so the automatic retries stay', async () => {
    const a = (await repo.claim(userId, '2026-10-21', 'PENDING'))!;
    await repo.finish(a, { status: 'RETRY', nextAttemptAt: new Date('2026-10-21T02:05:00Z'), lastError: 'HTTP 503' });
    const retry = (await repo.find(userId, '2026-10-21', 'PENDING'))!;
    const taken = (await repo.retake(retry))!;
    expect(taken.attempts).toBe(2);
    await repo.finish(taken, { status: 'RETRY', attempts: 1, nextAttemptAt: retry.nextAttemptAt, lastError: 'HTTP 502' });
    expect(await repo.find(userId, '2026-10-21', 'PENDING')).toMatchObject({ status: 'RETRY', attempts: 1, nextAttemptAt: new Date('2026-10-21T02:05:00Z'), lastError: 'HTTP 502' });
  });

  it('taking a row again moves its last change on, so a send just taken never looks stuck', async () => {
    const a = (await repo.claim(userId, '2026-10-21', 'PENDING'))!;
    const old = new Date('2026-10-21T02:00:00Z');
    await prisma.dailyTaskEmail.update({ where: { id: a.id }, data: { updatedAt: old } });
    const stuck = (await repo.dueForRetry(new Date(), new Date(Date.now() - 15 * 60_000))).find((r) => r.id === a.id)!;
    expect(stuck.updatedAt).toEqual(old);
    const taken = (await repo.retake(stuck))!;
    expect(taken.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await repo.dueForRetry(new Date(), new Date(Date.now() - 15 * 60_000))).some((r) => r.id === a.id)).toBe(false);
  });

  it('lets only one administrator’s resend take a sent email at the same moment', async () => {
    const a = (await repo.claim(userId, '2026-10-21', 'PENDING'))!;
    await repo.finish(a, { status: 'SENT', taskCount: 1, sentAt: new Date('2026-10-21T02:00:05Z') });
    const sent = (await repo.find(userId, '2026-10-21', 'PENDING'))!;
    const takes = await Promise.all([repo.retake(sent), repo.retake(sent), repo.retake(sent)]);
    expect(takes.filter(Boolean)).toHaveLength(1);
    expect(takes.find(Boolean)).toMatchObject({ status: 'SENDING', attempts: 2, sentAt: new Date('2026-10-21T02:00:05Z') });
  });
});
