import { taskNoticeBody } from '../notifications/task-notice';
import type { MoveResult } from './task-move-service';

const STATUS_WORDS = { COMPLETED: ' and marked complete', REOPENED: ' and reopened' } as const;

/**
 * "RIG-4 moved to Operations" — the key people knew it by — then the task as it is now ("OPS-17 · …").
 * A move that completed or re-opened it says so here: one notice, not a second "moved to Done".
 */
export function moveNotice(move: MoveResult): { title: string; body: string | null } {
  const status = move.statusChange ? STATUS_WORDS[move.statusChange] : '';
  return { title: `${move.from.key} moved to ${move.to.name}${status}`, body: taskNoticeBody(move.task) };
}

export interface MoveNotifierDeps {
  /** Who hears about the task (its assignees and watchers who can still open it), never `actorId`. */
  recipients: (taskId: string, actorId: string) => Promise<string[]>;
  notify: (n: { userId: string; type: string; title: string; body: string | null; entityType: string; entityId: string }) => Promise<unknown>;
}

/** Tell the people following a task that it moved to another project (a status-change notification). */
export function createMoveNotifier(deps: MoveNotifierDeps) {
  return async (move: MoveResult & { actorId: string }): Promise<void> => {
    const { title, body } = moveNotice(move);
    for (const userId of await deps.recipients(move.task.id, move.actorId)) {
      await deps.notify({ userId, type: 'TASK_STATUS', title, body, entityType: 'task', entityId: move.task.id });
    }
  };
}
