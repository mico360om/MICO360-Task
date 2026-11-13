import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDependencyRepository, DEPENDENCY_LOCK } from '../../src/modules/tasks/prisma-dependency-repository';
import { createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createDependencyService } from '../../src/modules/tasks/dependency-service';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';
import { batch4aWorld } from './batch4a-helpers';

// Batch 4b (left over from 4a): a task merge moves dependency links onto the main task. It took no part in the
// "task-dependencies" hold that adding a link takes, so a link added at the same moment could close a loop
// through the merged task. The merge (and its undo) now take that hold first, in the same order as adding a link.
// Requires a running MySQL or MariaDB (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const world = batch4aWorld(prisma, 'MDH');
const links = createDependencyService({ repo: createPrismaDependencyRepository(prisma), taskLookup: createPrismaTaskLookup(prisma) });
const merges = createTaskMergeService({ prisma, timeZone: 'Asia/Muscat' });
const TRIALS = 12;

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(async () => {
  const projects = (await prisma.project.findMany({ where: { code: { startsWith: 'MDH' } }, select: { id: true } })).map((x) => x.id);
  const tasks = (await prisma.task.findMany({ where: { projectId: { in: projects } }, select: { id: true } })).map((t) => t.id);
  await prisma.taskMerge.deleteMany({ where: { mainTaskId: { in: tasks } } });
  await world.clean();
});
afterAll(async () => {
  await world.clean();
  await prisma.$disconnect();
});

/** Is there a loop among these tasks' links? */
async function hasLoop(ids: string[]): Promise<boolean> {
  const edges = await prisma.taskDependency.findMany({ where: { OR: [{ taskId: { in: ids } }, { dependsOnTaskId: { in: ids } }] }, select: { taskId: true, dependsOnTaskId: true } });
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.taskId, [...(out.get(e.taskId) ?? []), e.dependsOnTaskId]);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    for (const m of out.get(n) ?? []) if (visit(m)) return true;
    state.set(n, 2);
    return false;
  };
  return [...out.keys()].some((id) => visit(id));
}

describe('a merge and a new link at the same moment (the task-dependencies hold)', () => {
  it('X waits on B; B is merged into M while someone links M to wait on X — never a loop', async () => {
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    const actor = { id: owner.id, roles: ['ADMIN'] };
    let loops = 0;
    for (let i = 0; i < TRIALS; i++) {
      const m = await world.task(p.id, p.code, todo.id, owner.id);
      const b = await world.task(p.id, p.code, todo.id, owner.id);
      const x = await world.task(p.id, p.code, todo.id, owner.id);
      await links.addDependency(x.id, b.id); // X waits on B
      await Promise.allSettled([merges.merge(actor, { taskIds: [m.id, b.id], mainTaskId: m.id }), links.addDependency(m.id, x.id)]);
      if (await hasLoop([m.id, b.id, x.id])) loops += 1;
    }
    expect(loops).toBe(0);
  });

  it('the merge takes the hold first (its job_locks row is there after a merge)', async () => {
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    const m = await world.task(p.id, p.code, todo.id, owner.id);
    const b = await world.task(p.id, p.code, todo.id, owner.id);
    await prisma.jobLock.deleteMany({ where: { name: DEPENDENCY_LOCK } });
    await merges.merge({ id: owner.id, roles: ['ADMIN'] }, { taskIds: [m.id, b.id], mainTaskId: m.id });
    expect(await prisma.jobLock.count({ where: { name: DEPENDENCY_LOCK } })).toBe(1);
  });
});
