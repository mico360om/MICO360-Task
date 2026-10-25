import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { CreateProjectData, NewProjectMember, PeopleLookup, ProjectRecord, ProjectRepository, UpdateProjectData } from './project-repository';
import { CODE_PATTERN, normalizeCode, suggestFreeCode } from './project-icons';
import { PROJECT_TASK_DEFAULTS } from './project-task-settings';

export type { PeopleLookup } from './project-repository';

export interface ProjectServiceDeps {
  projects: ProjectRepository;
  /** Who may be picked as owner, manager or team (active people); without it, nobody is checked. */
  people?: PeopleLookup;
}

/** Who is asking for a change: their id and roles. */
export interface ProjectActor {
  id: string;
  roles: string[];
}

/** A new project as asked for: the project, and the people picked for its team. */
export type NewProjectRequest = Omit<CreateProjectData, 'members'> & { memberIds?: string[] };

/**
 * Who is on a new project's team, each person once: an employee who creates it is always on it as
 * a MANAGER (even when someone else owns it), so they can keep running it; a chosen owner other
 * than the creator joins it; then the people picked for it. An administrator who creates a project
 * is not put on it unless they pick themselves (they manage every project anyway).
 */
export function newProjectTeam({ creatorId, creatorIsAdmin, ownerId, memberIds }: { creatorId: string; creatorIsAdmin: boolean; ownerId: string | null | undefined; memberIds: string[] }): NewProjectMember[] {
  const team = new Map<string, NewProjectMember['role']>();
  if (!creatorIsAdmin) team.set(creatorId, 'MANAGER');
  if (ownerId && ownerId !== creatorId) team.set(ownerId, 'MEMBER');
  for (const id of memberIds) if (!team.has(id)) team.set(id, 'MEMBER');
  return [...team].map(([userId, role]) => ({ userId, role }));
}

const isAdmin = (roles: string[]) => roles.includes('ADMIN');

export function createProjectService({ projects, people }: ProjectServiceDeps) {
  /** Any project — deleted ones too — with this code. */
  const codeInUse = async (code: string) => (projects.codeInUse ? projects.codeInUse(code) : (await projects.findByCode(code)) !== null);

  /** Owner, manager and team must be active people; anyone else is refused in plain words. */
  async function requireActive({ ownerId, managerId, memberIds = [] }: { ownerId?: string | null; managerId?: string | null; memberIds?: string[] }): Promise<void> {
    if (!people) return;
    const asked = [ownerId, managerId, ...memberIds].filter((x): x is string => !!x);
    if (asked.length === 0) return;
    const active = new Set(await people.activeIds(asked));
    if (ownerId && !active.has(ownerId)) throw new ValidationError('The owner you picked isn’t an active user. Pick someone else.', { field: 'ownerId' });
    if (managerId && !active.has(managerId)) throw new ValidationError('The project manager you picked isn’t an active user. Pick someone else.', { field: 'managerId' });
    const off = [...new Set(memberIds)].filter((id) => !active.has(id));
    if (off.length === 1) throw new ValidationError('One of the people picked for the team isn’t an active user. Take them off and try again.', { field: 'memberIds', userIds: off });
    if (off.length > 1) throw new ValidationError(`${off.length} of the people picked for the team aren’t active users. Take them off and try again.`, { field: 'memberIds', userIds: off });
  }

  /**
   * Create a project with its first team, in one write. Asked by an employee (`actor` not an admin),
   * it is theirs unless they pick another owner, and they are on its team as a MANAGER (see
   * newProjectTeam). Without an `actor` it is created as an administrator would (as before).
   * Returns the project and the team it was given.
   */
  async function createProject(input: NewProjectRequest, actor?: ProjectActor): Promise<ProjectRecord & { team: NewProjectMember[] }> {
    const { memberIds = [], ...data } = input;
    const code = normalizeCode(data.code);
    if (await codeInUse(code)) throw new ConflictError(`The code ${code} is already used by another project (or a deleted one).`, 'DUPLICATE_PROJECT_CODE');
    const byAdmin = actor ? isAdmin(actor.roles) : true;
    // An employee's project always has an owner: them, unless they pick someone else.
    const ownerId = !byAdmin && !data.ownerId ? data.createdById : data.ownerId;
    // The creator is signed in; everyone else they name must be an active user.
    await requireActive({
      ownerId: ownerId === data.createdById ? null : ownerId,
      managerId: data.managerId === data.createdById ? null : data.managerId,
      memberIds: memberIds.filter((id) => id !== data.createdById),
    });
    const team = newProjectTeam({ creatorId: data.createdById, creatorIsAdmin: byAdmin, ownerId, memberIds });
    // Settings left out take what every project starts with (carry forward on, due today off).
    const created = await projects.create({
      ...data,
      ownerId,
      code,
      carryForward: data.carryForward ?? PROJECT_TASK_DEFAULTS.carryForward,
      defaultDueToday: data.defaultDueToday ?? PROJECT_TASK_DEFAULTS.defaultDueToday,
      ...(team.length ? { members: team } : {}),
    });
    return { ...created, team };
  }

  /** Before saving: is this code well formed and free? If taken, the first free variant. */
  async function checkCode(raw: string): Promise<{ code: string; valid: boolean; available: boolean; suggestion?: string }> {
    const code = normalizeCode(raw);
    if (!CODE_PATTERN.test(code)) return { code, valid: false, available: false };
    if (!(await codeInUse(code))) return { code, valid: true, available: true };
    const suggestion = await suggestFreeCode(code, codeInUse);
    return suggestion ? { code, valid: true, available: false, suggestion } : { code, valid: true, available: false };
  }

  async function listProjects(): Promise<ProjectRecord[]> {
    return projects.list();
  }

  /** Projects the caller may see: everything for an admin, else only those they belong to. */
  async function listVisibleProjects(user: { id: string; roles: string[] }): Promise<ProjectRecord[]> {
    if (isAdmin(user.roles)) return projects.list();
    return projects.listForUser(user.id);
  }

  async function getProject(id: string): Promise<ProjectRecord> {
    const project = await projects.findById(id);
    if (!project) throw new NotFoundError('Project not found.');
    return project;
  }

  /** Fetch a project only if the caller may see it; otherwise 404 (don't reveal its existence). */
  async function getVisibleProject(id: string, user: { id: string; roles: string[] }): Promise<ProjectRecord> {
    const project = await getProject(id);
    if (isAdmin(user.roles)) return project;
    if (await projects.isAccessibleTo(id, user.id)) return project;
    throw new NotFoundError('Project not found.');
  }

  async function updateProject(id: string, patch: UpdateProjectData): Promise<ProjectRecord> {
    await getProject(id);
    return projects.update(id, patch);
  }

  /**
   * Someone who may change the project edits it. A new owner or manager must be an active user (one
   * left as it was is not checked again, so a project whose owner has left can still be edited).
   * An employee who runs it as its owner or named manager and hands that over keeps running it: they
   * stay on (or join) its team as a MANAGER in the same write — so an edit never leaves a project
   * that only an administrator can run. To step away they leave the team.
   */
  async function editProject(id: string, patch: UpdateProjectData, actor: ProjectActor): Promise<{ project: ProjectRecord; keptAsManager: string | null }> {
    const before = await getProject(id);
    const ownerChanged = patch.ownerId !== undefined && patch.ownerId !== before.ownerId;
    const managerChanged = patch.managerId !== undefined && patch.managerId !== before.managerId;
    await requireActive({ ownerId: ownerChanged ? patch.ownerId : null, managerId: managerChanged ? patch.managerId : null });
    let keep: string | null = null;
    if (!isAdmin(actor.roles) && (before.ownerId === actor.id || before.managerId === actor.id)) {
      const owner = patch.ownerId !== undefined ? patch.ownerId : before.ownerId;
      const manager = patch.managerId !== undefined ? patch.managerId : before.managerId;
      if (owner !== actor.id && manager !== actor.id) keep = actor.id;
    }
    const project = await projects.update(id, patch, keep ? { keepManager: keep } : undefined);
    return { project, keptAsManager: keep };
  }

  async function archiveProject(id: string): Promise<ProjectRecord> {
    return updateProject(id, { status: 'ARCHIVED' });
  }

  async function deleteProject(id: string): Promise<void> {
    await getProject(id);
    await projects.softDelete(id);
  }

  return { createProject, checkCode, listProjects, listVisibleProjects, getProject, getVisibleProject, updateProject, editProject, archiveProject, deleteProject };
}

export type ProjectService = ReturnType<typeof createProjectService>;
