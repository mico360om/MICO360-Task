import type { ProjectMoveWrite } from './task-move-repository';

/** One activity line a move writes: on the task (in its new project), or on the old project alone. */
export interface MoveHistoryLine {
  taskId: string | null;
  projectId: string;
  action: string;
  meta: Record<string, unknown>;
}

/**
 * The history a move writes, oldest first — every repository writes these lines, in this order:
 * - each assignee taken off the task (UNASSIGNED, as when someone is unassigned);
 * - what the move changed (UPDATED: the due date the new project gave it, the milestone cleared);
 * - the move itself (PROJECT_CHANGED), the task's newest line;
 * - for the old project, which no longer lists the task's history: where it went
 *   (PROJECT_MOVED_OUT, on no task — people there may not be able to open it any more).
 */
export function moveHistory(w: ProjectMoveWrite, newKey: string): MoveHistoryLine[] {
  const onTask = (action: string, meta: Record<string, unknown>): MoveHistoryLine => ({ taskId: w.taskId, projectId: w.to.projectId, action, meta });
  const changes = [
    ...(w.dueDateSet ? [{ field: 'dueDate', from: null, to: w.dueDateSet }] : []),
    ...(w.patch.isMilestone === false ? [{ field: 'milestone', from: true, to: false }] : []),
    ...(w.patch.clientVisible === false ? [{ field: 'clientVisible', from: true, to: false, reason: 'moved' }] : []),
  ];
  return [
    ...w.unassign.map((p) => onTask('UNASSIGNED', { assigneeId: p.id, assignee: p.name })),
    ...(changes.length > 0 ? [onTask('UPDATED', { changes })] : []),
    onTask('PROJECT_CHANGED', { fromProjectId: w.from.projectId, fromProject: w.from.name, fromKey: w.from.key, toProjectId: w.to.projectId, toProject: w.to.name, toKey: newKey }),
    {
      taskId: null,
      projectId: w.from.projectId,
      action: 'PROJECT_MOVED_OUT',
      meta: { key: w.from.key, title: w.title, fromProjectId: w.from.projectId, fromProject: w.from.name, toProjectId: w.to.projectId, toProject: w.to.name, toKey: newKey },
    },
  ];
}
