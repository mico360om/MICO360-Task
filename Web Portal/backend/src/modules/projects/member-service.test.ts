import { describe, it, expect, beforeEach } from 'vitest';
import { createMemberService } from './member-service';
import type { MemberRepository, MemberUser, ProjectExistsLookup } from './member-repository';
import { NotFoundError } from '../../lib/http-errors';

function inMemory(projects: string[], implicitAccess: Record<string, string[]> = {}) {
  const links = new Map<string, 'MEMBER' | 'MANAGER'>();
  const removedLinks: string[] = [];
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
    async hasImplicitAccess(projectId, userId) { return (implicitAccess[projectId] ?? []).includes(userId); },
    async removeTaskLinks(projectId, userId) { removedLinks.push(`${projectId}:${userId}`); },
  };
  const projectsLookup: ProjectExistsLookup = { async exists(id) { return projects.includes(id); } };
  return { repo, projects: projectsLookup, removedLinks };
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

describe('MemberService — removal cuts task access', () => {
  it('drops the leaver’s task assignments and watches, then fires onMemberRemoved', async () => {
    const mem = inMemory(['p1']);
    const order: string[] = [];
    const svc2 = createMemberService({
      ...mem,
      repo: { ...mem.repo, async removeTaskLinks(p, u) { order.push(`links:${p}:${u}`); } },
      onMemberRemoved: (p, u) => { order.push(`hook:${p}:${u}`); },
    });
    await svc2.addMembers('p1', ['u1']);
    await svc2.removeMember('p1', 'u1');
    expect(order).toEqual(['links:p1:u1', 'hook:p1:u1']);
  });

  it('keeps the tasks of someone who still sees the project (its owner/manager/creator or an admin)', async () => {
    const mem = inMemory(['p1'], { p1: ['u2'] });
    const hooked: string[] = [];
    const svc2 = createMemberService({ ...mem, onMemberRemoved: (_p, u) => { hooked.push(u); } });
    await svc2.addMembers('p1', ['u2']);
    await svc2.removeMember('p1', 'u2');
    expect(mem.removedLinks).toEqual([]);
    expect(hooked).toEqual(['u2']);
  });

  it('does nothing for an unknown project', async () => {
    const mem = inMemory(['p1']);
    const svc2 = createMemberService(mem);
    await expect(svc2.removeMember('ghost', 'u1')).rejects.toBeInstanceOf(NotFoundError);
    expect(mem.removedLinks).toEqual([]);
  });
});
