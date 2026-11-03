import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { CreateProjectData, NewProjectMember, PeopleLookup, ProjectRecord, ProjectRepository, UpdateProjectData } from './project-repository';
import { CODE_PATTERN, normalizeCode, suggestFreeCode } from './project-icons';
import { PROJECT_TASK_DEFAULTS } from './project-task-settings';
import { requireActiveTeam, requireInCompanies } from './active-people';
import type { CompanyChangePlan, ProjectCompanyRules } from '../companies/project-companies';

export type { PeopleLookup } from './project-repository';

export interface ProjectServiceDeps {
  projects: ProjectRepository;
  /** Who may be picked as owner, manager or team (active people); without it, nobody is checked. */
  people?: PeopleLookup;
  /** companies: which companies a project goes into and who may change them; without it, nothing is said about companies. */
  companies?: ProjectCompanyRules;
  /** 1.22: has this administrator turned on "Show my projects only"? Absent: never. */
  myProjectsOnly?: (userId: string) => Promise<boolean>;
}

/** Who is asking for a change: their id and roles. */
export interface ProjectActor {
  id: string;
  roles: string[];
}

/** How many people an employee may put on a new project's team at once (more: the Team tab). */
export const NEW_TEAM_LIMIT = 100;

const MANAGER_IS_ADMINS = 'Only an administrator can name a project’s manager.';

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

export function createProjectService({ projects, people, companies, myProjectsOnly }: ProjectServiceDeps) {
  /** Any project — deleted ones too — with this code. */
  const codeInUse = async (code: string) => (projects.codeInUse ? projects.codeInUse(code) : (await projects.findByCode(code)) !== null);

  /**
   * Owner, manager and team must be active people; anyone else is refused in plain words. companies:
   * with `companyIds` (the project's), they must also be administrators or belong to one of them.
   */
  async function requireActive(
    { ownerId, managerId, memberIds = [] }: { ownerId?: string | null; managerId?: string | null; memberIds?: string[] },
    companyIds?: readonly string[] | null,
  ): Promise<void> {
    if (!people) return;
    const named = [ownerId, managerId].filter((x): x is string => !!x);
    if (named.length) {
      const active = new Set(await people.activeIds(named));
      if (ownerId && !active.has(ownerId)) throw new ValidationError('The owner you picked isn’t an active user. Pick someone else.', { field: 'ownerId' });
      if (managerId && !active.has(managerId)) throw new ValidationError('The project manager you picked isn’t an active user. Pick someone else.', { field: 'managerId' });
    }
    await requireActiveTeam(people, memberIds, ' for the team', companyIds);
    if (ownerId) await requireInCompanies(people, [ownerId], companyIds, 'ownerId');
    if (managerId) await requireInCompanies(people, [managerId], companyIds, 'managerId');
  }

  /**
   * Create a project with its first team, in one write. Asked by an employee (`actor` not an admin),
   * it is theirs unless they pick another owner, and they are on its team as a MANAGER (see
   * newProjectTeam). Without an `actor` it is created as an administrator would (as before).
   * Returns the project and the team it was given.
   */
  async function createProject(input: NewProjectRequest, actor?: ProjectActor, pick?: string | null): Promise<ProjectRecord & { team: NewProjectMember[] }> {
    const { memberIds: picked = [], companyIds: askedCompanies, ...data } = input;
    const memberIds = [...new Set(picked)];
    const byAdmin = actor ? isAdmin(actor.roles) : true;
    if (!byAdmin) {
      // Naming a project's manager is an administrator's; an employee naming nobody or themselves is ignored.
      if (data.managerId && data.managerId !== data.createdById) throw new ValidationError(MANAGER_IS_ADMINS, { field: 'managerId' });
      delete data.managerId;
      if (memberIds.length > NEW_TEAM_LIMIT) {
        throw new ValidationError(`A new project’s team can have at most ${NEW_TEAM_LIMIT} people to begin with. Add the others on its Team tab afterwards.`, { field: 'memberIds' });
      }
    }
    const code = normalizeCode(data.code);
    if (await codeInUse(code)) throw new ConflictError(`The code ${code} is already used by another project (or a deleted one).`, 'DUPLICATE_PROJECT_CODE');
    // An employee's project always has an owner: them, unless they pick someone else.
    const ownerId = !byAdmin && !data.ownerId ? data.createdById : data.ownerId;
    // companies: the ones named, else the picked company, else the creator's primary one, else the
    // site's only one — refused when they aren't the person's to use (MC1 Ruling 12).
    const companyIds = companies ? await companies.forNewProject(actor ?? { id: data.createdById, roles: ['ADMIN'] }, askedCompanies, pick ?? null) : askedCompanies;
    // The creator is signed in; everyone else they name must be an active user (in one of its companies).
    await requireActive(
      {
        ownerId: ownerId === data.createdById ? null : ownerId,
        managerId: data.managerId === data.createdById ? null : data.managerId,
        memberIds: memberIds.filter((id) => id !== data.createdById),
      },
      companyIds,
    );
    const team = newProjectTeam({ creatorId: data.createdById, creatorIsAdmin: byAdmin, ownerId, memberIds });
    // Settings left out take what every project starts with (carry forward on, due today off).
    const created = await projects.create({
      ...data,
      ownerId,
      code,
      carryForward: data.carryForward ?? PROJECT_TASK_DEFAULTS.carryForward,
      defaultDueToday: data.defaultDueToday ?? PROJECT_TASK_DEFAULTS.defaultDueToday,
      newTasksNeedApproval: data.newTasksNeedApproval ?? PROJECT_TASK_DEFAULTS.newTasksNeedApproval,
      ...(team.length ? { members: team } : {}),
      ...(companyIds !== undefined ? { companyIds } : {}),
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

  /**
   * The projects a person's lists show: everything for an admin, else only those they belong to; a
   * picked company (already checked) narrows the list to it. 1.22: an administrator who turned on
   * "Show my projects only" gets the projects they own, manage or are on the team of — unless
   * `everyProject` (the Projects page's "Only my projects" unticked for one visit).
   */
  async function listVisibleProjects(user: { id: string; roles: string[] }, pick?: string | null, opts: { everyProject?: boolean } = {}): Promise<ProjectRecord[]> {
    if (isAdmin(user.roles)) {
      if (!opts.everyProject && projects.listTeamOf && (await myProjectsOnly?.(user.id))) return projects.listTeamOf(user.id, pick ?? null);
      return projects.list(pick ?? null);
    }
    return projects.listForUser(user.id, pick ?? null);
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
   * Naming the manager is an administrator's: from anyone else an unchanged value is ignored and a
   * change refused. Whoever held the owner or manager place before a change stays on (or joins) its
   * team as a MANAGER in the same write, whoever makes it — nobody silently loses a project they
   * ran, and an edit never leaves one that only an administrator can run. To step away, they leave
   * the team.
   */
  async function editProject(
    id: string,
    input: UpdateProjectData & { companyIds?: string[] },
    actor: ProjectActor,
  ): Promise<{ project: ProjectRecord; keptAsManagers: string[]; companies: CompanyChangePlan | null }> {
    const before = await getProject(id);
    const { companyIds: askedCompanies, ...patch } = input;
    if (patch.managerId !== undefined && !isAdmin(actor.roles)) {
      if (patch.managerId !== before.managerId) throw new ValidationError(MANAGER_IS_ADMINS, { field: 'managerId' });
      delete patch.managerId;
    }
    const ownerChanged = patch.ownerId !== undefined && patch.ownerId !== before.ownerId;
    const managerChanged = patch.managerId !== undefined && patch.managerId !== before.managerId;
    // companies: a change of its companies is checked before anything is written (refused: nothing saved).
    const plan = askedCompanies !== undefined && companies ? await companies.planChange(id, actor, askedCompanies) : null;
    // A new owner or manager must be in one of its companies (the new ones, when they change).
    const scope = ownerChanged || managerChanged ? (plan?.after ?? (await people?.projectCompanyIds?.(id)) ?? null) : null;
    await requireActive({ ownerId: ownerChanged ? patch.ownerId : null, managerId: managerChanged ? patch.managerId : null }, scope);
    const keep = [...new Set([ownerChanged ? before.ownerId : null, managerChanged ? before.managerId : null].filter((x): x is string => !!x))];
    const project = await projects.update(id, patch, keep.length ? { keepManagers: keep } : undefined);
    if (plan) await companies!.applyChange(plan);
    return { project, keptAsManagers: keep, companies: plan };
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
