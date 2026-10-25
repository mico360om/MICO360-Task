import { ConflictError, NotFoundError } from '../../lib/http-errors';
import type { MemberRepository, MemberUser, ProjectExistsLookup, ProjectMemberRole } from './member-repository';

export interface MemberServiceDeps {
  repo: MemberRepository;
  projects: ProjectExistsLookup;
  /**
   * Called after a user is removed from a project so access held elsewhere is cut too (project
   * chat participation, live socket rooms). Task watchers/assignments are handled here.
   */
  onMemberRemoved?: (projectId: string, userId: string) => void | Promise<void>;
}

export function createMemberService({ repo, projects, onMemberRemoved }: MemberServiceDeps) {
  async function ensureProject(projectId: string): Promise<void> {
    if (!(await projects.exists(projectId))) throw new NotFoundError('Project not found.');
  }

  /**
   * Someone other than an admin can't take the last runner off a project (demote or remove its only
   * MANAGER member when it has no owner or named manager): only an admin could run it then.
   */
  async function keepSomeoneRunning(projectId: string, userId: string, byAdmin: boolean): Promise<void> {
    if (byAdmin || !repo.hasOtherRunner) return;
    const current = (await repo.list(projectId)).find((m) => m.id === userId);
    if (current?.role !== 'MANAGER') return;
    if (!(await repo.hasOtherRunner(projectId, userId))) {
      throw new ConflictError('Someone has to run this project. Make another member a manager, or give it an owner, first.', 'LAST_PROJECT_MANAGER');
    }
  }

  async function listMembers(projectId: string): Promise<MemberUser[]> {
    await ensureProject(projectId);
    return repo.list(projectId);
  }

  async function addMembers(projectId: string, userIds: string[]): Promise<MemberUser[]> {
    await ensureProject(projectId);
    for (const userId of userIds) await repo.add(projectId, userId);
    return repo.list(projectId);
  }

  /**
   * Remove a member (not the last one running the project, unless an admin asks). Someone who
   * thereby loses access to the project (not its owner, manager, creator or an admin) is also
   * taken off its tasks — assignments and watches — so they stop seeing and hearing about its
   * work. Then `onMemberRemoved` cuts access held elsewhere.
   */
  async function removeMember(projectId: string, userId: string, opts: { byAdmin?: boolean } = {}): Promise<void> {
    await ensureProject(projectId);
    await keepSomeoneRunning(projectId, userId, opts.byAdmin ?? false);
    await repo.remove(projectId, userId);
    const keepsAccess = repo.hasImplicitAccess ? await repo.hasImplicitAccess(projectId, userId) : false;
    if (!keepsAccess) await repo.removeTaskLinks?.(projectId, userId);
    await onMemberRemoved?.(projectId, userId);
  }

  async function setMemberRole(projectId: string, userId: string, role: ProjectMemberRole, opts: { byAdmin?: boolean } = {}): Promise<MemberUser[]> {
    await ensureProject(projectId);
    if (role !== 'MANAGER') await keepSomeoneRunning(projectId, userId, opts.byAdmin ?? false);
    await repo.setRole(projectId, userId, role);
    return repo.list(projectId);
  }

  return { listMembers, addMembers, removeMember, setMemberRole };
}

export type MemberService = ReturnType<typeof createMemberService>;
