/**
 * My Tasks' bulk actions (4d), as the website's (Web Portal/frontend/src/lib/bulkActions.ts): one
 * action on many tasks, one at a time, each through that task's own write — on the phone, the task
 * write path (its lane, its version, kept on this phone when it gets no answer). A refusal is
 * counted, never fatal; a change kept on this phone is counted apart. Pure (the writes come in).
 */
import { isNetworkError } from './api-client';
import type { Refresh } from './refresh';
import type { ApiColumn, Priority } from './types';

export interface BulkTaskRef {
  id: string;
  projectId: string;
}

export type BulkAction =
  | { type: 'complete' }
  | { type: 'setDueDate'; dueDate: string | null }
  | { type: 'setPriority'; priority: Priority }
  | { type: 'assign'; userId: string }
  | { type: 'move'; columnId: string };

export interface BulkDeps {
  update(task: BulkTaskRef, patch: { dueDate?: string | null; priority?: Priority }): Promise<unknown>;
  move(task: BulkTaskRef, columnId: string): Promise<unknown>;
  assign(task: BulkTaskRef, userId: string): Promise<unknown>;
  /** The task's project's Done column, or null when it has none. */
  doneColumnFor(task: BulkTaskRef): Promise<string | null>;
}

export interface BulkResult {
  succeeded: number;
  failed: number;
  /** Got no answer: kept on this phone, sent later. */
  kept: number;
  /** Not tried: the run was stopped before them (absent when it ran to the end). */
  stopped?: number;
}

export interface BulkRunOptions {
  /** How far it is: called before the first task and after each one (final review A2). */
  onProgress?: (done: number, total: number) => void;
  /** Asked before each task: false stops the run there (Stop) — the tasks after it are left as they are. */
  shouldContinue?: () => boolean;
}

class NoDoneColumn extends Error {}

export async function runBulk(tasks: readonly BulkTaskRef[], action: BulkAction, deps: BulkDeps, opts: BulkRunOptions = {}): Promise<BulkResult> {
  let succeeded = 0;
  let failed = 0;
  let kept = 0;
  let tried = 0;
  opts.onProgress?.(0, tasks.length);
  for (const task of tasks) {
    if (opts.shouldContinue && !opts.shouldContinue()) break;
    tried += 1;
    try {
      switch (action.type) {
        case 'complete': {
          const col = await deps.doneColumnFor(task);
          if (!col) throw new NoDoneColumn('No done column for this project.');
          await deps.move(task, col);
          break;
        }
        case 'move':
          await deps.move(task, action.columnId);
          break;
        case 'setDueDate':
          await deps.update(task, { dueDate: action.dueDate });
          break;
        case 'setPriority':
          await deps.update(task, { priority: action.priority });
          break;
        case 'assign':
          await deps.assign(task, action.userId);
          break;
      }
      succeeded += 1;
    } catch (e) {
      if (isNetworkError(e)) kept += 1;
      else failed += 1;
    }
    opts.onProgress?.(tried, tasks.length);
  }
  const stopped = tasks.length - tried;
  return { succeeded, failed, kept, ...(stopped ? { stopped } : {}) };
}

/** While a bulk action runs: "12 of 150 done…" (final review A2). */
export function bulkProgressText(done: number, total: number): string {
  return `${done} of ${total} done…`;
}

/**
 * A bulk run's refreshes (final review A2): each task's own data (its details, activity, people) as
 * it goes, and everything that lists tasks — My Tasks, the boards, the calendar, the projects'
 * figures — once, at the end (`finish`). A list refreshed after every task would be read again for
 * each of them (each refresh calls off the one before): 150 tasks, 150 downloads of the whole list.
 */
export function createBulkRefresher(apply: (targets: Refresh[]) => void) {
  const atEnd = new Map<string, Refresh>();
  const ownTask = (t: Refresh) => 'queryKey' in t && t.queryKey[0] === 'task';
  return {
    add: (targets: Refresh[]): void => {
      const own = targets.filter(ownTask);
      if (own.length) apply(own);
      for (const t of targets) if (!ownTask(t)) atEnd.set(JSON.stringify(t), t);
    },
    /** The run is over: everything it touched, with `extra`, in one pass. */
    finish: (extra: Refresh[] = []): void => {
      for (const t of extra) atEnd.set(JSON.stringify(t), t);
      const all = [...atEnd.values()];
      atEnd.clear();
      if (all.length) apply(all);
    },
  };
}

/** How each action is told, as the website's toast. */
export const BULK_LABELS = {
  complete: 'Completed',
  setDueDate: 'Updated due date on',
  setPriority: 'Set priority on',
  assign: 'Assigned',
  move: 'Moved',
} as const;

/**
 * "Completed 3 tasks." / "Assigned 2, 1 couldn’t be updated." — what waits on this phone, and what a
 * Stop left as it was.
 */
export function bulkResultText(label: string, r: BulkResult): string {
  const left = r.stopped ?? 0;
  if (left && r.succeeded === 0 && r.failed === 0 && r.kept === 0) return 'Stopped — no tasks were changed.';
  const stopped = left ? `Stopped — ${left} ${left === 1 ? 'task wasn’t' : 'tasks weren’t'} changed.` : '';
  const kept = r.kept ? `${r.kept} saved on this phone — will sync when you’re online.` : '';
  const done =
    r.succeeded === 0 && r.failed === 0 && r.kept
      ? 'Saved on this phone — will sync when you’re online.'
      : [r.failed === 0 ? `${label} ${r.succeeded} task${r.succeeded === 1 ? '' : 's'}.` : `${label} ${r.succeeded}, ${r.failed} couldn’t be updated.`, kept].filter(Boolean).join(' ');
  return stopped ? `${done} ${stopped}` : done;
}

/** The website's question before clearing the due dates. */
export function clearDatesQuestion(count: number): string {
  return `Clear the due date on ${count} task${count === 1 ? '' : 's'}?`;
}

/** A project's Done column: a shown one, else any (the website's rule). */
export function doneColumnOf(columns: readonly ApiColumn[]): string | null {
  return (columns.find((c) => c.category === 'DONE' && c.enabled) ?? columns.find((c) => c.category === 'DONE'))?.id ?? null;
}
