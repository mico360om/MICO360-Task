import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { DependencyEdge, DependencyRepository } from './dependency-repository';
import type { TaskLookup } from './assignee-repository';

export interface DependencyServiceDeps {
  repo: DependencyRepository;
  taskLookup: TaskLookup;
}

export interface DependencyView {
  /** Tasks this task depends on (its blockers). */
  blockedBy: string[];
  /** Tasks that depend on this task (the ones it blocks). */
  blocks: string[];
}

export function createDependencyService({ repo, taskLookup }: DependencyServiceDeps) {
  async function ensureTask(id: string): Promise<void> {
    if (!(await taskLookup.exists(id))) throw new NotFoundError('Task not found.');
  }

  /** Can we reach `target` by following dependsOn edges out of `start`? */
  async function reaches(start: string, target: string): Promise<boolean> {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const node = stack.pop()!;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push(...(await repo.dependsOn(node)));
    }
    return false;
  }

  async function addDependency(taskId: string, dependsOnTaskId: string): Promise<DependencyEdge> {
    if (taskId === dependsOnTaskId) throw new ValidationError('A task cannot depend on itself.');
    await ensureTask(taskId);
    await ensureTask(dependsOnTaskId);
    if (await repo.exists(taskId, dependsOnTaskId)) {
      throw new ConflictError('That dependency already exists.', 'DEPENDENCY_EXISTS');
    }
    // Adding taskId -> dependsOnTaskId is a cycle iff dependsOnTaskId already reaches taskId.
    if (await reaches(dependsOnTaskId, taskId)) {
      throw new ConflictError('That dependency would create a circular chain.', 'DEPENDENCY_CYCLE');
    }
    return repo.add(taskId, dependsOnTaskId);
  }

  async function removeDependency(taskId: string, dependsOnTaskId: string): Promise<void> {
    await repo.remove(taskId, dependsOnTaskId);
  }

  async function listDependencies(taskId: string): Promise<DependencyView> {
    await ensureTask(taskId);
    const [blockedBy, blocks] = await Promise.all([repo.dependsOn(taskId), repo.blocks(taskId)]);
    return { blockedBy, blocks };
  }

  return { addDependency, removeDependency, listDependencies };
}

export type DependencyService = ReturnType<typeof createDependencyService>;
