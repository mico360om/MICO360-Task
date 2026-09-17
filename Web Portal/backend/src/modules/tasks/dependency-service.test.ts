import { describe, it, expect, beforeEach } from 'vitest';
import { createDependencyService } from './dependency-service';
import type { DependencyEdge, DependencyRepository } from './dependency-repository';
import type { TaskLookup } from './assignee-repository';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';

function inMemory(tasks: string[]) {
  const edges = new Map<string, DependencyEdge>(); // key `${taskId}->${dependsOnTaskId}`
  let seq = 0;
  const key = (t: string, d: string) => `${t}->${d}`;
  const repo: DependencyRepository = {
    async add(taskId, dependsOnTaskId) {
      const e: DependencyEdge = { id: `e${seq++}`, taskId, dependsOnTaskId };
      edges.set(key(taskId, dependsOnTaskId), e);
      return e;
    },
    async remove(taskId, dependsOnTaskId) {
      edges.delete(key(taskId, dependsOnTaskId));
    },
    async exists(taskId, dependsOnTaskId) {
      return edges.has(key(taskId, dependsOnTaskId));
    },
    async dependsOn(taskId) {
      return [...edges.values()].filter((e) => e.taskId === taskId).map((e) => e.dependsOnTaskId);
    },
    async blocks(taskId) {
      return [...edges.values()].filter((e) => e.dependsOnTaskId === taskId).map((e) => e.taskId);
    },
  };
  const taskLookup: TaskLookup = { async exists(id) { return tasks.includes(id); } };
  return { repo, taskLookup };
}

let svc: ReturnType<typeof createDependencyService>;
beforeEach(() => {
  svc = createDependencyService(inMemory(['a', 'b', 'c', 'd']));
});

describe('DependencyService.addDependency', () => {
  it('records that a task depends on another', async () => {
    const edge = await svc.addDependency('a', 'b'); // a is blocked by b
    expect(edge.taskId).toBe('a');
    expect(edge.dependsOnTaskId).toBe('b');
    const deps = await svc.listDependencies('a');
    expect(deps.blockedBy).toEqual(['b']);
    const bDeps = await svc.listDependencies('b');
    expect(bDeps.blocks).toEqual(['a']);
  });

  it('rejects a self-dependency', async () => {
    await expect(svc.addDependency('a', 'a')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a duplicate dependency', async () => {
    await svc.addDependency('a', 'b');
    await expect(svc.addDependency('a', 'b')).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFound when either task does not exist', async () => {
    await expect(svc.addDependency('a', 'ghost')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.addDependency('ghost', 'a')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a direct circular dependency', async () => {
    await svc.addDependency('a', 'b'); // a depends on b
    await expect(svc.addDependency('b', 'a')).rejects.toBeInstanceOf(ConflictError); // b depends on a -> cycle
  });

  it('rejects a transitive circular dependency', async () => {
    await svc.addDependency('a', 'b'); // a -> b
    await svc.addDependency('b', 'c'); // b -> c
    // c -> a would close the loop a->b->c->a
    await expect(svc.addDependency('c', 'a')).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows a diamond (non-circular) shape', async () => {
    await svc.addDependency('a', 'b'); // a -> b
    await svc.addDependency('a', 'c'); // a -> c
    await svc.addDependency('b', 'd'); // b -> d
    const edge = await svc.addDependency('c', 'd'); // c -> d (diamond, no cycle)
    expect(edge.taskId).toBe('c');
  });
});

describe('DependencyService.removeDependency', () => {
  it('removes an existing dependency', async () => {
    await svc.addDependency('a', 'b');
    await svc.removeDependency('a', 'b');
    expect((await svc.listDependencies('a')).blockedBy).toEqual([]);
  });
});
