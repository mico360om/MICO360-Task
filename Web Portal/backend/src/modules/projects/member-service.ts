import { NotFoundError } from '../../lib/http-errors';
import type { MemberRepository, MemberUser, ProjectExistsLookup, ProjectMemberRole } from './member-repository';

export interface MemberServiceDeps {
  repo: MemberRepository;
  projects: ProjectExistsLookup;
}

export function createMemberService({ repo, projects }: MemberServiceDeps) {
  async function ensureProject(projectId: string): Promise<void> {
    if (!(await projects.exists(projectId))) throw new NotFoundError('Project not found.');
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

  async function removeMember(projectId: string, userId: string): Promise<void> {
    await ensureProject(projectId);
    await repo.remove(projectId, userId);
  }

  async function setMemberRole(projectId: string, userId: string, role: ProjectMemberRole): Promise<MemberUser[]> {
    await ensureProject(projectId);
    await repo.setRole(projectId, userId, role);
    return repo.list(projectId);
  }

  return { listMembers, addMembers, removeMember, setMemberRole };
}

export type MemberService = ReturnType<typeof createMemberService>;
