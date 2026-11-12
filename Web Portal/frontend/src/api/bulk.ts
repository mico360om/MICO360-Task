import type { ApiClient } from '../lib/api-client';
import type { AssigneeChoice, Priority } from './tasks';

/**
 * Bulk task changes (owner, 10 Nov 2026): one request applies one change to up to 500 tasks, each task
 * checked by the same rules as its single-task change; a dry run (the confirmation's preview) says
 * what would change and what would be skipped, and why. Shapes as the bulk lane's API contract.
 */

/** The six statuses a task can be moved to (each task: its own project's first switched-on column of that kind). */
export type BulkStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

/** One change, applied to every task. */
export type BulkAction =
  | { type: 'status'; status: BulkStatus }
  | { type: 'priority'; priority: Priority }
  /** Adds these people (1–20). */
  | { type: 'assign'; userIds: string[] }
  /** Replaces everyone assigned with these people (1–20). */
  | { type: 'reassign'; userIds: string[] }
  /** Takes these people off (left out: everyone). */
  | { type: 'unassign'; userIds?: string[] }
  | { type: 'dueDate'; mode: 'set'; date: string }
  | { type: 'dueDate'; mode: 'clear' }
  /** -365..365, never 0. */
  | { type: 'dueDate'; mode: 'shift'; days: number }
  /** Today's move to another project (people not on the new team need `assignees`). */
  | { type: 'project'; projectId: string; columnId?: string; assignees?: AssigneeChoice }
  /** Category ids of ONE project (at least one id in all). */
  | { type: 'category'; add?: string[]; remove?: string[] }
  /** Guest ids from the project's company list (1–20). */
  | { type: 'guests'; add: string[] }
  /** At most 50 tasks: a copy of each ("… (copy)"). */
  | { type: 'duplicate' }
  | { type: 'archive' }
  | { type: 'unarchive' }
  /** To the Recycle Bin. */
  | { type: 'delete' };

export type BulkActionType = BulkAction['type'];

/** A task the change was (or, in a dry run, would be) applied to. */
export interface BulkChanged {
  id: string;
  key: string;
  title: string;
  projectId: string;
  /** Something to say about it ("Waits for approval"). */
  note?: { code: string; text: string };
  /** Duplicate: its copy. */
  copy?: { id: string; key: string };
}

/** A task left as it was, and why (a task the person can't open has no key or title: never named). */
export interface BulkSkipped {
  id: string;
  key?: string;
  title?: string;
  code: string;
  /** A plain sentence, shown as it is. */
  reason: string;
}

export interface BulkResult {
  action: BulkActionType;
  dryRun: boolean;
  total: number;
  changed: BulkChanged[];
  skipped: BulkSkipped[];
  /** Null for a dry run, when nothing changed, and for an action without Undo. */
  undo: { id: string; until: string } | null;
}

export interface BulkUndoResult {
  restored: { id: string; key: string; title: string; projectId: string }[];
  /** CHANGED_SINCE: "Changed since — left as it is." */
  skipped: BulkSkipped[];
}

export function bulkApi(client: ApiClient) {
  return {
    /** Apply (or, with dryRun, preview) one change to these tasks. */
    run: (taskIds: string[], action: BulkAction, opts: { dryRun?: boolean } = {}) =>
      client
        .post<{ data: BulkResult }>('/tasks/bulk', { taskIds, action, ...(opts.dryRun ? { dryRun: true } : {}) })
        .then((r) => r.data),
    /** Put back what a bulk change did (the person who made it, within its window, once). */
    undo: (bulkId: string) => client.post<{ data: BulkUndoResult }>(`/tasks/bulk/${encodeURIComponent(bulkId)}/undo`, {}).then((r) => r.data),
  };
}
