import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import { isNetworkError } from './api-client';
import { movedInCached, type CalendarRange, type DuePatch } from './calendar-data';
import type { CalendarTask } from './calendar-model';
import { afterTaskSaved } from './task-cache';
import { taskWrites as appTaskWrites, withExpectedVersion, type TaskWrites } from './task-writes';
import { queueOnOffline, sendInOrder, type WriteOrderDeps } from './write-order';
import { refresh } from './refresh';
import type { RecurrenceRule } from './recurrence';
import type { ApiTask } from './types';

/** Where the calendar's ranges and overdue list are cached (core/calendar-queries). */
export const CALENDAR_KEY = ['tasks', 'calendar'] as const;

export interface RescheduleVars {
  taskId: string;
  /** The new day ('YYYY-MM-DD') and, for a repeating task's newest copy, its rule (lib/calendar-reschedule). */
  patch: { dueDate: string; recurrenceRule?: RecurrenceRule };
  /** The version the calendar read the task at. */
  readVersion?: number;
}

export interface RescheduleDeps {
  /** PUT /tasks/:id (resources.tasks.update). */
  update: (id: string, body: { dueDate: string; recurrenceRule?: RecurrenceRule; expectedVersion?: number }) => Promise<ApiTask | undefined>;
  queue: WriteOrderDeps['queue'];
  /** The signed-in user. */
  userId: () => string | null;
  /** Ask for a sync now (a move kept behind an older change goes as soon as that one has). */
  sync?: () => void;
  /** The task-write lanes (the app's one set unless a test brings its own). */
  writes?: TaskWrites;
}

const newest = (a: number | undefined, b: number | undefined) => (typeof a === 'number' && typeof b === 'number' ? Math.max(a, b) : (a ?? b));

/** The task's day and repeat before the move (only the fields the move changes), to put back on a refusal. */
type Context = { before: DuePatch | null };

/** The task as a cached calendar answer holds it (a range's tasks or series heads, or the overdue list). */
function cachedTask(qc: QueryClient, taskId: string): CalendarTask | undefined {
  for (const [, data] of qc.getQueriesData({ queryKey: CALENDAR_KEY })) {
    const lists = Array.isArray(data) ? [data] : data && typeof data === 'object' ? [(data as CalendarRange).tasks, (data as CalendarRange).series] : [];
    for (const list of lists) {
      const found = Array.isArray(list) ? (list as CalendarTask[]).find((t) => t?.id === taskId) : undefined;
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Move a task to another day (5a), the way every task edit in the app is saved: in the task's lane,
 * against the newest version this phone knows (lib/task-writes), behind an older change of the
 * task still waiting on this phone, and kept here when it gets no answer (lib/write-order). The
 * calendar shows it on its new day at once; a refusal puts it back and loads the server's copy
 * (someone else may have changed it), and a move kept offline stays shown until it is sent.
 */
export function rescheduleOptions(deps: RescheduleDeps, qc: QueryClient): MutationOptions<ApiTask | undefined, unknown, RescheduleVars, Context> {
  const writes = deps.writes ?? appTaskWrites;
  const order: WriteOrderDeps = { queue: deps.queue, userId: deps.userId, sync: deps.sync };
  /** What each move was sent as (with its expectedVersion), so a move made offline is kept the same. */
  const sentMoves = new WeakMap<object, object>();
  return {
    mutationFn: (v) =>
      writes.run(v.taskId, async () => {
        const loaded = newest(qc.getQueryData<ApiTask>(['task', v.taskId])?.version, v.readVersion);
        const body = withExpectedVersion(v.patch, writes.expectedVersion(v.taskId, loaded));
        sentMoves.set(v, body);
        return sendInOrder(order, { kind: 'task.update', payload: { id: v.taskId, patch: body } }, async () => {
          const updated = await deps.update(v.taskId, body);
          writes.note(v.taskId, updated?.version);
          return updated;
        });
      }),
    onMutate: async (v) => {
      // A reload landing after the move would show it undone, so it is called off — but not a first
      // load: called off, it would stay empty with nothing loading it again.
      await qc.cancelQueries({ queryKey: CALENDAR_KEY, predicate: (q) => q.state.data !== undefined });
      const was = cachedTask(qc, v.taskId);
      const before: DuePatch | null = was ? { dueDate: was.dueDate, ...('recurrenceRule' in v.patch ? { recurrenceRule: was.recurrenceRule ?? null } : {}) } : null;
      qc.setQueriesData({ queryKey: CALENDAR_KEY }, (data: unknown) => movedInCached(data, v.taskId, v.patch as DuePatch));
      return { before };
    },
    onError: async (err, v, ctx) => {
      if (isNetworkError(err)) {
        // No answer: kept on this phone (by the write, or here) and shown on its new day until sent.
        await queueOnOffline(deps.queue, deps.userId(), err, 'task.update', { id: v.taskId, patch: sentMoves.get(v) ?? v.patch });
        return;
      }
      // Refused: only this task goes back (another move made meanwhile stays), and the server's copy is loaded.
      const before = ctx?.before;
      if (before) qc.setQueriesData({ queryKey: CALENDAR_KEY }, (data: unknown) => movedInCached(data, v.taskId, before));
      refresh(qc, [{ listsHolding: v.taskId }, { queryKey: ['task', v.taskId], exact: true }]);
    },
    // The task's details take the server's copy; the lists showing it (the calendar's too) are fetched again.
    onSuccess: (saved, v) => afterTaskSaved(qc, v.taskId, saved, v.patch),
  };
}
