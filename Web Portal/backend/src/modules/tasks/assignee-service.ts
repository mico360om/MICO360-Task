import { NotFoundError } from '../../lib/http-errors';
import type { AssigneeRepository, AssigneeUser, TaskLookup } from './assignee-repository';

export interface AssigneeServiceDeps {
  repo: AssigneeRepository;
  taskLookup: TaskLookup;
  /** Fired after users are assigned (used to create notifications + activity). `actorId` is who assigned them. */
  onAssigned?: (taskId: string, userIds: string[], actorId?: string) => void | Promise<void>;
}

export function createAssigneeService({ repo, taskLookup, onAssigned }: AssigneeServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  async function assignUsers(taskId: string, userIds: string[], actorId?: string): Promise<AssigneeUser[]> {
    await ensureTask(taskId);
    for (const userId of userIds) {
      await repo.add(taskId, userId);
    }
    if (userIds.length > 0) await onAssigned?.(taskId, userIds, actorId);
    return repo.list(taskId);
  }

  async function unassignUser(taskId: string, userId: string): Promise<void> {
    await ensureTask(taskId);
    await repo.remove(taskId, userId);
  }

  async function listAssignees(taskId: string): Promise<AssigneeUser[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  return { assignUsers, unassignUser, listAssignees };
}

export type AssigneeService = ReturnType<typeof createAssigneeService>;
