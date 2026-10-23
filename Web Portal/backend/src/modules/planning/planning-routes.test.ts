import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createProjectService } from '../projects/project-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createSettingsService } from '../settings/settings-service';
import type { ProjectRecord, ProjectRepository } from '../projects/project-repository';
import type { SettingsRepository } from '../settings/settings-repository';
import type { TimelineRows, TimelineSource } from './timeline';
import { fakeWorkloadStore, type FakeCompany } from './workload-store.fixture';

// Saturday 24 October 2026, 12:00 in Muscat.
const NOW = new Date('2026-10-24T08:00:00Z');

function record(id: string, extra: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id,
    code: id.toUpperCase(),
    number: null,
    name: `Project ${id}`,
    description: null,
    clientName: null,
    managerId: null,
    ownerId: null,
    status: 'ACTIVE',
    priority: 'NORMAL',
    color: '#8B1E1E',
    icon: null,
    imageUrl: null,
    startDate: null,
    targetDate: null,
    notes: null,
    carryForward: true,
    defaultDueToday: false,
    createdById: 'admin',
    createdAt: new Date('2026-09-01T08:00:00Z'),
    updatedAt: new Date('2026-09-01T08:00:00Z'),
    ...extra,
  };
}

let projects: ProjectRecord[] = [];
const repo: ProjectRepository = {
  async create() { throw new Error('not used'); },
  async findById(id) { return projects.find((p) => p.id === id) ?? null; },
  async findByCode(code) { return projects.find((p) => p.code === code) ?? null; },
  async list() { return projects; },
  async listForUser(userId) { return projects.filter((p) => p.ownerId === userId || p.managerId === userId || p.createdById === userId); },
  async isAccessibleTo(projectId, userId) { return (await repo.listForUser(userId)).some((p) => p.id === projectId); },
  async update() { throw new Error('not used'); },
  async softDelete() {},
};

let timelineCalls: { projectIds: string[]; ownerIds: string[]; meetingsFrom: Date; meetingsTo: Date }[] = [];
let timelineRows: TimelineRows = { totals: [], openByDue: [], milestones: [], meetings: [], owners: [] };
const timelineSource: TimelineSource = {
  async load(projectIds, ownerIds, window) {
    timelineCalls.push({ projectIds, ownerIds, ...window });
    return timelineRows;
  },
};

const EMPTY: FakeCompany = { users: [], projects: [], members: [], tasks: [] };
let company: FakeCompany = EMPTY;
let workloadStore = fakeWorkloadStore(company);

let stored: Record<string, unknown> = {};
const settingsRepo: SettingsRepository = {
  async getAll() { return Object.entries(stored).map(([key, value]) => ({ key, value })); },
  async set(key, value) {
    stored[key] = value;
    return { key, value };
  },
};

const tokenService = createTokenService({
  accessSecret: 'plan-access',
  refreshSecret: 'plan-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const as = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const ADMIN = () => as('admin', ['ADMIN']);
const EMPLOYEE = (id = 'emp') => as(id, ['EMPLOYEE']);

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({
    authService,
    tokenService,
    projectService: createProjectService({ projects: repo }),
    settingsService: createSettingsService({ settings: settingsRepo }),
    timelineSource,
    workloadStore: {
      managedProjectIds: (u) => workloadStore.managedProjectIds(u),
      liveProjects: (ids) => workloadStore.liveProjects(ids),
      members: (ids) => workloadStore.members(ids),
      activeUsers: (ids) => workloadStore.activeUsers(ids),
      openTasks: (q) => workloadStore.openTasks(q),
      overdueCounts: (q) => workloadStore.overdueCounts(q),
      openDue: (q) => workloadStore.openDue(q),
    },
    planningNow: () => NOW,
    appConfig: { timeZone: 'Asia/Muscat', productName: 'MICO360 Tasks', companyName: 'MICO360' },
  });
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  projects = [];
  timelineCalls = [];
  timelineRows = { totals: [], openByDue: [], milestones: [], meetings: [], owners: [] };
  company = EMPTY;
  workloadStore = fakeWorkloadStore(company);
  stored = {};
  app = await makeApp();
});

describe('GET /timeline', () => {
  const url = '/api/v1/timeline?from=2026-10-05&to=2026-12-31&weekStart=1';

  it('shows every open project an administrator may see — not the completed or archived ones', async () => {
    projects = [
      record('rig', { name: 'Rig Inspection Portal', ownerId: 'sara' }),
      record('plan', { status: 'PLANNING' }),
      record('hold', { status: 'ON_HOLD' }),
      record('done', { status: 'COMPLETED' }),
      record('old', { status: 'ARCHIVED' }),
    ];
    timelineRows = { ...timelineRows, owners: [{ id: 'sara', name: 'Sara Ahmed', avatarUrl: null }] };
    const res = await app.inject({ method: 'GET', url, headers: await ADMIN() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.projects.map((p: { id: string }) => p.id)).toEqual(['rig', 'plan', 'hold']);
    expect(data.projects[0].owner).toEqual({ id: 'sara', name: 'Sara Ahmed', avatarUrl: null });
    expect(data).toMatchObject({ from: '2026-10-05', to: '2027-01-03', weekStart: 1, today: '2026-10-24', currentWeek: '2026-10-19' });
    expect(data.weeks).toHaveLength(13);
    // One load for the whole list.
    expect(timelineCalls).toHaveLength(1);
    expect(timelineCalls[0]!.projectIds).toEqual(['rig', 'plan', 'hold']);
    expect(timelineCalls[0]!.ownerIds).toEqual(['sara']);
  });

  it('reads the meetings of the shown weeks and of this week, whichever starts first and ends last (company time)', async () => {
    projects = [record('rig')];
    await app.inject({ method: 'GET', url: '/api/v1/timeline?from=2026-11-02&to=2026-11-15&weekStart=1', headers: await ADMIN() });
    // This week (from Monday 19 October) starts before the shown weeks: midnight in Muscat is 20:00 UTC the day before.
    expect(timelineCalls[0]!.meetingsFrom.toISOString()).toBe('2026-10-18T20:00:00.000Z');
    expect(timelineCalls[0]!.meetingsTo.toISOString()).toBe('2026-11-15T20:00:00.000Z');
  });

  it('shows anyone else only the projects they own, manage, created or belong to (as the projects list does)', async () => {
    projects = [record('mine', { ownerId: 'emp' }), record('theirs'), record('managed', { managerId: 'emp' })];
    const res = await app.inject({ method: 'GET', url, headers: await EMPLOYEE() });
    expect(res.json().data.projects.map((p: { id: string }) => p.id)).toEqual(['mine', 'managed']);
    expect(timelineCalls[0]!.projectIds).toEqual(['mine', 'managed']);
  });

  it('starts weeks on Sunday when no week start is given', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/timeline?from=2026-10-24&to=2026-10-24', headers: await ADMIN() });
    expect(res.json().data).toMatchObject({ from: '2026-10-18', to: '2026-10-24', weekStart: 0, currentWeek: '2026-10-18' });
  });

  it('refuses a reversed range, more than 53 weeks, a date that is not real and an unknown week start (400)', async () => {
    for (const q of ['from=2026-12-01&to=2026-10-01', 'from=2026-01-05&to=2027-02-01', 'from=2026-02-30&to=2026-03-10', 'from=2026-10-01&to=2026-10-30&weekStart=3', 'to=2026-10-30']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/timeline?${q}`, headers: await ADMIN() });
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
    expect(timelineCalls).toHaveLength(0);
  });

  it('refuses dates more than two years away, and extreme years, with a plain 400 — never a 500', async () => {
    for (const q of ['from=2024-10-01&to=2024-12-01', 'from=2028-11-01&to=2028-12-01', 'from=0000-01-01&to=0000-03-01', 'from=9999-10-01&to=9999-12-31', 'from=2026-10-01&to=9999-12-31']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/timeline?${q}`, headers: await ADMIN() });
      expect(res.statusCode, q).toBe(400);
      expect(res.json().error.message, q).toBe('Pick dates within two years of today.');
    }
    expect(timelineCalls).toHaveLength(0);
  });

  it('needs a sign-in (401)', async () => {
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });
});

describe('GET /workload', () => {
  const url = '/api/v1/workload?week=2026-10-25';
  const use = (c: FakeCompany) => {
    company = c;
    workloadStore = fakeWorkloadStore(c);
  };
  const TEAM: FakeCompany = {
    users: [
      { id: 'admin', name: 'Aisha Khan' },
      { id: 'pm', name: 'Sara Ahmed' },
      { id: 'omar', name: 'Omar Said' },
      { id: 'emp', name: 'Yusuf Ali' },
    ],
    projects: [{ id: 'rig', managerId: 'pm' }, { id: 'mine' }, { id: 'done', status: 'COMPLETED', managerId: 'emp' }],
    members: [{ projectId: 'rig', userId: 'omar' }, { projectId: 'mine', userId: 'emp' }],
    tasks: [{ id: 'r1', projectId: 'rig', due: '2026-10-27', assignees: ['omar'] }],
  };

  it('lets an administrator see everyone, with the company limit and working days, and change the limit', async () => {
    use(TEAM);
    stored = { 'workload.dailyLimit': 6, 'meetings.workingHours': { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' } };
    const res = await app.inject({ method: 'GET', url, headers: await ADMIN() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ week: '2026-10-25', today: '2026-10-24', limit: 6, canChangeLimit: true, scope: 'everyone' });
    expect(data.days.map((d: { working: boolean }) => d.working)).toEqual([true, true, true, true, true, false, false]);
    expect(data.people.map((p: { id: string }) => p.id)).toEqual(['admin', 'omar', 'pm', 'emp']); // by name
    expect(data.projects.map((p: { id: string }) => p.id)).toEqual(['rig', 'mine']); // not the completed one
    expect(data).not.toHaveProperty('loads');
  });

  it('reads only the shown week’s tasks (a day either side), and weighs the three weeks after it', async () => {
    use(TEAM);
    await app.inject({ method: 'GET', url, headers: await ADMIN() });
    const shown = workloadStore.calls.find((c) => c.name === 'openTasks')!.args as { from: Date; to: Date };
    expect([shown.from.toISOString(), shown.to.toISOString()]).toEqual(['2026-10-24T00:00:00.000Z', '2026-11-02T00:00:00.000Z']);
    const weighed = workloadStore.calls.find((c) => c.name === 'openDue' && (c.args as { projectIds: unknown }).projectIds === null)!.args as { windows: { from: Date; to: Date }[] };
    expect(weighed.windows.map((w) => [w.from.toISOString(), w.to.toISOString()])).toEqual([['2026-10-24T00:00:00.000Z', '2026-11-23T00:00:00.000Z']]);
  });

  it('shows a project manager the team of the project they manage, and no limit control', async () => {
    use(TEAM);
    const res = await app.inject({ method: 'GET', url, headers: await as('pm', ['EMPLOYEE']) });
    const data = res.json().data;
    expect(data).toMatchObject({ scope: 'teams', canChangeLimit: false, limit: 5 });
    expect(data.people.map((p: { id: string }) => p.id)).toEqual(['omar', 'pm']);
    expect(data.projects.map((p: { id: string }) => p.id)).toEqual(['rig']);
  });

  it('shows anyone else only their own row — also when the only project they manage is completed', async () => {
    use(TEAM);
    projects = [record('mine', { createdById: 'emp' }), record('theirs'), record('done', { managerId: 'emp', status: 'COMPLETED' })];
    const res = await app.inject({ method: 'GET', url, headers: await EMPLOYEE() });
    const data = res.json().data;
    expect(data).toMatchObject({ scope: 'self', canChangeLimit: false });
    expect(data.people.map((p: { id: string }) => p.id)).toEqual(['emp']);
    expect(data.projects.map((p: { id: string }) => p.id)).toEqual(['mine']);
  });

  it('narrows to a project in the asker’s scope', async () => {
    use(TEAM);
    const res = await app.inject({ method: 'GET', url: `${url}&projectId=rig`, headers: await ADMIN() });
    expect(res.json().data.projectId).toBe('rig');
  });

  it('refuses a missing or unreal week (400) and needs a sign-in (401)', async () => {
    for (const q of ['', '?week=2026-02-30', '?week=next']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/workload${q}`, headers: await ADMIN() });
      expect(res.statusCode, q).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });

  it('refuses a week more than two years away, and extreme years, with a plain 400 — never a 500', async () => {
    for (const week of ['2028-11-05', '2024-10-20', '0000-01-02', '9999-12-26', '0001-01-01']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/workload?week=${week}`, headers: await ADMIN() });
      expect(res.statusCode, week).toBe(400);
      expect(res.json().error.message, week).toBe('Pick a week within two years of today.');
    }
    expect(workloadStore.calls).toHaveLength(0);
  });

  it('only an administrator may change the daily limit, and the page then shows it', async () => {
    const put = (headers: Record<string, string>, value: unknown) =>
      app.inject({ method: 'PUT', url: '/api/v1/system-settings/workload.dailyLimit', headers, payload: { value } });
    expect((await put(await EMPLOYEE(), 8)).statusCode).toBe(403);
    expect((await put(await ADMIN(), 51)).statusCode).toBe(400);
    expect((await put(await ADMIN(), 8)).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url, headers: await EMPLOYEE() });
    expect(res.json().data.limit).toBe(8);
  });
});
