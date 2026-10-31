import { NotFoundError } from '../../lib/http-errors';
import type { MemberRepository, MemberUser, ProjectExistsLookup, ProjectMemberRole } from './member-repository';
import type { PeopleLookup } from './project-repository';
import { requireActiveTeam } from './active-people';

export interface MemberServiceDeps {
  repo: MemberRepository;
  projects: ProjectExistsLookup;
  /**
   * Called after a user is removed from a project so access held elsewhere is cut too (project
   * chat participation, live socket rooms). Task watchers/assignments are handled here.
   */
  onMemberRemoved?: (projectId: string, userId: string) => void | Promise<void>;
  /** Only active people may be added (deactivated, suspended, deleted or unknown ones are refused). */
  people?: PeopleLookup;
  /**
   * companies: of these team members, who can see the project now (in one of its active companies, or
   * an admin). The Team tab still lists the others, with `hasAccess: false`. Absent: everyone has.
   */
  whoCanSee?: (projectId: string, userIds: string[]) => Promise<Set<string>>;
}

/** A team member, and whether they can still see the project (companies: they may have lost its companies). */
export type MemberView = MemberUser & { hasAccess: boolean };

export function createMemberService({ repo, projects, onMemberRemoved, people, whoCanSee }: MemberServiceDeps) {
  async function ensureProject(projectId: string): Promise<void> {
    if (!(await projects.exists(projectId))) throw new NotFoundError('Project not found.');
  }

  /** The team, each marked with whether they can still see the project. */
  async function teamOf(projectId: string): Promise<MemberView[]> {
    const team = await repo.list(projectId);
    const seeing = whoCanSee ? await whoCanSee(projectId, team.map((m) => m.id)) : null;
    return team.map((m) => ({ ...m, hasAccess: seeing ? seeing.has(m.id) : true }));
  }

  async function listMembers(projectId: string): Promise<MemberView[]> {
    await ensureProject(projectId);
    return teamOf(projectId);
  }

  async function addMembers(projectId: string, userIds: string[]): Promise<MemberView[]> {
    await ensureProject(projectId);
    await requireActiveTeam(people, userIds);
    for (const userId of userIds) await repo.add(projectId, userId);
    return teamOf(projectId);
  }

  /**
   * Remove a member (not the last one running the project, unless an admin asks). Someone who
   * thereby loses access to the project (not its owner, named manager or an admin) is also
   * taken off its tasks — assignments and watches — so they stop seeing and hearing about its
   * work. Then `onMemberRemoved` cuts access held elsewhere.
   */
  async function removeMember(projectId: string, userId: string, opts: { byAdmin?: boolean } = {}): Promise<void> {
    await ensureProject(projectId);
    // Someone other than an admin can't take the last person running it off (only an admin could run it then).
    if (!opts.byAdmin && repo.changeGuarded) await repo.changeGuarded(projectId, userId, { remove: true });
    else await repo.remove(projectId, userId);
    const keepsAccess = repo.hasImplicitAccess ? await repo.hasImplicitAccess(projectId, userId) : false;
    if (!keepsAccess) await repo.removeTaskLinks?.(projectId, userId);
    await onMemberRemoved?.(projectId, userId);
  }

  async function setMemberRole(projectId: string, userId: string, role: ProjectMemberRole, opts: { byAdmin?: boolean } = {}): Promise<MemberView[]> {
    await ensureProject(projectId);
    if (!opts.byAdmin && repo.changeGuarded) await repo.changeGuarded(projectId, userId, { role });
    else await repo.setRole(projectId, userId, role);
    return teamOf(projectId);
  }

  return { listMembers, addMembers, removeMember, setMemberRole };
}

export type MemberService = ReturnType<typeof createMemberService>;
