import type { QueryClient } from '@tanstack/react-query';
import type { ApiTask } from './types';
import { refresh, type Refresh } from './refresh';

/**
 * What a saved edit changes besides the task itself: its activity (the timeline notes the edit) and
 * the lists that show it. A new due date or column also changes the project's progress figures
 * (overdue and done counts). An edit to a whole series changes the other copies too: every list and
 * every task's details (only the ones on screen are fetched again).
 */
export function editRefreshes(taskId: string, patch: object): Refresh[] {
  const targets: Refresh[] = [{ queryKey: ['task', taskId, 'activity'], exact: true }, { listsHolding: taskId }];
  if ('dueDate' in patch || 'columnId' in patch) targets.push({ progressFor: taskId });
  if ((patch as { scope?: unknown }).scope === 'series') targets.push({ queryKey: ['tasks'] }, { taskDetails: 'all' });
  return targets;
}

/**
 * My Action Items, open and all (core/queries useMyActionItems), after a task changed: marked out of
 * date and fetched when they are next shown — most task changes don't touch an action item, and the
 * server announces one that does (`meeting:action-items`, which fetches them at once).
 */
export const MY_ACTION_ITEMS: Refresh = { queryKey: ['action-items', 'mine'], later: true };

/**
 * What a new task refreshes (made live, or replayed after being kept offline): its project's board
 * days, My Tasks, the project's progress and the calendar's ranges (5a) — a task made on a day of
 * the calendar shows there.
 */
export function createdTaskRefreshes(projectId: string): Refresh[] {
  return [
    { queryKey: ['tasks', 'project', projectId] },
    { queryKey: ['tasks', 'mine'] },
    { queryKey: ['project', projectId, 'progress'], exact: true },
    { queryKey: ['tasks', 'calendar'] },
  ];
}

/**
 * What a move refreshes once the server answered: the task, its activity (the timeline notes the
 * move), its project's board days (finishing a repeating task adds its next copy to a later day —
 * only the day on screen is fetched again), the other lists holding it (My Tasks when it's yours),
 * its project's progress and My Action Items (a meeting's action item follows its task into Done
 * and out of it).
 */
export function moveRefreshes(taskId: string, projectId: string): Refresh[] {
  return [
    { queryKey: ['task', taskId], exact: true },
    { queryKey: ['task', taskId, 'activity'], exact: true },
    { queryKey: ['tasks', 'project', projectId] },
    { listsHolding: taskId },
    { queryKey: ['project', projectId, 'progress'], exact: true },
    MY_ACTION_ITEMS,
  ];
}

/**
 * After an edit was saved: the task's details take the server's copy at once (keeping what only
 * the details call returns, such as the meeting it came from), and only what the edit changed is
 * fetched again — not the task's other parts, every list and every project. A load of the details
 * still on its way is called off first: it may have been answered before the edit was saved, and
 * landing after the save it would show the edit as undone.
 */
export function afterTaskSaved(qc: QueryClient, taskId: string, saved: ApiTask | undefined, patch: object): void {
  const targets = editRefreshes(taskId, patch);
  if (saved?.id === taskId) {
    // Calling it off puts the details back as they were before that load, at once (TanStack's
    // revert), so the server's copy is laid over them on the next line.
    void qc.cancelQueries({ queryKey: ['task', taskId], exact: true });
    qc.setQueryData<ApiTask>(['task', taskId], (prev) => (prev ? { ...prev, ...saved } : saved));
  } else {
    targets.push({ queryKey: ['task', taskId], exact: true });
  }
  refresh(qc, targets);
}

/**
 * After a task was deleted: its own data goes, and the lists that held it and its project's figures
 * (progress, meetings with their action items) are fetched again. Deleting a whole series also
 * refreshes the project's lists, My Tasks and the other copies' details.
 */
export function afterTaskDeleted(qc: QueryClient, taskId: string, scope?: 'series'): void {
  const projectId = qc.getQueryData<ApiTask>(['task', taskId])?.projectId;
  const targets: Refresh[] = [{ listsHolding: taskId }];
  if (projectId) {
    targets.push({ queryKey: ['project', projectId, 'progress'], exact: true }, { queryKey: ['project', projectId, 'meetings'], exact: true });
  } else {
    targets.push({ progressFor: taskId });
  }
  if (scope === 'series') {
    targets.push({ queryKey: projectId ? ['tasks', 'project', projectId] : ['tasks'] }, { queryKey: ['tasks', 'mine'] }, { taskDetails: 'all' });
  }
  // Its own data goes first, so the deleted task is never asked for again.
  qc.removeQueries({ queryKey: ['task', taskId] });
  refresh(qc, targets);
}
