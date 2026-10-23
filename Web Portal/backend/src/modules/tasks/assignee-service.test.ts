import { describe, it, expect, beforeEach } from 'vitest';
import { createAssigneeService } from './assignee-service';
import type { AssigneeRepository, AssigneeUser, TaskLookup } from './assignee-repository';
import { NotFoundError, ValidationError } from '../../lib/http-errors';

function inMemory(existingTasks: string[]) {
  const links = new Set<string>(); // `${taskId}:${userId}`
  const users: Record<string, AssigneeUser> = {
    u1: { id: 'u1', username: 'ada', email: 'ada@x', firstName: 'Ada', lastName: 'L' },
    u2: { id: 'u2', username: 'omar', email: 'omar@x', firstName: 'Omar', lastName: 'A' },
  };
  const repo: AssigneeRepository = {
    async add(taskId, userId) {
      links.add(`${taskId}:${userId}`);
    },
    async remove(taskId, userId) {
      links.delete(`${taskId}:${userId}`);
    },
    async list(taskId) {
      return [...links]
        .filter((l) => l.startsWith(`${taskId}:`))
        .map((l) => users[l.split(':')[1]!]!)
        .filter(Boolean);
    },
  };
  const taskLookup: TaskLookup = { async exists(id) { return existingTasks.includes(id); } };
  return { repo, taskLookup };
}

let svc: ReturnType<typeof createAssigneeService>;
beforeEach(() => {
  svc = createAssigneeService(inMemory(['t1']));
});

describe('AssigneeService', () => {
  it('assigns multiple users to a task and lists them', async () => {
    const list = await svc.assignUsers('t1', ['u1', 'u2']);
    expect(list.map((u) => u.username).sort()).toEqual(['ada', 'omar']);
  });

  it('is idempotent when assigning the same user twice', async () => {
    await svc.assignUsers('t1', ['u1']);
    const list = await svc.assignUsers('t1', ['u1']);
    expect(list).toHaveLength(1);
  });

  it('throws NotFound when the task does not exist', async () => {
    await expect(svc.assignUsers('ghost', ['u1'])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('unassigns a user', async () => {
    await svc.assignUsers('t1', ['u1', 'u2']);
    await svc.unassignUser('t1', 'u1');
    const list = await svc.listAssignees('t1');
    expect(list.map((u) => u.username)).toEqual(['omar']);
  });

  it('fires onUnassigned with who was removed and who removed them (for the activity timeline)', async () => {
    const calls: unknown[] = [];
    const s = createAssigneeService({ ...inMemory(['t1']), onUnassigned: (taskId, userId, actorId) => { calls.push({ taskId, userId, actorId }); } });
    await s.assignUsers('t1', ['u1']);
    await s.unassignUser('t1', 'u1', 'u9');
    expect(calls).toEqual([{ taskId: 't1', userId: 'u1', actorId: 'u9' }]);
  });

  it('fires onAssigned with the assigned user ids (for notifications/activity)', async () => {
    const calls: { taskId: string; userIds: string[] }[] = [];
    const mem = inMemory(['t1']);
    const withHook = createAssigneeService({ ...mem, onAssigned: (taskId, userIds) => { calls.push({ taskId, userIds }); } });
    await withHook.assignUsers('t1', ['u1', 'u2']);
    expect(calls).toEqual([{ taskId: 't1', userIds: ['u1', 'u2'] }]);
  });
});

describe('AssigneeService — only active project members can be assigned', () => {
  function checked() {
    const mem = inMemory(['t1']);
    const calls: string[][] = [];
    const repo = {
      ...mem.repo,
      async projectIdOfTask() { return 'p1'; },
      // u1 is an active member of p1; u2 isn't (left the project, or deactivated).
      async eligibleUserIds(projectId: string, userIds: string[]) { return projectId === 'p1' ? userIds.filter((id) => id === 'u1') : []; },
    };
    const svc = createAssigneeService({ repo, taskLookup: mem.taskLookup, onAssigned: (_t, ids) => { calls.push(ids); } });
    return { svc, calls };
  }

  it('rejects the whole request (400) when anyone is not eligible, assigning nobody', async () => {
    const { svc, calls } = checked();
    await expect(svc.assignUsers('t1', ['u1', 'u2'])).rejects.toMatchObject({ status: 400, details: { userIds: ['u2'] } });
    expect(await svc.listAssignees('t1')).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('assigns eligible users', async () => {
    const { svc } = checked();
    expect((await svc.assignUsers('t1', ['u1'])).map((u) => u.id)).toEqual(['u1']);
  });

  it('filters and asserts eligibility for a project (used before a task exists)', async () => {
    const { svc } = checked();
    expect(await svc.eligibleAssignees('p1', ['u1', 'u2', 'u1'])).toEqual(['u1']);
    await expect(svc.assertAssignable('p1', ['u2'])).rejects.toBeInstanceOf(ValidationError);
    expect(await svc.assertAssignable('p1', ['u1', 'u1'])).toEqual(['u1']);
  });

  it('notifyAssigned fires the assignment hook without writing', async () => {
    const { svc, calls } = checked();
    await svc.notifyAssigned('t1', ['u1']);
    await svc.notifyAssigned('t1', []);
    expect(calls).toEqual([['u1']]);
  });
});

describe('AssigneeService — swapping one person for another (the Workload page)', () => {
  function swappable(state: { version: number; done: boolean } = { version: 3, done: false }) {
    const mem = inMemory(['t1']);
    const writes: string[] = [];
    const assigned: string[][] = [];
    const unassigned: string[] = [];
    const repo = {
      ...mem.repo,
      async projectIdOfTask() { return 'p1'; },
      async eligibleUserIds(_p: string, userIds: string[]) { return userIds.filter((id) => id !== 'u3'); },
      async swap(taskId: string, fromId: string, toId: string) {
        writes.push(`swap ${fromId}->${toId}`);
        await mem.repo.add(taskId, toId);
        await mem.repo.remove(taskId, fromId);
      },
    };
    const taskLookup = { ...mem.taskLookup, async state() { return state; } };
    const svc = createAssigneeService({
      repo,
      taskLookup,
      onAssigned: (_t, ids) => { assigned.push(ids); },
      onUnassigned: (_t, id) => { unassigned.push(id); },
    });
    return { svc, writes, assigned, unassigned, mem };
  }

  it('takes one person off and puts another on in one write, telling both as usual', async () => {
    const { svc, writes, assigned, unassigned, mem } = swappable();
    await mem.repo.add('t1', 'u1');
    const list = await svc.swapAssignee('t1', 'u1', 'u2', 'u9', { expectedVersion: 3 });
    expect(list.map((u) => u.id)).toEqual(['u2']);
    expect(writes).toEqual(['swap u1->u2']);
    expect(assigned).toEqual([['u2']]);
    expect(unassigned).toEqual(['u1']);
  });

  it('refuses a task changed since it was read, changing nothing (409 VERSION_CONFLICT)', async () => {
    const { svc, writes, mem } = swappable({ version: 4, done: false });
    await mem.repo.add('t1', 'u1');
    await expect(svc.swapAssignee('t1', 'u1', 'u2', 'u9', { expectedVersion: 3 })).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(writes).toEqual([]);
  });

  it('refuses a task that is already done (409 TASK_DONE)', async () => {
    const { svc, writes, mem } = swappable({ version: 3, done: true });
    await mem.repo.add('t1', 'u1');
    await expect(svc.swapAssignee('t1', 'u1', 'u2', 'u9')).rejects.toMatchObject({ status: 409, code: 'TASK_DONE' });
    expect(writes).toEqual([]);
  });

  it('refuses when the person is no longer on the task (409 ASSIGNEE_GONE)', async () => {
    const { svc, writes } = swappable();
    await expect(svc.swapAssignee('t1', 'u1', 'u2', 'u9')).rejects.toMatchObject({ status: 409, code: 'ASSIGNEE_GONE' });
    expect(writes).toEqual([]);
  });

  it('refuses someone who may not be assigned in the project (400), changing nothing', async () => {
    const { svc, writes, mem } = swappable();
    await mem.repo.add('t1', 'u1');
    await expect(svc.swapAssignee('t1', 'u1', 'u3', 'u9')).rejects.toMatchObject({ status: 400 });
    expect(writes).toEqual([]);
    expect((await svc.listAssignees('t1')).map((u) => u.id)).toEqual(['u1']);
  });
});
