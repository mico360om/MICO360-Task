import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { followTask, taskDetailCatchUp, taskDetailEventPlan, type SocketLike } from './task-realtime';

const exact = (...queryKey: string[]) => ({ queryKey, exact: true });

/** A socket the test plays events into; it counts what is listened to. */
function fakeSocket() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const socket: SocketLike = {
    on: (ev, fn) => void (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(fn),
    off: (ev, fn) => void handlers.get(ev)?.delete(fn),
  };
  return { socket, play: (ev: string, payload: unknown) => handlers.get(ev)?.forEach((fn) => fn(payload)), listening: () => [...handlers.values()].reduce((n, s) => n + s.size, 0) };
}

describe('task details, live (4d): what each event refreshes', () => {
  it('a change to this task: the task and its activity — never its other parts (they have their own events)', () => {
    for (const ev of ['task:updated', 'task:moved']) {
      expect(taskDetailEventPlan(ev, { id: 't1' }, 't1', new Set())).toEqual({ deleted: false, refresh: [exact('task', 't1'), exact('task', 't1', 'activity')] });
    }
  });

  it('this task deleted: the screen is told (and nothing is fetched for it)', () => {
    expect(taskDetailEventPlan('task:deleted', { id: 't1' }, 't1', new Set())).toEqual({ deleted: true, refresh: [] });
  });

  it('a task it is linked to (a blocker) changed: that one’s line; deleted, the links too; any other task: nothing', () => {
    expect(taskDetailEventPlan('task:moved', { id: 'b1' }, 't1', new Set(['b1']))).toEqual({ deleted: false, refresh: [exact('task', 'b1')] });
    expect(taskDetailEventPlan('task:deleted', { id: 'b1' }, 't1', new Set(['b1']))).toEqual({ deleted: false, refresh: [exact('task', 't1', 'dependencies'), exact('task', 'b1')] });
    expect(taskDetailEventPlan('task:updated', { id: 'zz' }, 't1', new Set(['b1']))).toEqual({ deleted: false, refresh: [] });
    expect(taskDetailEventPlan('task:created', { id: 'new' }, 't1', new Set())).toEqual({ deleted: false, refresh: [] });
  });

  it('after a reconnect (or coming back to the screen): the task and every part of it', () => {
    expect(taskDetailCatchUp('t1')).toEqual([{ queryKey: ['task', 't1'] }]);
  });
});

describe('following a task on its project’s socket (4d)', () => {
  const deps = (over = {}) => ({
    taskId: 't1',
    projectId: 'p1',
    linked: () => new Set(['b1']),
    myId: 'u1',
    inMyTasks: () => true,
    add: vi.fn(),
    onDeleted: vi.fn(),
    onRemoval: vi.fn(),
    ...over,
  });

  it('refreshes this task’s parts for its own part events only', () => {
    const { socket, play } = fakeSocket();
    const d = deps();
    followTask(socket, d);
    play('comment:created', { taskId: 't1' });
    play('comment:created', { taskId: 'other' });
    play('checklist:changed', { taskId: 't1' });
    expect(d.add.mock.calls).toEqual([[[exact('task', 't1', 'comments'), exact('task', 't1', 'activity')]], [[exact('task', 't1', 'checklist'), exact('task', 't1'), exact('task', 't1', 'activity')]]]);
  });

  it('tells the screen once when this task is deleted, and nothing more after it', () => {
    const { socket, play } = fakeSocket();
    const d = deps();
    followTask(socket, d);
    play('task:deleted', { id: 't1' });
    play('task:deleted', { id: 't1' });
    play('task:updated', { id: 't1' });
    expect(d.onDeleted).toHaveBeenCalledTimes(1);
    expect(d.add).not.toHaveBeenCalled();
  });

  it('a removal from this project is passed on (the hook checks the project); another project’s is not', () => {
    const { socket, play } = fakeSocket();
    const d = deps();
    followTask(socket, d);
    play('project:removed', { projectId: 'p2' });
    play('project:removed', { projectId: 'p1' });
    expect(d.onRemoval).toHaveBeenCalledTimes(1);
  });

  it('stops listening to everything it listened to (no leaks)', () => {
    const { socket, listening } = fakeSocket();
    const stop = followTask(socket, deps());
    expect(listening()).toBeGreaterThan(10);
    stop();
    expect(listening()).toBe(0);
  });

  it('the screen follows its task while it is in view, through one hook that joins the room and catches up', () => {
    const hook = readFileSync(resolve(__dirname, '../core/useTaskRealtime.ts'), 'utf8');
    expect(hook).toMatch(/s\.emit\('join', \{ projectId \}\)/);
    expect(hook).toMatch(/if \(isReconnect \|\| back\) batch\.add\(taskDetailCatchUp\(taskId\)\)/);
    expect(hook).toMatch(/const stop = followTask\(socket, \{/);
    expect(hook).toMatch(/stop\(\);\s*dispose\(\);/);
    expect(hook).toMatch(/afterRemoval\(\(\) => services\.resources\.tasks\.get\(taskId\)\)/);
    const screen = readFileSync(resolve(__dirname, '../screens/TaskDetailScreen.tsx'), 'utf8');
    expect(screen).toMatch(/useTaskRealtime\(focused \? taskId : undefined, task\?\.projectId, \{/);
    expect(screen).toMatch(/if \(deleting\.current\) return;/);
  });
});
