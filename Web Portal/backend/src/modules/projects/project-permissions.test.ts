import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createProjectService, type PeopleLookup } from './project-service';
import { createMemberService } from './member-service';
import { createProjectAuthz, type ProjectManagerLookup } from './project-authz';
import { managesProject } from './project-managers';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { pngHeader } from '../../lib/test-images';
import type { CreateProjectData, ProjectRecord, ProjectRepository } from './project-repository';
import type { MemberRepository, ProjectExistsLookup, ProjectMemberRole } from './member-repository';
import type { AuditService } from '../audit/audit-service';
import type { ProjectOverviewSource } from './project-overview';

/**
 * Employees create projects; a project's owner, its named manager and its MANAGER members run it
 * (edit, picture, archive, team); deleting stays an administrator's. Every route is tried with a
 * hand-made request from each kind of person, as the server — not the page — must refuse.
 */

// Active people, and someone who isn't (deactivated, suspended or deleted: none can be picked).
const ACTIVE = ['admin', 'owner', 'named', 'lead', 'member', 'outsider', 'sara', 'omar'];

type Row = ProjectRecord & { deleted?: boolean };

function world() {
  const projects = new Map<string, Row>();
  const teams = new Map<string, Map<string, ProjectMemberRole>>();
  let seq = 0;
  const team = (pid: string) => {
    if (!teams.has(pid)) teams.set(pid, new Map());
    return teams.get(pid)!;
  };
  const live = (id: string) => {
    const p = projects.get(id);
    return p && !p.deleted ? p : null;
  };
  const sees = (p: Row, uid: string) => p.ownerId === uid || p.managerId === uid || p.createdById === uid || team(p.id).has(uid);
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
      if (opts?.keepManager) team(id).set(opts.keepManager, 'MANAGER');
      return u;
    },
    async softDelete(id) { projects.set(id, { ...projects.get(id)!, deleted: true }); },
  };

  const managers: ProjectManagerLookup = {
    async managesProject(uid, pid) { const p = live(pid); return !!p && runs(p, uid); },
    async managedAmong(uid, ids) { return ids.filter((id) => { const p = live(id); return !!p && runs(p, uid); }); },
    async projectIdOfColumn() { return null; },
    async projectIdOfTask() { return null; },
  };

  const memberRepo: MemberRepository = {
    async list(pid) {
      return [...team(pid)].map(([id, role]) => ({ id, username: id, email: `${id}@x`, firstName: id, lastName: '', role }));
    },
    async add(pid, uid) { if (!team(pid).has(uid)) team(pid).set(uid, 'MEMBER'); },
    async remove(pid, uid) { team(pid).delete(uid); },
    async setRole(pid, uid, role) { team(pid).set(uid, role); },
    async hasOtherRunner(pid, uid) {
      const p = live(pid);
      return !!p && (p.ownerId !== null || p.managerId !== null || [...team(pid)].some(([id, role]) => id !== uid && role === 'MANAGER'));
    },
  };
  const exists: ProjectExistsLookup = { async exists(id) { return live(id) !== null; } };
  const people: PeopleLookup = { async activeIds(ids) { return ids.filter((id) => ACTIVE.includes(id)); } };

  return { projects, team, repo, managers, memberRepo, exists, people };
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
  const auditService = {
    async record(d: (typeof audit)[number]) { audit.push(d); return { ...d, id: 'a', createdAt: new Date() }; },
    async list() { return audit; },
  } as unknown as AuditService;
  app = await buildApp({
    authService,
    tokenService,
    projectService: createProjectService({ projects: w.repo, people: w.people }),
    memberService: createMemberService({ repo: w.memberRepo, projects: w.exists }),
    projectAuthz: createProjectAuthz({ managers: w.managers }),
    projectOverview: overview,
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
  audit = [];
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

  it('keeps deleting a project an administrator’s alone', async () => {
    for (const who of ['owner', 'named', 'lead', 'member', 'outsider']) {
      expect((await call(who, 'DELETE', `/projects/${rig}`)).statusCode, who).toBe(403);
    }
    expect(w.projects.get(rig)!.deleted).toBeUndefined();
    expect((await call('admin', 'DELETE', `/projects/${rig}`)).statusCode).toBe(204);
  });

  it('lets the owner and the named manager run the team too (not only MANAGER members)', async () => {
    expect((await call('owner', 'POST', `/projects/${rig}/members`, { userIds: ['sara'] })).statusCode).toBe(200);
    expect((await call('named', 'PATCH', `/projects/${rig}/members/sara`, { role: 'MANAGER' })).statusCode).toBe(200);
    expect((await call('member', 'POST', `/projects/${rig}/members`, { userIds: ['omar'] })).statusCode).toBe(403);
    expect(w.team(rig).get('sara')).toBe('MANAGER');
    expect(w.team(rig).has('omar')).toBe(false);
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
    const manager = await call('omar', 'POST', '/projects', { code: 'BAD3', name: 'Bad', managerId: 'gone' });
    expect(manager.statusCode).toBe(400);
    expect(manager.json().error.message).toMatch(/manager.*isn’t an active user/i);
    const team = await call('omar', 'POST', '/projects', { code: 'BAD4', name: 'Bad', memberIds: ['sara', 'gone', 'nobody'] });
    expect(team.statusCode).toBe(400);
    expect(team.json().error.message).toMatch(/2 of the people picked for the team aren’t active users/i);
    expect(w.projects.size).toBe(before);
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

describe('An administrator creates a project (as before)', () => {
  it('is not put on the team, may leave it without an owner, and a chosen owner joins the team', async () => {
    const none = await call('admin', 'POST', '/projects', { code: 'ADM1', name: 'No owner' });
    expect(none.json().data.ownerId).toBeNull();
    expect(w.team(none.json().data.id).size).toBe(0);
    const owned = await call('admin', 'POST', '/projects', { code: 'ADM2', name: 'Owned', ownerId: 'sara', memberIds: ['member'] });
    expect(Object.fromEntries(w.team(owned.json().data.id))).toEqual({ sara: 'MEMBER', member: 'MEMBER' });
  });
});

describe('Handing a project over never locks its runners out', () => {
  it('an owner who hands it to someone else stays on as a manager, so they can still run it', async () => {
    const res = await call('owner', 'PUT', `/projects/${rig}`, { ownerId: 'sara' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ ownerId: 'sara', canManage: true });
    expect(w.team(rig).get('owner')).toBe('MANAGER');
    expect((await call('owner', 'PUT', `/projects/${rig}`, { name: 'Still running it' })).statusCode).toBe(200);
    expect((await call('sara', 'PUT', `/projects/${rig}`, { name: 'And so does Sara' })).statusCode).toBe(200);
    expect(audit.find((a) => a.action === 'project.update' && a.userId === 'owner')?.newValue).toMatchObject({ ownerId: 'sara', keptAsManager: 'owner' });
  });

  it('an owner who clears the owner stays on as a manager too', async () => {
    expect((await call('owner', 'PUT', `/projects/${rig}`, { ownerId: null })).statusCode).toBe(200);
    expect(w.team(rig).get('owner')).toBe('MANAGER');
  });

  it('a named manager who names someone else stays on as a manager', async () => {
    expect((await call('named', 'PUT', `/projects/${rig}`, { managerId: 'omar' })).statusCode).toBe(200);
    expect(w.team(rig).get('named')).toBe('MANAGER');
  });

  it('a MANAGER member who changes the owner keeps their place as it was, and nobody else is touched', async () => {
    expect((await call('lead', 'PUT', `/projects/${rig}`, { ownerId: 'sara' })).statusCode).toBe(200);
    expect(Object.fromEntries(w.team(rig))).toEqual({ lead: 'MANAGER', member: 'MEMBER' });
  });

  it('an administrator’s change is applied as asked (no one is added)', async () => {
    expect((await call('admin', 'PUT', `/projects/${rig}`, { ownerId: null })).statusCode).toBe(200);
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

  it('allows it once someone else runs it, and always for an administrator', async () => {
    expect((await call('lead', 'PATCH', `/projects/${rig}/members/member`, { role: 'MANAGER' })).statusCode).toBe(200);
    expect((await call('lead', 'PATCH', `/projects/${rig}/members/lead`, { role: 'MEMBER' })).statusCode).toBe(200);
    expect((await call('admin', 'DELETE', `/projects/${rig}/members/member`)).statusCode).toBe(204);
  });
});
