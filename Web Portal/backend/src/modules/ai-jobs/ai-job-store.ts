import { randomUUID } from 'node:crypto';

/**
 * 1.22 (§10): AI work that keeps running in the background after the page is closed — a Final MOM
 * "Draft with AI" (`final-minutes`, for a meeting) or a MICO AI answer (`mico-ai`, for the answer's
 * message). A job is QUEUED until a server takes it (RUNNING, under a lease it renews), and ends DONE
 * (its result kept), FAILED or CANCELLED. Only one job per thing is active at a time: `activeKey` is
 * unique while it is queued or running, so a second request for the same thing joins the first.
 */
export type AiJobKind = 'final-minutes' | 'mico-ai';
export type AiJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

/** A failed try as the person is told it, with the HTTP code and status the request would have had. */
export interface AiJobError {
  message: string;
  code: string | null;
  status: number;
}

export interface AiJobRecord {
  id: string;
  kind: AiJobKind;
  subjectId: string;
  meetingId: string | null;
  messageId: string | null;
  /** `${kind}:${subjectId}` while queued or running; null once it ended. */
  activeKey: string | null;
  requestedById: string;
  status: AiJobStatus;
  /** Tries started so far. */
  attempts: number;
  /** When it may be tried (again). */
  nextTryAt: Date;
  /** Whose try it is (a server and that one try) while running. */
  leaseOwner: string | null;
  leaseUntil: Date | null;
  input: Record<string, unknown>;
  result: unknown;
  /** What became of the result (SAVED, OFFERED, USED, DISCARDED, LOST); null until then. */
  outcome: string | null;
  outcomeAt: Date | null;
  /** The last failed try. */
  error: AiJobError | null;
  /** When the requester's page last showed it. */
  watchedAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface NewAiJob {
  kind: AiJobKind;
  subjectId: string;
  requestedById: string;
  input: Record<string, unknown>;
  meetingId?: string | null;
  messageId?: string | null;
  /** The requester is watching it from the start (a request that waits for it): no bell when it ends. */
  watched?: boolean;
}

export type AiJobEnd = { status: 'DONE'; result: unknown } | { status: 'FAILED'; error: AiJobError };

export interface AiJobStore {
  /** Add a job — unless one is still active for the same thing: that one is returned (`joined`). */
  create(job: NewAiJob, now: Date): Promise<{ job: AiJobRecord; joined: boolean }>;
  get(id: string): Promise<AiJobRecord | null>;
  /** The newest job for a thing, whatever became of it. */
  latest(kind: AiJobKind, subjectId: string): Promise<AiJobRecord | null>;
  /** The job still queued or running for a thing. */
  active(kind: AiJobKind, subjectId: string): Promise<AiJobRecord | null>;
  /** Which of these things have a job queued or running. */
  activeSubjects(kind: AiJobKind, subjectIds: readonly string[]): Promise<Set<string>>;
  /**
   * Take up to `limit` due jobs — queued and due, or running on a lease that lapsed (a server that
   * stopped) — each in one step two servers can't both win. Each take is a try (`attempts` + 1) with
   * its own lease token (`leaseOwner`, starting with `owner`).
   */
  claimDue(owner: string, now: Date, leaseMs: number, limit: number): Promise<AiJobRecord[]>;
  /** Hold a running try a while longer: false when it is no longer this try's (cancelled, taken over, deleted). */
  renew(id: string, leaseOwner: string, until: Date): Promise<boolean>;
  /** The try failed and the job waits until `at` for the next one: false when it wasn't this try's. */
  retryAt(id: string, leaseOwner: string, at: Date, error: AiJobError): Promise<boolean>;
  /** End this try's job: false (nothing changed) when it isn't this try's any more. */
  finish(id: string, leaseOwner: string, end: AiJobEnd, now: Date): Promise<boolean>;
  /** Cancel the active job of a thing: the job as it was, or null when none was active. */
  cancel(kind: AiJobKind, subjectId: string, now: Date): Promise<AiJobRecord | null>;
  /** What became of a finished job's result, only while its outcome is one of `from` (default: none yet). */
  setOutcome(id: string, outcome: string, opts: { at: Date; from?: ReadonlyArray<string | null> }): Promise<boolean>;
  /** The requester's page shows the active job of a thing. */
  watch(kind: AiJobKind, subjectId: string, at: Date): Promise<void>;
  /**
   * Take up to `limit` jobs that finished (DONE) before `before` but whose result was never kept
   * (outcome still none: a server stopped between the two) — each marked SAVING (outcomeAt = `at`)
   * in one step two servers can't both win — to keep them now. 1.22 review: with
   * `staleSavingBefore`, also jobs marked SAVING before then (a server that stopped while keeping).
   */
  claimUnkept(before: Date, limit: number, opts?: { at?: Date; staleSavingBefore?: Date }): Promise<AiJobRecord[]>;
  /** Delete jobs that ended before `before` (their facts and results go with them). */
  deleteEnded(before: Date): Promise<number>;
}

export const activeKeyOf = (kind: AiJobKind, subjectId: string): string => `${kind}:${subjectId}`;
/** A lease token: the server, and this one take of the job (the same server taking it again is another try). */
export const leaseToken = (owner: string): string => `${owner.slice(0, 48)}#${randomUUID().slice(0, 8)}`;

/** In-memory storage, for tests (and the rule a database store keeps). */
export function createMemoryAiJobStore(): AiJobStore & { rows: Map<string, AiJobRecord> } {
  const rows = new Map<string, AiJobRecord>();
  const copy = (j: AiJobRecord): AiJobRecord => structuredClone(j);
  const activeOf = (key: string) => [...rows.values()].find((j) => j.activeKey === key) ?? null;
  const running = (id: string, leaseOwner: string) => {
    const j = rows.get(id);
    return j && j.status === 'RUNNING' && j.leaseOwner === leaseOwner ? j : null;
  };
  // No await between a check and its change: two calls can't both win.
  return {
    rows,
    async create(input, now) {
      const key = activeKeyOf(input.kind, input.subjectId);
      const existing = activeOf(key);
      if (existing) return { job: copy(existing), joined: true };
      const job: AiJobRecord = {
        id: randomUUID(),
        kind: input.kind,
        subjectId: input.subjectId,
        meetingId: input.meetingId ?? null,
        messageId: input.messageId ?? null,
        activeKey: key,
        requestedById: input.requestedById,
        status: 'QUEUED',
        attempts: 0,
        nextTryAt: now,
        leaseOwner: null,
        leaseUntil: null,
        input: structuredClone(input.input),
        result: null,
        outcome: null,
        outcomeAt: null,
        error: null,
        watchedAt: input.watched ? now : null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
      };
      rows.set(job.id, job);
      return { job: copy(job), joined: false };
    },
    async get(id) {
      const j = rows.get(id);
      return j ? copy(j) : null;
    },
    async latest(kind, subjectId) {
      const all = [...rows.values()].filter((j) => j.kind === kind && j.subjectId === subjectId);
      const newest = all.reduce<AiJobRecord | null>((best, j) => (!best || j.createdAt.getTime() >= best.createdAt.getTime() ? j : best), null);
      return newest ? copy(newest) : null;
    },
    async active(kind, subjectId) {
      const j = activeOf(activeKeyOf(kind, subjectId));
      return j ? copy(j) : null;
    },
    async activeSubjects(kind, subjectIds) {
      return new Set(subjectIds.filter((s) => activeOf(activeKeyOf(kind, s))));
    },
    async claimDue(owner, now, leaseMs, limit) {
      const due = [...rows.values()]
        .filter((j) => (j.status === 'QUEUED' && j.nextTryAt.getTime() <= now.getTime()) || (j.status === 'RUNNING' && !!j.leaseUntil && j.leaseUntil.getTime() < now.getTime()))
        .sort((a, b) => a.nextTryAt.getTime() - b.nextTryAt.getTime())
        .slice(0, Math.max(0, limit));
      for (const j of due) Object.assign(j, { status: 'RUNNING', leaseOwner: leaseToken(owner), leaseUntil: new Date(now.getTime() + leaseMs), attempts: j.attempts + 1, startedAt: now });
      return due.map(copy);
    },
    async renew(id, leaseOwner, until) {
      const j = running(id, leaseOwner);
      if (!j) return false;
      j.leaseUntil = until;
      return true;
    },
    async retryAt(id, leaseOwner, at, error) {
      const j = running(id, leaseOwner);
      if (!j) return false;
      Object.assign(j, { status: 'QUEUED', nextTryAt: at, leaseOwner: null, leaseUntil: null, error: structuredClone(error) });
      return true;
    },
    async finish(id, leaseOwner, end, now) {
      const j = running(id, leaseOwner);
      if (!j) return false;
      Object.assign(j, { status: end.status, activeKey: null, leaseOwner: null, leaseUntil: null, finishedAt: now });
      if (end.status === 'DONE') Object.assign(j, { result: structuredClone(end.result ?? null), error: null });
      else j.error = structuredClone(end.error);
      return true;
    },
    async cancel(kind, subjectId, now) {
      const j = activeOf(activeKeyOf(kind, subjectId));
      if (!j) return null;
      const before = copy(j);
      Object.assign(j, { status: 'CANCELLED', activeKey: null, leaseOwner: null, leaseUntil: null, finishedAt: now });
      return before;
    },
    async setOutcome(id, outcome, { at, from = [null] }) {
      const j = rows.get(id);
      if (!j || !from.includes(j.outcome)) return false;
      Object.assign(j, { outcome, outcomeAt: at });
      return true;
    },
    async watch(kind, subjectId, at) {
      const j = activeOf(activeKeyOf(kind, subjectId));
      if (j) j.watchedAt = at;
    },
    async claimUnkept(before, limit, opts = {}) {
      const stale = opts.staleSavingBefore?.getTime();
      const unkept = (j: AiJobRecord) =>
        (j.outcome === null && !!j.finishedAt && j.finishedAt.getTime() < before.getTime()) ||
        (stale !== undefined && j.outcome === 'SAVING' && !!j.outcomeAt && j.outcomeAt.getTime() < stale);
      const due = [...rows.values()].filter((j) => j.status === 'DONE' && unkept(j)).slice(0, Math.max(0, limit));
      for (const j of due) Object.assign(j, { outcome: 'SAVING', outcomeAt: opts.at ?? new Date() });
      return due.map(copy);
    },
    async deleteEnded(before) {
      let n = 0;
      for (const [id, j] of rows) {
        if (!j.activeKey && j.finishedAt && j.finishedAt.getTime() < before.getTime()) {
          rows.delete(id);
          n++;
        }
      }
      return n;
    },
  };
}
