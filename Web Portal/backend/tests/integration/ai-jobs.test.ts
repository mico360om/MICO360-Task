import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaAiJobStore } from '../../src/modules/ai-jobs/prisma-ai-job-store';
import { createAiJobRunner, type AiJobHandler } from '../../src/modules/ai-jobs/ai-job-runner';
import { createPrismaMicoAiRepository } from '../../src/modules/mico-ai/prisma-mico-ai-repository';
import { createPrismaFinalMinutesRepository } from '../../src/modules/meetings/final-minutes-repository';
import { createFinalMinutesAi } from '../../src/modules/meetings/final-minutes-ai';

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
  await prisma.meetingMinutes.deleteMany({ where: { meeting: { organizerId: USER } } });
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

  it('the Final MOM over the database: saved as the draft when nothing changed, offered when someone saved meanwhile', async () => {
    const finalMinutes = createPrismaFinalMinutesRepository(prisma);
    const runner = createAiJobRunner({ store, owner: 'srv-1' });
    let release: () => void = () => {};
    let held: Promise<void> | null = null;
    const told: string[] = [];
    const ai = createFinalMinutesAi({
      jobs: runner,
      store,
      finalMinutes,
      draftMinutesWithAi: async () => {
        if (held) await held;
        return { summary: 'Drafted by the AI.', decisions: ['Ship it'] };
      },
      notify: async (n) => void told.push(n.body),
    });
    runner.register('final-minutes', ai.handler);
    const viewer = { userId: USER, roles: ['EMPLOYEE'] };
    // A first draft: nothing written before or since.
    await ai.start(viewer, meetingId, { title: 'AI jobs weekly', facts: async () => 'Meeting: AI jobs weekly' }, null);
    await runner.idle();
    const first = (await finalMinutes.get(meetingId))!;
    expect(first.content.summary).toBe('Drafted by the AI.');
    expect(await ai.view(meetingId, first, USER)).toMatchObject({ status: 'saved' });
    // Redraft from that save: replaced, since nobody saved after it (the timestamps match to the millisecond).
    await ai.start(viewer, meetingId, { title: 'AI jobs weekly', facts: async () => 'x' }, first);
    await runner.idle();
    const second = (await finalMinutes.get(meetingId))!;
    expect(second.savedAt.getTime()).toBeGreaterThanOrEqual(first.savedAt.getTime());
    expect(await ai.view(meetingId, second, USER)).toMatchObject({ status: 'saved' });
    // Someone saves while the AI drafts: theirs is kept and the AI's offered.
    held = new Promise<void>((r) => (release = r));
    await ai.start(viewer, meetingId, { title: 'AI jobs weekly', facts: async () => 'x' }, second);
    await new Promise((r) => setTimeout(r, 5));
    await finalMinutes.save(meetingId, { content: { summary: 'Mine.', discussion: [], decisions: [], risks: [], nextSteps: [] }, status: 'DRAFT', approvedById: null, approvedAt: null });
    release();
    await runner.idle();
    const kept = (await finalMinutes.get(meetingId))!;
    expect(kept.content.summary).toBe('Mine.');
    const offer = await ai.view(meetingId, kept, USER);
    expect(offer).toMatchObject({ status: 'ready', reason: 'changed', content: { summary: 'Drafted by the AI.' } });
    expect(told.at(-1)).toMatch(/changed while the AI was drafting/);
    await ai.use(meetingId, offer!.id);
    expect((await finalMinutes.get(meetingId))!.content.summary).toBe('Drafted by the AI.');
    await expect(ai.use(meetingId, offer!.id)).rejects.toMatchObject({ status: 409 });
  });

  it('MICO AI over the database: a resend joins its turn; an answer a job still writes is never “interrupted”', async () => {
    const repo = createPrismaMicoAiRepository(prisma);
    const chat = await repo.createChat(USER, 'Jobs');
    const turn = (clientId?: string) => repo.startTurn(chat.id, { question: 'hi', step: 'Thinking…', staleBefore: new Date(Date.now() - 60_000), interrupted: { error: 'interrupted' }, clientId });
    const both = await Promise.all([turn('c-1'), turn('c-1')]);
    const [a, b] = both as Array<Exclude<Awaited<ReturnType<typeof turn>>, 'busy'>>;
    expect(a!.answer.id).toBe(b!.answer.id);
    expect(both.filter((t) => t !== 'busy' && t.joined)).toHaveLength(1);
    expect(await repo.findTurn(chat.id, 'c-1')).toMatchObject({ question: { id: a!.question.id }, answer: { id: a!.answer.id } });
    expect(await repo.findTurn(chat.id, 'c-2')).toBeNull();
    // The answer waits for its job's next try, untouched for ten minutes.
    await store.create({ kind: 'mico-ai', subjectId: a!.answer.id, messageId: a!.answer.id, requestedById: USER, input: { chatId: chat.id } }, new Date());
    await prisma.$executeRaw`UPDATE mico_ai_messages SET updatedAt = ${new Date(Date.now() - 10 * 60_000)} WHERE id = ${a!.answer.id}`;
    expect(await repo.interruptStale(new Date(Date.now() - 60_000), { error: 'interrupted' }, chat.id)).toBe(0);
    expect(await turn('c-3')).toBe('busy');
    // Its job ended (a crash between): then it is interrupted, and the chat is free.
    await store.cancel('mico-ai', a!.answer.id, new Date());
    expect(await repo.interruptStale(new Date(Date.now() - 60_000), { error: 'interrupted' }, chat.id)).toBe(1);
    expect(await turn('c-3')).not.toBe('busy');
  });
});
