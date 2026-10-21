import type { QueuedMutation } from './sync-queue';
import { dueDayKey } from './due-date';
import { withAnchorDay, type RecurrenceRule } from './recurrence';
import type { ApiTask } from './types';

/**
 * Edits to a task carry the version they were made against (`expectedVersion`), and the server
 * refuses one made over someone else's change (VERSION_CONFLICT). Every save or move bumps that
 * version, so this phone's own quick edits must each be sent against the version the one before
 * made — not the version the screen loaded — or the second would be refused as "someone else's".
 * Pure (no React, no native imports) so it is unit-testable.
 */
export function createTaskWrites() {
  const lanes = new Map<string, Promise<unknown>>();
  const written = new Map<string, number>();

  return {
    /** Run one write to a task after its earlier writes have finished (failed or not). */
    run<T>(taskId: string, write: () => Promise<T>): Promise<T> {
      const before = lanes.get(taskId) ?? Promise.resolve();
      const next = before.then(write, write);
      const settled = next.catch(() => undefined);
      lanes.set(taskId, settled);
      void settled.then(() => {
        if (lanes.get(taskId) === settled) lanes.delete(taskId);
      });
      return next;
    },
    /** Remember the version a write of this phone's returned. */
    note(taskId: string, version: number | undefined): void {
      if (typeof version !== 'number') return;
      written.set(taskId, Math.max(version, written.get(taskId) ?? version));
    },
    /**
     * The version the next edit is made against: the newer of the loaded task's and the one this
     * phone's last write returned. Versions only go up, so a reload that started before a write and
     * landed after it can't take the phone back to an older one.
     */
    expectedVersion(taskId: string, loaded: number | undefined): number | undefined {
      const mine = written.get(taskId);
      if (typeof loaded !== 'number') return mine;
      return typeof mine === 'number' ? Math.max(mine, loaded) : loaded;
    },
  };
}

export type TaskWrites = ReturnType<typeof createTaskWrites>;

/** The app's one set of task-write lanes (the detail screen and the board share it). */
export const taskWrites = createTaskWrites();

/** The edit with the version it was made against; an unknown version (older server) is left out. */
export function withExpectedVersion<P extends object>(patch: P, version: number | undefined): P & { expectedVersion?: number } {
  return typeof version === 'number' ? { ...patch, expectedVersion: version } : patch;
}

type TaskWritePayload = { id?: unknown; patch?: { expectedVersion?: unknown } };

/**
 * Replays answered by the task as reloaded (a conflict the task already held, perform-mutation) —
 * not by this phone's own save. Its version may be a colleague's later edit (2c review).
 */
const reloaded = new WeakSet<object>();

/** Mark a replay's answer as the reloaded task. */
export function markReloaded<T extends object>(task: T): T {
  reloaded.add(task);
  return task;
}

/** Was this replay answered by the task as reloaded (rather than by this phone's own save)? */
export function isReloaded(result: unknown): boolean {
  return !!result && typeof result === 'object' && reloaded.has(result);
}

/**
 * The version a replayed edit or move made, as far as this phone can be sure it is its own: the
 * server's answer to its own save, or — for a reloaded task — only when nobody saved since this
 * phone's edit (its version is the one the edit expected plus one). Otherwise none.
 */
function ownVersion(m: QueuedMutation, result: unknown): number | undefined {
  const version = (result as { version?: unknown } | null | undefined)?.version;
  if (typeof version !== 'number') return undefined;
  if (!isReloaded(result)) return version;
  const expected = (m.payload as TaskWritePayload | null)?.patch?.expectedVersion;
  return typeof expected === 'number' && version === expected + 1 ? version : undefined;
}

/**
 * After a queued task edit or move replays and the server answers with the task's new version R,
 * this phone's later queued edit of that task made against R - 1 (the version before this phone's
 * own write) now expects R. An edit made against any other version stays as it is, so it is still
 * refused when someone else changed the task in between.
 */
export function rebaseQueuedVersion(done: QueuedMutation, result: unknown, waiting: QueuedMutation): QueuedMutation {
  if (done.kind !== 'task.update' && done.kind !== 'task.move') return waiting;
  if (waiting.kind !== 'task.update') return waiting;
  const made = ownVersion(done, result);
  if (typeof made !== 'number') return waiting;
  const doneId = (done.payload as TaskWritePayload | null)?.id;
  const p = waiting.payload as TaskWritePayload | null;
  if (!p || p.id !== doneId || !p.patch || p.patch.expectedVersion !== made - 1) return waiting;
  return { ...waiting, payload: { ...p, patch: { ...p.patch, expectedVersion: made } } };
}

/** Two values with null, undefined and absent keys all meaning "none" (a JSON-shaped deep compare). */
function sameShape(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameShape(x, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  return [...keys].every((k) => sameShape(ao[k], bo[k]));
}

/** Does the task hold this one field's edited value, as the server would have stored it? */
function holdsField(task: ApiTask, field: string, wanted: unknown): boolean {
  const have = (task as unknown as Record<string, unknown>)[field];
  switch (field) {
    // Calendar days: the phone sends 'YYYY-MM-DD', the server answers with a timestamp.
    case 'dueDate':
    case 'startDate':
      return dueDayKey(have as string | null) === dueDayKey(wanted as string | null);
    // Clearing the description may come back as an empty text or as none.
    case 'description':
      return ((have as string | null) || null) === ((wanted as string | null) || null);
    // The server pins a month-based repeat to its due day (withAnchorDay), so accept either form.
    case 'recurrenceRule': {
      if (!wanted || !have) return !wanted && !have;
      const due = task.dueDate ? new Date(task.dueDate) : null;
      return sameShape(have, wanted) || sameShape(have, withAnchorDay(wanted as RecurrenceRule, due && !Number.isNaN(due.getTime()) ? due : null));
    }
    default:
      return sameShape(have, wanted);
  }
}

/**
 * Does the task already hold every value this queued edit sets? A replayed edit whose first try
 * timed out after the server saved it is refused as a version conflict — by its own change. When
 * the reloaded task already holds the edit, nothing is left to do. An edit with nothing to check
 * is never "held": better a visible conflict than a change silently dropped.
 */
export function taskHoldsEdit(task: ApiTask, patch: Record<string, unknown>): boolean {
  const fields = Object.entries(patch).filter(([k]) => k !== 'expectedVersion' && k !== 'scope');
  return fields.length > 0 && fields.every(([field, wanted]) => holdsField(task, field, wanted));
}

/**
 * A task edit or move replayed by the sync made a new version: it is this phone's own, so the next
 * edit (made before the task's reload lands) is sent against it — not refused as someone else's.
 */
export function noteReplayed(writes: TaskWrites, m: QueuedMutation, result: unknown): void {
  if (m.kind !== 'task.update' && m.kind !== 'task.move') return;
  const id = (m.payload as TaskWritePayload | null)?.id;
  // Never a colleague's version shown by a reload: the next edit would overwrite their change.
  const version = ownVersion(m, result);
  if (typeof id === 'string' && typeof version === 'number') writes.note(id, version);
}
