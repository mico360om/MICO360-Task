/**
 * A task's details, live (4d): the screen follows its task on its project's socket room — a change
 * made elsewhere shows at once (so an edit here is far less often refused as someone else's), a
 * change to one part refreshes just that part, a linked task (a blocker) that changes updates its
 * line, and a deletion is told to the screen. After a reconnect, or coming back to the screen, the
 * task and every part of it are fetched again (events may have been missed). Pure, so it is tested.
 */
import { isProjectRemoval, PROJECT_REMOVED_EVENT, taskPartRefreshes, TASK_EVENTS, TASK_PART_EVENTS } from './realtime';
import type { Refresh } from './refresh';

export function taskDetailEventPlan(event: string, payload: unknown, taskId: string, linked: ReadonlySet<string>): { deleted: boolean; refresh: Refresh[] } {
  const raw = (payload as { id?: unknown } | null | undefined)?.id;
  const id = typeof raw === 'string' && raw ? raw : null;
  const exact = (...queryKey: string[]): Refresh => ({ queryKey, exact: true });
  if (!id) return { deleted: false, refresh: [] };
  if (id === taskId) {
    if (event === 'task:deleted') return { deleted: true, refresh: [] };
    return { deleted: false, refresh: [exact('task', taskId), exact('task', taskId, 'activity')] };
  }
  if (!linked.has(id)) return { deleted: false, refresh: [] };
  // A blocker deleted takes its link with it.
  return { deleted: false, refresh: event === 'task:deleted' ? [exact('task', taskId, 'dependencies'), exact('task', id)] : [exact('task', id)] };
}

/** After a reconnect, or back on the screen: the task and every part of it. */
export function taskDetailCatchUp(taskId: string): Refresh[] {
  return [{ queryKey: ['task', taskId] }];
}

/** What of socket.io's socket this needs. */
export interface SocketLike {
  on(event: string, fn: (payload: unknown) => void): unknown;
  off(event: string, fn: (payload: unknown) => void): unknown;
}

export interface FollowTaskDeps {
  taskId: string;
  projectId: string;
  /** The tasks it is linked to now (blockers, and the ones it blocks). */
  linked: () => ReadonlySet<string>;
  myId: string | null;
  /** Is the task in my list now (its people changing may add or take it off)? */
  inMyTasks: () => boolean;
  add: (targets: Refresh[]) => void;
  onDeleted: () => void;
  /** Taken off this task's project (the hook checks whether the task can still be opened). */
  onRemoval: () => void;
}

/** Listen for the task's events on a socket; the function returned stops every one of them (no leaks). */
export function followTask(socket: SocketLike, d: FollowTaskDeps): () => void {
  const listening: [string, (payload: unknown) => void][] = [];
  const on = (event: string, fn: (payload: unknown) => void) => {
    socket.on(event, fn);
    listening.push([event, fn]);
  };
  let gone = false;
  for (const ev of TASK_EVENTS) {
    on(ev, (payload) => {
      if (gone) return;
      const plan = taskDetailEventPlan(ev, payload, d.taskId, d.linked());
      if (plan.deleted) {
        gone = true;
        d.onDeleted();
        return;
      }
      if (plan.refresh.length) d.add(plan.refresh);
    });
  }
  for (const ev of TASK_PART_EVENTS) {
    on(ev, (payload) => {
      if (gone || (payload as { taskId?: unknown } | null)?.taskId !== d.taskId) return;
      d.add(taskPartRefreshes(ev, payload, { myId: d.myId, inMyTasks: d.inMyTasks() }));
    });
  }
  on(PROJECT_REMOVED_EVENT, (payload) => {
    if (isProjectRemoval(payload, d.projectId)) d.onRemoval();
  });
  return () => {
    for (const [event, fn] of listening) socket.off(event, fn);
    listening.length = 0;
  };
}
