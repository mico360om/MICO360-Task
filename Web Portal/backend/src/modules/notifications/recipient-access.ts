/**
 * Who may hear about a task right now. Watchers and @mentioned users are kept only while they can
 * still open the task — so someone removed from a project stops getting its updates and digest
 * lines, and a mention can't leak a task to someone outside the project.
 */

/** The project-visibility facts of one task (the same rule as project access: owner, manager, creator, member). */
export interface TaskAudienceFacts {
  /** Assignees can always open their task. */
  assigneeIds: string[];
  project: {
    deletedAt: Date | null;
    ownerId: string | null;
    managerId: string | null;
    createdById: string;
    memberIds: string[];
  } | null;
}

export interface AudienceOptions {
  /** Users with the ADMIN role (they see every project). */
  adminIds: Iterable<string>;
  /** When given, only these (active, not deleted) users are kept. */
  activeIds?: Iterable<string>;
  /** Never notify this user (the actor who caused the event). */
  excludeUserId?: string | null;
}

/** A predicate for "can this user currently see the task?". */
export function taskAudience(facts: TaskAudienceFacts, opts: AudienceOptions): (userId: string) => boolean {
  const admins = new Set(opts.adminIds);
  const active = opts.activeIds ? new Set(opts.activeIds) : null;
  const project = facts.project;
  if (!project || project.deletedAt) return () => false; // a deleted project's tasks notify no one
  const visible = new Set<string>([
    ...facts.assigneeIds,
    ...project.memberIds,
    project.createdById,
    ...(project.ownerId ? [project.ownerId] : []),
    ...(project.managerId ? [project.managerId] : []),
  ]);
  return (userId) => {
    if (opts.excludeUserId && userId === opts.excludeUserId) return false;
    if (active && !active.has(userId)) return false;
    return visible.has(userId) || admins.has(userId);
  };
}

/** Keep the (deduped) recipients who can currently see the task. */
export function filterTaskRecipients(userIds: Iterable<string>, facts: TaskAudienceFacts, opts: AudienceOptions): string[] {
  const allowed = taskAudience(facts, opts);
  return [...new Set(userIds)].filter(allowed);
}
