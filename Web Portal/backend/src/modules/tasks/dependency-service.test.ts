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

describe('review fix #12 + N12: one link at a time; the loop check sees binned tasks', () => {
  /** The fake plus a one-at-a-time queue (as the database's hold) and some tasks in the Recycle Bin. */
  function guarded(binned: string[]) {
    const base = inMemory(['a', 'b', 'c', 'd']);
    let queue: Promise<unknown> = Promise.resolve();
    let held = 0;
    const repo: DependencyRepository = {
      ...base.repo,
      // What a task shows leaves binned blockers out; the loop check follows them.
      async dependsOn(taskId) {
        return (await base.repo.dependsOn(taskId)).filter((id) => !binned.includes(id));
      },
      dependsOnAny: (taskId) => base.repo.dependsOn(taskId),
      oneAtATime<T>(work: (r: DependencyRepository) => Promise<T>): Promise<T> {
        const run = queue.then(async () => {
          held++;
          try {
            return await work(repo);
          } finally {
            held--;
          }
        });
        queue = run.catch(() => undefined);
        return run;
      },
    };
    return { svc: createDependencyService({ repo, taskLookup: base.taskLookup }), held: () => held };
  }

  it('two opposite links at the same moment: one is made, the other refused as a loop', async () => {
    const { svc: s } = guarded([]);
    const r = await Promise.allSettled([s.addDependency('a', 'b'), s.addDependency('b', 'a')]);
    expect(r.map((x) => (x.status === 'fulfilled' ? 'ok' : (x.reason as ConflictError).code)).sort()).toEqual(['DEPENDENCY_CYCLE', 'ok']);
  });

  it('a link that would close a loop through a binned task is refused; its list still leaves the binned one out', async () => {
    const { svc: s } = guarded(['b']);
    await s.addDependency('a', 'b');
    await s.addDependency('b', 'c');
    expect((await s.listDependencies('a')).blockedBy).toEqual([]);
    await expect(s.addDependency('c', 'a')).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE' });
  });
});
