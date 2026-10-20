import type { QueuedMutation } from './sync-queue';

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
 * After a queued task edit or move replays and the server answers with the task's new version R,
 * this phone's later queued edit of that task made against R - 1 (the version before this phone's
 * own write) now expects R. An edit made against any other version stays as it is, so it is still
 * refused when someone else changed the task in between.
 */
export function rebaseQueuedVersion(done: QueuedMutation, result: unknown, waiting: QueuedMutation): QueuedMutation {
  if (done.kind !== 'task.update' && done.kind !== 'task.move') return waiting;
  if (waiting.kind !== 'task.update') return waiting;
  const made = (result as { version?: unknown } | null | undefined)?.version;
  if (typeof made !== 'number') return waiting;
  const doneId = (done.payload as TaskWritePayload | null)?.id;
  const p = waiting.payload as TaskWritePayload | null;
  if (!p || p.id !== doneId || !p.patch || p.patch.expectedVersion !== made - 1) return waiting;
  return { ...waiting, payload: { ...p, patch: { ...p.patch, expectedVersion: made } } };
}
