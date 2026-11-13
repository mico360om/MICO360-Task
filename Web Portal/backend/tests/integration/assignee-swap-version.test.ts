import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createAssigneeService } from '../../src/modules/tasks/assignee-service';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { runBackfill } from './company-helpers';
import { batch4aWorld, outcome } from './batch4a-helpers';

// N12 (13 Nov 2026): the Workload page's "hand this task to someone else" (POST /tasks/:id/assignees/swap)
// checked the version it was given before writing, but the write neither checked nor moved it on — so
// an edit made at the same moment, or later from the version read before the swap, could overwrite it.
// The swap is now one step with the version (409 VERSION_CONFLICT when stale), and it moves the version
// on like every other task edit. The version stays optional. Requires a running MySQL (TEST_DATABASE_URL).
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const world = batch4aWorld(prisma, 'ASW');
const assignees = createAssigneeService({ repo: createPrismaAssigneeRepository(prisma), taskLookup: createPrismaTaskLookup(prisma) });
const tasks = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma) });
const TRIALS = 15;

beforeAll(async () => {
  await prisma.$connect();
});
beforeEach(() => world.clean());
afterAll(async () => {
  await world.clean();
  await prisma.$disconnect();
});

async function setup() {
  const owner = await world.user(true);
  const omar = await world.user();
  const sara = await world.user();
  const b = await world.project(owner.id, [omar.id, sara.id]);
  await runBackfill(prisma);
  return { owner, omar, sara, ...b };
}
const people = async (taskId: string) => (await prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((a) => a.userId).sort();

describe('the Workload swap and the task version (N12)', () => {
  it('moves the version on, so an edit from the version read before the swap is refused (409), not saved over it', async () => {
    const { owner, omar, sara, p, todo } = await setup();
    const t = await world.task(p.id, p.code, todo.id, owner.id, { assignees: { create: [{ userId: omar.id }] } });
    await assignees.swapAssignee(t.id, omar.id, sara.id, owner.id, { expectedVersion: t.version });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).version).toBe(t.version + 1);
    await expect(tasks.updateTask(t.id, { title: 'Stale edit' }, t.version)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(await people(t.id)).toEqual([sara.id]);
  });

  it('a swap and an edit made from the same version at the same moment: exactly one is saved', async () => {
    const { owner, omar, sara, p, todo } = await setup();
    for (let i = 0; i < TRIALS; i++) {
      const t = await world.task(p.id, p.code, todo.id, owner.id, { assignees: { create: [{ userId: omar.id }] } });
      const r = await Promise.allSettled([
        assignees.swapAssignee(t.id, omar.id, sara.id, owner.id, { expectedVersion: t.version }),
        tasks.updateTask(t.id, { title: 'Edited at the same moment' }, t.version),
      ]);
      expect(r.map(outcome).sort()).toEqual(['VERSION_CONFLICT', 'ok']);
      const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.version).toBe(t.version + 1);
      // Whichever was refused changed nothing.
      if (outcome(r[0]!) === 'ok') expect(await people(t.id)).toEqual([sara.id]);
      else expect(await people(t.id)).toEqual([omar.id]);
    }
  });

  it('two swaps from the same version at the same moment: exactly one is made', async () => {
    const { owner, omar, sara, p, todo } = await setup();
    const third = await world.user();
    await prisma.projectMember.create({ data: { projectId: p.id, userId: third.id } });
    await runBackfill(prisma);
    for (let i = 0; i < TRIALS; i++) {
      const t = await world.task(p.id, p.code, todo.id, owner.id, { assignees: { create: [{ userId: omar.id }] } });
      const r = await Promise.allSettled([
        assignees.swapAssignee(t.id, omar.id, sara.id, owner.id, { expectedVersion: t.version }),
        assignees.swapAssignee(t.id, omar.id, third.id, owner.id, { expectedVersion: t.version }),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(await people(t.id)).toHaveLength(1);
    }
  });

  it('without a version (older apps) the swap still works, and still moves the version on', async () => {
    const { owner, omar, sara, p, todo } = await setup();
    const t = await world.task(p.id, p.code, todo.id, owner.id, { assignees: { create: [{ userId: omar.id }] } });
    await expect(assignees.swapAssignee(t.id, omar.id, sara.id, owner.id)).resolves.toEqual([expect.objectContaining({ id: sara.id })]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).version).toBe(t.version + 1);
  });

  it('a stale version is refused before anything changes, as before', async () => {
    const { owner, omar, sara, p, todo } = await setup();
    const t = await world.task(p.id, p.code, todo.id, owner.id, { assignees: { create: [{ userId: omar.id }] } });
    await tasks.updateTask(t.id, { title: 'Someone else first' }, t.version);
    await expect(assignees.swapAssignee(t.id, omar.id, sara.id, owner.id, { expectedVersion: t.version })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await people(t.id)).toEqual([omar.id]);
  });
});
