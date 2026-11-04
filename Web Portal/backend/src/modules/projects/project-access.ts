import type { ProjectManagerLookup } from './project-authz';

/** Read-side project access: who may *see* a project's data (owner / named manager / team member). */
export interface ProjectAccessRepo {
  isAccessibleTo(projectId: string, userId: string): Promise<boolean>;
  /** A non-admin's visible projects (companies: inside their active companies), narrowed to a pick. */
  listForUser(userId: string, pick?: string | null): Promise<{ id: string }[]>;
  /** Every live project, or a picked company's (an administrator with a pick). */
  list(pick?: string | null): Promise<{ id: string }[]>;
  /**
   * 1.22: the live projects this person owns, manages or is on the team of — the team rule alone, no
   * company condition — in the pick: an administrator's own projects ("Show my projects only").
   */
  listTeamOf?(userId: string, pick?: string | null): Promise<{ id: string }[]>;
}

/** @deprecated Being assigned no longer grants access on its own; kept so older wiring still compiles. */
export interface TaskAssigneeLookup {
  isAssignee(taskId: string, userId: string): Promise<boolean>;
}

/**
 * Object-level view authorization (T2.7 companion to ProjectAuthz's manage checks). Admins see
 * everything; otherwise a user may see a project — and every task/column/comment under it — only
 * when they own, manage or are on the team of that project (having created it is not enough: the
 * creator is on its team, and leaving it means leaving the project). Task access follows the task's
 * project: being assigned is not a way in (assignees must be project members, and someone who
 * leaves the project loses its tasks). Deleted projects and tasks resolve to nothing.
 */
export function createProjectAccess({
  projects,
  managers,
  myProjectsOnly,
}: {
  projects: ProjectAccessRepo;
  managers: Pick<ProjectManagerLookup, 'projectIdOfTask' | 'projectIdOfColumn'>;
  /** @deprecated Ignored — see TaskAssigneeLookup. */
  assignees?: TaskAssigneeLookup;
  /**
   * 1.22: has this administrator turned on "Show my projects only"? Read on every list (never cached).
   * Absent: never (everything lists as before).
   */
  myProjectsOnly?: (userId: string) => Promise<boolean>;
}) {
  const isAdmin = (roles: string[]) => roles.includes('ADMIN');

  async function canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    return projects.isAccessibleTo(projectId, userId);
  }
  async function canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfTask(taskId);
    return projectId ? projects.isAccessibleTo(projectId, userId) : false;
  }
  async function canViewColumn(userId: string, roles: string[], columnId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const projectId = await managers.projectIdOfColumn(columnId);
    return projectId ? projects.isAccessibleTo(projectId, userId) : false;
  }
  /**
   * Project ids a user may see, or `null` for an admin without a pick (meaning "all projects, no
   * scoping"). A picked company (already checked) narrows it; an admin with a pick gets that company's.
   *
   * 1.22 "Show my projects only": a call that NAMES the pick — a company id, or null for "all my
   * companies" — is a LIST, and an administrator who turned the setting on gets the projects they own,
   * manage or are on the team of (in the pick), like a team member. A call without a pick is an
   * OBJECT check (one project, task or board by its link; may I use this project) and stays admin-wide.
   */
  async function accessibleProjectIds(userId: string, roles: string[], pick?: string | null): Promise<string[] | null> {
    if (isAdmin(roles)) {
      const listing = pick !== undefined;
      if (listing && projects.listTeamOf && (await myProjectsOnly?.(userId))) return (await projects.listTeamOf(userId, pick)).map((p) => p.id);
      return pick ? (await projects.list(pick)).map((p) => p.id) : null;
    }
    return (await projects.listForUser(userId, pick ?? null)).map((p) => p.id);
  }
  /**
   * 1.22 (owner, 4 Nov — "always show my own"): the projects a list of the person's OWN work reaches
   * (My Tasks, their tasks on the calendar, MICO AI's tasks) — the list scope with "Show my projects
   * only" never applied: an administrator's every project (in the pick; null without one), anyone
   * else's visible ones, exactly as accessibleProjectIds gives them.
   */
  async function ownProjectIds(userId: string, roles: string[], pick: string | null): Promise<string[] | null> {
    if (isAdmin(roles)) return pick ? (await projects.list(pick)).map((p) => p.id) : null;
    return (await projects.listForUser(userId, pick)).map((p) => p.id);
  }

  return { canViewProject, canViewTask, canViewColumn, accessibleProjectIds, ownProjectIds };
}

type FullProjectAccess = ReturnType<typeof createProjectAccess>;
/** ownProjectIds (1.22) is optional so hand-made fakes keep compiling; without it, own work lists like any list. */
export type ProjectAccess = Omit<FullProjectAccess, 'ownProjectIds'> & Partial<Pick<FullProjectAccess, 'ownProjectIds'>>;
