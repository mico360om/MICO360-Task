import { randomUUID } from 'node:crypto';
import type { Logger } from '../../lib/logger';
import { ProviderRefusedError } from '../ai/ai-completion';
import { AiTimeoutError } from '../ai/ai-network';
import { AiBusyError } from '../ai/ai-limits';
import type { AiJobError, AiJobKind, AiJobRecord, AiJobStore, NewAiJob } from './ai-job-store';

/**
 * 1.22 (§10): runs AI work in the background, so it finishes — and is kept — after the page is
 * closed. The server that takes a request starts its job at once; every server also sweeps for due
 * jobs (a retry whose wait is over, or a job a stopped server held), so a restart or several servers
 * never lose or double one:
 * - a server takes a job in one step two servers can't both win, under a lease it renews while the
 *   try runs; a lease that lapses (a server that stopped) lets another take the job over, and the
 *   first one's late answer is then not kept (its finish no longer matches);
 * - a try that fails on a time-out, a 429 or a 5xx waits 30 s, 2 min, then 5 min and goes again
 *   (four tries in all); configuration, limit and content errors end it at once;
 * - the result is kept once (only the try that finishes the job keeps it), and the requester is told
 *   by the bell and a phone push when it ends — unless their page was showing it;
 * - a result a stopped server never kept (it finished the job, then stopped) is kept by a sweep a
 *   minute later — and if keeping it fails again, the job is settled as failed; one a server stopped
 *   while keeping (SAVING) is taken again after SAVING_STALE_MS;
 * - jobs that ended more than 30 days ago are deleted (with the meeting facts they kept).
 */

/** The waits before the second, third and fourth tries. */
export const RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 300_000];
/** The first try and one per wait. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** A quota that resets within the longest wait between tries is worth trying again (review I3). */
const QUOTA_RETRY_WITHIN_MS = Math.max(...RETRY_DELAYS_MS);
/** How long a try is held without a renewal (a stopped server's job is taken over after this). */
export const JOB_LEASE_MS = 60_000;
export const JOB_HEARTBEAT_MS = 20_000;
/** How often every server looks for due jobs. */
export const JOB_SWEEP_MS = 15_000;
/** At most this many tries at once on one server (each model's own limit still governs its calls). */
export const JOB_CONCURRENCY = 16;
/** A finished job whose result isn't kept this long after (its server stopped between) is kept by a sweep. */
export const KEEP_GRACE_MS = 60_000;
/**
 * 1.22 review: a result marked SAVING this long ago is kept again — the server keeping it stopped
 * (a keep is a few database writes; MySQL gives up waiting for a lock after 50 s).
 */
export const SAVING_STALE_MS = 5 * 60_000;
/** Ended jobs are deleted after this long. */
export const ENDED_KEEP_MS = 30 * 24 * 60 * 60_000;
const CLEANUP_EVERY_MS = 60 * 60_000;
/**
 * A requester's page that showed the job this recently is open: the page says it is done, not the
 * bell. Just over the pages' own reading (MICO AI every second, the Final MOM every 3 s), so a page
 * closed a few seconds before the end is told by the bell. A hidden tab stops reading: it is told too.
 */
export const WATCH_FRESH_MS = 6_000;
/** A page showing a job says so at most this often. */
const WATCH_EVERY_MS = 2_000;
const INTERRUPTED: AiJobError = { message: 'This was interrupted. Try again.', code: 'AI_JOB_INTERRUPTED', status: 500 };

/**
 * Is this failure worth another try later? Time-outs, a busy service (429, ours or theirs) and the
 * provider's 5xx. A used-up quota (MICO360 AI's 429 "Quota exceeded") only when it resets within the
 * waits between tries (a per-minute quota); one that lasts an hour, a day or a month is not.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderRefusedError) {
    if (err.providerStatus === 429) return !err.quota || (err.retryAfterSeconds !== null && err.retryAfterSeconds * 1000 <= QUOTA_RETRY_WITHIN_MS);
    return err.providerStatus >= 500;
  }
  return err instanceof AiTimeoutError || err instanceof AiBusyError;
}

export type AiJobEnding = { status: 'DONE'; outcome: string | null } | { status: 'FAILED'; error: AiJobError };

/** What one kind of job does. Each step but `run` is best-effort: a failure is logged. */
export interface AiJobHandler {
  /** One try: the result to keep, or a failure (tried again when isRetryable). Honour `signal`: cancelled or taken over. */
  run(job: AiJobRecord, signal: AbortSignal): Promise<unknown>;
  /** Keep the result (called once, by the try that finished the job): what became of it, and when. */
  save(job: AiJobRecord, result: unknown): Promise<{ outcome: string; at?: Date }>;
  /** It failed for good: settle what it was for (MICO AI: the answer shows the error). */
  failed?(job: AiJobRecord, error: AiJobError): Promise<void>;
  /** A try failed; the next one is at `at`. */
  waiting?(job: AiJobRecord, at: Date): Promise<void>;
  /** Tell the requester it ended (not called when their page was showing it). */
  notify?(job: AiJobRecord, end: AiJobEnding): Promise<void>;
  /** It moved on (waiting, done, failed): open pages are told. */
  changed?(job: AiJobRecord): void;
  /** A failure as the person is told it. */
  describe(err: unknown): AiJobError;
}

export interface AiJobRunnerDeps {
  store: AiJobStore;
  /** This server's name in lease tokens (default: its process id and a random part). */
  owner?: string;
  now?: () => Date;
  retryDelaysMs?: readonly number[];
  leaseMs?: number;
  heartbeatMs?: number;
  sweepMs?: number;
  concurrency?: number;
  watchFreshMs?: number;
  logger?: Pick<Logger, 'error'>;
}

export function createAiJobRunner(deps: AiJobRunnerDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const owner = deps.owner ?? `${process.pid}-${randomUUID().slice(0, 8)}`;
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const maxAttempts = delays.length + 1;
  const leaseMs = deps.leaseMs ?? JOB_LEASE_MS;
  const heartbeatMs = deps.heartbeatMs ?? JOB_HEARTBEAT_MS;
  const sweepMs = deps.sweepMs ?? JOB_SWEEP_MS;
  const concurrency = deps.concurrency ?? JOB_CONCURRENCY;
  const watchFreshMs = deps.watchFreshMs ?? WATCH_FRESH_MS;
  const handlers = new Map<AiJobKind, AiJobHandler>();
  /** Tries running on this server, by job id. */
  const running = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let interval: ReturnType<typeof setInterval> | null = null;
  let cleanup: ReturnType<typeof setInterval> | null = null;
  let sweeping: Promise<void> | null = null;
  let again = false;
  const watched = new Map<string, number>();

  const log = (message: string, err: unknown, meta: Record<string, unknown> = {}) => {
    try {
      deps.logger?.error(message, { err, ...meta });
    } catch {
      // Logging must never be what fails.
    }
  };
  const quietly = async (what: string, job: AiJobRecord, step: () => Promise<unknown> | unknown) => {
    try {
      await step();
    } catch (err) {
      log(`AI jobs: ${what} failed`, err, { jobId: job.id, kind: job.kind });
    }
  };

  function register(kind: AiJobKind, handler: AiJobHandler): void {
    handlers.set(kind, handler);
  }

  /** Add a job (or join the one already active for that thing); this server starts it at once. */
  async function enqueue(job: NewAiJob): Promise<{ job: AiJobRecord; joined: boolean }> {
    const out = await store.create(job, now());
    if (!out.joined) void sweep();
    return out;
  }

  /** Take the due jobs this server has room for and start them. Calls at the same time share one sweep. */
  function sweep(): Promise<void> {
    if (sweeping) {
      again = true;
      return sweeping;
    }
    sweeping = (async () => {
      do {
        again = false;
        const room = concurrency - running.size;
        if (room <= 0) return;
        let taken: AiJobRecord[];
        try {
          taken = await store.claimDue(owner, now(), leaseMs, room);
        } catch (err) {
          log('AI jobs: looking for due jobs failed', err);
          return;
        }
        for (const job of taken) start(job);
      } while (again);
      await keepUnkept();
    })().finally(() => {
      sweeping = null;
    });
    return sweeping;
  }

  function later(ms: number): void {
    const t = setTimeout(() => {
      timers.delete(t);
      void sweep();
    }, ms + 25);
    t.unref?.();
    timers.add(t);
  }

  function start(job: AiJobRecord): void {
    const token = job.leaseOwner!;
    // Taken again by this server (its renewals failed past the lease): the old try is no longer the job's.
    running.get(job.id)?.controller.abort();
    const controller = new AbortController();
    // Hold the lease while the try runs; a renewal that no longer matches (cancelled, taken over, deleted) stops it.
    const beat = setInterval(() => {
      store
        .renew(job.id, token, new Date(now().getTime() + leaseMs))
        .then((mine) => {
          if (!mine) controller.abort();
        })
        .catch((err) => log('AI jobs: renewing a lease failed', err, { jobId: job.id }));
    }, heartbeatMs);
    beat.unref?.();
    const entry: { controller: AbortController; done: Promise<void> } = { controller, done: Promise.resolve() };
    entry.done = execute(job, token, controller.signal)
      .catch((err) => log('AI jobs: a job failed unexpectedly', err, { jobId: job.id, kind: job.kind }))
      .finally(() => {
        clearInterval(beat);
        if (running.get(job.id) === entry) running.delete(job.id);
        // A slot is free: anything waiting for one goes now.
        void sweep();
      });
    running.set(job.id, entry);
  }

  /** Keep a finished job's result (once); false when keeping it failed (it is kept again later, or settled). */
  async function keep(job: AiJobRecord, handler: AiJobHandler, from: ReadonlyArray<string | null>): Promise<{ outcome: string } | null> {
    try {
      const kept = await handler.save(job, job.result);
      await store.setOutcome(job.id, kept.outcome, { at: kept.at ?? now(), from });
      return { outcome: kept.outcome };
    } catch (err) {
      log('AI jobs: keeping a result failed', err, { jobId: job.id, kind: job.kind });
      return null;
    }
  }

  /** Results a stopped server never kept: kept now; if that fails too, the job is settled as failed. */
  async function keepUnkept(): Promise<void> {
    let found: AiJobRecord[];
    try {
      found = await store.claimUnkept(new Date(now().getTime() - KEEP_GRACE_MS), 10, { at: now(), staleSavingBefore: new Date(now().getTime() - SAVING_STALE_MS) });
    } catch (err) {
      log('AI jobs: looking for results to keep failed', err);
      return;
    }
    for (const job of found) {
      const handler = handlers.get(job.kind);
      if (!handler) continue;
      const kept = await keep(job, handler, ['SAVING']);
      if (kept) {
        await tell({ ...job, outcome: kept.outcome }, handler, { status: 'DONE', outcome: kept.outcome });
        continue;
      }
      const error: AiJobError = { message: 'Something went wrong while keeping the AI’s work. Try again.', code: 'AI_JOB_NOT_KEPT', status: 500 };
      await store.setOutcome(job.id, 'LOST', { at: now(), from: ['SAVING'] }).catch((err) => log('AI jobs: settling a result failed', err));
      if (handler.failed) await quietly('settling a failed job', job, () => handler.failed!(job, error));
      await tell({ ...job, outcome: 'LOST' }, handler, { status: 'FAILED', error });
    }
  }

  async function tell(job: AiJobRecord, handler: AiJobHandler, end: AiJobEnding): Promise<void> {
    const fresh = (await store.get(job.id).catch(() => null)) ?? job;
    const seen = fresh.watchedAt && now().getTime() - fresh.watchedAt.getTime() < watchFreshMs;
    if (!seen && handler.notify) await quietly('telling the requester', job, () => handler.notify!(fresh, end));
    if (handler.changed) await quietly('telling open pages', job, () => handler.changed!(fresh));
  }

  async function fail(job: AiJobRecord, token: string, handler: AiJobHandler, error: AiJobError): Promise<void> {
    if (!(await store.finish(job.id, token, { status: 'FAILED', error }, now()))) return;
    const ended = { ...job, status: 'FAILED' as const, error, activeKey: null };
    if (handler.failed) await quietly('settling a failed job', job, () => handler.failed!(ended, error));
    await tell(ended, handler, { status: 'FAILED', error });
  }

  async function execute(job: AiJobRecord, token: string, signal: AbortSignal): Promise<void> {
    const handler = handlers.get(job.kind);
    if (!handler) {
      await store.finish(job.id, token, { status: 'FAILED', error: { message: 'This can’t be done on this server.', code: null, status: 500 } }, now());
      return;
    }
    // Cut off on its last try (a restart): it ends here rather than trying a fifth time.
    if (job.attempts > maxAttempts) return fail(job, token, handler, INTERRUPTED);
    let result: unknown;
    try {
      result = await handler.run(job, signal);
    } catch (err) {
      // Cancelled or taken over: whoever did that settles it.
      if (signal.aborted) return;
      const error = handler.describe(err);
      if (isRetryable(err) && job.attempts < maxAttempts) {
        const wait = delays[Math.min(job.attempts - 1, delays.length - 1)]!;
        const at = new Date(now().getTime() + wait);
        if (!(await store.retryAt(job.id, token, at, error))) return;
        const waiting = { ...job, status: 'QUEUED' as const, nextTryAt: at, error, leaseOwner: null, leaseUntil: null };
        if (handler.waiting) await quietly('saying a job waits', job, () => handler.waiting!(waiting, at));
        if (handler.changed) await quietly('telling open pages', job, () => handler.changed!(waiting));
        later(wait);
        return;
      }
      return fail(job, token, handler, error);
    }
    if (signal.aborted) return;
    if (!(await store.finish(job.id, token, { status: 'DONE', result }, now()))) return;
    const done = { ...job, status: 'DONE' as const, result, activeKey: null };
    const kept = await keep(done, handler, [null]);
    // Not kept (a failure): a sweep keeps it again a minute later, and tells then.
    if (!kept) return;
    await tell({ ...done, outcome: kept.outcome }, handler, { status: 'DONE', outcome: kept.outcome });
  }

  /** Cancel the active job of a thing (its try in flight here stops at once; elsewhere at its next renewal). */
  async function cancel(kind: AiJobKind, subjectId: string): Promise<AiJobRecord | null> {
    const job = await store.cancel(kind, subjectId, now());
    if (job) running.get(job.id)?.controller.abort();
    return job;
  }

  /** The requester's page shows the active job of a thing (said at most every few seconds). */
  async function watch(kind: AiJobKind, subjectId: string): Promise<void> {
    const key = `${kind}:${subjectId}`;
    const at = now().getTime();
    if (at - (watched.get(key) ?? 0) < WATCH_EVERY_MS) return;
    if (watched.size > 2000) watched.clear();
    watched.set(key, at);
    await store.watch(kind, subjectId, now()).catch((err) => log('AI jobs: noting a watched job failed', err));
  }

  /** Sweep now and then every few seconds (timers don't keep the process alive). */
  function startSweeps(): void {
    if (interval) return;
    interval = setInterval(() => void sweep(), sweepMs);
    interval.unref?.();
    void sweep();
    // Ended jobs go after 30 days (any server may; deleting twice is harmless).
    const prune = () => void store.deleteEnded(new Date(now().getTime() - ENDED_KEEP_MS)).catch((err) => log('AI jobs: deleting old jobs failed', err));
    cleanup = setInterval(prune, CLEANUP_EVERY_MS);
    cleanup.unref?.();
    prune();
  }

  /** Stop sweeping (a try in flight runs on; its lease lapses if the process ends). */
  function stop(): void {
    if (interval) clearInterval(interval);
    if (cleanup) clearInterval(cleanup);
    interval = null;
    cleanup = null;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  /** Resolves once nothing runs on this server (tests, a clean shutdown). */
  async function idle(): Promise<void> {
    while (running.size || sweeping) {
      await Promise.all([...[...running.values()].map((r) => r.done), sweeping]);
    }
  }

  /** Is a try for this job running on this server? */
  const isRunningHere = (jobId: string) => running.has(jobId);

  return { register, enqueue, sweep, cancel, watch, startSweeps, stop, idle, isRunningHere, owner };
}

export type AiJobRunner = ReturnType<typeof createAiJobRunner>;
