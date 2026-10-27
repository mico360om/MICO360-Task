import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { inspectPdf } from '../../lib/pdf-inspect';
import { createManagementService } from './management-service';
import { parseManagementFilters } from './management-routes';
import { fakeManagementSource, fakeWorkloadFor, type FakeManagementData } from './management-source.fixture';

const NOW = new Date('2026-10-27T06:00:00.000Z');
const DATA: FakeManagementData = {
  users: [
    { id: 'sara', name: 'Sara Ahmed' },
    { id: 'omar', name: 'Omar Ahmed' },
    { id: 'zara', name: 'Zara Ahmed' },
  ],
  projects: [
    { id: 'rig', name: 'Rig Inspection Portal', status: 'ACTIVE', managerId: 'sara', members: ['zara'] },
    { id: 'mico', name: 'MICO360 Platform', status: 'ACTIVE', ownerId: 'omar' },
    { id: 'arab', name: 'مشروع الحفر', status: 'PLANNING', ownerId: 'omar' },
  ],
  tasks: [
    { id: 'r1', projectId: 'rig', title: 'Handover', due: '2026-10-24', milestone: true, assignees: ['zara'] },
    { id: 'c1', projectId: 'rig', formId: 'F1', due: '2026-10-22', assignees: ['zara'] },
    { id: 'c2', projectId: 'rig', formId: 'F1', due: '2026-10-23', assignees: ['zara'] },
    { id: 'c3', projectId: 'rig', formId: 'F1', due: '2026-10-26', assignees: ['zara'] },
    { id: 'm1', projectId: 'mico', due: '2026-10-26', assignees: ['omar'], createdAt: '2026-10-20T08:00:00.000Z' },
  ],
  inspections: [
    {
      id: 'in1',
      projectId: 'rig',
      formId: 'F1',
      title: 'Rig daily check',
      finishedAt: '2026-10-20T08:00:00.000Z',
      passed: 8,
      failed: 2,
      failedItems: ['valve'],
      structure: { sections: [{ id: 's', title: 'S', items: [{ id: 'valve', kind: 'CHECK', label: 'Valve sealed' }] }] },
    },
  ],
  actions: [{ id: 'a1', projectId: 'rig', assigneeId: 'zara', due: '2026-10-20', meetingId: 'mt1', description: 'Order hoses' }],
};

const tokenService = createTokenService({
  accessSecret: 'mgmt-access',
  refreshSecret: 'mgmt-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const auth = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

async function makeApp(opts: { pdfsPerMinute?: number } = {}) {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const service = createManagementService({
    source: fakeManagementSource(DATA),
    workload: fakeWorkloadFor(DATA),
    settings: { companyWeekStart: async () => 0, workingHours: async () => ({ days: [0, 1, 2, 3, 4] }), dailyLimit: async () => 5 },
    timeZone: 'Asia/Muscat',
    now: () => NOW,
  });
  return buildApp({
    authService,
    tokenService,
    management: { service, timeZone: 'Asia/Muscat', userName: async (id) => ({ admin: 'Aisha Khan', sara: 'Sara Ahmed' } as Record<string, string>)[id] ?? null, ...opts },
  });
}

describe('parseManagementFilters: the filters as the page puts them in the address', () => {
  it('reads projects, owner, statuses and weeks, with the defaults', () => {
    expect(parseManagementFilters({})).toEqual({ projectIds: [], ownerId: null, statuses: ['PLANNING', 'ACTIVE', 'ON_HOLD'], weeks: 12 });
    expect(parseManagementFilters({ projectIds: 'a,b,a', ownerId: 'u1', status: 'ACTIVE,ARCHIVED', weeks: '26' })).toEqual({ projectIds: ['a', 'b'], ownerId: 'u1', statuses: ['ACTIVE', 'ARCHIVED'], weeks: 26 });
    expect(parseManagementFilters({ status: '' }).statuses).toEqual(['PLANNING', 'ACTIVE', 'ON_HOLD']);
  });

  it('refuses anything else in plain words (400)', () => {
    for (const q of [{ weeks: '13' }, { status: 'ACTIVE,DONE' }, { projectIds: 'a b' }, { ownerId: '<x>' }, { projectIds: Array.from({ length: 101 }, (_, i) => `p${i}`).join(',') }]) {
      expect(() => parseManagementFilters(q), JSON.stringify(q).slice(0, 40)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
});

describe('Management routes', () => {
  it('signed out: 401 everywhere', async () => {
    const app = await makeApp();
    for (const url of ['/api/v1/management/access', '/api/v1/management/overview', '/api/v1/management/items?metric=late-tasks', '/api/v1/management/overview.pdf']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });

  it('access: an admin sees everything, a runner theirs, anyone else is told no (and gets 403 from the rest)', async () => {
    const app = await makeApp();
    const get = async (url: string, who: Record<string, string>) => app.inject({ method: 'GET', url, headers: who });
    expect((await get('/api/v1/management/access', await auth('admin', ['ADMIN']))).json().data).toEqual({ allowed: true, scope: 'ALL' });
    expect((await get('/api/v1/management/access', await auth('sara', ['EMPLOYEE']))).json().data).toEqual({ allowed: true, scope: 'RUN' });
    const zara = await auth('zara', ['EMPLOYEE']);
    expect((await get('/api/v1/management/access', zara)).json().data).toEqual({ allowed: false, scope: null });
    for (const url of ['/api/v1/management/overview', '/api/v1/management/items?metric=late-tasks', '/api/v1/management/overview.pdf']) {
      expect((await get(url, zara)).statusCode, url).toBe(403);
    }
  });

  it('overview: an admin gets every project; a runner only theirs and a 404 for another project’s id', async () => {
    const app = await makeApp();
    const admin = await app.inject({ method: 'GET', url: '/api/v1/management/overview?weeks=4', headers: await auth('admin', ['ADMIN']) });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().data.projects.map((p: { id: string }) => p.id)).toEqual(['rig', 'mico', 'arab']);
    expect(admin.json().data.trends).toHaveLength(4);
    const sara = await auth('sara', ['EMPLOYEE']);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/management/overview', headers: sara });
    expect(mine.json().data.projects.map((p: { id: string }) => p.id)).toEqual(['rig']);
    const theirs = await app.inject({ method: 'GET', url: '/api/v1/management/overview?projectIds=rig,mico', headers: sara });
    expect(theirs.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/management/overview?weeks=5', headers: sara })).statusCode).toBe(400);
  });

  it('items: the list behind a number, only inside the caller’s scope', async () => {
    const app = await makeApp();
    const sara = await auth('sara', ['EMPLOYEE']);
    const missing = await app.inject({ method: 'GET', url: '/api/v1/management/items?metric=missing-checks&projectId=rig', headers: sara });
    expect(missing.statusCode).toBe(200);
    expect(missing.json().data).toMatchObject({ metric: 'missing-checks', total: 3, title: 'Missing checks · Rig Inspection Portal' });
    // Omar's late task is in MICO, which Sara doesn't run: asked for by its project it is a 404,
    // and asked for as Omar's late work it is simply not there.
    expect((await app.inject({ method: 'GET', url: '/api/v1/management/items?metric=late-tasks&projectId=mico', headers: sara })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/management/items?metric=late-tasks&personId=omar', headers: sara })).json().data.rows).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/management/items?metric=late-tasks&projectIds=mico', headers: sara })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/management/items?metric=nope', headers: sara })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/management/items', headers: sara })).statusCode).toBe(400);
  });

  it('PDF: a branded download named by the server, with the filters in words, the marks as words, and page numbers', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/management/overview.pdf?weeks=4', headers: await auth('admin', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="management-overview-2026-10-27.pdf"');
    expect(res.headers['cache-control']).toBe('no-store');
    const text = inspectPdf(res.rawPayload).pages.flat().join('\n');
    // Each mark is one whole line, "•\u00A0Red" (a no-break space keeps the dot with its word; never "• Ambe" / "r").
    const lines = inspectPdf(res.rawPayload).pages.flat();
    for (const mark of ['•\u00A0Red', '•\u00A0Amber', '•\u00A0Green']) expect(lines, mark).toContain(mark);
    for (const s of [
      'Management overview',
      'All projects',
      'Projects: All · Owner: Anyone · Status: Planning, Active, On hold · Period: last 4 weeks (4 Oct – 27 Oct 2026)',
      'Generated 27 Oct 2026, 10:00 (Asia/Muscat) by Aisha Khan',
      'Project health',
      'Rig Inspection Portal',
      'Milestone “Handover” is 3 days late',
      'مشروع الحفر',
      'Inspections',
      'Valve sealed',
      'People and workload',
      'Zara Ahmed',
      'Trends',
      'Page 1 of',
    ]) {
      expect(text, s).toContain(s);
    }
  });

  it('PDF: one project chosen is in the file name; a runner’s copy says it is their projects', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/management/overview.pdf?projectIds=rig', headers: await auth('sara', ['EMPLOYEE']) });
    expect(res.headers['content-disposition']).toBe('attachment; filename="management-overview-rig-inspection-portal-2026-10-27.pdf"');
    const text = inspectPdf(res.rawPayload).pages.flat().join('\n');
    expect(text).toContain('Projects you run');
    expect(text).toContain('Projects: Rig Inspection Portal');
    expect(text).not.toContain('MICO360 Platform');
  });

  it('PDF: limited per person a minute', async () => {
    const app = await makeApp({ pdfsPerMinute: 2 });
    const admin = await auth('admin', ['ADMIN']);
    const pdf = () => app.inject({ method: 'GET', url: '/api/v1/management/overview.pdf', headers: admin });
    expect((await pdf()).statusCode).toBe(200);
    expect((await pdf()).statusCode).toBe(200);
    const third = await pdf();
    expect(third.statusCode).toBe(429);
    expect(third.json().error.message).toMatch(/wait a moment/i);
    // Someone else still can.
    expect((await app.inject({ method: 'GET', url: '/api/v1/management/overview.pdf', headers: await auth('sara', ['EMPLOYEE']) })).statusCode).toBe(200);
  });
});
