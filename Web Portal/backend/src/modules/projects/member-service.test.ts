import { describe, it, expect, beforeEach } from 'vitest';
import { createMemberService } from './member-service';
import type { MemberRepository, MemberUser, ProjectExistsLookup } from './member-repository';
import { NotFoundError } from '../../lib/http-errors';

function inMemory(projects: string[]) {
  const links = new Map<string, 'MEMBER' | 'MANAGER'>();
  const base: Record<string, Omit<MemberUser, 'role'>> = {
    u1: { id: 'u1', username: 'ada', email: 'ada@x', firstName: 'Ada', lastName: 'L' },
    u2: { id: 'u2', username: 'omar', email: 'omar@x', firstName: 'Omar', lastName: 'A' },
  };
  const repo: MemberRepository = {
    async list(projectId) {
      return [...links.entries()]
        .filter(([k]) => k.startsWith(`${projectId}:`))
        .map(([k, role]) => ({ ...base[k.split(':')[1]!]!, role }))
        .filter(Boolean);
    },
    async add(projectId, userId) { if (!links.has(`${projectId}:${userId}`)) links.set(`${projectId}:${userId}`, 'MEMBER'); },
    async remove(projectId, userId) { links.delete(`${projectId}:${userId}`); },
    async setRole(projectId, userId, role) { links.set(`${projectId}:${userId}`, role); },
  };
  const projectsLookup: ProjectExistsLookup = { async exists(id) { return projects.includes(id); } };
  return { repo, projects: projectsLookup };
}

let svc: ReturnType<typeof createMemberService>;
beforeEach(() => { svc = createMemberService(inMemory(['p1'])); });

describe('MemberService', () => {
  it('adds members and lists them', async () => {
    const list = await svc.addMembers('p1', ['u1', 'u2']);
    expect(list.map((u) => u.username).sort()).toEqual(['ada', 'omar']);
  });

  it('removes a member', async () => {
    await svc.addMembers('p1', ['u1', 'u2']);
    await svc.removeMember('p1', 'u1');
    expect((await svc.listMembers('p1')).map((u) => u.username)).toEqual(['omar']);
  });

  it('throws NotFound for an unknown project', async () => {
    await expect(svc.addMembers('ghost', ['u1'])).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.listMembers('ghost')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('promotes a member to MANAGER (and new members default to MEMBER)', async () => {
    await svc.addMembers('p1', ['u1']);
    expect((await svc.listMembers('p1'))[0]!.role).toBe('MEMBER');
    const list = await svc.setMemberRole('p1', 'u1', 'MANAGER');
    expect(list.find((m) => m.id === 'u1')!.role).toBe('MANAGER');
  });
});
