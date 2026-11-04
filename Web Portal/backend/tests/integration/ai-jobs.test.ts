import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaAiJobStore } from '../../src/modules/ai-jobs/prisma-ai-job-store';
import { createAiJobRunner, type AiJobHandler } from '../../src/modules/ai-jobs/ai-job-runner';
import { createPrismaMicoAiRepository } from '../../src/modules/mico-ai/prisma-mico-ai-repository';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. 1.22 (§10): AI jobs in the
// ai_jobs table — one active job per thing, a take that two servers can't both win, a lease that a
// stopped server loses, and jobs that go with their meeting or MICO AI answer.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaAiJobStore(prisma);
const USER = 'ai-jobs-test-omar';
let meetingId = '';

const job = (subjectId = meetingId) => ({ kind: 'final-minutes' as const, subjectId, meetingId: subjectId, requestedById: USER, input: { facts: 'Meeting: Weekly', baseline: null } });
const error = { message: 'The AI service is busy right now (HTTP 429). Try again in a moment.', code: 'VALIDATION', status: 400 };

async function cleanup() {
  await prisma.aiJob.deleteMany({ where: { requestedById: USER } });
}

beforeAll(async () => {
  await prisma.$connect();
  await prisma.meeting.deleteMany({ where: { organizerId: USER } });
  meetingId = (await prisma.meeting.create({ data: { title: 'AI jobs weekly', status: 'COMPLETED', startAt: new Date(), organizerId: USER, createdById: USER } })).id;
});
afterAll(async () => {
  await cleanup();
  await prisma.micoAiChat.deleteMany({ where: { userId: USER } });
  await prisma.meeting.deleteMany({ where: { organizerId: USER } });
  await prisma.$disconnect();
});
beforeEach(cleanup);

describe('AI jobs in the database (integration)', () => {
  it('one active job per thing: requests at the same moment all join one', async () => {
    const all = await Promise.all(Array.from({ length: 6 }, () => store.create(job(), new Date())));
    expect(new Set(all.map((a) => a.job.id)).size).toBe(1);
    expect(all.filter((a) => !a.joined)).toHaveLength(1);
    expect(await prisma.aiJob.count({ where: { requestedById: USER } })).toBe(1);
    const j = all[0]!.job;
    expect(j).toMatchObject({ kind: 'final-minutes', subjectId: meetingId, meetingId, status: 'QUEUED', attempts: 0, activeKey: `final-minutes:${meetingId}`, input: { facts: 'Meeting: Weekly', baseline: null } });
    expect(await store.active('final-minutes', meetingId)).toMatchObject({ id: j.id });
    expect(await store.activeSubjects('final-minutes', [meetingId, 'nothing'])).toEqual(new Set([meetingId]));
  });

  it('a due job is taken by one server only; its lease token guards every change', async () => {
    const { job: j } = await store.create(job(), new Date());
    const now = new Date();
    const takes = await Promise.all([store.claimDue('srv-1', now, 60_000, 5), store.claimDue('srv-2', now, 60_000, 5), store.claimDue('srv-3', now, 60_000, 5)]);
    const won = takes.flat().filter((t) => t.id === j.id);
    expect(won).toHaveLength(1);
    const token = won[0]!.leaseOwner!;
    expect(won[0]).toMatchObject({ status: 'RUNNING', attempts: 1 });
    expect(await store.renew(j.id, 'srv-9#nope', new Date(Date.now() + 60_000))).toBe(false);
    expect(await store.finish(j.id, 'srv-9#nope', { status: 'DONE', result: { x: 1 } }, new Date())).toBe(false);
    expect(await store.renew(j.id, token, new Date(Date.now() + 60_000))).toBe(true);
    // Not taken again while its lease holds.
    expect((await store.claimDue('srv-2', new Date(), 60_000, 5)).map((t) => t.id)).not.toContain(j.id);
    expect(await store.finish(j.id, token, { status: 'DONE', result: { summary: 'Done.' } }, new Date())).toBe(true);
    expect(await store.get(j.id)).toMatchObject({ status: 'DONE', activeKey: null, leaseOwner: null, result: { summary: 'Done.' }, error: null });
    expect(await store.finish(j.id, token, { status: 'DONE', result: { summary: 'Again.' } }, new Date())).toBe(false);
    // Ended: the next request makes a new job.
    expect((await store.create(job(), new Date())).joined).toBe(false);
  });

  it('a try that failed waits for its time; a lapsed lease (a stopped server) lets another take it over', async () => {
    const { job: j } = await store.create(job(), new Date());
    const [taken] = await store.claimDue('srv-1', new Date(), 60_000, 5);
    const at = new Date(Date.now() + 30_000);
    expect(await store.retryAt(j.id, taken!.leaseOwner!, at, error)).toBe(true);
    expect(await store.get(j.id)).toMatchObject({ status: 'QUEUED', attempts: 1, error, activeKey: `final-minutes:${meetingId}` });
    expect(await store.claimDue('srv-1', new Date(), 60_000, 5)).toEqual([]);
    const [again] = await store.claimDue('srv-2', new Date(at.getTime() + 1), 1, 5);
    expect(again).toMatchObject({ id: j.id, status: 'RUNNING', attempts: 2 });
    // Its 1 ms lease lapses: another server takes it over, and the first one's token no longer works.
    const later = new Date(at.getTime() + 1000);
    const [over] = await store.claimDue('srv-3', later, 60_000, 5);
    expect(over).toMatchObject({ id: j.id, attempts: 3 });
    expect(over!.leaseOwner).not.toBe(again!.leaseOwner);
    expect(await store.finish(j.id, again!.leaseOwner!, { status: 'FAILED', error }, later)).toBe(false);
    expect(await store.finish(j.id, over!.leaseOwner!, { status: 'FAILED', error }, later)).toBe(true);
    expect(await store.get(j.id)).toMatchObject({ status: 'FAILED', error, activeKey: null });
  });

  it('cancel, what became of the result, and the page watching', async () => {
    const { job: j } = await store.create(job(), new Date());
    await store.watch('final-minutes', meetingId, new Date('2026-11-04T08:00:00.000Z'));
    expect((await store.get(j.id))!.watchedAt?.toISOString()).toBe('2026-11-04T08:00:00.000Z');
    expect((await store.cancel('final-minutes', meetingId, new Date()))?.id).toBe(j.id);
    expect(await store.get(j.id)).toMatchObject({ status: 'CANCELLED', activeKey: null });
    expect(await store.cancel('final-minutes', meetingId, new Date())).toBeNull();

    const { job: k } = await store.create(job(), new Date());
    const [t] = await store.claimDue('srv-1', new Date(), 60_000, 5);
    await store.finish(k.id, t!.leaseOwner!, { status: 'DONE', result: { summary: 'Offer.' } }, new Date());
    const at = new Date('2026-11-04T09:00:00.000Z');
    expect(await store.setOutcome(k.id, 'OFFERED', { at })).toBe(true);
    expect(await store.setOutcome(k.id, 'SAVED', { at })).toBe(false); // already has one
    expect(await store.setOutcome(k.id, 'USED', { at, from: ['OFFERED', null] })).toBe(true);
    expect(await store.setOutcome(k.id, 'DISCARDED', { at, from: ['OFFERED', null] })).toBe(false); // used meanwhile
    expect(await store.get(k.id)).toMatchObject({ outcome: 'USED' });
    expect((await store.latest('final-minutes', meetingId))!.id).toBe(k.id);
  });

  it('jobs go with their meeting and with their MICO AI answer', async () => {
    const m = await prisma.meeting.create({ data: { title: 'AI jobs gone', status: 'COMPLETED', startAt: new Date(), organizerId: USER, createdById: USER } });
    const { job: a } = await store.create(job(m.id), new Date());
    const repo = createPrismaMicoAiRepository(prisma);
    const chat = await repo.createChat(USER, 'Jobs');
    const answer = await repo.addMessage(chat.id, { role: 'assistant', text: '', content: null, status: 'PENDING' });
    const { job: b } = await store.create({ kind: 'mico-ai', subjectId: answer.id, messageId: answer.id, requestedById: USER, input: { chatId: chat.id } }, new Date());
    await prisma.meeting.delete({ where: { id: m.id } });
    await repo.deleteChat(USER, chat.id);
    expect(await store.get(a.id)).toBeNull();
    expect(await store.get(b.id)).toBeNull();
  });

  it('the runner over the database: two servers, one try, the result kept once', async () => {
    const kept: string[] = [];
    const calls: string[] = [];
    const handler = (name: string): AiJobHandler => ({
      async run() {
        calls.push(name);
        return { summary: `By ${name}` };
      },
      async save(j) {
        kept.push(j.id);
        return { outcome: 'SAVED' };
      },
      describe: () => ({ message: 'x', code: null, status: 500 }),
    });
    const one = createAiJobRunner({ store, owner: 'srv-1' });
    const two = createAiJobRunner({ store, owner: 'srv-2' });
    one.register('final-minutes', handler('one'));
    two.register('final-minutes', handler('two'));
    const { job: j } = await store.create(job(), new Date());
    await Promise.all([one.sweep(), two.sweep(), one.sweep(), two.sweep()]);
    await Promise.all([one.idle(), two.idle()]);
    expect(calls).toHaveLength(1);
    expect(kept).toEqual([j.id]);
    expect(await store.get(j.id)).toMatchObject({ status: 'DONE', outcome: 'SAVED', attempts: 1 });
  });
});
