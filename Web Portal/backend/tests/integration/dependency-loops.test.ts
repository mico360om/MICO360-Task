import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaDependencyRepository } from '../../src/modules/tasks/prisma-dependency-repository';
import { createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createDependencyService } from '../../src/modules/tasks/dependency-service';
import { batch4aWorld, outcome } from './batch4a-helpers';

// Review fix #12 + N12 (13 Nov 2026): two people linking A→B and B→A at the same moment both
// succeeded (30/30), making a loop; a loop could also form through a task in the Recycle Bin and
// appear when it was restored. Links are now added one at a time across the site (a hold on a
// job_locks row taken first), the loop check follows links through binned tasks too, and the check
// and the insert are one transaction. Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const world = batch4aWorld(prisma, 'DLP');
const svc = createDependencyService({ repo: createPrismaDependencyRepository(prisma), taskLookup: createPrismaTaskLookup(prisma) });
const TRIALS = 15;

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(() => world.clean());
afterAll(async () => {
  await world.clean();
  await prisma.$disconnect();
});

/** Is there a loop among these tasks' links (every link, binned tasks included)? */
async function hasLoop(ids: string[]): Promise<boolean> {
  const edges = await prisma.taskDependency.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, dependsOnTaskId: true } });
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
  return ids.some((id) => visit(id));
}

describe('dependency links added at the same moment (review fix #12)', () => {
  it('A→B and B→A at once: exactly one is made, the other refused (DEPENDENCY_CYCLE) — never a loop', async () => {
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    for (let i = 0; i < TRIALS; i++) {
      const a = await world.task(p.id, p.code, todo.id, owner.id);
      const b = await world.task(p.id, p.code, todo.id, owner.id);
      const r = await Promise.allSettled([svc.addDependency(a.id, b.id), svc.addDependency(b.id, a.id)]);
      expect(r.map(outcome).sort()).toEqual(['DEPENDENCY_CYCLE', 'ok']);
      expect(await hasLoop([a.id, b.id])).toBe(false);
    }
  });

  it('a three-task loop made of three links at once: at most two are made', async () => {
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    for (let i = 0; i < TRIALS; i++) {
      const [c, d, e] = [await world.task(p.id, p.code, todo.id, owner.id), await world.task(p.id, p.code, todo.id, owner.id), await world.task(p.id, p.code, todo.id, owner.id)];
      const r = await Promise.allSettled([svc.addDependency(c.id, d.id), svc.addDependency(d.id, e.id), svc.addDependency(e.id, c.id)]);
      expect(r.map(outcome).sort()).toEqual(['DEPENDENCY_CYCLE', 'ok', 'ok']);
      expect(await hasLoop([c.id, d.id, e.id])).toBe(false);
    }
  });

  it('links across two projects at once are checked together (cross-project links are allowed)', async () => {
    const owner = await world.user(true);
    const one = await world.project(owner.id);
    const two = await world.project(owner.id);
    for (let i = 0; i < 5; i++) {
      const a = await world.task(one.p.id, one.p.code, one.todo.id, owner.id);
      const b = await world.task(two.p.id, two.p.code, two.todo.id, owner.id);
      const r = await Promise.allSettled([svc.addDependency(a.id, b.id), svc.addDependency(b.id, a.id)]);
      expect(r.map(outcome).sort()).toEqual(['DEPENDENCY_CYCLE', 'ok']);
    }
  });

  it('the same link twice at once: one is made, the other told it already exists', async () => {
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    const a = await world.task(p.id, p.code, todo.id, owner.id);
    const b = await world.task(p.id, p.code, todo.id, owner.id);
    const r = await Promise.allSettled([svc.addDependency(a.id, b.id), svc.addDependency(a.id, b.id)]);
    expect(r.map(outcome).sort()).toEqual(['DEPENDENCY_EXISTS', 'ok']);
  });
});

describe('a loop through a task in the Recycle Bin (N12)', () => {
  it('X→D, D→Y, D binned, then Y→X: refused, so restoring D brings back no loop', async () => {
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    const [x, d, y] = [await world.task(p.id, p.code, todo.id, owner.id), await world.task(p.id, p.code, todo.id, owner.id), await world.task(p.id, p.code, todo.id, owner.id)];
    await svc.addDependency(x.id, d.id);
    await svc.addDependency(d.id, y.id);
    await prisma.task.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    await expect(svc.addDependency(y.id, x.id)).rejects.toMatchObject({ code: 'DEPENDENCY_CYCLE', status: 409 });
    await prisma.task.update({ where: { id: d.id }, data: { deletedAt: null } });
    expect(await hasLoop([x.id, d.id, y.id])).toBe(false);
  });

  it('what a task shows is unchanged: a binned blocker is still left out of its list', async () => {
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    const [a, b] = [await world.task(p.id, p.code, todo.id, owner.id), await world.task(p.id, p.code, todo.id, owner.id)];
    await svc.addDependency(a.id, b.id);
    await prisma.task.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
    expect(await svc.listDependencies(a.id)).toEqual({ blockedBy: [], blocks: [] });
  });

  it('the hold is a row of its own in job_locks (made when missing)', async () => {
    await prisma.jobLock.deleteMany({ where: { name: 'task-dependencies' } });
    const owner = await world.user(true);
    const { p, todo } = await world.project(owner.id);
    const [a, b] = [await world.task(p.id, p.code, todo.id, owner.id), await world.task(p.id, p.code, todo.id, owner.id)];
    await svc.addDependency(a.id, b.id);
    expect(await prisma.jobLock.count({ where: { name: 'task-dependencies' } })).toBe(1);
  });
});
