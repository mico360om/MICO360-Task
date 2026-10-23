import { taskNoticeBody } from '../notifications/task-notice';
import type { MoveResult } from './task-move-service';

/** "RIG-4 moved to Operations" — the key people knew it by — then the task as it is now ("OPS-17 · …"). */
export function moveNotice(move: MoveResult): { title: string; body: string | null } {
  return { title: `${move.from.key} moved to ${move.to.name}`, body: taskNoticeBody(move.task) };
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
