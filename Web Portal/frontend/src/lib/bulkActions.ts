import type { Priority } from '../api/tasks';

/** A task the bulk runner needs to act on — just its id and owning project. */
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

/** Injected operations so the runner is pure/testable (the page wires the real API calls). */
export interface BulkDeps {
  update(taskId: string, patch: { dueDate?: string | null; priority?: Priority }): Promise<unknown>;
  move(taskId: string, columnId: string): Promise<unknown>;
  assign(taskId: string, userId: string): Promise<unknown>;
  /** Resolve the DONE-category column id for a task's project, or null if none exists. */
  doneColumnFor(task: BulkTaskRef): Promise<string | null>;
}

export interface BulkResult {
  succeeded: number;
  failed: number;
}

/**
 * Apply one action to many tasks, one at a time, reusing the existing (object-level-authorized)
 * single-task endpoints. A per-task failure is counted, never fatal — the batch always finishes
 * and reports how many succeeded vs failed.
 */
export async function runBulk(tasks: BulkTaskRef[], action: BulkAction, deps: BulkDeps): Promise<BulkResult> {
  let succeeded = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      switch (action.type) {
        case 'complete': {
          const col = await deps.doneColumnFor(task);
          if (!col) throw new Error('No done column for this project.');
          await deps.move(task.id, col);
          break;
        }
        case 'move':
          await deps.move(task.id, action.columnId);
          break;
        case 'setDueDate':
          await deps.update(task.id, { dueDate: action.dueDate });
          break;
        case 'setPriority':
          await deps.update(task.id, { priority: action.priority });
          break;
        case 'assign':
          await deps.assign(task.id, action.userId);
          break;
      }
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  return { succeeded, failed };
}
