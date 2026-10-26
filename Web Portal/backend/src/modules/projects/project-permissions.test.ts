import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createProjectService, type PeopleLookup } from './project-service';
import { createMemberService } from './member-service';
import { createProjectAuthz, type ProjectManagerLookup } from './project-authz';
import { createProjectAccess } from './project-access';
import { createProjectNotices } from './project-notices';
import { managesProject } from './project-managers';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { NotFoundError } from '../../lib/http-errors';
import { pngHeader } from '../../lib/test-images';
import type { CreateProjectData, ProjectRecord, ProjectRepository } from './project-repository';
import type { MemberRepository, ProjectExistsLookup, ProjectMemberRole } from './member-repository';
import type { AuditService } from '../audit/audit-service';
import type { ProjectOverviewSource } from './project-overview';
import type { ColumnService } from './column-service';
import type { TaskService } from '../tasks/task-service';
import type { CreateNotificationData } from '../notifications/notification-repository';

/**
 * Employees create projects; a project's owner, its named manager and its MANAGER members run it
 * (edit, picture, archive, team, board columns, deleting tasks); deleting the project stays an
 * administrator's. Every route is tried with a hand-made request from each kind of person, as the
 * server — not the page — must refuse.
 */

// Active people, and someone who isn't ("gone": deactivated, suspended or deleted — none can be picked).
const ACTIVE = ['admin', 'owner', 'named', 'lead', 'member', 'outsider', 'sara', 'omar'];
const NAMES: Record<string, string> = { admin: 'Aisha Khan', owner: 'Olivia Owner', omar: 'Omar Ahmed', lead: 'Lena Lead' };

type Row = ProjectRecord & { deleted?: boolean };

function world() {
  const projects = new Map<string, Row>();
  const teams = new Map<string, Map<string, ProjectMemberRole>>();
  const columns = new Map<string, string>(); // column → project
  const tasks = new Map<string, string>(); // task → project
  let seq = 0;
  const team = (pid: string) => {
    if (!teams.has(pid)) teams.set(pid, new Map());
    return teams.get(pid)!;
  };
  const live = (id: string) => {
    const p = projects.get(id);
    return p && !p.deleted ? p : null;
  };
  // The real rule: owner, named manager or on the team (having created it is not a way in).
  const sees = (p: Row, uid: string) => p.ownerId === uid || p.managerId === uid || team(p.id).has(uid);
  const runs = (p: Row, uid: string) => managesProject({ ownerId: p.ownerId, managerId: p.managerId, members: [...team(p.id)].map(([userId, role]) => ({ userId, role })) }, uid);

  const repo: ProjectRepository = {
    async create(data: CreateProjectData) {
      const now = new Date();
      const rec: Row = {
        id: `p${seq++}`, code: data.code, number: data.number ?? null, name: data.name, description: data.description ?? null, clientName: data.clientName ?? null,
        managerId: data.managerId ?? null, ownerId: data.ownerId ?? null, status: data.status ?? 'PLANNING', priority: data.priority ?? 'NORMAL',
        color: data.color ?? '#8B1E1E', icon: data.icon ?? null, imageUrl: null, startDate: null, targetDate: null, notes: null,
        carryForward: data.carryForward ?? true, defaultDueToday: data.defaultDueToday ?? false,
        createdById: data.createdById, createdAt: now, updatedAt: now,
      };
      projects.set(rec.id, rec);
      for (const m of data.members ?? []) {
        // The database's (projectId, userId) key: a second row for the same person would fail.
        if (team(rec.id).has(m.userId)) throw new Error(`duplicate member row for ${m.userId}`);
        team(rec.id).set(m.userId, m.role);
      }
      return rec;
    },
    async findById(id) { return live(id); },
    async findByCode(code) { return [...projects.values()].find((p) => p.code === code && !p.deleted) ?? null; },
    async codeInUse(code) { return [...projects.values()].some((p) => p.code === code); },
    async list() { return [...projects.values()].filter((p) => !p.deleted); },
    async listForUser(uid) { return [...projects.values()].filter((p) => !p.deleted && sees(p, uid)); },
    async isAccessibleTo(id, uid) { const p = live(id); return !!p && sees(p, uid); },
    async update(id, patch, opts) {
      const u = { ...projects.get(id)!, ...patch, updatedAt: new Date() };
      projects.set(id, u);
      for (const keep of opts?.keepManagers ?? []) team(id).set(keep, 'MANAGER');
      return u;
    },
    async softDelete(id) { projects.set(id, { ...projects.get(id)!, deleted: true }); },
  };

  const managers: ProjectManagerLookup = {
    async managesProject(uid, pid) { const p = live(pid); return !!p && runs(p, uid); },
    async managedAmong(uid, ids) { return ids.filter((id) => { const p = live(id); return !!p && runs(p, uid); }); },
    async projectIdOfColumn(cid) { return columns.get(cid) ?? null; },
    async projectIdOfTask(tid) { const pid = tasks.get(tid); return pid && live(pid) ? pid : null; },
  };

  const memberRepo: MemberRepository = {
    async list(pid) {
      return [...team(pid)].map(([id, role]) => ({ id, username: id, email: `${id}@x`, firstName: id, lastName: '', role }));
    },
    async add(pid, uid) { if (!team(pid).has(uid)) team(pid).set(uid, 'MEMBER'); },
    async remove(pid, uid) { team(pid).delete(uid); },
    async setRole(pid, uid, role) { team(pid).set(uid, role); },
    // As the database does it: the check and the change together; only active people count.
    async changeGuarded(pid, uid, change) {
      const p = live(pid)!;
      const losing = team(pid).get(uid) === 'MANAGER' && ('remove' in change || change.role !== 'MANAGER');
      if (losing) {
        const others = [p.ownerId, p.managerId, ...[...team(pid)].filter(([id, role]) => id !== uid && role === 'MANAGER').map(([id]) => id)];
        if (!others.some((id) => id && ACTIVE.includes(id))) {
          const { ConflictError } = await import('../../lib/http-errors');
          throw new ConflictError('Someone has to run this project. Make another member a manager, or give it an owner, first.', 'LAST_PROJECT_MANAGER');
        }
      }
      if ('remove' in change) team(pid).delete(uid);
      else team(pid).set(uid, change.role);
    },
  };
  const exists: ProjectExistsLookup = { async exists(id) { return live(id) !== null; } };
  const people: PeopleLookup = { async activeIds(ids) { return ids.filter((id) => ACTIVE.includes(id)); } };

  return { projects, team, columns, tasks, repo, managers, memberRepo, exists, people };
}

const tokenService = createTokenService({
  accessSecret: 'perm-access',
  refreshSecret: 'perm-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const storage = {
  async save() { return { storageKey: 'img.png', url: '/uploads/img.png', sizeBytes: 10 }; },
  async remove() {},
};
const overview: ProjectOverviewSource = { async load() { return { totals: [], openByDue: [], members: [], owners: [] }; } };

let w: ReturnType<typeof world>;
let app: Awaited<ReturnType<typeof buildApp>>;
let audit: { userId?: string | null; action: string; module: string; entityId?: string | null; newValue?: unknown }[] = [];
let notices: CreateNotificationData[] = [];
let deletedTasks: string[] = [];
let rig = '';

const as = async (id: string) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles: id === 'admin' ? ['ADMIN'] : ['EMPLOYEE'] })).accessToken}` });
const call = async (who: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: who ? await as(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

function upload() {
  const boundary = '----mico360perm';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
    pngHeader(64, 64),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const sendPicture = async (who: string | null, id: string) => {
  const u = upload();
  return app.inject({ method: 'POST', url: `/api/v1/projects/${id}/image`, headers: { ...(who ? await as(who) : {}), ...u.headers }, payload: u.payload });
};

beforeEach(async () => {
  w = world();
  audit = [];
  notices = [];
  deletedTasks = [];
  const auditService = {
    async record(d: (typeof audit)[number]) { audit.push(d); return { ...d, id: 'a', createdAt: new Date() }; },
    async list() { return audit; },
  } as unknown as AuditService;
  const columnService = {
    async listColumns() { return []; },
    async addColumn(projectId: string, body: { name: string }) { w.columns.set('c-new', projectId); return { id: 'c-new', projectId, name: body.name, category: 'TODO', position: 9, color: '#111', enabled: true }; },
    async updateColumn(id: string, patch: { name?: string }) { return { id, projectId: w.columns.get(id)!, name: patch.name ?? 'Col', category: 'TODO', position: 0, color: '#111', enabled: true }; },
    async removeColumn(id: string) { return { projectId: w.columns.get(id)! }; },
  } as unknown as ColumnService;
  const taskService = {
    async getTask(id: string) { const projectId = w.tasks.get(id); if (!projectId) throw new NotFoundError('Task not found.'); return { id, projectId }; },
    async deleteTask(id: string) { deletedTasks.push(id); },
    async listTasks() { return []; },
  } as unknown as TaskService;
  const projectService = createProjectService({ projects: w.repo, people: w.people });
  app = await buildApp({
    authService,
    tokenService,
    projectService,
    memberService: createMemberService({ repo: w.memberRepo, projects: w.exists, people: w.people }),
    projectAuthz: createProjectAuthz({ managers: w.managers }),
    projectAccess: createProjectAccess({ projects: w.repo, managers: w.managers }),
    projectNotices: createProjectNotices({
      notify: async (n) => { notices.push(n); },
      nameOf: async (id) => NAMES[id] ?? id,
      projectName: async (id) => (await projectService.getProject(id)).name,
    }),
    projectOverview: overview,
    columnService,
    taskService,
    auditService,
    chatAttachmentStorage: storage as never,
  });
  // RIG: owned by "owner", "named" is its named manager, "lead" a MANAGER member and "member" a plain one.
  const created = await call('admin', 'POST', '/projects', { code: 'RIG', name: 'Rig Inspection', ownerId: 'owner', managerId: 'named' });
  rig = created.json().data.id;
  // As projects made before this change are: the owner runs it without a place on its team.
  w.team(rig).delete('owner');
  w.team(rig).set('lead', 'MANAGER');
  w.team(rig).set('member', 'MEMBER');
  w.columns.set('c1', rig);
  w.tasks.set('t1', rig);
  audit = [];
  notices = [];
});

describe('Who may change a project (owner, named manager, MANAGER member, admin)', () => {
  const RUNNERS = ['owner', 'named', 'lead', 'admin'];

  it('lets each of them edit its details and status', async () => {
    for (const who of RUNNERS) {
      const res = await call(who, 'PUT', `/projects/${rig}`, { name: `Renamed by ${who}`, status: 'ACTIVE' });
      expect(res.statusCode, who).toBe(200);
      expect(res.json().data.name).toBe(`Renamed by ${who}`);
    }
  });

  it('refuses a plain member with plain words, and hides the project from an outsider', async () => {
    const member = await call('member', 'PUT', `/projects/${rig}`, { name: 'Hijacked' });
    expect(member.statusCode).toBe(403);
    expect(member.json().error.message).toMatch(/owner.*manager.*administrator/i);
    expect((await call('outsider', 'PUT', `/projects/${rig}`, { name: 'Hijacked' })).statusCode).toBe(404);
    expect((await call(null, 'PUT', `/projects/${rig}`, { name: 'Hijacked' })).statusCode).toBe(401);
    expect(w.projects.get(rig)!.name).toBe('Rig Inspection');
  });

  it('lets each of them archive it; a plain member and an outsider cannot', async () => {
    expect((await call('member', 'POST', `/projects/${rig}/archive`)).statusCode).toBe(403);
    expect((await call('outsider', 'POST', `/projects/${rig}/archive`)).statusCode).toBe(404);
    expect(w.projects.get(rig)!.status).toBe('PLANNING');
    for (const who of RUNNERS) {
      w.projects.set(rig, { ...w.projects.get(rig)!, status: 'ACTIVE' });
      const res = await call(who, 'POST', `/projects/${rig}/archive`);
      expect(res.statusCode, who).toBe(200);
      expect(res.json().data.status).toBe('ARCHIVED');
    }
  });

  it('lets each of them set and remove its picture; a plain member and an outsider cannot', async () => {
    expect((await sendPicture('member', rig)).statusCode).toBe(403);
    expect((await sendPicture('outsider', rig)).statusCode).toBe(404);
    expect((await call('member', 'DELETE', `/projects/${rig}/image`)).statusCode).toBe(403);
    expect((await call('outsider', 'DELETE', `/projects/${rig}/image`)).statusCode).toBe(404);
    expect(w.projects.get(rig)!.imageUrl).toBeNull();
    for (const who of RUNNERS) {
      const set = await sendPicture(who, rig);
      expect(set.statusCode, who).toBe(200);
      expect(set.json().data.imageUrl).toBe('/uploads/img.png');
      const cleared = await call(who, 'DELETE', `/projects/${rig}/image`);
      expect(cleared.statusCode, who).toBe(200);
      expect(cleared.json().data.imageUrl).toBeNull();
    }
  });

  it('answers 404 to its owner for a deleted project: edit, archive and picture', async () => {
    w.projects.set(rig, { ...w.projects.get(rig)!, deleted: true });
    expect((await call('owner', 'PUT', `/projects/${rig}`, { name: 'Back from the dead' })).statusCode).toBe(404);
    expect((await call('owner', 'POST', `/projects/${rig}/archive`)).statusCode).toBe(404);
    expect((await sendPicture('owner', rig)).statusCode).toBe(404);
    expect((await call('owner', 'DELETE', `/projects/${rig}/image`)).statusCode).toBe(404);
    expect(w.projects.get(rig)!.name).toBe('Rig Inspection');
  });

  it('keeps deleting a project an administrator’s alone', async () => {
    for (const who of ['owner', 'named', 'lead', 'member', 'outsider']) {
      expect((await call(who, 'DELETE', `/projects/${rig}`)).statusCode, who).toBe(403);
    }
    expect(w.projects.get(rig)!.deleted).toBeUndefined();
    expect((await call('admin', 'DELETE', `/projects/${rig}`)).statusCode).toBe(204);
  });

  it('tells each viewer whether they may change the project (list, details, overview)', async () => {
    for (const [who, can] of [['owner', true], ['named', true], ['lead', true], ['member', false], ['admin', true]] as const) {
      const list = await call(who, 'GET', '/projects');
      expect(list.json().data.find((p: { id: string }) => p.id === rig)?.canManage, who).toBe(can);
      expect((await call(who, 'GET', `/projects/${rig}`)).json().data.canManage, who).toBe(can);
      const cards = await call(who, 'GET', '/projects/overview');
      expect(cards.json().data.find((p: { id: string }) => p.id === rig)?.canManage, who).toBe(can);
    }
  });
});

describe('Who may run the team', () => {
  it('the owner and the named manager too (not only MANAGER members)', async () => {
    expect((await call('owner', 'POST', `/projects/${rig}/members`, { userIds: ['sara'] })).statusCode).toBe(200);
    expect((await call('named', 'PATCH', `/projects/${rig}/members/sara`, { role: 'MANAGER' })).statusCode).toBe(200);
    expect((await call('member', 'POST', `/projects/${rig}/members`, { userIds: ['omar'] })).statusCode).toBe(403);
    expect(w.team(rig).get('sara')).toBe('MANAGER');
    expect(w.team(rig).has('omar')).toBe(false);
  });

  it('a plain member can’t make themselves a manager (403)', async () => {
    expect((await call('member', 'PATCH', `/projects/${rig}/members/member`, { role: 'MANAGER' })).statusCode).toBe(403);
    expect(w.team(rig).get('member')).toBe('MEMBER');
  });

  it('an outsider can neither see nor change the team (403)', async () => {
    expect((await call('outsider', 'GET', `/projects/${rig}/members`)).statusCode).toBe(403);
    expect((await call('outsider', 'POST', `/projects/${rig}/members`, { userIds: ['outsider'] })).statusCode).toBe(403);
    expect((await call('outsider', 'PATCH', `/projects/${rig}/members/member`, { role: 'MANAGER' })).statusCode).toBe(403);
    expect((await call('outsider', 'DELETE', `/projects/${rig}/members/member`)).statusCode).toBe(403);
    expect(Object.fromEntries(w.team(rig))).toEqual({ lead: 'MANAGER', member: 'MEMBER' });
  });

  it('can’t add inactive or unknown people either (400 in plain words, nobody added)', async () => {
    const one = await call('owner', 'POST', `/projects/${rig}/members`, { userIds: ['sara', 'gone'] });
    expect(one.statusCode).toBe(400);
    expect(one.json().error.message).toMatch(/one of the people picked isn’t an active user/i);
    const two = await call('owner', 'POST', `/projects/${rig}/members`, { userIds: ['gone', 'nobody'] });
    expect(two.json().error.message).toMatch(/2 of the people picked aren’t active users/i);
    expect(w.team(rig).has('sara')).toBe(false);
  });
});

describe('Board columns and deleting tasks follow the same rule', () => {
  it('lets the owner, the named manager and a MANAGER member add, change and remove columns', async () => {
    for (const who of ['owner', 'named', 'lead']) {
      expect((await call(who, 'POST', `/projects/${rig}/columns`, { name: `By ${who}` })).statusCode, who).toBe(201);
      expect((await call(who, 'PUT', '/columns/c1', { name: `Renamed by ${who}` })).statusCode, who).toBe(200);
      expect((await call(who, 'DELETE', '/columns/c1')).statusCode, who).toBe(204);
    }
  });

  it('refuses a plain member and an outsider (403)', async () => {
    for (const who of ['member', 'outsider']) {
      expect((await call(who, 'POST', `/projects/${rig}/columns`, { name: 'Nope' })).statusCode, who).toBe(403);
      expect((await call(who, 'PUT', '/columns/c1', { name: 'Nope' })).statusCode, who).toBe(403);
      expect((await call(who, 'DELETE', '/columns/c1')).statusCode, who).toBe(403);
    }
  });

  it('lets the owner and the named manager delete a task; not a plain member or an outsider', async () => {
    for (const who of ['member', 'outsider']) expect((await call(who, 'DELETE', '/tasks/t1')).statusCode, who).toBe(403);
    expect(deletedTasks).toEqual([]);
    for (const who of ['owner', 'named']) expect((await call(who, 'DELETE', '/tasks/t1')).statusCode, who).toBe(204);
    expect(deletedTasks).toEqual(['t1', 't1']);
  });
});

describe('An employee creates a project', () => {
  it('owns it by default, runs it as a MANAGER member and sees it at once', async () => {
    const res = await call('omar', 'POST', '/projects', { code: 'OPS', name: 'Operations' });
    expect(res.statusCode).toBe(201);
    const p = res.json().data;
    expect(p).toMatchObject({ ownerId: 'omar', createdById: 'omar', canManage: true });
    expect([...w.team(p.id)]).toEqual([['omar', 'MANAGER']]);
    expect((await call('omar', 'GET', '/projects')).json().data.map((x: { code: string }) => x.code)).toContain('OPS');
    expect((await call('omar', 'GET', `/projects/${p.id}`)).statusCode).toBe(200);
  });

  it('can make someone else the owner and pick a team — one row each, the creator a manager', async () => {
    const res = await call('omar', 'POST', '/projects', { code: 'TEAM', name: 'Team project', ownerId: 'sara', memberIds: ['member', 'sara', 'omar', 'member'] });
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id as string;
    expect(res.json().data.ownerId).toBe('sara');
    expect(Object.fromEntries(w.team(id))).toEqual({ omar: 'MANAGER', sara: 'MEMBER', member: 'MEMBER' });
    // Everyone chosen sees it straight away; nobody else does.
    for (const who of ['omar', 'sara', 'member']) {
      expect((await call(who, 'GET', '/projects')).json().data.map((x: { id: string }) => x.id), who).toContain(id);
    }
    expect((await call('outsider', 'GET', '/projects')).json().data.map((x: { id: string }) => x.id)).not.toContain(id);
    // The creator and the owner run it; a plain member of the team doesn't.
    expect((await call('omar', 'PUT', `/projects/${id}`, { name: 'Still mine to run' })).statusCode).toBe(200);
    expect((await call('sara', 'PUT', `/projects/${id}`, { name: 'Sara’s now' })).statusCode).toBe(200);
    expect((await call('member', 'PUT', `/projects/${id}`, { name: 'Nope' })).statusCode).toBe(403);
  });

  it('loses it once taken off the team: having created it is no way in', async () => {
    const id = (await call('omar', 'POST', '/projects', { code: 'GONE', name: 'Handed over', ownerId: 'sara' })).json().data.id as string;
    expect((await call('sara', 'DELETE', `/projects/${id}/members/omar`)).statusCode).toBe(204);
    expect((await call('omar', 'GET', `/projects/${id}`)).statusCode).toBe(404);
    expect((await call('omar', 'GET', '/projects')).json().data.map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await call('omar', 'PUT', `/projects/${id}`, { name: 'Mine again?' })).statusCode).toBe(404);
  });

  it('writes the creator and the team to the Audit Log', async () => {
    const res = await call('omar', 'POST', '/projects', { code: 'AUDT', name: 'Audited', ownerId: 'sara', memberIds: ['member'] });
    const entry = audit.find((a) => a.action === 'project.create');
    expect(entry).toMatchObject({
      userId: 'omar',
      module: 'projects',
      entityId: res.json().data.id,
      newValue: {
        code: 'AUDT',
        name: 'Audited',
        createdById: 'omar',
        ownerId: 'sara',
        team: [{ userId: 'omar', role: 'MANAGER' }, { userId: 'sara', role: 'MEMBER' }, { userId: 'member', role: 'MEMBER' }],
      },
    });
  });

  it('refuses inactive or unknown people as owner, manager or team, in plain words, and creates nothing', async () => {
    const before = w.projects.size;
    const owner = await call('omar', 'POST', '/projects', { code: 'BAD1', name: 'Bad', ownerId: 'gone' });
    expect(owner.statusCode).toBe(400);
    expect(owner.json().error.message).toMatch(/owner.*isn’t an active user/i);
    const unknown = await call('omar', 'POST', '/projects', { code: 'BAD2', name: 'Bad', ownerId: 'nobody-at-all' });
    expect(unknown.statusCode).toBe(400);
    const manager = await call('admin', 'POST', '/projects', { code: 'BAD3', name: 'Bad', managerId: 'gone' });
    expect(manager.statusCode).toBe(400);
    expect(manager.json().error.message).toMatch(/manager.*isn’t an active user/i);
    const team = await call('omar', 'POST', '/projects', { code: 'BAD4', name: 'Bad', memberIds: ['sara', 'gone', 'nobody'] });
    expect(team.statusCode).toBe(400);
    expect(team.json().error.message).toMatch(/2 of the people picked for the team aren’t active users/i);
    expect(w.projects.size).toBe(before);
  });

  it('may name at most 100 people for the team at once (admins: as before)', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `person-${i}`);
    const res = await call('omar', 'POST', '/projects', { code: 'BIG', name: 'Big', memberIds: many });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/at most 100 people/i);
    const admin = await call('admin', 'POST', '/projects', { code: 'BIG', name: 'Big', memberIds: many });
    expect(admin.json().error.message).not.toMatch(/at most 100/i); // refused for another reason: nobody by those names
  });

  it('keeps today’s answer to a code that is taken (409), and may check a code first', async () => {
    const check = await call('omar', 'GET', '/projects/code-check?code=rig');
    expect(check.statusCode).toBe(200);
    expect(check.json().data).toMatchObject({ code: 'RIG', available: false });
    const clash = await call('omar', 'POST', '/projects', { code: 'RIG', name: 'Again' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('DUPLICATE_PROJECT_CODE');
  });
});

describe('Naming a project manager is an administrator’s', () => {
  it('refuses an employee who names a manager on create, and ignores themselves or nobody', async () => {
    const other = await call('omar', 'POST', '/projects', { code: 'NM1', name: 'Named', managerId: 'sara' });
    expect(other.statusCode).toBe(400);
    expect(other.json().error.message).toMatch(/only an administrator can name a project’s manager/i);
    const self = await call('omar', 'POST', '/projects', { code: 'NM2', name: 'Self', managerId: 'omar' });
    expect(self.statusCode).toBe(201);
    expect(self.json().data.managerId).toBeNull();
  });

  it('refuses an employee who changes or clears it, and ignores it sent unchanged', async () => {
    const same = await call('owner', 'PUT', `/projects/${rig}`, { managerId: 'named', name: 'Same manager' });
    expect(same.statusCode).toBe(200);
    expect(same.json().data).toMatchObject({ name: 'Same manager', managerId: 'named' });
    for (const managerId of ['sara', null]) {
      const res = await call('owner', 'PUT', `/projects/${rig}`, { managerId });
      expect(res.statusCode, String(managerId)).toBe(400);
      expect(res.json().error.message).toMatch(/only an administrator/i);
    }
    expect((await call('named', 'PUT', `/projects/${rig}`, { managerId: 'omar' })).statusCode).toBe(400);
    expect(w.projects.get(rig)!.managerId).toBe('named');
  });

  it('lets an administrator name or clear it — and the person named before stays on as a manager', async () => {
    const cleared = await call('admin', 'PUT', `/projects/${rig}`, { managerId: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.managerId).toBeNull();
    expect(w.team(rig).get('named')).toBe('MANAGER');
    expect((await call('admin', 'PUT', `/projects/${rig}`, { managerId: 'sara' })).json().data.managerId).toBe('sara');
  });
});

describe('Nobody silently loses a project they ran', () => {
  it('an owner who hands it to someone else stays on as a manager, so they can still run it', async () => {
    const res = await call('owner', 'PUT', `/projects/${rig}`, { ownerId: 'sara' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ ownerId: 'sara', canManage: true });
    expect(w.team(rig).get('owner')).toBe('MANAGER');
    expect((await call('owner', 'PUT', `/projects/${rig}`, { name: 'Still running it' })).statusCode).toBe(200);
    expect((await call('sara', 'PUT', `/projects/${rig}`, { name: 'And so does Sara' })).statusCode).toBe(200);
    expect(audit.find((a) => a.action === 'project.update' && a.userId === 'owner')?.newValue).toMatchObject({ ownerId: 'sara', keptAsManagers: ['owner'] });
  });

  it('a MANAGER member who changes the owner can’t push them out: the old owner (no team row before) stays a manager', async () => {
    expect(w.team(rig).has('owner')).toBe(false);
    expect((await call('lead', 'PUT', `/projects/${rig}`, { ownerId: 'sara' })).statusCode).toBe(200);
    expect(Object.fromEntries(w.team(rig))).toEqual({ owner: 'MANAGER', lead: 'MANAGER', member: 'MEMBER' });
    expect((await call('owner', 'PUT', `/projects/${rig}`, { name: 'I still run it' })).statusCode).toBe(200);
  });

  it('an administrator who clears the owner keeps them on as a manager too', async () => {
    expect((await call('admin', 'PUT', `/projects/${rig}`, { ownerId: null })).statusCode).toBe(200);
    expect(Object.fromEntries(w.team(rig))).toEqual({ owner: 'MANAGER', lead: 'MANAGER', member: 'MEMBER' });
  });

  it('a change that leaves the owner as it was keeps the team as it was', async () => {
    expect((await call('lead', 'PUT', `/projects/${rig}`, { ownerId: 'owner', name: 'Same owner' })).statusCode).toBe(200);
    expect(Object.fromEntries(w.team(rig))).toEqual({ lead: 'MANAGER', member: 'MEMBER' });
  });

  it('refuses an inactive or unknown new owner or manager, but an unchanged one is no obstacle', async () => {
    const gone = await call('owner', 'PUT', `/projects/${rig}`, { ownerId: 'gone' });
    expect(gone.statusCode).toBe(400);
    expect(gone.json().error.message).toMatch(/owner.*isn’t an active user/i);
    expect((await call('admin', 'PUT', `/projects/${rig}`, { managerId: 'nobody' })).statusCode).toBe(400);
    expect(w.projects.get(rig)).toMatchObject({ ownerId: 'owner', managerId: 'named' });
    // An owner who left the company since: the project can still be renamed with the form's full payload.
    w.projects.set(rig, { ...w.projects.get(rig)!, ownerId: 'gone' });
    expect((await call('admin', 'PUT', `/projects/${rig}`, { ownerId: 'gone', name: 'Renamed' })).statusCode).toBe(200);
  });
});

describe('Team changes keep someone running the project', () => {
  beforeEach(() => {
    // Nobody owns or is named to run it: "lead" is the only one who does.
    w.projects.set(rig, { ...w.projects.get(rig)!, ownerId: null, managerId: null });
  });

  it('refuses to let the last manager step down or leave', async () => {
    const demote = await call('lead', 'PATCH', `/projects/${rig}/members/lead`, { role: 'MEMBER' });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.message).toMatch(/someone has to run this project/i);
    expect((await call('lead', 'DELETE', `/projects/${rig}/members/lead`)).statusCode).toBe(409);
    expect(w.team(rig).get('lead')).toBe('MANAGER');
  });

  it('doesn’t count an owner who is no longer active', async () => {
    w.projects.set(rig, { ...w.projects.get(rig)!, ownerId: 'gone' });
    expect((await call('lead', 'PATCH', `/projects/${rig}/members/lead`, { role: 'MEMBER' })).statusCode).toBe(409);
  });

  it('allows it once someone else runs it, and always for an administrator', async () => {
    expect((await call('lead', 'PATCH', `/projects/${rig}/members/member`, { role: 'MANAGER' })).statusCode).toBe(200);
    expect((await call('lead', 'PATCH', `/projects/${rig}/members/lead`, { role: 'MEMBER' })).statusCode).toBe(200);
    expect((await call('admin', 'DELETE', `/projects/${rig}/members/member`)).statusCode).toBe(204);
  });
});

describe('People put on a project are told', () => {
  const told = () => notices.map((n) => [n.userId, n.title]);

  it('on creation: the owner that they own it, the team that they’re on it — never the creator', async () => {
    const res = await call('omar', 'POST', '/projects', { code: 'TOLD', name: 'Pipeline Survey', ownerId: 'sara', memberIds: ['member', 'lead', 'omar'] });
    const id = res.json().data.id;
    expect(told()).toEqual([
      ['sara', 'Omar Ahmed made you the owner of Pipeline Survey'],
      ['member', 'Omar Ahmed added you to the project Pipeline Survey'],
      ['lead', 'Omar Ahmed added you to the project Pipeline Survey'],
    ]);
    expect(notices.every((n) => n.type === 'PROJECT_ADDED' && n.entityType === 'project' && n.entityId === id)).toBe(true);
  });

  it('on the Team tab: only the people newly added, not the person adding them', async () => {
    expect((await call('owner', 'POST', `/projects/${rig}/members`, { userIds: ['sara', 'member', 'owner'] })).statusCode).toBe(200);
    expect(told()).toEqual([
      ['sara', 'Olivia Owner added you to the project Rig Inspection'],
    ]);
  });

  it('says nothing when the change is refused', async () => {
    await call('member', 'POST', `/projects/${rig}/members`, { userIds: ['sara'] });
    await call('omar', 'POST', '/projects', { code: 'BADT', name: 'Bad', ownerId: 'sara', memberIds: ['gone'] });
    expect(notices).toEqual([]);
  });
});
