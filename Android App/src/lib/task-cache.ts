import type { QueryClient } from '@tanstack/react-query';
import type { ApiTask, MoveResult } from './types';
import { refresh, type Refresh } from './refresh';

/**
 * The figures that count tasks on the Stage 3 screens — Timeline and Workload (['planning', …]) and
 * Management (['management', …]) — after any task change: marked out of date and read again when
 * next shown (those screens read again as they come back into view: core/focus-refetch), as the
 * website's TASK_FIGURE_KEYS / invalidateTaskQueries. Who may open Management is another key.
 */
export const TASK_FIGURE_VIEWS: Refresh[] = [
  { queryKey: ['planning'], later: true },
  { queryKey: ['management'], later: true },
];

/**
 * What a saved edit changes besides the task itself: its activity (the timeline notes the edit) and
 * the lists that show it. A new due date or column also changes the project's progress figures
 * (overdue and done counts). An edit to a whole series changes the other copies too: every list and
 * every task's details (only the ones on screen are fetched again).
 */
export function editRefreshes(taskId: string, patch: object): Refresh[] {
  const targets: Refresh[] = [{ queryKey: ['task', taskId, 'activity'], exact: true }, { listsHolding: taskId }];
  // "Needs approval" turned off while it waits marks it done: the project's figures change too.
  if ('dueDate' in patch || 'columnId' in patch || 'needsApproval' in patch) targets.push({ progressFor: taskId });
  // It joins or leaves the approvals list (My Tasks' To approve, the Dashboard's card).
  if ('needsApproval' in patch) targets.push({ queryKey: ['approvals'] });
  // A new day or repeat may put the task (or its copies to come) on a calendar range that didn't hold it (5a).
  if ('dueDate' in patch || 'recurrenceRule' in patch) targets.push({ queryKey: ['tasks', 'calendar'] });
  if ((patch as { scope?: unknown }).scope === 'series') targets.push({ queryKey: ['tasks'] }, { taskDetails: 'all' });
  targets.push(...TASK_FIGURE_VIEWS);
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
    ...TASK_FIGURE_VIEWS,
  ];
}

/**
 * What a change to a task's people refreshes (made live, or replayed after being kept offline): its
 * assignees and activity, My Tasks (it may join or leave yours) and every list holding it — the
 * calendar's ranges too, which show whose task it is (5a review).
 */
export function assignmentRefreshes(taskId: string): Refresh[] {
  return [
    { queryKey: ['task', taskId, 'assignees'], exact: true },
    { queryKey: ['task', taskId, 'activity'], exact: true },
    { queryKey: ['tasks', 'mine'] },
    { listsHolding: taskId },
    ...TASK_FIGURE_VIEWS,
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
    ...TASK_FIGURE_VIEWS,
  ];
}

/**
 * After an edit was saved: the task's details take the server's copy at once (keeping what only
 * the details call returns, such as the meeting it came from), and only what the edit changed is
 * fetched again — not the task's other parts, every list and every project. A load of the details
 * still on its way is called off first: it may have been answered before the edit was saved, and
 * landing after the save it would show the edit as undone.
 *
 * Details never loaded (an edit from the calendar or a list) are not made from the save's answer:
 * it lacks what only the details call returns ("From meeting"), and it would count as fresh. They
 * are left to load in full when opened (a first load on its way is called off and loaded again).
 *
 * `run` refreshes the targets (a bulk run gathers the lists for its end — final review A2).
 */
export function afterTaskSaved(qc: QueryClient, taskId: string, saved: ApiTask | undefined, patch: object, run: (targets: Refresh[]) => void = (t) => refresh(qc, t)): void {
  const targets = editRefreshes(taskId, patch);
  // Calling a load off puts the details back as they were before it, at once (TanStack's revert).
  void qc.cancelQueries({ queryKey: ['task', taskId], exact: true });
  if (saved?.id === taskId && qc.getQueryData<ApiTask>(['task', taskId]) !== undefined) {
    // The server's copy is laid over the details shown.
    qc.setQueryData<ApiTask>(['task', taskId], (prev) => (prev ? { ...prev, ...saved } : prev));
  } else {
    targets.push({ queryKey: ['task', taskId], exact: true });
  }
  run(targets);
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
  targets.push(...TASK_FIGURE_VIEWS);
  // Its own data goes first, so the deleted task is never asked for again.
  qc.removeQueries({ queryKey: ['task', taskId] });
  refresh(qc, targets);
}

/**
 * What an approval decision changes (Approve, Send back, the "Needs approval" switch): the task, its
 * comments (a send-back's reason is one) and history, the lists that show it, its project's progress,
 * the approvals list (My Tasks' To approve, the Dashboard's card) and, when next shown, the projects'
 * counts.
 */
export function approvalRefreshes(taskId: string): Refresh[] {
  return [
    { queryKey: ['task', taskId], exact: true },
    { queryKey: ['task', taskId, 'comments'] },
    { queryKey: ['task', taskId, 'activity'] },
    { listsHolding: taskId },
    { progressFor: taskId },
    { queryKey: ['approvals'] },
    { queryKey: ['projects'], later: true },
  ];
}

/**
 * After an approval decision the server accepted: its copy of the task is laid over the details
 * shown at once (a load still on its way is called off first, as after an edit), then everything
 * it changed is refreshed. Details never loaded (a decision from To approve) are not made from the
 * answer — it lacks what only the details call returns — and load in full when opened.
 */
export function afterApprovalDecision(qc: QueryClient, taskId: string, answer: ApiTask): void {
  void qc.cancelQueries({ queryKey: ['task', taskId], exact: true });
  if (answer?.id === taskId) qc.setQueryData<ApiTask>(['task', taskId], (prev) => (prev ? { ...prev, ...answer } : prev));
  refresh(qc, approvalRefreshes(taskId));
}

/**
 * After the server refused a decision (the task changed meanwhile, someone else decided first, the
 * person's rights changed): the task and the approvals list are read again, so a retry is from what
 * is there now (the website's task panel and To approve).
 */
export function afterApprovalRefused(qc: QueryClient, taskId: string): void {
  refresh(qc, [{ queryKey: ['task', taskId], exact: true }, { queryKey: ['approvals'] }]);
}

/**
 * What moving a task to another project changes: every task list (both projects' boards, My Tasks,
 * the calendar), the projects and both projects' own data (progress, members, meetings), the task
 * itself with its parts (its history notes the move), and the approvals list (it may wait in its new
 * project for someone else's OK) — the website's invalidateTaskQueries.
 */
export function projectMoveRefreshes(r: Pick<MoveResult, 'task' | 'from' | 'to'>): Refresh[] {
  return [
    { queryKey: ['tasks'] },
    { queryKey: ['projects'] },
    { queryKey: ['project', r.from.projectId] },
    { queryKey: ['project', r.to.projectId] },
    { queryKey: ['task', r.task.id] },
    { queryKey: ['approvals'] },
  ];
}

/**
 * After a task moved to another project: the details shown take its new number and project at once
 * ("Formerly RIG-4" too — the answer carries formerKeys), then everything the move changed is read
 * again. Details never loaded are not made from the answer (as after an edit).
 */
export function afterTaskMoved(qc: QueryClient, r: MoveResult): void {
  afterTasksMoved(qc, [r]);
}

/** Several tasks moved at once (My Tasks): each shows its new number, and what they changed is read again once. */
export function afterTasksMoved(qc: QueryClient, moved: readonly MoveResult[]): void {
  const targets = new Map<string, Refresh>();
  for (const r of moved) {
    void qc.cancelQueries({ queryKey: ['task', r.task.id], exact: true });
    qc.setQueryData<ApiTask>(['task', r.task.id], (prev) => (prev ? { ...prev, ...r.task } : prev));
    for (const t of projectMoveRefreshes(r)) targets.set(JSON.stringify(t), t);
  }
  if (targets.size) refresh(qc, [...targets.values()]);
}
