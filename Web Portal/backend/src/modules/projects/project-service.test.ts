import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createProjectService, newProjectTeam } from './project-service';
import type { ProjectRecord, ProjectRepository, CreateProjectData, PeopleLookup } from './project-repository';
import type { CompanyChangePlan, ProjectCompanyRules } from '../companies/project-companies';
import { ConflictError, NotFoundError } from '../../lib/http-errors';

function inMemoryRepo(): ProjectRepository & { all(): ProjectRecord[]; addMember(projectId: string, userId: string): void; inCompanies(projectId: string, ids: string[]): void } {
  const rows = new Map<string, ProjectRecord>();
  const members = new Map<string, Set<string>>();
  const companies = new Map<string, string[]>();
  let seq = 0;
  const canAccess = (p: ProjectRecord, userId: string) =>
    p.ownerId === userId || p.managerId === userId || (members.get(p.id)?.has(userId) ?? false);
  const inPick = (p: ProjectRecord, pick?: string | null) => !pick || (companies.get(p.id) ?? []).includes(pick);
  return {
    all: () => [...rows.values()],
    inCompanies: (projectId, ids) => {
      companies.set(projectId, ids);
    },
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
        number: data.number ?? null,
        managerId: data.managerId ?? null,
        status: data.status ?? 'PLANNING',
        priority: data.priority ?? 'NORMAL',
        color: data.color ?? '#8B1E1E',
        icon: data.icon ?? null,
        imageUrl: null,
        ownerId: data.ownerId ?? null,
        startDate: data.startDate ?? null,
        targetDate: data.targetDate ?? null,
        notes: data.notes ?? null,
        carryForward: data.carryForward ?? true,
        defaultDueToday: data.defaultDueToday ?? false,
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
    async list(pick) {
      return [...rows.values()].filter((p) => inPick(p, pick));
    },
    async listForUser(userId, pick) {
      return [...rows.values()].filter((p) => canAccess(p, userId) && inPick(p, pick));
    },
    async listTeamOf(userId, pick) {
      return [...rows.values()].filter((p) => canAccess(p, userId) && inPick(p, pick));
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

  it('companies: a picked company narrows the list — an admin gets that company’s projects, an employee theirs in it', async () => {
    const a = await svc.createProject({ code: 'A', name: 'A', createdById: 'admin', ownerId: 'emp1' });
    const b = await svc.createProject({ code: 'B', name: 'B', createdById: 'admin', ownerId: 'emp1' });
    repo.inCompanies(a.id, ['alpha']);
    repo.inCompanies(b.id, ['beta']);
    expect((await svc.listVisibleProjects({ id: 'admin', roles: ['ADMIN'] }, 'beta')).map((p) => p.code)).toEqual(['B']);
    expect((await svc.listVisibleProjects({ id: 'emp1', roles: ['EMPLOYEE'] }, 'alpha')).map((p) => p.code)).toEqual(['A']);
    expect((await svc.listVisibleProjects({ id: 'emp1', roles: ['EMPLOYEE'] })).map((p) => p.code).sort()).toEqual(['A', 'B']);
  });

  // 1.22 "Show my projects only": an administrator's lists use the team rule; the Projects page can
  // ask for every project for one visit; opening one by its link is unchanged.
  it('an administrator with “Show my projects only” lists the projects they own, manage or are on the team of', async () => {
    const on = new Set(['admin']);
    const mine = createProjectService({ projects: repo, myProjectsOnly: async (id) => on.has(id) });
    const own = await mine.createProject({ code: 'OWN', name: 'Owned', createdById: 'admin', ownerId: 'admin' });
    const mgr = await mine.createProject({ code: 'MGR', name: 'Managed', createdById: 'admin', managerId: 'admin' });
    const mem = await mine.createProject({ code: 'MEM', name: 'Member', createdById: 'admin' });
    const other = await mine.createProject({ code: 'OTHER', name: 'Not theirs', createdById: 'admin' });
    repo.addMember(mem.id, 'admin');
    repo.inCompanies(own.id, ['alpha']);
    repo.inCompanies(other.id, ['alpha']);
    const codes = (ps: { code: string }[]) => ps.map((p) => p.code).sort();
    expect(codes(await mine.listVisibleProjects({ id: 'admin', roles: ['ADMIN'] }))).toEqual(['MEM', 'MGR', 'OWN']);
    expect(codes(await mine.listVisibleProjects({ id: 'admin', roles: ['ADMIN'] }, 'alpha'))).toEqual(['OWN']); // with a pick both apply
    // The Projects page's "for this visit" untick (GET /projects/overview?all=1).
    expect(codes(await mine.listVisibleProjects({ id: 'admin', roles: ['ADMIN'] }, null, { everyProject: true }))).toEqual(['MEM', 'MGR', 'OTHER', 'OWN']);
    // Opening one by its link.
    expect((await mine.getVisibleProject(other.id, { id: 'admin', roles: ['ADMIN'] })).code).toBe('OTHER');
    // Another administrator, and an employee asking for every project, are unchanged.
    expect(codes(await mine.listVisibleProjects({ id: 'admin2', roles: ['ADMIN'] }))).toEqual(['MEM', 'MGR', 'OTHER', 'OWN']);
    repo.addMember(mgr.id, 'emp1');
    expect(codes(await mine.listVisibleProjects({ id: 'emp1', roles: ['EMPLOYEE'] }, null, { everyProject: true }))).toEqual(['MGR']);
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

describe('newProjectTeam — who is on a new project’s team', () => {
  it('puts an employee creator on as a MANAGER, the owner and the picked people as members, each once', () => {
    expect(newProjectTeam({ creatorId: 'omar', creatorIsAdmin: false, ownerId: 'sara', memberIds: ['ali', 'sara', 'omar', 'ali'] })).toEqual([
      { userId: 'omar', role: 'MANAGER' },
      { userId: 'sara', role: 'MEMBER' },
      { userId: 'ali', role: 'MEMBER' },
    ]);
  });

  it('an employee who owns it themselves is on once, as a MANAGER', () => {
    expect(newProjectTeam({ creatorId: 'omar', creatorIsAdmin: false, ownerId: 'omar', memberIds: [] })).toEqual([{ userId: 'omar', role: 'MANAGER' }]);
  });

  it('an administrator creator is not added (as before); a chosen owner and the picked people are', () => {
    expect(newProjectTeam({ creatorId: 'boss', creatorIsAdmin: true, ownerId: null, memberIds: [] })).toEqual([]);
    expect(newProjectTeam({ creatorId: 'boss', creatorIsAdmin: true, ownerId: 'boss', memberIds: ['ali'] })).toEqual([{ userId: 'ali', role: 'MEMBER' }]);
    expect(newProjectTeam({ creatorId: 'boss', creatorIsAdmin: true, ownerId: 'sara', memberIds: ['boss'] })).toEqual([
      { userId: 'sara', role: 'MEMBER' },
      { userId: 'boss', role: 'MEMBER' },
    ]);
  });
});

describe('ProjectService — companies', () => {
  const admin = { id: 'admin', roles: ['ADMIN'] };
  const cat = { id: 'cat', roles: ['EMPLOYEE'] };
  const plan: CompanyChangePlan = { projectId: 'p0', before: ['A'], mainBefore: 'A', after: ['B', 'A'], added: [{ id: 'B', name: 'Beta Co' }], removed: [], main: { id: 'B', name: 'Beta Co' } };
  function wired() {
    const rules = {
      forNewProject: vi.fn(async (_actor: unknown, ids: string[] | undefined, pick: string | null) => ids ?? (pick ? [pick] : ['B'])),
      planChange: vi.fn(async (): Promise<CompanyChangePlan | null> => plan),
      applyChange: vi.fn(async () => {}),
    } satisfies ProjectCompanyRules;
    // Everyone is active; bob belongs to none of the companies asked about.
    const people: PeopleLookup = {
      async activeIds(ids) { return ids; },
      outsideCompanies: vi.fn(async (ids: string[]) => (ids.includes('bob') ? [{ id: 'bob', name: 'Bob Betaonly' }] : [])),
      async projectCompanyIds() { return ['A']; },
    };
    const created = vi.spyOn(repo, 'create');
    return { rules, people, created, svc: createProjectService({ projects: repo, people, companies: rules }) };
  }

  it('a new project goes into the companies the rules give it (named, the pick, the creator’s primary…)', async () => {
    const { rules, created, svc: s } = wired();
    await s.createProject({ code: 'CPA', name: 'Picked', createdById: 'cat' }, cat, 'A');
    expect(rules.forNewProject).toHaveBeenLastCalledWith(cat, undefined, 'A');
    expect(created.mock.lastCall![0]).toMatchObject({ companyIds: ['A'] });
    await s.createProject({ code: 'CPB', name: 'Named', createdById: 'admin', companyIds: ['B', 'A'] }, admin);
    expect(rules.forNewProject).toHaveBeenLastCalledWith(admin, ['B', 'A'], null);
    expect(created.mock.lastCall![0]).toMatchObject({ companyIds: ['B', 'A'] });
    expect(created.mock.lastCall![0]).not.toHaveProperty('pick');
  });

  it('without the companies rules nothing is said about companies (as before)', async () => {
    const created = vi.spyOn(repo, 'create');
    await svc.createProject({ code: 'CPC', name: 'Plain', createdById: 'admin' });
    expect(created.mock.lastCall![0]).not.toHaveProperty('companyIds');
  });

  it('its owner, manager and team must be in one of those companies (nothing is made otherwise)', async () => {
    const { people, svc: s } = wired();
    await expect(s.createProject({ code: 'CPD', name: 'Owner', createdById: 'admin', ownerId: 'bob', companyIds: ['A'] }, admin)).rejects.toMatchObject({
      status: 400,
      message: 'Bob Betaonly isn’t in any of this project’s companies.',
      details: { field: 'ownerId' },
    });
    expect(people.outsideCompanies).toHaveBeenLastCalledWith(['bob'], ['A']);
    await expect(s.createProject({ code: 'CPE', name: 'Team', createdById: 'admin', memberIds: ['ana', 'bob'], companyIds: ['A'] }, admin)).rejects.toMatchObject({
      message: 'Bob Betaonly isn’t in any of this project’s companies.',
      details: { field: 'memberIds', userIds: ['bob'] },
    });
    await expect(s.createProject({ code: 'CPF', name: 'Manager', createdById: 'admin', managerId: 'bob', companyIds: ['A'] }, admin)).rejects.toMatchObject({ details: { field: 'managerId' } });
    expect(repo.all()).toEqual([]);
  });

  it('an edit checks a companies change first, writes it after the other fields, and a new owner must be in the new companies', async () => {
    const { rules, people, svc: s } = wired();
    const p = await s.createProject({ code: 'CPG', name: 'Edit', createdById: 'admin', companyIds: ['A'] }, admin);
    const out = await s.editProject(p.id, { companyIds: ['B', 'A'], ownerId: 'ana', name: 'Edited' }, admin);
    expect(rules.planChange).toHaveBeenCalledWith(p.id, admin, ['B', 'A']);
    expect(rules.applyChange).toHaveBeenCalledWith(plan);
    expect(people.outsideCompanies).toHaveBeenLastCalledWith(['ana'], ['B', 'A']);
    expect(out).toMatchObject({ project: { name: 'Edited', ownerId: 'ana' }, companies: plan });
    await expect(s.editProject(p.id, { ownerId: 'bob' }, admin)).rejects.toMatchObject({ message: 'Bob Betaonly isn’t in any of this project’s companies.' });
    expect(people.outsideCompanies).toHaveBeenLastCalledWith(['bob'], ['A']); // the project's own companies when they aren't changing
  });

  it('a refused companies change saves nothing', async () => {
    const { rules, svc: s } = wired();
    const p = await s.createProject({ code: 'CPH', name: 'Kept', createdById: 'admin', companyIds: ['A'] }, admin);
    rules.planChange.mockRejectedValueOnce(Object.assign(new Error('You can only add or remove your own companies.'), { status: 403 }));
    await expect(s.editProject(p.id, { companyIds: ['B'], name: 'Not saved' }, cat)).rejects.toMatchObject({ status: 403 });
    expect((await s.getProject(p.id)).name).toBe('Kept');
    expect(rules.applyChange).not.toHaveBeenCalled();
    rules.planChange.mockResolvedValueOnce(null); // nothing to change
    expect((await s.editProject(p.id, { companyIds: ['A'] }, admin)).companies).toBeNull();
    expect(rules.applyChange).not.toHaveBeenCalled();
  });
});
