import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { TaskMovedConflictError } from '../../src/modules/tasks/task-move-repository';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createRecurrenceService } from '../../src/modules/tasks/recurrence-service';
import { createPrismaSearchDataSource } from '../../src/modules/search/prisma-search-data-source';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
// 10:00 on 24 Oct in Muscat.
const NOW = new Date('2026-10-24T06:00:00Z');
const TODAY = new Date('2026-10-24T00:00:00.000Z');
const tasksRepo = createPrismaTaskRepository(prisma);
const taskService = createTaskService({ tasks: tasksRepo, projects: createPrismaProjectLookup(prisma), timeZone: TZ, now: () => NOW });
const moveRepo = createPrismaTaskMoveRepository(prisma);
const moves = createTaskMoveService({ repo: moveRepo, timeZone: TZ, now: () => NOW });
const recurrence = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => NOW }), timeZone: TZ, now: () => NOW });
const search = createPrismaSearchDataSource(prisma);

const CODES = ['MVRIG', 'MVOPS'];
const EMAILS = ['move-manager@mico360.test', 'move-mate@mico360.test', 'move-outsider@mico360.test'];

let manager = { id: '', roles: [] as string[] };
let mateId = '';
let outsiderId = '';
let rig = { id: '', todo: '', doing: '', done: '' };
let ops = { id: '', todo: '', doing: '', done: '' };

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.taskKeyAlias.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

async function project(code: string, name: string, extra: Partial<Prisma.ProjectUncheckedCreateInput> = {}) {
  const p = await prisma.project.create({ data: { code, name, createdById: manager.id, ...extra } });
  const col = (n: string, category: 'TODO' | 'IN_PROGRESS' | 'DONE', position: number) =>
    prisma.kanbanColumn.create({ data: { projectId: p.id, name: n, category, position } }).then((c) => c.id);
  return { id: p.id, todo: await col('To do', 'TODO', 0), doing: await col(code === 'MVOPS' ? 'Doing' : 'In progress', 'IN_PROGRESS', 1), done: await col('Done', 'DONE', 2) };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  const user = (email: string, first: string, last: string) =>
    prisma.user.create({ data: { email, username: email.split('@')[0]!, passwordHash: 'x', firstName: first, lastName: last } });
  manager = { id: (await user(EMAILS[0]!, 'Aisha', 'Khan')).id, roles: ['EMPLOYEE'] };
  mateId = (await user(EMAILS[1]!, 'Omar', 'Ahmed')).id;
  outsiderId = (await user(EMAILS[2]!, 'Sara', 'Al Balushi')).id;
  rig = await project('MVRIG', 'Rig Inspection');
  ops = await project('MVOPS', 'Operations');
  // Aisha manages both projects; Omar is on both teams; Sara only on Rig Inspection.
  await prisma.projectMember.createMany({
    data: [
      { projectId: rig.id, userId: manager.id, role: 'MANAGER' },
      { projectId: ops.id, userId: manager.id, role: 'MANAGER' },
      { projectId: rig.id, userId: mateId },
      { projectId: ops.id, userId: mateId },
      { projectId: rig.id, userId: outsiderId },
    ],
  });
});

const newTask = (title: string, extra: Partial<Parameters<typeof taskService.createTask>[0]> = {}) =>
  taskService.createTask({ title, projectId: rig.id, columnId: rig.todo, createdById: manager.id, ...extra });

describe('Moving a task to another project (integration)', () => {
  it('gives it the next number there, keeps the old key as an alias, and takes its history, people and links along', async () => {
    const blocker = await newTask('Order the parts');
    const task = await newTask('Inspect the rig', { columnId: rig.doing, assigneeIds: [mateId, outsiderId], isMilestone: true });
    expect(task.key).toBe('MVRIG-2');
    await prisma.taskDependency.create({ data: { taskId: task.id, dependsOnTaskId: blocker.id } });
    await prisma.comment.create({ data: { taskId: task.id, userId: manager.id, body: 'Started' } });
    await prisma.checklistItem.create({ data: { taskId: task.id, text: 'Fire exits' } });
    await prisma.taskWatcher.create({ data: { taskId: task.id, userId: mateId } });
    await prisma.activity.create({ data: { taskId: task.id, projectId: rig.id, userId: manager.id, action: 'CREATED', meta: { title: task.title } } });
    await prisma.task.create({ data: { key: 'MVOPS-1', title: 'Already there', projectId: ops.id, columnId: ops.todo, createdById: manager.id } });

    const moved = await moves.moveTask(manager, task.id, { projectId: ops.id, assignees: 'ADD_TO_TEAM' });

    expect(moved.task).toMatchObject({ id: task.id, key: 'MVOPS-2', projectId: ops.id, columnId: ops.doing, isMilestone: false, formerKeys: ['MVRIG-2'] });
    expect(moved.from).toEqual({ projectId: rig.id, name: 'Rig Inspection', key: 'MVRIG-2' });
    expect(moved.to).toEqual({ projectId: ops.id, name: 'Operations', key: 'MVOPS-2' });
    expect(moved.addedToTeam).toEqual([{ id: outsiderId, name: 'Sara Al Balushi' }]);
    const alias = await prisma.taskKeyAlias.findUniqueOrThrow({ where: { key: 'MVRIG-2' } });
    expect(alias).toMatchObject({ taskId: task.id, projectId: rig.id });
    // Its people, comments, checklist, watchers and blockers are still the task's.
    expect((await prisma.taskAssignee.findMany({ where: { taskId: task.id } })).map((a) => a.userId).sort()).toEqual([mateId, outsiderId].sort());
    expect(await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: ops.id, userId: outsiderId } } })).toMatchObject({ role: 'MEMBER' });
    expect(await prisma.comment.count({ where: { taskId: task.id } })).toBe(1);
    expect(await prisma.checklistItem.count({ where: { taskId: task.id } })).toBe(1);
    expect(await prisma.taskWatcher.count({ where: { taskId: task.id } })).toBe(1);
    expect(await prisma.taskDependency.count({ where: { taskId: task.id, dependsOnTaskId: blocker.id } })).toBe(1);
    // Its history goes with it, filed under the new project, with the move as the newest line.
    const history = await prisma.activity.findMany({ where: { taskId: task.id } });
    expect(new Set(history.map((h) => h.projectId))).toEqual(new Set([ops.id]));
    expect(history.map((h) => h.action).sort()).toEqual(['CREATED', 'PROJECT_CHANGED']);
    const line = history.find((h) => h.action === 'PROJECT_CHANGED')!;
    expect(line).toMatchObject({ userId: manager.id });
    expect(line.meta).toEqual({ fromProject: 'Rig Inspection', fromKey: 'MVRIG-2', toProject: 'Operations', toKey: 'MVOPS-2', fromProjectId: rig.id, toProjectId: ops.id });
  });

  it('can take people who aren’t on the new team off the task instead', async () => {
    const task = await newTask('Inspect the rig', { assigneeIds: [mateId, outsiderId] });
    const moved = await moves.moveTask(manager, task.id, { projectId: ops.id, assignees: 'UNASSIGN' });
    expect(moved.unassigned).toEqual([{ id: outsiderId, name: 'Sara Al Balushi' }]);
    expect((await prisma.taskAssignee.findMany({ where: { taskId: task.id } })).map((a) => a.userId)).toEqual([mateId]);
    expect(await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: ops.id, userId: outsiderId } } })).toBeNull();
    const line = await prisma.activity.findFirstOrThrow({ where: { taskId: task.id, action: 'UNASSIGNED' } });
    expect(line).toMatchObject({ userId: manager.id, projectId: ops.id, meta: { assigneeId: outsiderId, assignee: 'Sara Al Balushi' } });
  });

  it('gives an undated task today when the new project’s tasks are due today, and records it', async () => {
    await prisma.project.update({ where: { id: ops.id }, data: { defaultDueToday: true } });
    const task = await newTask('No date yet');
    const moved = await moves.moveTask(manager, task.id, { projectId: ops.id });
    expect(moved.task.dueDate).toEqual(TODAY);
    expect(moved.dueDateSet).toBe('2026-10-24');
    const line = await prisma.activity.findFirstOrThrow({ where: { taskId: task.id, action: 'UPDATED' } });
    expect(line.meta).toEqual({ changes: [{ field: 'dueDate', from: null, to: '2026-10-24' }] });
  });

  it('never gives an old key to another task: new tasks and repeat copies in the old project take the next unused number', async () => {
    await newTask('One');
    const two = await newTask('Two');
    await moves.moveTask(manager, two.id, { projectId: ops.id });
    // MVRIG-2 is now an old key of the moved task: the next task in Rig Inspection is MVRIG-3.
    expect((await newTask('Three')).key).toBe('MVRIG-3');
    const repeating = await newTask('Weekly check', { dueDate: new Date('2026-10-20T00:00:00.000Z'), recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    expect(repeating.key).toBe('MVRIG-4');
    const copy = await recurrence.onTaskCompleted({ id: repeating.id, dueDate: repeating.dueDate, recurrenceRule: repeating.recurrenceRule, recurrenceParentId: null });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: copy!.id } })).key).toBe('MVRIG-5');
  });

  it('refuses a key that is already an old key, at the database (unique)', async () => {
    const task = await newTask('One');
    await prisma.taskKeyAlias.create({ data: { key: 'MVRIG-90', taskId: task.id, projectId: rig.id } });
    await expect(prisma.taskKeyAlias.create({ data: { key: 'MVRIG-90', taskId: task.id, projectId: rig.id } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('tasks moved into the same project at the same moment get different numbers, with none skipped', async () => {
    const ids = await Promise.all(['A', 'B', 'C'].map(async (t) => (await newTask(t)).id));
    const moved = await Promise.all(ids.map((id) => moves.moveTask(manager, id, { projectId: ops.id })));
    expect(moved.map((m) => m.task.key).sort()).toEqual(['MVOPS-1', 'MVOPS-2', 'MVOPS-3']);
  });

  it('numbers carry on from the highest one used, old keys included, even after a gap', async () => {
    await prisma.task.create({ data: { key: 'MVOPS-7', title: 'Imported', projectId: ops.id, columnId: ops.todo, createdById: manager.id } });
    const a = await newTask('A');
    expect((await moves.moveTask(manager, a.id, { projectId: ops.id })).task.key).toBe('MVOPS-8');
    expect((await taskService.createTask({ title: 'New', projectId: ops.id, columnId: ops.todo, createdById: manager.id })).key).toBe('MVOPS-9');
  });

  it('a move and a new task in the same project at the same moment never share a number', async () => {
    const a = await newTask('A');
    const [moved, created] = await Promise.all([
      moves.moveTask(manager, a.id, { projectId: ops.id }),
      taskService.createTask({ title: 'New', projectId: ops.id, columnId: ops.todo, createdById: manager.id }),
    ]);
    expect(moved.task.key).not.toBe(created.key);
    expect([moved.task.key, created.key].sort()).toEqual(['MVOPS-1', 'MVOPS-2']);
  });

  it('refuses to move a task that has meanwhile left the project it was read from', async () => {
    const task = await newTask('Moving twice');
    await moves.moveTask(manager, task.id, { projectId: ops.id });
    await expect(
      moveRepo.move({
        taskId: task.id,
        from: { projectId: rig.id, name: 'Rig Inspection', key: 'MVRIG-1' },
        to: { projectId: ops.id, name: 'Operations', code: 'MVOPS' },
        columnId: ops.todo,
        patch: {},
        addToTeam: [],
        unassign: [],
        actorId: manager.id,
      }),
    ).rejects.toBeInstanceOf(TaskMovedConflictError);
  });

  it('the old key still finds the task: search, and the task’s own details', async () => {
    const task = await newTask('Inspect the rig');
    await moves.moveTask(manager, task.id, { projectId: ops.id });
    const hits = await search.searchTasks!('MVRIG-1', null, 50);
    expect(hits).toEqual([expect.objectContaining({ id: task.id, key: 'MVOPS-1', formerKeys: ['MVRIG-1'] })]);
    expect((await search.searchTasks!('mvrig-1', [ops.id], 50)).map((t) => t.id)).toEqual([task.id]);
    // Scoped to the old project only, it is gone: it isn't there any more.
    expect(await search.searchTasks!('MVRIG-1', [rig.id], 50)).toEqual([]);
    expect((await tasksRepo.findById(task.id))!.formerKeys).toEqual(['MVRIG-1']);
  });

  it('moving the newest copy of a repeating task: its next copies are made in the new project', async () => {
    const head = await newTask('Weekly check', { dueDate: new Date('2026-10-20T00:00:00.000Z'), recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    await moves.moveTask(manager, head.id, { projectId: ops.id });
    const copy = await recurrence.onTaskCompleted({ id: head.id, dueDate: head.dueDate, recurrenceRule: head.recurrenceRule, recurrenceParentId: null });
    const made = await prisma.task.findUniqueOrThrow({ where: { id: copy!.id } });
    expect(made).toMatchObject({ projectId: ops.id, key: 'MVOPS-2', columnId: ops.todo, recurrenceParentId: head.id });
  });
});
