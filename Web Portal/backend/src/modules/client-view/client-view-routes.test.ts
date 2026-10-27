import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createProjectAuthz } from '../projects/project-authz';
import { createProjectAccess } from '../projects/project-access';
import { managesProject, type ProjectManagers } from '../projects/project-managers';
import { createClientAccessService } from './client-access-service';
import { createMemoryClientShareStore } from './client-share-store';
import { createMemoryClientViewSource } from './memory-client-view-source';
import type { ClientMinutesFlags, ClientTaskFlags } from './client-view-routes';
import type { AuditService } from '../audit/audit-service';
import type { TaskRecord } from '../tasks/task-repository';
import type { ClientCodeParams, ClientInvitationParams } from '../email/email-templates';

const tokenService = createTokenService({
  accessSecret: 'cv-access',
  refreshSecret: 'cv-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

// Who is who on project P1 (P2 belongs to someone else).
const OWNER = 'u-owner';
const NAMED = 'u-named-manager';
const MANAGER_MEMBER = 'u-manager-member';
const MEMBER = 'u-member';
const OUTSIDER = 'u-outsider';
const ADMIN = 'u-admin';
const ROLE_OF: Record<string, string[]> = { [ADMIN]: ['ADMIN'] };
const projects: Record<string, ProjectManagers & { team: string[] }> = {
  p1: { ownerId: OWNER, managerId: NAMED, members: [{ userId: MANAGER_MEMBER, role: 'MANAGER' }, { userId: MEMBER, role: 'MEMBER' }], team: [MANAGER_MEMBER, MEMBER] },
  p2: { ownerId: OUTSIDER, managerId: null, members: [], team: [] },
};
const onProject = (projectId: string, userId: string) => {
  const p = projects[projectId];
  return !!p && (p.ownerId === userId || p.managerId === userId || p.team.includes(userId));
};

interface Fixture {
  app: FastifyInstance;
  invitations: { email: string; params: ClientInvitationParams }[];
  codes: { email: string; params: ClientCodeParams }[];
  audited: { userId: string | null; action: string; module: string; entityId: string | null; ip: string | null }[];
  activity: { taskId: string; userId: string; action: string; meta?: Record<string, unknown> }[];
  broadcasts: { projectId: string; event: string }[];
  tasks: Map<string, { projectId: string; clientVisible: boolean; title: string }>;
  minutes: Map<string, { projectId: string | null; approved: boolean; clientVisible: boolean; includeRisks?: boolean }>;
  settle: () => Promise<void>;
}

async function makeFixture(opts: { codeLimit?: number; verifyLimit?: number; pdfLimit?: number; secureCookies?: boolean } = {}): Promise<Fixture> {
  const invitations: Fixture['invitations'] = [];
  const codes: Fixture['codes'] = [];
  const audited: Fixture['audited'] = [];
  const activity: Fixture['activity'] = [];
  const broadcasts: Fixture['broadcasts'] = [];
  const pending: Promise<void>[] = [];
  const source = createMemoryClientViewSource();
  source.addProject('p1', { name: 'Rig 7 Inspection', code: 'RIG', number: null, clientName: 'Oman Drilling Co.', status: 'ACTIVE', color: '#1E6B8B', icon: null, imageUrl: null, startDate: null, targetDate: null });
  source.addProject('p2', { name: 'Other Confidential Project', code: 'OCP', number: null, clientName: null, status: 'ACTIVE', color: '#000000', icon: null, imageUrl: null, startDate: null, targetDate: null });
  source.addTask('p1', { title: 'Marked milestone', isMilestone: true, clientVisible: true, columnCategory: 'IN_PROGRESS', completedAt: null, dueDate: null });
  source.addTask('p1', { title: 'Unmarked internal step', isMilestone: false, clientVisible: false, columnCategory: 'TODO', completedAt: null, dueDate: null });
  source.addTask('p2', { title: 'Other project marked task', isMilestone: false, clientVisible: true, columnCategory: 'TODO', completedAt: null, dueDate: null });
  const tasks: Fixture['tasks'] = new Map([
    ['t1', { projectId: 'p1', clientVisible: false, title: 'Pour the foundation' }],
    ['t2', { projectId: 'p2', clientVisible: false, title: 'P2 task' }],
  ]);
  const minutes: Fixture['minutes'] = new Map([
    ['m1', { projectId: 'p1', approved: true, clientVisible: false }],
    ['m-draft', { projectId: 'p1', approved: false, clientVisible: false }],
    ['m-alone', { projectId: null, approved: true, clientVisible: false }],
  ]);

  const auditService = {
    async record(d: Fixture['audited'][number]) {
      audited.push({ userId: d.userId ?? null, action: d.action, module: d.module, entityId: d.entityId ?? null, ip: d.ip ?? null });
      return {} as never;
    },
    async list() {
      return [];
    },
  } as unknown as AuditService;
  const service = createClientAccessService({
    store: createMemoryClientShareStore(),
    source,
    mailer: {
      isConfigured: () => true,
      async sendClientInvitation(email, params) {
        invitations.push({ email, params });
        return 'sent';
      },
      async sendClientCode(email, params) {
        codes.push({ email, params });
      },
    },
    userName: async (id) => (id === OWNER ? 'Omar Ahmed' : 'A colleague'),
    appUrl: 'https://task.mico360.test',
    assetUrl: 'https://task.mico360.test',
    timeZone: 'Asia/Muscat',
    runInBackground: (task) => void pending.push(task()),
    audit: auditService,
  });

  const managers = {
    async managesProject(userId: string, projectId: string) {
      return projects[projectId] ? managesProject(projects[projectId]!, userId) : false;
    },
    async projectIdOfColumn() {
      return null;
    },
    async projectIdOfTask(taskId: string) {
      return tasks.get(taskId)?.projectId ?? null;
    },
  };
  const projectAuthz = createProjectAuthz({ managers });
  const projectAccess = createProjectAccess({
    projects: {
      async isAccessibleTo(projectId, userId) {
        return onProject(projectId, userId);
      },
      async listForUser(userId) {
        return Object.keys(projects).filter((id) => onProject(id, userId)).map((id) => ({ id }));
      },
    },
    managers,
  });
  const taskFlags: ClientTaskFlags = {
    projectOf: async (taskId) => tasks.get(taskId)?.projectId ?? null,
    async setClientVisible(taskId, visible) {
      const t = tasks.get(taskId)!;
      const before = t.clientVisible;
      t.clientVisible = visible;
      return { before, task: { id: taskId, projectId: t.projectId, title: t.title, clientVisible: visible } as unknown as TaskRecord };
    },
  };
  const minutesFlags: ClientMinutesFlags = {
    projectOf: async (meetingId) => (minutes.has(meetingId) ? minutes.get(meetingId)!.projectId : undefined),
    state: async (meetingId) => {
      const m = minutes.get(meetingId);
      return m ? { approved: m.approved, clientVisible: m.clientVisible, includeRisks: m.clientVisible && m.includeRisks === true } : null;
    },
    async set(meetingId, visible, opts) {
      const m = minutes.get(meetingId)!;
      if (visible && !m.approved) return false;
      m.clientVisible = visible;
      m.includeRisks = visible && opts.includeRisks;
      return true;
    },
    async preview(meetingId) {
      const m = minutes.get(meetingId);
      if (!m?.approved) return null;
      return {
        content: { summary: 'Agreed with Sara Al Balushi.', discussion: [], decisions: ['Go'], risks: ['Internal: margin'], nextSteps: ['Survey — Sara, by 20 Oct'] },
        names: ['Sara Al Balushi', 'Sara'],
      };
    },
  };


  const deps: AppDeps = {
    tokenService,
    authService,
    projectAuthz,
    projectAccess,
    auditService,
    rateLimitMax: 100_000,
    authRateLimitMax: 100_000,
    meetingAccess: {
      canViewMeeting: async (userId: string, roles: string[], meetingId: string) => {
        const p = minutes.get(meetingId)?.projectId;
        return roles.includes('ADMIN') || (p ? onProject(p, userId) : userId === OWNER);
      },
    } as unknown as AppDeps['meetingAccess'],
    recordTaskActivity: async (e) => void activity.push(e),
    onTaskEvent: (projectId, event) => void broadcasts.push({ projectId, event }),
    clientView: {
      service,
      secureCookies: opts.secureCookies ?? true,
      tasks: taskFlags,
      minutes: minutesFlags,
      rateLimits: { codesPerMinute: opts.codeLimit ?? 1000, verifiesPerMinute: opts.verifyLimit ?? 1000, pdfsPerMinute: opts.pdfLimit ?? 1000 },
    },
  };
  const app = await buildApp(deps);
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  return { app, invitations, codes, audited, activity, broadcasts, tasks, minutes, settle };
}

const bearer = async (userId: string) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id: userId, roles: ROLE_OF[userId] ?? ['EMPLOYEE'] })).accessToken}` });
const linkOf = (f: Fixture) => /\/client\/([A-Za-z0-9_-]{43})$/.exec(f.invitations.at(-1)!.params.link)![1]!;

async function shareP1(f: Fixture, as = OWNER, email = 'fatma@client.example') {
  const res = await f.app.inject({ method: 'POST', url: '/api/v1/projects/p1/client-shares', headers: await bearer(as), payload: { name: 'Fatma Al Harthy', email } });
  expect(res.statusCode, res.body).toBe(201);
  return { share: res.json().data as { id: string }, link: linkOf(f) };
}

/** The email → code → cookie flow, over HTTP. Returns the cookie to send back ("name=value"). */
async function signInOverHttp(f: Fixture, link: string, email = 'fatma@client.example') {
  const asked = await f.app.inject({ method: 'POST', url: '/api/v1/client/code', headers: { 'x-client-link': link }, payload: { email } });
  expect(asked.statusCode, asked.body).toBe(202);
  await f.settle();
  const res = await f.app.inject({ method: 'POST', url: '/api/v1/client/verify', headers: { 'x-client-link': link }, payload: { email, code: f.codes.at(-1)!.params.code } });
  expect(res.statusCode, res.body).toBe(200);
  const setCookie = String(res.headers['set-cookie']);
  return { cookie: setCookie.split(';')[0]!, setCookie };
}

let f: Fixture;
beforeEach(async () => {
  f = await makeFixture();
});

describe('who may share a project with a client (each role, enforced by the server)', () => {
  // Runners: the owner, the named manager, a MANAGER member — and admins. A plain member is refused;
  // someone not on the project doesn't learn it exists.
  const cases: [string, string, number][] = [
    ['owner', OWNER, 2],
    ['named manager', NAMED, 2],
    ['MANAGER member', MANAGER_MEMBER, 2],
    ['admin', ADMIN, 2],
    ['plain member', MEMBER, 403],
    ['outsider', OUTSIDER, 404],
  ];

  it.each(cases)('%s: list, share, resend, remove', async (_label, userId, expected) => {
    const ok = (status: number) => (expected === 2 ? expect(status).toBeLessThan(300) : expect(status).toBe(expected));
    const headers = await bearer(userId);
    ok((await f.app.inject({ method: 'GET', url: '/api/v1/projects/p1/client-shares', headers })).statusCode);
    ok((await f.app.inject({ method: 'POST', url: '/api/v1/projects/p1/client-shares', headers, payload: { name: 'Bilal', email: `bilal-${userId}@client.example` } })).statusCode);
    const { share } = await shareP1(f, OWNER, `target-${userId}@client.example`);
    ok((await f.app.inject({ method: 'POST', url: `/api/v1/projects/p1/client-shares/${share.id}/resend`, headers })).statusCode);
    ok((await f.app.inject({ method: 'DELETE', url: `/api/v1/projects/p1/client-shares/${share.id}`, headers })).statusCode);
  });

  it.each(cases)('%s: show a task and a meeting’s minutes to the client', async (_label, userId, expected) => {
    const headers = await bearer(userId);
    const task = await f.app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/client-visible', headers, payload: { visible: true } });
    const minutes = await f.app.inject({ method: 'PUT', url: '/api/v1/meetings/m1/client-visibility', headers, payload: { visible: true } });
    if (expected === 2) {
      expect(task.statusCode, task.body).toBe(200);
      expect(minutes.statusCode, minutes.body).toBe(200);
      expect(f.tasks.get('t1')!.clientVisible).toBe(true);
      expect(f.minutes.get('m1')!.clientVisible).toBe(true);
    } else {
      expect(task.statusCode).toBe(expected);
      expect(minutes.statusCode).toBe(expected);
      expect(f.tasks.get('t1')!.clientVisible).toBe(false);
      expect(f.minutes.get('m1')!.clientVisible).toBe(false);
    }
  });

  it('a project’s shares are reached only through that project', async () => {
    const { share } = await shareP1(f);
    // OUTSIDER owns P2: their right to P2 is no way into P1's clients.
    const headers = await bearer(OUTSIDER);
    expect((await f.app.inject({ method: 'DELETE', url: `/api/v1/projects/p2/client-shares/${share.id}`, headers })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'POST', url: `/api/v1/projects/p2/client-shares/${share.id}/resend`, headers })).statusCode).toBe(404);
  });

  it('needs a staff sign-in at all', async () => {
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/projects/p1/client-shares' })).statusCode).toBe(401);
  });

  it('checks the name and address', async () => {
    const headers = await bearer(OWNER);
    const bad = async (payload: unknown) => (await f.app.inject({ method: 'POST', url: '/api/v1/projects/p1/client-shares', headers, payload: payload as object })).statusCode;
    expect(await bad({ name: '', email: 'a@b.example' })).toBe(400);
    expect(await bad({ name: 'A', email: 'not-an-address' })).toBe(400);
    expect(await bad({ name: 'x'.repeat(121), email: 'a@b.example' })).toBe(400);
  });

  it('lists clients with their last view, and writes share / resend / remove to the audit log with who did it', async () => {
    const { share } = await shareP1(f);
    const list = await f.app.inject({ method: 'GET', url: '/api/v1/projects/p1/client-shares', headers: await bearer(OWNER) });
    expect(list.json().data).toEqual([{ id: share.id, name: 'Fatma Al Harthy', email: 'fatma@client.example', createdAt: expect.any(String), linkSentAt: expect.any(String), lastViewedAt: null }]);
    await f.app.inject({ method: 'POST', url: `/api/v1/projects/p1/client-shares/${share.id}/resend`, headers: await bearer(NAMED) });
    await f.app.inject({ method: 'DELETE', url: `/api/v1/projects/p1/client-shares/${share.id}`, headers: await bearer(ADMIN) });
    expect(f.audited.map((a) => [a.module, a.action, a.userId, a.entityId])).toEqual([
      ['client-view', 'client-view.share.add', OWNER, share.id],
      ['client-view', 'client-view.share.resend', NAMED, share.id],
      ['client-view', 'client-view.share.remove', ADMIN, share.id],
    ]);
  });
});

describe('marking items "Show to client"', () => {
  it('a task: switched on and off, with a history line each way and a live update for open boards', async () => {
    const headers = await bearer(OWNER);
    const on = await f.app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/client-visible', headers, payload: { visible: true } });
    expect(on.json().data).toMatchObject({ id: 't1', clientVisible: true });
    // Again: no change, no second line.
    await f.app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/client-visible', headers, payload: { visible: true } });
    await f.app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/client-visible', headers, payload: { visible: false } });
    expect(f.activity).toEqual([
      { taskId: 't1', userId: OWNER, action: 'UPDATED', meta: { changes: [{ field: 'clientVisible', from: false, to: true }] } },
      { taskId: 't1', userId: OWNER, action: 'UPDATED', meta: { changes: [{ field: 'clientVisible', from: true, to: false }] } },
    ]);
    expect(f.broadcasts.filter((b) => b.event === 'task:updated').map((b) => b.projectId)).toEqual(['p1', 'p1', 'p1']);
    expect(f.audited.map((a) => a.action)).toEqual(['client-view.task.shown', 'client-view.task.hidden']);
  });

  it('a task that doesn’t exist is 404, and the body must say on or off', async () => {
    const headers = await bearer(ADMIN);
    expect((await f.app.inject({ method: 'PUT', url: '/api/v1/tasks/nope/client-visible', headers, payload: { visible: true } })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/client-visible', headers, payload: { visible: 'yes' } })).statusCode).toBe(400);
  });

  it('minutes: only approved minutes of a project meeting can be shown; the state says who may change it', async () => {
    const owner = await bearer(OWNER);
    const member = await bearer(MEMBER);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/meetings/m1/client-visibility', headers: owner })).json().data).toEqual({ projectMeeting: true, approved: true, clientVisible: false, includeRisks: false, canChange: true });
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/meetings/m1/client-visibility', headers: member })).json().data).toEqual({ projectMeeting: true, approved: true, clientVisible: false, includeRisks: false, canChange: false });
    const draft = await f.app.inject({ method: 'PUT', url: '/api/v1/meetings/m-draft/client-visibility', headers: owner, payload: { visible: true } });
    expect(draft.statusCode).toBe(409);
    expect(draft.json().error.code).toBe('MINUTES_NOT_FINAL');
    const alone = await f.app.inject({ method: 'PUT', url: '/api/v1/meetings/m-alone/client-visibility', headers: owner, payload: { visible: true } });
    expect(alone.statusCode).toBe(409);
    expect(alone.json().error.code).toBe('NOT_A_PROJECT_MEETING');
    const on = await f.app.inject({ method: 'PUT', url: '/api/v1/meetings/m1/client-visibility', headers: owner, payload: { visible: true } });
    expect(on.json().data).toEqual({ projectMeeting: true, approved: true, clientVisible: true, includeRisks: false, canChange: true });
    expect(f.audited.at(-1)).toMatchObject({ action: 'client-view.minutes.shown', userId: OWNER, entityId: 'm1' });
    // Shown again with the risks ticked.
    await f.app.inject({ method: 'PUT', url: '/api/v1/meetings/m1/client-visibility', headers: owner, payload: { visible: false } });
    const withRisks = await f.app.inject({ method: 'PUT', url: '/api/v1/meetings/m1/client-visibility', headers: owner, payload: { visible: true, includeRisks: true } });
    expect(withRisks.json().data).toMatchObject({ clientVisible: true, includeRisks: true });
  });

  it('the preview before showing minutes: exactly the client copy (owners off, risks there to tick) and the names to highlight', async () => {
    const owner = await bearer(OWNER);
    const res = await f.app.inject({ method: 'GET', url: '/api/v1/meetings/m1/client-visibility/preview', headers: owner });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      content: { summary: 'Agreed with Sara Al Balushi.', discussion: [], decisions: ['Go'], risks: ['Internal: margin'], nextSteps: ['Survey — by 20 Oct'] },
      names: ['Sara Al Balushi', 'Sara'],
    });
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/meetings/m1/client-visibility/preview', headers: await bearer(MEMBER) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/meetings/m1/client-visibility/preview', headers: await bearer(OUTSIDER) })).statusCode).toBe(404);
    const draft = await f.app.inject({ method: 'GET', url: '/api/v1/meetings/m-draft/client-visibility/preview', headers: owner });
    expect(draft.statusCode).toBe(409);
    expect(draft.json().error.code).toBe('MINUTES_NOT_FINAL');
  });
});

describe('the client’s own routes', () => {
  it('the full flow: link → code → cookie → page, with only marked items and no names', async () => {
    const { link } = await shareP1(f);
    const before = await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': link } });
    expect(before.statusCode).toBe(401);
    expect(before.json().error.code).toBe('CLIENT_SIGN_IN');
    expect(before.body).not.toContain('Rig 7');
    const { cookie } = await signInOverHttp(f, link);
    const page = await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': link, cookie } });
    expect(page.statusCode).toBe(200);
    const body = page.body;
    expect(page.json().data.project.name).toBe('Rig 7 Inspection');
    expect(page.json().data.milestones).toEqual([{ title: 'Marked milestone', status: 'In progress', dueDate: null }]);
    for (const hidden of ['Unmarked internal step', 'Other project', 'Other Confidential Project', 'Omar Ahmed', OWNER, NAMED, MEMBER, 'ownerId', 'managerId', 'assignee', 'description', 'comment']) {
      expect(body).not.toContain(hidden);
    }
  });

  it('the session cookie is httpOnly, Secure, SameSite=Strict, scoped to the client API, for 30 days', async () => {
    const { link } = await shareP1(f);
    const { setCookie } = await signInOverHttp(f, link);
    expect(setCookie).toMatch(/^mico_client_[A-Za-z0-9_-]+=[A-Za-z0-9_-]{43}; Path=\/api\/v1\/client; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure$/);
  });

  it('client answers are never stored and never indexed', async () => {
    const { link } = await shareP1(f);
    const res = await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': link } });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('a forwarded link with another address gets no code and can’t sign in — and is told the same as anyone', async () => {
    const { link } = await shareP1(f);
    const asked = await f.app.inject({ method: 'POST', url: '/api/v1/client/code', headers: { 'x-client-link': link }, payload: { email: 'colleague@other.example' } });
    expect(asked.statusCode).toBe(202);
    expect(asked.json()).toEqual({ data: { sent: true } });
    await f.settle();
    expect(f.codes).toEqual([]);
    const tried = await f.app.inject({ method: 'POST', url: '/api/v1/client/verify', headers: { 'x-client-link': link }, payload: { email: 'colleague@other.example', code: '123456' } });
    expect(tried.statusCode).toBe(401);
    expect(tried.json().error.code).toBe('CLIENT_CODE_INVALID');
    expect(tried.headers['set-cookie']).toBeUndefined();
  });

  it('Remove: the signed-in page is refused at once, as a link that no longer works', async () => {
    const { share, link } = await shareP1(f);
    const { cookie } = await signInOverHttp(f, link);
    await f.app.inject({ method: 'DELETE', url: `/api/v1/projects/p1/client-shares/${share.id}`, headers: await bearer(OWNER) });
    const res = await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': link, cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CLIENT_LINK_ENDED');
  });

  it('Resend: the old link stops working and the device is signed out; the new link opens with a new code', async () => {
    const { share, link } = await shareP1(f);
    const { cookie } = await signInOverHttp(f, link);
    await f.app.inject({ method: 'POST', url: `/api/v1/projects/p1/client-shares/${share.id}/resend`, headers: await bearer(OWNER) });
    const fresh = linkOf(f);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': link, cookie } })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': fresh, cookie } })).statusCode).toBe(401);
  });

  it('signing out clears the cookie and ends the session', async () => {
    const { link } = await shareP1(f);
    const { cookie } = await signInOverHttp(f, link);
    const out = await f.app.inject({ method: 'POST', url: '/api/v1/client/sign-out', headers: { 'x-client-link': link, cookie } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^mico_client_[^=]+=; Path=\/api\/v1\/client; Max-Age=0; HttpOnly; SameSite=Strict; Secure$/);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': link, cookie } })).statusCode).toBe(401);
  });

  it('the minutes PDF is the client copy, only for minutes shown to the client', async () => {
    const { link } = await shareP1(f);
    const { cookie } = await signInOverHttp(f, link);
    const missing = await f.app.inject({ method: 'GET', url: '/api/v1/client/minutes/m1/pdf', headers: { 'x-client-link': link, cookie } });
    expect(missing.statusCode).toBe(404);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/minutes/m1/pdf', headers: { 'x-client-link': link } })).statusCode).toBe(401);
  });

  it('an inspection report’s details need a signed-in device, and only a shown report is there', async () => {
    const { link } = await shareP1(f);
    const { cookie } = await signInOverHttp(f, link);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/inspections/i1', headers: { 'x-client-link': link, cookie } })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/inspections/i1', headers: { 'x-client-link': link } })).statusCode).toBe(401);
  });

  it('an inspection report PDF needs a signed-in device, and only a shown report is there', async () => {
    const { link } = await shareP1(f);
    const { cookie } = await signInOverHttp(f, link);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/inspections/i1/pdf', headers: { 'x-client-link': link, cookie } })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/client/inspections/i1/pdf', headers: { 'x-client-link': link } })).statusCode).toBe(401);
  });

  it('a staff token is never used on client routes: even an admin gets no page without the client’s code', async () => {
    const { link } = await shareP1(f);
    for (const userId of [ADMIN, OWNER, OUTSIDER]) {
      const res = await f.app.inject({ method: 'GET', url: '/api/v1/client/view', headers: { 'x-client-link': link, ...(await bearer(userId)) } });
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain('Marked milestone');
    }
  });

  it('limits code requests and code tries per IP address', async () => {
    const limited = await makeFixture({ codeLimit: 5, verifyLimit: 10 });
    const { link } = await shareP1(limited);
    const ask = () => limited.app.inject({ method: 'POST', url: '/api/v1/client/code', headers: { 'x-client-link': link }, payload: { email: 'x@y.example' } });
    for (let i = 0; i < 5; i++) expect((await ask()).statusCode).toBe(202);
    expect((await ask()).statusCode).toBe(429);
    const tryCode = () => limited.app.inject({ method: 'POST', url: '/api/v1/client/verify', headers: { 'x-client-link': link }, payload: { email: 'x@y.example', code: '123456' } });
    for (let i = 0; i < 10; i++) expect((await tryCode()).statusCode).toBe(401);
    expect((await tryCode()).statusCode).toBe(429);
  });

  it('counts PDFs (minutes and inspection reports) on the device’s session for that share: extra cookies don’t give a new allowance', async () => {
    const limited = await makeFixture({ pdfLimit: 2 });
    const { link } = await shareP1(limited);
    const { cookie } = await signInOverHttp(limited, link);
    const name = cookie.split('=')[0]!;
    const pdf = (url: string, extra: string) => limited.app.inject({ method: 'GET', url, headers: { 'x-client-link': link, cookie: `${cookie}; ${extra}` } });
    expect((await pdf('/api/v1/client/minutes/m1/pdf', 'junk=1')).statusCode).toBe(404);
    expect((await pdf('/api/v1/client/inspections/i1/pdf', `${name}x=${'C'.repeat(43)}; other=2`)).statusCode).toBe(404);
    expect((await pdf('/api/v1/client/minutes/m1/pdf', `junk=3; mico_client_fake=${'D'.repeat(43)}`)).statusCode).toBe(429);
  });

  it('limits minutes PDFs per signed-in device (10 a minute)', async () => {
    const limited = await makeFixture({ pdfLimit: 10 });
    const { link } = await shareP1(limited);
    const { cookie } = await signInOverHttp(limited, link);
    const pdf = () => limited.app.inject({ method: 'GET', url: '/api/v1/client/minutes/m1/pdf', headers: { 'x-client-link': link, cookie } });
    for (let i = 0; i < 10; i++) expect((await pdf()).statusCode).toBe(404);
    expect((await pdf()).statusCode).toBe(429);
    // Another device (another session cookie) has its own allowance: it gets its own answer, not 429.
    const other = `${cookie.split('=')[0]}=${'B'.repeat(43)}`;
    expect((await limited.app.inject({ method: 'GET', url: '/api/v1/client/minutes/m1/pdf', headers: { 'x-client-link': link, cookie: other } })).statusCode).toBe(401);
  });

  it('without the Secure flag only when the server is told so (plain http on a development machine)', async () => {
    const dev = await makeFixture({ secureCookies: false });
    const { link } = await shareP1(dev);
    const { setCookie } = await signInOverHttp(dev, link);
    expect(setCookie).not.toContain('Secure');
    const viaHttps = await dev.app.inject({ method: 'POST', url: '/api/v1/client/sign-out', headers: { 'x-client-link': link, 'x-forwarded-proto': 'https' } });
    expect(viaHttps.statusCode).toBe(204);
  });
});

describe('a client session can’t reach any staff route', () => {
  it('every staff API route refuses the client cookie and the client token (401), whatever it is', async () => {
    // The whole API, with every service stubbed: a request that got past sign-in would reach a stub.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub: any = new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? undefined : stub), apply: () => Promise.reject(new Error('reached a service')) });
    const real = await makeFixture();
    const { link } = await shareP1(real);
    const { cookie } = await signInOverHttp(real, link);
    const clientToken = cookie.split('=')[1]!;
    const base = { tokenService, authService: stub, rateLimitMax: 100_000, authRateLimitMax: 100_000 } as unknown as AppDeps;
    const deps = new Proxy(base, {
      get: (t, p) =>
        p in t
          ? (t as unknown as Record<string | symbol, unknown>)[p]
          : typeof p === 'string' && /Service$|Source$|Store$|Repository$|Access$|Authz$|Notices$|Overview$|^about$|Lookup$|^clientView$/.test(p)
            ? stub
            : undefined,
    });
    const app = await buildApp(deps);
    const routes = routeList(app.printRoutes({ commonPrefix: false }));
    expect(routes.length).toBeGreaterThan(150);

    // Routes that are public on purpose (no staff session: they take a password, a code, a key or a
    // refresh token in their body). Listed by name, so a new public route is a deliberate choice.
    const PUBLIC = [
      'GET /api/v1/health', 'GET /api/v1/config', 'POST /api/v1/webhooks/mailjet',
      'POST /api/v1/auth/login', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/refresh',
      'POST /api/v1/auth/biometric-credential', 'POST /api/v1/auth/biometric-credential/revoke', 'POST /api/v1/auth/biometric-sign-in',
      'POST /api/v1/auth/otp/request', 'POST /api/v1/auth/otp/verify', 'POST /api/v1/auth/password/forgot', 'POST /api/v1/auth/password/reset',
    ];
    const names = routes.map((r) => `${r.method} ${r.url}`);
    expect(PUBLIC.filter((p) => !names.includes(p))).toEqual([]);
    const refused: string[] = [];
    const allowed: string[] = [];
    for (const { method, url } of routes) {
      if (url.startsWith('/api/v1/client/') || method === 'OPTIONS') continue;
      const name = `${method} ${url}`;
      if (PUBLIC.includes(name)) continue;
      const withBody = method !== 'GET' && method !== 'DELETE';
      const res = await app.inject({
        method: method as 'GET',
        url: url.replace(/:[A-Za-z]+/g, 'x1').replace(/\*/g, 'x'),
        headers: { cookie, authorization: `Bearer ${clientToken}`, 'x-client-link': link, ...(withBody ? { 'content-type': 'application/json' } : {}) },
        ...(withBody ? { payload: '{}' } : {}),
      });
      (res.statusCode === 401 ? refused : allowed).push(`${name} → ${res.statusCode}`);
    }
    expect(allowed).toEqual([]);
    expect(refused.length).toBeGreaterThan(150);
  });

  it('the client token is no staff refresh token or sign-in key either', async () => {
    const { link } = await shareP1(f);
    const { cookie } = await signInOverHttp(f, link);
    const clientToken = cookie.split('=')[1]!;
    const refresh = await f.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: clientToken } });
    expect(refresh.statusCode).toBeGreaterThanOrEqual(400);
    expect(refresh.body).not.toContain('accessToken');
  });
});

/** "METHOD /full/path" for each route in Fastify's printed route tree (HEAD left out: it is GET). */
function routeList(tree: string): { method: string; url: string }[] {
  const out: { method: string; url: string }[] = [];
  const stack: string[] = [];
  for (const line of tree.split('\n')) {
    const m = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length / 4;
    stack.length = depth;
    stack[depth] = m[2]!;
    const url = stack.join('');
    for (const method of (m[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) if (method !== 'HEAD') out.push({ method, url });
  }
  return out;
}
