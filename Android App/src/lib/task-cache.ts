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
 * What a move refreshes once the server answered: the task, its activity (the timeline notes the
 * move), its project's board days (finishing a repeating task adds its next copy to a later day —
 * only the day on screen is fetched again), the other lists holding it (My Tasks when it's yours)
 * and its project's progress.
 */
export function moveRefreshes(taskId: string, projectId: string): Refresh[] {
  return [
    { queryKey: ['task', taskId], exact: true },
    { queryKey: ['task', taskId, 'activity'], exact: true },
    { queryKey: ['tasks', 'project', projectId] },
    { listsHolding: taskId },
    { queryKey: ['project', projectId, 'progress'], exact: true },
  ];
}

/**
 * After an edit was saved: the task's details take the server's copy at once (keeping what only
 * the details call returns, such as the meeting it came from), and only what the edit changed is
 * fetched again — not the task's other parts, every list and every project.
 */
export function afterTaskSaved(qc: QueryClient, taskId: string, saved: ApiTask | undefined, patch: object): void {
  const targets = editRefreshes(taskId, patch);
  if (saved?.id === taskId) {
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
