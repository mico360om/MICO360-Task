import { NetworkError, isNetworkError } from './api-client';
import type { QueuedMutation, SyncQueue } from './sync-queue';

/**
 * Writes to one item reach the server in the order they were made (2b review).
 *
 * A change kept on this phone (its try got no answer) is sent when the sync runs — and any answer
 * from the server starts the sync. Without an order, a newer change to the same item made on a good
 * connection would reach the server first, and the older one, replayed after it, would overwrite it:
 * tick an agenda item on bad Wi-Fi (kept), untick it (sent, and its answer starts the sync), and the
 * replayed tick puts it back.
 *
 * So a change to an item that still has an older change waiting on this phone isn't sent live: it
 * is kept behind that one (the sync sends them in order), and the screen treats it like any change
 * kept offline. A change that got no answer is kept here, inside the write — within the item's
 * write lane (task-writes) or TanStack mutation scope — so a quick second change can never be sent
 * before the first was kept. And a newer change that went through drops a refused older one of the
 * same fields (shown with Retry), whose Retry would overwrite it. Pure, so it is tested here.
 */

export interface WriteOrderDeps {
  queue: Pick<SyncQueue, 'pendingFor' | 'failedFor' | 'enqueue' | 'discard'>;
  /** The signed-in user (whose queue is checked and written to). */
  userId: () => string | null;
  /** Ask for a sync now: a change kept behind an older one goes as soon as that one has. */
  sync?: () => void;
}

/** One write as it would be queued. */
export interface Write {
  kind: string;
  payload: unknown;
  /** A creating write's key (the replay sends the same). */
  idempotencyKey?: string;
}

const id = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const tagged = (tag: string, v: unknown): string | null => {
  const s = id(v);
  return s ? `${tag}:${s}` : null;
};

/**
 * The item a queued change writes to — one string per item, the same for every kind that writes
 * it (a task's moves and edits share one: an edit carries the version a move bumps). null for a
 * change that makes something new (nothing older can overtake it).
 */
export function writeTarget(kind: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'task.move':
    case 'task.update':
      return tagged('task', p.id);
    case 'task.assign':
    case 'task.unassign':
      return tagged('assignees', p.id);
    case 'checklist.update':
      return tagged('subtask', p.itemId);
    case 'meeting.agenda.covered':
      return tagged('agenda', p.itemId);
    case 'meeting.attendance':
      return tagged('attendee', p.attendeeId);
    case 'meeting.action.update':
      return tagged('action', p.id);
    default:
      return null;
  }
}

/** The fields a change sets (for "a newer change of the same fields"), or null when that can't be told. */
function fieldsOf(kind: string, payload: unknown): string[] | null {
  const p = (payload ?? {}) as { patch?: unknown };
  const patchKeys = () => (p.patch && typeof p.patch === 'object' ? Object.keys(p.patch).filter((k) => k !== 'expectedVersion' && k !== 'scope') : []);
  switch (kind) {
    case 'task.move':
      return ['columnId'];
    case 'meeting.agenda.covered':
      return ['completed'];
    case 'meeting.attendance':
      return ['attendance'];
    case 'task.update':
    case 'checklist.update':
    case 'meeting.action.update':
      return patchKeys();
    default:
      return null;
  }
}

/** Does `newer` set every field `older` set, on the same item (so `older` has nothing left to do)? */
function supersedes(newer: Write, older: Pick<QueuedMutation, 'kind' | 'payload'>): boolean {
  if (newer.kind !== older.kind || writeTarget(newer.kind, newer.payload) !== writeTarget(older.kind, older.payload)) return false;
  const mine = fieldsOf(newer.kind, newer.payload);
  const theirs = fieldsOf(older.kind, older.payload);
  return !!mine && !!theirs && theirs.length > 0 && theirs.every((f) => mine.includes(f));
}

/** A change kept on this phone because an older change to the same item is still waiting. */
export class WaitingBehindError extends NetworkError {
  readonly keptOnPhone = true;
  constructor() {
    super('An earlier change to this is still waiting to sync — this one goes after it.');
  }
}

const KEPT = Symbol.for('mico360.keptOnPhone');

/** Was this failed write already kept on this phone (by sendInOrder), so nothing more is to be kept? */
export function isKeptOnPhone(error: unknown): boolean {
  return !!error && typeof error === 'object' && ((error as { keptOnPhone?: unknown }).keptOnPhone === true || (error as Record<symbol, unknown>)[KEPT] === true);
}

/**
 * Send one write live, in order: kept behind an older change to the same item still waiting on
 * this phone, or — when it gets no answer — kept on this phone at once. Either way it rejects with a
 * network error (isNetworkError) marked as kept (isKeptOnPhone), so the screen's offline path
 * (keep the change shown, "Saved on this phone") is unchanged and nothing is kept twice. A refusal
 * from the server is never kept. After a success, refused older changes it overtook are dropped.
 */
export async function sendInOrder<T>(deps: WriteOrderDeps, write: Write, send: () => Promise<T>): Promise<T> {
  const userId = deps.userId();
  const target = writeTarget(write.kind, write.payload);
  const keep = () => deps.queue.enqueue(write.kind, write.payload, { userId: userId!, idempotencyKey: write.idempotencyKey });
  if (userId && target && deps.queue.pendingFor(userId).some((m) => writeTarget(m.kind, m.payload) === target)) {
    await keep();
    deps.sync?.();
    throw new WaitingBehindError();
  }
  let result: T;
  try {
    result = await send();
  } catch (e) {
    if (userId && isNetworkError(e) && e && typeof e === 'object') {
      // Kept for the person who made it, and only while they are still signed in: sign-out dropped
      // their changes, and one that came back now would replay at the next sign-in (2c review).
      if (deps.userId() === userId) await keep();
      // Either way nothing more is kept (the screen's offline path would keep it for whoever is in).
      (e as Record<symbol, unknown>)[KEPT] = true;
    }
    throw e;
  }
  if (userId && target) {
    for (const m of deps.queue.failedFor(userId)) if (supersedes(write, m)) await deps.queue.discard(m.id);
  }
  return result;
}

/**
 * Keep a failed write for later sync ONLY when the request got no answer (offline / timeout, A8).
 * A server answer (`ApiError`, 4xx/5xx) is a real rejection — it must surface and must never be
 * replayed. Queued items record their owner so they are only ever replayed for that user (XP-02),
 * and reuse the action's idempotency key so a replay of a write the server already saved is
 * de-duplicated (XP-06). A write sendInOrder already kept is not kept again.
 */
export async function queueOnOffline(
  queue: Pick<SyncQueue, 'enqueue'>,
  userId: string | null,
  err: unknown,
  kind: string,
  payload: unknown,
  idempotencyKey?: string,
): Promise<void> {
  if (!userId || !isNetworkError(err) || isKeptOnPhone(err)) return;
  await queue.enqueue(kind, payload, { userId, idempotencyKey });
}

/**
 * After a sync: a refused change (shown with Retry) that a later change of the same fields — now
 * replayed — has replaced is dropped, as after a live success: its Retry would overwrite the newer
 * change (tick on bad Wi-Fi, untick; the tick's replay is refused, the untick's goes through).
 */
export async function dropOvertaken(queue: Pick<SyncQueue, 'failedFor' | 'discard'>, userId: string, done: readonly QueuedMutation[]): Promise<void> {
  for (const d of done) {
    if (!writeTarget(d.kind, d.payload)) continue;
    for (const m of queue.failedFor(userId)) if (m.id !== d.id && m.createdAt <= d.createdAt && supersedes(d, m)) await queue.discard(m.id);
  }
}
