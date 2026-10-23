import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDailyEmailRepository } from '../../src/modules/daily-emails/prisma-daily-email-repository';
import { createPrismaDailyEmailSources } from '../../src/modules/daily-emails/prisma-daily-email-sources';
import { createDailyEmailService } from '../../src/modules/daily-emails/daily-email-service';
import type { DailyTask } from '../../src/modules/daily-emails/daily-email-content';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Nothing is emailed: the
// sender only writes down what it was given.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const repo = createPrismaDailyEmailRepository(prisma);
const sources = createPrismaDailyEmailSources(prisma);
const EMAILS = ['dadm-ada@mico360.test', 'dadm-bo@mico360.test'];
let ada = '';
let bo = '';

const task = (key: string): DailyTask => ({ id: key, key, title: key, projectName: 'Rig', priority: 'NORMAL', dueDate: null, statusLabel: 'To Do', completedAt: new Date('2026-10-20T08:00:00Z') });

function makeService(now: Date) {
  const sent: string[] = [];
  const service = createDailyEmailService({
    repo,
    // Only this test's people: the shared test database may hold others.
    people: {
      list: async () => (await sources.people.list()).filter((p) => EMAILS.includes(p.email ?? '')),
      find: (id) => sources.people.find(id),
    },
    tasks: { pending: async () => [task('RIG-1')], completedBetween: async () => [task('RIG-2')] },
    send: async (to, _content, template) => {
      await new Promise((r) => setTimeout(r, 5)); // a real send takes a moment: let the others run meanwhile
      sent.push(`${to} ${template}`);
    },
    isConfigured: () => true,
    companyTimeZone: 'Asia/Muscat',
    appUrl: 'https://task.example',
    now: () => now,
  });
  return { service, sent };
}

async function cleanup() {
  await prisma.dailyTaskEmail.deleteMany({ where: { user: { email: { in: EMAILS } } } });
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
  const joined = new Date('2026-01-01T00:00:00Z');
  ada = (await prisma.user.create({ data: { email: EMAILS[0]!, username: 'dadm-ada', passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', createdAt: joined } })).id;
  bo = (
    await prisma.user.create({
      data: {
        email: EMAILS[1]!, username: 'dadm-bo', passwordHash: 'x', firstName: 'Bo', lastName: 'Admin', createdAt: joined,
        preferredTimeZone: 'Asia/Kolkata', notificationPrefs: { muted: [], dailyEmails: { pending: true, completed: false, time: '07:00' } },
      },
    })
  ).id;
});

describe('Daily task emails: administrators’ sends and the sweep (integration)', () => {
  it('"Send now" twice and the sweep at the same moment: each email goes once, with one record', async () => {
    const { service, sent } = makeService(new Date('2026-10-21T02:00:00Z')); // 06:00 Muscat, 07:30 Kolkata
    await Promise.all([service.sendNow(), service.runSweep(), service.sendNow(), service.sendFor(ada)]);
    expect(sent.sort()).toEqual([
      'dadm-ada@mico360.test daily-completed',
      'dadm-ada@mico360.test daily-pending',
      'dadm-bo@mico360.test daily-pending',
    ]);
    const rows = await prisma.dailyTaskEmail.findMany({ where: { userId: { in: [ada, bo] } } });
    expect(rows.map((r) => `${r.userId === ada ? 'ada' : 'bo'} ${r.kind} ${r.status} ${r.attempts}`).sort()).toEqual([
      'ada COMPLETED SENT 1',
      'ada PENDING SENT 1',
      'bo PENDING SENT 1',
    ]);
    // Later that day nothing goes again.
    const later = makeService(new Date('2026-10-21T09:00:00Z'));
    await later.service.runSweep();
    expect(await later.service.sendNow()).toMatchObject({ sent: 0, alreadyDone: 3, off: 1 });
    expect(later.sent).toEqual([]);
  });

  it('sent before the person’s time, it counts as today’s: the sweep at their time sends nothing', async () => {
    const early = makeService(new Date('2026-10-21T00:30:00Z')); // 04:30 Muscat, 06:00 Kolkata: before both
    expect(await early.service.sendNow()).toMatchObject({ sent: 3 });
    const atTheirTime = makeService(new Date('2026-10-21T02:00:00Z'));
    await atTheirTime.service.runSweep();
    expect(atTheirTime.sent).toEqual([]);
  });

  it('a failed email taken again by two sends at once goes once; a resend keeps the one record', async () => {
    const failed = (await repo.claim(ada, '2026-10-21', 'PENDING'))!;
    await repo.finish(failed.id, { status: 'FAILED', lastError: 'HTTP 503' });
    const { service, sent } = makeService(new Date('2026-10-21T03:00:00Z'));
    await Promise.all([service.sendFor(ada, { kind: 'PENDING' }), service.sendFor(ada, { kind: 'PENDING' })]);
    expect(sent).toEqual(['dadm-ada@mico360.test daily-pending']);
    await service.sendFor(ada, { kind: 'PENDING', resend: true });
    expect(sent).toHaveLength(2);
    const rows = await prisma.dailyTaskEmail.findMany({ where: { userId: ada, kind: 'PENDING' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SENT', attempts: 3, lastError: null, sentAt: new Date('2026-10-21T03:00:00Z') });
  });

  it('the overview reads each person’s records for their own day', async () => {
    const { service } = makeService(new Date('2026-10-21T02:00:00Z'));
    await service.sendFor(ada, { kind: 'PENDING' });
    const failed = (await repo.claim(bo, '2026-10-21', 'PENDING'))!;
    await repo.finish(failed.id, { status: 'RETRY', nextAttemptAt: new Date('2026-10-21T02:20:00Z'), lastError: 'HTTP 503' });
    await repo.claim(ada, '2026-10-20', 'PENDING'); // another day: not shown for today

    const o = await service.overview();
    expect(o.people.map((p) => p.name)).toEqual(['Ada Admin', 'Bo Admin']);
    const [a, b] = o.people;
    expect(a).toMatchObject({ day: '2026-10-21', timeZone: 'Asia/Muscat', ownTimeZone: false, time: '06:00' });
    expect(a!.pending).toMatchObject({ state: 'SENT', taskCount: 1, sentAt: new Date('2026-10-21T02:00:00Z') });
    expect(a!.completed).toMatchObject({ state: 'DUE', dueAt: new Date('2026-10-21T02:00:00Z') });
    expect(b).toMatchObject({ day: '2026-10-21', timeZone: 'Asia/Kolkata', ownTimeZone: true, time: '07:00' });
    expect(b!.pending).toMatchObject({ state: 'RETRY', lastError: 'HTTP 503', nextAttemptAt: new Date('2026-10-21T02:20:00Z') });
    expect(b!.completed).toMatchObject({ on: false, state: 'OFF' });
    expect(o.summary).toEqual({ people: 2, sent: 1, skipped: 0, failed: 0, retrying: 1, sending: 0, upcoming: 1, toSend: 2 });

    const yesterday = await service.overview('2026-10-20');
    expect(yesterday.people[0]!.pending).toMatchObject({ state: 'SENDING' });
    expect(yesterday.people[1]!.pending).toMatchObject({ state: 'NONE' });
  });
});
