import { describe, it, expect, beforeEach } from 'vitest';
import { createAssigneeService } from './assignee-service';
import type { AssigneeRepository, AssigneeUser, TaskLookup } from './assignee-repository';
import { NotFoundError } from '../../lib/http-errors';

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

  it('fires onAssigned with the assigned user ids (for notifications/activity)', async () => {
    const calls: { taskId: string; userIds: string[] }[] = [];
    const mem = inMemory(['t1']);
    const withHook = createAssigneeService({ ...mem, onAssigned: (taskId, userIds) => { calls.push({ taskId, userIds }); } });
    await withHook.assignUsers('t1', ['u1', 'u2']);
    expect(calls).toEqual([{ taskId: 't1', userIds: ['u1', 'u2'] }]);
  });
});
