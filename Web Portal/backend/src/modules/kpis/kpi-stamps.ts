/**
 * KPIs (review I1/I2): the on-time rule is decided when a change is made, not later — so a project manager
 * who extended a task and later left (or was made a member, or the task moved project) still extended it.
 * The task's timeline lines get two additive marks the KPIs read (task-history):
 *   - a due-date change: `agreed` — made by an administrator, or by whoever runs the project and has never
 *     been on the task (a change by the assignee, a colleague, or a runner who was ever on it isn't one);
 *   - a taking-off (UNASSIGNED): `released` — made by an administrator or whoever runs the project, of
 *     someone else (taking yourself off, or a colleague taking you off, leaves you answerable).
 * Lines written before this release have no mark and are judged by today's rules.
 */

export interface StampDeps {
  isAdmin(userId: string): Promise<boolean>;
  runsProject(userId: string, projectId: string): Promise<boolean>;
  /** Has this person ever been on the task (now, or by its ASSIGNED lines)? */
  everOnTask(taskId: string, userId: string): Promise<boolean>;
}

type Change = { field: string } & Record<string, unknown>;

/** The UPDATED line's changes with the due-date change marked agreed or not. */
export async function stampDueChange<T extends { changes: Change[] }>(meta: T, ctx: { actorId: string; taskId: string; projectId: string }, deps: StampDeps): Promise<T> {
  const i = meta.changes.findIndex((c) => c.field === 'dueDate');
  if (i < 0) return meta;
  const agreed = (await deps.isAdmin(ctx.actorId)) || ((await deps.runsProject(ctx.actorId, ctx.projectId)) && !(await deps.everOnTask(ctx.taskId, ctx.actorId)));
  const changes = meta.changes.map((c, j) => (j === i ? { ...c, agreed } : c));
  return { ...meta, changes };
}

/** Does this taking-off release the person from the task? */
export async function releaseOf(ctx: { actorId: string; assigneeId: string; projectId: string }, deps: Pick<StampDeps, 'isAdmin' | 'runsProject'>): Promise<boolean> {
  if (ctx.actorId === ctx.assigneeId) return false;
  return (await deps.isAdmin(ctx.actorId)) || (await deps.runsProject(ctx.actorId, ctx.projectId));
}
