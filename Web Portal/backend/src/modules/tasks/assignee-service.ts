import { NotFoundError, ValidationError } from '../../lib/http-errors';
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

  /** The subset of `userIds` that can be assigned in the project (all of them when unchecked). */
  async function eligibleAssignees(projectId: string, userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (!repo.eligibleUserIds || unique.length === 0) return unique;
    const ok = new Set(await repo.eligibleUserIds(projectId, unique));
    return unique.filter((id) => ok.has(id));
  }

  /**
   * Only active users who can see the project may be assigned — being assigned must never be a
   * way to hand someone outside the project access to its work.
   */
  async function assertAssignable(projectId: string, userIds: string[]): Promise<string[]> {
    const unique = [...new Set(userIds)];
    const ok = new Set(await eligibleAssignees(projectId, unique));
    const rejected = unique.filter((id) => !ok.has(id));
    if (rejected.length > 0) {
      throw new ValidationError('Only active members of this project can be assigned.', { userIds: rejected });
    }
    return unique;
  }

  async function assignUsers(taskId: string, userIds: string[], actorId?: string): Promise<AssigneeUser[]> {
    await ensureTask(taskId);
    const projectId = repo.projectIdOfTask ? await repo.projectIdOfTask(taskId) : null;
    const ids = projectId ? await assertAssignable(projectId, userIds) : [...new Set(userIds)];
    for (const userId of ids) {
      await repo.add(taskId, userId);
    }
    if (ids.length > 0) await onAssigned?.(taskId, ids, actorId);
    return repo.list(taskId);
  }

  /** Fire the assignment side effects for users assigned elsewhere (e.g. atomically on task create). */
  async function notifyAssigned(taskId: string, userIds: string[], actorId?: string): Promise<void> {
    if (userIds.length > 0) await onAssigned?.(taskId, userIds, actorId);
  }

  async function unassignUser(taskId: string, userId: string): Promise<void> {
    await ensureTask(taskId);
    await repo.remove(taskId, userId);
  }

  async function listAssignees(taskId: string): Promise<AssigneeUser[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  return { assignUsers, unassignUser, listAssignees, eligibleAssignees, assertAssignable, notifyAssigned };
}

export type AssigneeService = ReturnType<typeof createAssigneeService>;
