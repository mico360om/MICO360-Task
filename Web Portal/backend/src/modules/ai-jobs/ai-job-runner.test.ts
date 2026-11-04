import { describe, it, expect, vi } from 'vitest';
import { createMemoryAiJobStore, type AiJobRecord } from './ai-job-store';
import { createAiJobRunner, isRetryable, KEEP_GRACE_MS, MAX_ATTEMPTS, RETRY_DELAYS_MS, SAVING_STALE_MS, type AiJobHandler } from './ai-job-runner';
import { ProviderRefusedError } from '../ai/ai-completion';
import { AiTimeoutError, readProviderJson } from '../ai/ai-network';
import { AiBusyError, AiRateLimitedError } from '../ai/ai-limits';
import { HttpError, ValidationError } from '../../lib/http-errors';

// 1.22 (§10): AI work that keeps running in the background. A job is run at once by the server that
// took the request, under a lease it renews; a try that fails on a time-out, a 429 or a 5xx waits and
// goes again; the result is kept once; the requester is told when it ends — unless their page showed it.

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await tick();
  }
}

type Told = { id: string; status: string; outcome?: string | null; error?: string };

/** A handler whose tries answer from a script (a value, an error, or a function of the signal). */
function scripted(steps: Array<unknown | ((signal: AbortSignal) => unknown)>) {
  const saved: Array<{ id: string; result: unknown }> = [];
  const failed: Array<{ id: string; message: string }> = [];
  const waiting: Array<{ id: string; at: Date }> = [];
  const told: Told[] = [];
  let calls = 0;
  const handler: AiJobHandler = {
    async run(_job, signal) {
      const step = steps[Math.min(calls++, steps.length - 1)];
      const out = typeof step === 'function' ? await (step as (s: AbortSignal) => unknown)(signal) : step;
      if (out instanceof Error) throw out;
      return out;
    },
    async save(job, result) {
      saved.push({ id: job.id, result });
      return { outcome: 'SAVED' };
    },
    async failed(job, error) {
      failed.push({ id: job.id, message: error.message });
    },
    async waiting(job, at) {
      waiting.push({ id: job.id, at });
    },
    async notify(job, end) {
      told.push(end.status === 'DONE' ? { id: job.id, status: 'DONE', outcome: end.outcome } : { id: job.id, status: 'FAILED', error: end.error.message });
    },
    describe(err) {
      return err instanceof HttpError ? { message: err.message, code: err.code, status: err.status } : { message: 'Something went wrong.', code: null, status: 500 };
    },
  };
  return { handler, saved, failed, waiting, told, calls: () => calls };
}

function setup(steps: Array<unknown | ((signal: AbortSignal) => unknown)>, opts: { retryDelaysMs?: number[]; leaseMs?: number; heartbeatMs?: number } = {}) {
  const store = createMemoryAiJobStore();
  const h = scripted(steps);
  const runner = createAiJobRunner({ store, owner: 'srv-1', retryDelaysMs: opts.retryDelaysMs ?? [20, 30, 40], leaseMs: opts.leaseMs, heartbeatMs: opts.heartbeatMs });
  runner.register('final-minutes', h.handler);
  return { store, runner, ...h };
}
const job = (subjectId = 'm1') => ({ kind: 'final-minutes' as const, subjectId, meetingId: subjectId, requestedById: 'u-omar', input: { facts: 'x' } });
const ended = (store: ReturnType<typeof createMemoryAiJobStore>, id: string) => async () => {
  const j = await store.get(id);
  return !!j && (j.status === 'DONE' || j.status === 'FAILED' || j.status === 'CANCELLED');
};

describe('AI jobs: which failures are tried again', () => {
  it('time-outs, 429 and 5xx — and our own model being busy — are tried again; nothing else', () => {
    expect(RETRY_DELAYS_MS).toEqual([30_000, 120_000, 300_000]);
    expect(MAX_ATTEMPTS).toBe(4); // the first try and three more
    for (const err of [new ProviderRefusedError(429, null), new ProviderRefusedError(500, null), new ProviderRefusedError(503, null), new ProviderRefusedError(504, null), new AiTimeoutError(), new AiBusyError()]) {
      expect(isRetryable(err), String(err)).toBe(true);
    }
    // Configuration, limits and content are said at once.
    for (const err of [
      new ProviderRefusedError(400, null),
      new ProviderRefusedError(401, null),
      new ProviderRefusedError(413, null),
      new AiRateLimitedError('You’ve reached today’s AI request limit. It resets tomorrow.'),
      new ValidationError('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.'),
      new ValidationError('Could not reach the AI provider. Check the API URL and network.'),
      new ValidationError('The AI’s draft couldn’t be read. Try again, or start from the notes.'),
      new Error('ECONNRESET'),
    ]) {
      expect(isRetryable(err), String(err)).toBe(false);
    }
  });

  it('a time-out while the answer is still coming in is a time-out too (tried again)', async () => {
    const res = { json: () => Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })) } as unknown as Response;
    await expect(readProviderJson(res)).rejects.toBeInstanceOf(AiTimeoutError);
    const garbled = { json: () => Promise.reject(new SyntaxError('Unexpected token <')) } as unknown as Response;
    await expect(readProviderJson(garbled)).rejects.toMatchObject({ message: 'The AI provider returned an unreadable response.' });
  });

  it('a time-out reads as before: a 400 in plain words', () => {
    const e = new AiTimeoutError();
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.status).toBe(400);
    expect(e.message).toBe('The AI provider did not respond in time. Try again later.');
  });
});

describe('AI jobs: the runner', () => {
  it('runs a job at once, keeps its result once and tells the requester', async () => {
    const s = setup([{ summary: 'Drafted.' }]);
    const { job: j, joined } = await s.runner.enqueue(job());
    expect(joined).toBe(false);
    await until(ended(s.store, j.id));
    await s.runner.idle();
    expect(s.saved).toEqual([{ id: j.id, result: { summary: 'Drafted.' } }]);
    expect(await s.store.get(j.id)).toMatchObject({ status: 'DONE', attempts: 1, outcome: 'SAVED', result: { summary: 'Drafted.' }, leaseOwner: null });
    expect(s.told).toEqual([{ id: j.id, status: 'DONE', outcome: 'SAVED' }]);
    // Ended: the thing has no active job, so a new request makes a new one.
    expect(await s.store.active('final-minutes', 'm1')).toBeNull();
    expect((await s.runner.enqueue(job())).joined).toBe(false);
  });

  it('a second request while one is running joins it: one job, one result', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const s = setup([async () => (await held, { summary: 'Once.' })]);
    const first = await s.runner.enqueue(job());
    const second = await s.runner.enqueue(job());
    const both = await Promise.all([s.runner.enqueue(job()), s.runner.enqueue(job())]);
    expect(second).toMatchObject({ joined: true, job: { id: first.job.id } });
    expect(both.every((b) => b.joined && b.job.id === first.job.id)).toBe(true);
    release();
    await until(ended(s.store, first.job.id));
    await s.runner.idle();
    expect(s.calls()).toBe(1);
    expect(s.saved).toHaveLength(1);
    expect(s.told).toHaveLength(1);
  });

  it('a time-out, a 429 or a 5xx waits and tries again; then the result is kept', async () => {
    const s = setup([new AiTimeoutError(), new ProviderRefusedError(429, null), new ProviderRefusedError(503, null), { summary: 'Fourth time lucky.' }], { retryDelaysMs: [120, 30, 30] });
    const { job: j } = await s.runner.enqueue(job());
    await until(async () => (await s.store.get(j.id))?.status === 'QUEUED' && (await s.store.get(j.id))!.attempts === 1);
    const waitingJob = (await s.store.get(j.id))!;
    expect(waitingJob.error).toEqual({ message: 'The AI provider did not respond in time. Try again later.', code: 'VALIDATION', status: 400 });
    expect(waitingJob.activeKey).toBe('final-minutes:m1'); // still the one active job
    await until(ended(s.store, j.id));
    await s.runner.idle();
    expect(s.calls()).toBe(4);
    expect(s.waiting).toHaveLength(3);
    expect(s.saved).toEqual([{ id: j.id, result: { summary: 'Fourth time lucky.' } }]);
    expect(await s.store.get(j.id)).toMatchObject({ status: 'DONE', attempts: 4, error: null });
    expect(s.told.map((t) => t.status)).toEqual(['DONE']); // told once, at the end
  });

  it('waits 30 seconds, then 2 minutes, then 5 minutes by default', async () => {
    const store = createMemoryAiJobStore();
    const at = new Date('2026-11-04T08:00:00.000Z');
    const h = scripted([new ProviderRefusedError(502, null)]);
    const runner = createAiJobRunner({ store, owner: 'srv-1', now: () => at });
    runner.register('final-minutes', h.handler);
    const { job: j } = await runner.enqueue(job());
    await until(async () => (await store.get(j.id))?.status === 'QUEUED' && (await store.get(j.id))!.attempts === 1);
    expect((await store.get(j.id))!.nextTryAt.toISOString()).toBe('2026-11-04T08:00:30.000Z');
    runner.stop();
  });

  it('after the last try it fails for good: said once, with the last error', async () => {
    const s = setup([new ProviderRefusedError(503, 'no model loaded')]);
    const { job: j } = await s.runner.enqueue(job());
    await until(ended(s.store, j.id));
    await s.runner.idle();
    expect(s.calls()).toBe(MAX_ATTEMPTS);
    expect(await s.store.get(j.id)).toMatchObject({ status: 'FAILED', attempts: 4, activeKey: null });
    const message = 'The AI service has no model available right now (HTTP 503). Try again in a minute, or ask an admin to check AI Management.';
    expect(s.failed).toEqual([{ id: j.id, message }]);
    expect(s.told).toEqual([{ id: j.id, status: 'FAILED', error: message }]);
    expect(s.saved).toEqual([]);
  });

  it('configuration, limit and content errors fail at once (no retry)', async () => {
    const s = setup([new AiRateLimitedError('You’ve reached today’s AI request limit. It resets tomorrow.')]);
    const { job: j } = await s.runner.enqueue(job());
    await until(ended(s.store, j.id));
    await s.runner.idle();
    expect(s.calls()).toBe(1);
    expect(s.waiting).toEqual([]);
    expect(await s.store.get(j.id)).toMatchObject({ status: 'FAILED', attempts: 1, error: { message: 'You’ve reached today’s AI request limit. It resets tomorrow.', status: 429 } });
  });

  it('cancelling stops the try in flight; nothing is kept and nobody is told', async () => {
    let signal: AbortSignal | undefined;
    const s = setup([(sig: AbortSignal) => new Promise((_r, reject) => ((signal = sig), sig.addEventListener('abort', () => reject(new Error('aborted')))))]);
    const { job: j } = await s.runner.enqueue(job());
    await until(() => !!signal);
    const cancelled = await s.runner.cancel('final-minutes', 'm1');
    expect(cancelled?.id).toBe(j.id);
    expect(signal!.aborted).toBe(true);
    await s.runner.idle();
    expect(await s.store.get(j.id)).toMatchObject({ status: 'CANCELLED', activeKey: null });
    expect(s.saved).toEqual([]);
    expect(s.failed).toEqual([]);
    expect(s.told).toEqual([]);
    expect(await s.runner.cancel('final-minutes', 'm1')).toBeNull(); // nothing active any more
  });

  it('a requester whose page shows the job is not told by the bell (the page says so)', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const s = setup([async () => (await held, { summary: 'Seen.' })]);
    const { job: j } = await s.runner.enqueue(job());
    await s.runner.watch('final-minutes', 'm1');
    expect((await s.store.get(j.id))!.watchedAt).toBeInstanceOf(Date);
    release();
    await until(ended(s.store, j.id));
    await s.runner.idle();
    expect(s.saved).toHaveLength(1);
    expect(s.told).toEqual([]);
  });
});

describe('AI jobs: several servers and restarts', () => {
  it('a job is taken by one server only', async () => {
    const store = createMemoryAiJobStore();
    const a = scripted([{ summary: 'A' }]);
    const b = scripted([{ summary: 'B' }]);
    const one = createAiJobRunner({ store, owner: 'srv-1' });
    const two = createAiJobRunner({ store, owner: 'srv-2' });
    one.register('final-minutes', a.handler);
    two.register('final-minutes', b.handler);
    // Queued straight into the store (as another server would), then both sweep at once.
    const { job: j } = await store.create(job(), new Date());
    await Promise.all([one.sweep(), two.sweep(), one.sweep(), two.sweep()]);
    await until(ended(store, j.id));
    await Promise.all([one.idle(), two.idle()]);
    expect(a.calls() + b.calls()).toBe(1);
    expect(a.saved.length + b.saved.length).toBe(1);
  });

  it('a server that stopped mid-try (its lease lapsed) is taken over; its late answer is not kept twice', async () => {
    const store = createMemoryAiJobStore();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const slow = scripted([async () => (await held, { summary: 'Late.' })]);
    const fresh = scripted([{ summary: 'Fresh.' }]);
    // srv-1 holds a 30 ms lease and never renews it (it "stopped").
    const one = createAiJobRunner({ store, owner: 'srv-1', leaseMs: 30, heartbeatMs: 60_000 });
    const two = createAiJobRunner({ store, owner: 'srv-2' });
    one.register('final-minutes', slow.handler);
    two.register('final-minutes', fresh.handler);
    const { job: j } = await one.enqueue(job());
    await until(() => slow.calls() === 1);
    await tick(40);
    await two.sweep();
    await until(ended(store, j.id));
    await two.idle();
    expect(fresh.saved).toHaveLength(1);
    expect((await store.get(j.id))!.attempts).toBe(2);
    release();
    await one.idle();
    expect(slow.saved).toEqual([]); // its finish found the job no longer its own
    expect((await store.get(j.id))!.result).toEqual({ summary: 'Fresh.' });
  });

  it('a renewed lease keeps the job: nobody takes it over while it runs', async () => {
    const store = createMemoryAiJobStore();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const slow = scripted([async () => (await held, { summary: 'Mine.' })]);
    const other = scripted([{ summary: 'Theirs.' }]);
    const one = createAiJobRunner({ store, owner: 'srv-1', leaseMs: 40, heartbeatMs: 10 });
    const two = createAiJobRunner({ store, owner: 'srv-2' });
    one.register('final-minutes', slow.handler);
    two.register('final-minutes', other.handler);
    const { job: j } = await one.enqueue(job());
    await until(() => slow.calls() === 1);
    for (let i = 0; i < 6; i++) {
      await tick(15);
      await two.sweep();
    }
    expect(other.calls()).toBe(0);
    release();
    await until(ended(store, j.id));
    await one.idle();
    expect(slow.saved).toHaveLength(1);
  });

  it('a job cut off on its last try (a restart) ends as interrupted instead of a fifth try', async () => {
    const store = createMemoryAiJobStore();
    const h = scripted([{ summary: 'never' }]);
    const runner = createAiJobRunner({ store, owner: 'srv-2' });
    runner.register('final-minutes', h.handler);
    const { job: j } = await store.create(job(), new Date());
    // Four tries taken already, the last one by a server that is gone (a lapsed lease).
    const row = store.rows.get(j.id)!;
    Object.assign(row, { status: 'RUNNING', attempts: MAX_ATTEMPTS, leaseOwner: 'gone#1', leaseUntil: new Date(Date.now() - 1000) } satisfies Partial<AiJobRecord>);
    await runner.sweep();
    await until(ended(store, j.id));
    await runner.idle();
    expect(h.calls()).toBe(0);
    expect(await store.get(j.id)).toMatchObject({ status: 'FAILED', error: { message: 'This was interrupted. Try again.' } });
    expect(h.failed).toHaveLength(1);
    expect(h.told.map((t) => t.status)).toEqual(['FAILED']);
  });

  it('a failure while keeping the result or telling is logged, never thrown', async () => {
    const store = createMemoryAiJobStore();
    const logger = { error: vi.fn(), info: vi.fn() };
    const runner = createAiJobRunner({ store, owner: 'srv-1', logger });
    const h = scripted([{ summary: 'x' }]);
    let saves = 0;
    runner.register('final-minutes', {
      ...h.handler,
      save: async () => {
        if (saves++ === 0) throw new Error('database gone');
        return { outcome: 'SAVED' };
      },
      notify: async () => {
        throw new Error('push down');
      },
    });
    const { job: j } = await runner.enqueue(job());
    await until(ended(store, j.id));
    await runner.idle();
    const errs = () => logger.error.mock.calls.map(([, meta]) => String((meta as { err?: Error }).err?.message));
    expect(errs()).toContain('database gone');
    expect((await store.get(j.id))!.outcome).toBeNull(); // not kept yet: the sweep keeps it later
    store.rows.get(j.id)!.finishedAt = new Date(Date.now() - KEEP_GRACE_MS - 1000);
    await runner.sweep();
    expect((await store.get(j.id))!.outcome).toBe('SAVED');
    expect(errs()).toContain('push down');
  });

  it('a result a stopped server never kept is kept by the next sweep (once), and its requester told', async () => {
    const store = createMemoryAiJobStore();
    const h = scripted([]);
    const runner = createAiJobRunner({ store, owner: 'srv-2' });
    runner.register('final-minutes', h.handler);
    const { job: j } = await store.create(job(), new Date());
    // srv-1 finished it (DONE, with its result) and stopped before keeping it.
    Object.assign(store.rows.get(j.id)!, { status: 'DONE', activeKey: null, result: { summary: 'Kept late.' }, attempts: 1, finishedAt: new Date(Date.now() - 1000) } satisfies Partial<AiJobRecord>);
    await runner.sweep();
    expect(h.saved).toEqual([]); // within the grace: srv-1 may still be keeping it
    store.rows.get(j.id)!.finishedAt = new Date(Date.now() - KEEP_GRACE_MS - 1000);
    await Promise.all([runner.sweep(), runner.sweep()]);
    await runner.sweep();
    expect(h.saved).toEqual([{ id: j.id, result: { summary: 'Kept late.' } }]);
    expect(await store.get(j.id)).toMatchObject({ outcome: 'SAVED' });
    expect(h.told).toEqual([{ id: j.id, status: 'DONE', outcome: 'SAVED' }]);
  });

  it('and if keeping it fails again, the job is settled as failed and the requester told', async () => {
    const store = createMemoryAiJobStore();
    const h = scripted([]);
    const runner = createAiJobRunner({ store, owner: 'srv-2' });
    runner.register('final-minutes', { ...h.handler, save: async () => Promise.reject(new Error('still gone')) });
    const { job: j } = await store.create(job(), new Date());
    Object.assign(store.rows.get(j.id)!, { status: 'DONE', activeKey: null, result: { summary: 'x' }, finishedAt: new Date(Date.now() - KEEP_GRACE_MS - 1000) } satisfies Partial<AiJobRecord>);
    await runner.sweep();
    expect(await store.get(j.id)).toMatchObject({ outcome: 'LOST' });
    expect(h.failed).toEqual([{ id: j.id, message: 'Something went wrong while keeping the AI’s work. Try again.' }]);
    expect(h.told.map((t) => t.status)).toEqual(['FAILED']);
  });

  // 1.22 review A2: a server that stopped while keeping a result (SAVING) left it so for good.
  it('a result left “being kept” by a server that stopped is kept again once that is stale — by one server, once', async () => {
    const store = createMemoryAiJobStore();
    const h = scripted([]);
    const [two, three] = ['srv-2', 'srv-3'].map((owner) => createAiJobRunner({ store, owner }));
    two!.register('final-minutes', h.handler);
    three!.register('final-minutes', h.handler);
    const { job: j } = await store.create(job(), new Date());
    // srv-1 finished it an hour ago, a sweep marked it SAVING a moment ago (it may still be keeping it).
    Object.assign(store.rows.get(j.id)!, {
      status: 'DONE',
      activeKey: null,
      result: { summary: 'Kept at last.' },
      attempts: 1,
      finishedAt: new Date(Date.now() - 60 * 60_000),
      outcome: 'SAVING',
      outcomeAt: new Date(Date.now() - 1000),
    } satisfies Partial<AiJobRecord>);
    await two!.sweep();
    expect(h.saved).toEqual([]);
    // That server stopped: once the mark is stale, one of the others keeps it.
    store.rows.get(j.id)!.outcomeAt = new Date(Date.now() - SAVING_STALE_MS - 1000);
    await Promise.all([two!.sweep(), three!.sweep()]);
    await two!.sweep();
    expect(h.saved).toEqual([{ id: j.id, result: { summary: 'Kept at last.' } }]);
    expect(await store.get(j.id)).toMatchObject({ outcome: 'SAVED' });
    expect(h.told).toEqual([{ id: j.id, status: 'DONE', outcome: 'SAVED' }]);
  });

  it('marking a result SAVING says when (the stale window starts there)', async () => {
    const store = createMemoryAiJobStore();
    const { job: j } = await store.create(job(), new Date());
    Object.assign(store.rows.get(j.id)!, { status: 'DONE', activeKey: null, result: {}, finishedAt: new Date(Date.now() - KEEP_GRACE_MS - 1000) } satisfies Partial<AiJobRecord>);
    const at = new Date();
    expect((await store.claimUnkept(new Date(Date.now() - KEEP_GRACE_MS), 5, { at, staleSavingBefore: new Date(Date.now() - SAVING_STALE_MS) })).map((x) => x.id)).toEqual([j.id]);
    expect(await store.get(j.id)).toMatchObject({ outcome: 'SAVING', outcomeAt: at });
  });

  it('a server that takes its own job again (its renewals failed) runs only the new try', async () => {
    const store = createMemoryAiJobStore();
    let signal: AbortSignal | undefined;
    const h = scripted([(sig: AbortSignal) => new Promise((_r, reject) => ((signal = sig), sig.addEventListener('abort', () => reject(new Error('aborted'))))), { summary: 'Second try.' }]);
    const runner = createAiJobRunner({ store, owner: 'srv-1', leaseMs: 20, heartbeatMs: 60_000 });
    runner.register('final-minutes', h.handler);
    const { job: j } = await runner.enqueue(job());
    await until(() => !!signal);
    await tick(30);
    await runner.sweep();
    await until(ended(store, j.id));
    await runner.idle();
    expect(signal!.aborted).toBe(true);
    expect(h.saved).toEqual([{ id: j.id, result: { summary: 'Second try.' } }]);
  });

  it('ended jobs are deleted after 30 days; active ones never', async () => {
    const store = createMemoryAiJobStore();
    const old = (await store.create(job('old'), new Date())).job;
    Object.assign(store.rows.get(old.id)!, { status: 'DONE', activeKey: null, finishedAt: new Date(Date.now() - 31 * 86_400_000) });
    const live = (await store.create(job('live'), new Date(Date.now() - 40 * 86_400_000))).job;
    const recent = (await store.create(job('recent'), new Date())).job;
    Object.assign(store.rows.get(recent.id)!, { status: 'FAILED', activeKey: null, finishedAt: new Date() });
    const runner = createAiJobRunner({ store, owner: 'srv-1', concurrency: 0 });
    runner.startSweeps();
    await until(async () => !(await store.get(old.id)));
    runner.stop();
    expect(await store.get(live.id)).not.toBeNull();
    expect(await store.get(recent.id)).not.toBeNull();
  });
});
