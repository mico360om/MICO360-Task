/**
 * My Tasks' bulk actions (4d), as the website's (Web Portal/frontend/src/lib/bulkActions.ts): one
 * action on many tasks, one at a time, each through that task's own write — on the phone, the task
 * write path (its lane, its version, kept on this phone when it gets no answer). A refusal is
 * counted, never fatal; a change kept on this phone is counted apart. Pure (the writes come in).
 */
import { isNetworkError } from './api-client';
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
}

class NoDoneColumn extends Error {}

export async function runBulk(tasks: readonly BulkTaskRef[], action: BulkAction, deps: BulkDeps): Promise<BulkResult> {
  let succeeded = 0;
  let failed = 0;
  let kept = 0;
  for (const task of tasks) {
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
  }
  return { succeeded, failed, kept };
}

/** How each action is told, as the website's toast. */
export const BULK_LABELS = {
  complete: 'Completed',
  setDueDate: 'Updated due date on',
  setPriority: 'Set priority on',
  assign: 'Assigned',
  move: 'Moved',
} as const;

/** "Completed 3 tasks." / "Assigned 2, 1 couldn’t be updated." — and what waits on this phone. */
export function bulkResultText(label: string, r: BulkResult): string {
  const kept = r.kept ? `${r.kept} saved on this phone — will sync when you’re online.` : '';
  if (r.succeeded === 0 && r.failed === 0 && r.kept) return `Saved on this phone — will sync when you’re online.`;
  const done = r.failed === 0 ? `${label} ${r.succeeded} task${r.succeeded === 1 ? '' : 's'}.` : `${label} ${r.succeeded}, ${r.failed} couldn’t be updated.`;
  return kept ? `${done} ${kept}` : done;
}

/** The website's question before clearing the due dates. */
export function clearDatesQuestion(count: number): string {
  return `Clear the due date on ${count} task${count === 1 ? '' : 's'}?`;
}

/** A project's Done column: a shown one, else any (the website's rule). */
export function doneColumnOf(columns: readonly ApiColumn[]): string | null {
  return (columns.find((c) => c.category === 'DONE' && c.enabled) ?? columns.find((c) => c.category === 'DONE'))?.id ?? null;
}
