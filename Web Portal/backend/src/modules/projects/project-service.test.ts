import { describe, it, expect, beforeEach } from 'vitest';
import { createProjectService } from './project-service';
import type { ProjectRecord, ProjectRepository, CreateProjectData } from './project-repository';
import { ConflictError, NotFoundError } from '../../lib/http-errors';

function inMemoryRepo(): ProjectRepository & { all(): ProjectRecord[]; addMember(projectId: string, userId: string): void } {
  const rows = new Map<string, ProjectRecord>();
  const members = new Map<string, Set<string>>();
  let seq = 0;
  const canAccess = (p: ProjectRecord, userId: string) =>
    p.ownerId === userId || p.managerId === userId || p.createdById === userId || (members.get(p.id)?.has(userId) ?? false);
  return {
    all: () => [...rows.values()],
    addMember: (projectId, userId) => {
      const set = members.get(projectId) ?? new Set<string>();
      set.add(userId);
      members.set(projectId, set);
    },
    async create(data: CreateProjectData) {
      const now = new Date();
      const rec: ProjectRecord = {
        id: `p${seq++}`,
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        clientName: data.clientName ?? null,
        managerId: data.managerId ?? null,
        status: data.status ?? 'PLANNING',
        priority: data.priority ?? 'NORMAL',
        color: data.color ?? '#8B1E1E',
        imageUrl: null,
        ownerId: data.ownerId ?? null,
        startDate: data.startDate ?? null,
        targetDate: data.targetDate ?? null,
        notes: data.notes ?? null,
        createdById: data.createdById,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByCode(code) {
      return [...rows.values()].find((p) => p.code === code) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async listForUser(userId) {
      return [...rows.values()].filter((p) => canAccess(p, userId));
    },
    async isAccessibleTo(projectId, userId) {
      const p = rows.get(projectId);
      return p ? canAccess(p, userId) : false;
    },
    async update(id, patch) {
      const rec = rows.get(id)!;
      const updated = { ...rec, ...patch, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async softDelete(id) {
      rows.delete(id);
    },
  };
}

let repo: ReturnType<typeof inMemoryRepo>;
let svc: ReturnType<typeof createProjectService>;
beforeEach(() => {
  repo = inMemoryRepo();
  svc = createProjectService({ projects: repo });
});

describe('ProjectService', () => {
  it('creates a project with sensible defaults', async () => {
    const p = await svc.createProject({ code: 'MICO', name: 'MICO360 Platform', createdById: 'admin' });
    expect(p.id).toBeTruthy();
    expect(p.status).toBe('PLANNING');
    expect(p.priority).toBe('NORMAL');
    expect(p.color).toBe('#8B1E1E');
  });

  it('rejects a duplicate project code', async () => {
    await svc.createProject({ code: 'MICO', name: 'One', createdById: 'admin' });
    await expect(svc.createProject({ code: 'MICO', name: 'Two', createdById: 'admin' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFound when getting an unknown project', async () => {
    await expect(svc.getProject('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates project fields', async () => {
    const p = await svc.createProject({ code: 'RIG', name: 'Rig Portal', createdById: 'admin' });
    const updated = await svc.updateProject(p.id, { name: 'Rig Inspection Portal', priority: 'URGENT' });
    expect(updated.name).toBe('Rig Inspection Portal');
    expect(updated.priority).toBe('URGENT');
  });

  it('archives a project', async () => {
    const p = await svc.createProject({ code: 'FIN', name: 'Finance', createdById: 'admin' });
    const archived = await svc.archiveProject(p.id);
    expect(archived.status).toBe('ARCHIVED');
  });

  it('soft-deletes a project', async () => {
    const p = await svc.createProject({ code: 'SUP', name: 'Support', createdById: 'admin' });
    await svc.deleteProject(p.id);
    await expect(svc.getProject(p.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists all projects', async () => {
    await svc.createProject({ code: 'A', name: 'A', createdById: 'admin' });
    await svc.createProject({ code: 'B', name: 'B', createdById: 'admin' });
    expect(await svc.listProjects()).toHaveLength(2);
  });
});

describe('ProjectService — membership-based visibility', () => {
  it('shows an admin every project', async () => {
    await svc.createProject({ code: 'A', name: 'A', createdById: 'admin' });
    await svc.createProject({ code: 'B', name: 'B', createdById: 'admin' });
    const visible = await svc.listVisibleProjects({ id: 'admin', roles: ['ADMIN'] });
    expect(visible).toHaveLength(2);
  });

  it('shows an employee only projects they own, manage, or belong to', async () => {
    await svc.createProject({ code: 'OWN', name: 'Owned', createdById: 'admin', ownerId: 'emp1' });
    await svc.createProject({ code: 'MGR', name: 'Managed', createdById: 'admin', managerId: 'emp1' });
    const c = await svc.createProject({ code: 'MEM', name: 'Member', createdById: 'admin' });
    await svc.createProject({ code: 'OTHER', name: 'Not theirs', createdById: 'admin' });
    repo.addMember(c.id, 'emp1');

    const codes = (await svc.listVisibleProjects({ id: 'emp1', roles: ['EMPLOYEE'] })).map((p) => p.code).sort();
    expect(codes).toEqual(['MEM', 'MGR', 'OWN']);
  });

  it('lets an employee open a project they belong to', async () => {
    const a = await svc.createProject({ code: 'A', name: 'A', createdById: 'admin' });
    repo.addMember(a.id, 'emp1');
    const got = await svc.getVisibleProject(a.id, { id: 'emp1', roles: ['EMPLOYEE'] });
    expect(got.code).toBe('A');
  });

  it('hides a project an employee has no access to (NotFound)', async () => {
    const a = await svc.createProject({ code: 'A', name: 'A', createdById: 'admin' });
    await expect(svc.getVisibleProject(a.id, { id: 'emp1', roles: ['EMPLOYEE'] })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets an admin open any project', async () => {
    const a = await svc.createProject({ code: 'A', name: 'A', createdById: 'admin' });
    const got = await svc.getVisibleProject(a.id, { id: 'someone', roles: ['ADMIN'] });
    expect(got.code).toBe('A');
  });
});
