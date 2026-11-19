import { describe, expect, it } from 'vitest';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createAuthGuard } from '../auth/auth-guard';
import { readPdfText } from '../../lib/pdf-read-text';

// "Download PDF" on the Workspace pages (1.24.3): each PDF asks the page's own data route as the caller.
// Here the pages' routes are stand-ins that record what they were asked and refuse whom the page refuses;
// the PDF routes are the real ones, wired by buildApp.
const tokenService = createTokenService({
  accessSecret: 'pdf-access',
  refreshSecret: 'pdf-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const as = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const FILE = (name: string) => new RegExp(`^attachment; filename="${name} \\d{4}-\\d{2}-\\d{2}\\.pdf"$`);

type Page = (req: FastifyRequest) => unknown;
interface Asked {
  url: string;
  user: string;
  company?: string;
}

/** The app with stand-in page routes: `pages` maps 'GET /path' to its answer; a user named "outsider" is refused (403) as a page would. */
async function app(pages: Record<string, Page>): Promise<{ a: FastifyInstance; asked: Asked[] }> {
  const asked: Asked[] = [];
  const a = await buildApp({ authService, tokenService, reportNames: { project: async () => null, user: async () => 'Omar Said' } });
  const guard = createAuthGuard(tokenService);
  await a.register(
    async (api) => {
      for (const [key, answer] of Object.entries(pages)) {
        const path = key.slice(4);
        api.get(path, { preHandler: guard.authenticate }, async (req, reply) => {
          asked.push({ url: req.url, user: req.user!.id, ...(typeof req.headers['x-company-id'] === 'string' ? { company: req.headers['x-company-id'] } : {}) });
          if (req.user!.id === 'outsider') return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You can’t see this.' } });
          if (req.user!.id === 'nobody') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Project not found.' } });
          return { data: answer(req) };
        });
      }
    },
    { prefix: '/api/v1' },
  );
  return { a, asked };
}

const textOf = (body: Buffer) => readPdfText(body).text.replace(/\s+/g, ' ');

// ── Workload ────────────────────────────────────────────────────────────────
const cell = (date: string, count: number, limit = 5) => ({ date, count, limit, over: Math.max(0, count - limit), tasks: [] });
const WEEK = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
const workload = {
  week: WEEK[0],
  today: '2026-11-19',
  days: WEEK.map((date, i) => ({ date, working: i < 5 })),
  limit: 5,
  canChangeLimit: true,
  scope: 'everyone',
  projectId: 'p1',
  projects: [{ id: 'p1', code: 'CON', name: 'Contoso Tower' }],
  people: [
    { id: 'u2', name: 'Mariam Al Balushi', overdue: 0, total: 3, weekLimit: 25, days: WEEK.map((d, i) => cell(d, i === 1 ? 3 : 0, i < 5 ? 5 : 0)) },
    { id: 'u1', name: 'Omar Said', overdue: 2, total: 9, weekLimit: 25, days: WEEK.map((d, i) => cell(d, i === 2 ? 7 : i === 3 ? 2 : 0, i < 5 ? 5 : 0)) },
  ],
};

describe('GET /workload.pdf', () => {
  it('asks the Workload route with the same week and project as the caller, and prints its table, most overloaded first', async () => {
    const { a, asked } = await app({ 'GET /workload': () => workload });
    const res = await a.inject({ method: 'GET', url: '/api/v1/workload.pdf?week=2026-11-15&projectId=p1', headers: { ...(await as('mgr')), 'x-company-id': 'c1' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(FILE('Workload'));
    expect(res.headers['cache-control']).toBe('no-store');
    expect(asked).toEqual([{ url: '/api/v1/workload?week=2026-11-15&projectId=p1', user: 'mgr', company: 'c1' }]);
    const text = textOf(res.rawPayload);
    expect(text).toContain('Workload');
    expect(text).toContain('Project: Contoso Tower (CON)');
    expect(text).toContain('Daily limit: 5');
    expect(text.indexOf('Omar Said')).toBeGreaterThan(-1);
    expect(text.indexOf('Omar Said')).toBeLessThan(text.indexOf('Mariam Al Balushi'));
    expect(text).toContain('9 due · limit 25 · room for 16');
    expect(text).toContain('Printed');
    expect(text).toContain('by Omar Said');
  });

  it('"Find a person" narrows the rows as on the page', async () => {
    const { a } = await app({ 'GET /workload': () => workload });
    const res = await a.inject({ method: 'GET', url: '/api/v1/workload.pdf?week=2026-11-15&q=mariam', headers: await as('mgr') });
    const text = textOf(res.rawPayload);
    expect(text).toContain('Mariam Al Balushi');
    expect(text).not.toContain('Omar Said ');
    expect(text).toContain('Find: “mariam”');
  });

  it('has the page’s access: its 403 and 404 are the PDF’s; a client account and a signed-out caller are refused', async () => {
    const { a, asked } = await app({ 'GET /workload': () => workload });
    expect((await a.inject({ method: 'GET', url: '/api/v1/workload.pdf?week=2026-11-15', headers: await as('outsider') })).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/api/v1/workload.pdf?week=2026-11-15', headers: await as('nobody') })).statusCode).toBe(404);
    const client = await a.inject({ method: 'GET', url: '/api/v1/workload.pdf?week=2026-11-15', headers: await as('cl', ['CLIENT']) });
    expect(client.statusCode).toBe(403);
    expect(client.json().error.code).toBe('CLIENT_NOT_ALLOWED');
    expect((await a.inject({ method: 'GET', url: '/api/v1/workload.pdf?week=2026-11-15' })).statusCode).toBe(401);
    expect(asked.map((x) => x.user)).toEqual(['outsider', 'nobody']);
  });

  it('a person gets at most 10 page PDFs a minute', async () => {
    const { a } = await app({ 'GET /workload': () => workload });
    const h = await as('busy');
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await a.inject({ method: 'GET', url: '/api/v1/workload.pdf?week=2026-11-15', headers: h })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

// ── Timeline ────────────────────────────────────────────────────────────────
const tproject = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: id.toUpperCase(),
  name,
  color: '#2F6DB5',
  owner: { id: 'u1', name: 'Omar Said' },
  start: '2026-10-01',
  target: '2026-12-20',
  tasks: { total: 10, done: 4, open: 6, overdue: 0 },
  progress: 40,
  timeUsed: 60,
  health: 'on-track',
  daysLate: 0,
  milestones: [{ id: 'm1', key: `${id.toUpperCase()}-9`, title: 'Handover', date: '2026-12-01', done: false }],
  milestonesSoon: 1,
  meetings: [],
  meetingsThisWeek: 0,
  ...extra,
});
const timeline = {
  from: '2026-11-01',
  to: '2026-12-26',
  today: '2026-11-19',
  weeks: Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i * 7)).toISOString().slice(0, 10)),
  projects: [tproject('con', 'Contoso Tower'), tproject('fab', 'Fabrikam Mall', { health: 'late', daysLate: 4, target: '2026-11-15', owner: { id: 'u2', name: 'Mariam' } }), tproject('nwt', 'Northwind Depot', { health: 'at-risk' })],
};

describe('GET /timeline.pdf', () => {
  it('prints the projects the page shows — owner, Late / At risk and sort applied — and opened projects’ task rows', async () => {
    const { a, asked } = await app({
      'GET /timeline': () => timeline,
      'GET /timeline/projects/:id/tasks': () => ({ projectId: 'con', matched: 1, tasks: [{ id: 't1', key: 'CON-12', title: 'Pour the slab', start: '2026-11-10', due: '2026-11-25', done: false, overdue: false, priority: 'HIGH', isMilestone: false }] }),
    });
    const res = await a.inject({ method: 'GET', url: '/api/v1/timeline.pdf?from=2026-11-01&to=2026-12-26&weekStart=0&owner=u1&sort=name&expanded=con,fab', headers: await as('mgr') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(FILE('Timeline'));
    expect(asked.map((x) => x.url)).toEqual(['/api/v1/timeline?from=2026-11-01&to=2026-12-26&weekStart=0', '/api/v1/timeline/projects/con/tasks?from=2026-11-01&to=2026-12-26', '/api/v1/timeline/projects/fab/tasks?from=2026-11-01&to=2026-12-26']);
    const text = textOf(res.rawPayload);
    expect(text).toContain('Owner: Omar Said');
    expect(text).toContain('Contoso Tower');
    expect(text).toContain('Northwind Depot');
    expect(text).not.toContain('Fabrikam Mall'); // another owner's
    expect(text.indexOf('Contoso Tower')).toBeLessThan(text.indexOf('Northwind Depot')); // by name
    expect(text).toContain('CON-12 · Pour the slab');
  });

  it('"Late" shows only the late projects; a refusal by the page is the PDF’s', async () => {
    const { a } = await app({ 'GET /timeline': () => timeline });
    const text = textOf((await a.inject({ method: 'GET', url: '/api/v1/timeline.pdf?from=2026-11-01&to=2026-12-26&show=late', headers: await as('mgr') })).rawPayload);
    expect(text).toContain('Fabrikam Mall');
    expect(text).not.toContain('Contoso Tower');
    expect(text).toContain('4 days late');
    expect((await a.inject({ method: 'GET', url: '/api/v1/timeline.pdf?from=2026-11-01&to=2026-12-26', headers: await as('outsider') })).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/api/v1/timeline.pdf?from=2026-11-01&to=2026-12-26', headers: await as('cl', ['CLIENT']) })).statusCode).toBe(403);
  });
});

// ── Calendar ────────────────────────────────────────────────────────────────
const task = (id: string, key: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  key,
  title,
  projectId: 'p1',
  columnId: 'c-todo',
  columnCategory: 'TODO',
  priority: 'NORMAL',
  startDate: null,
  dueDate: '2026-11-20',
  progress: 0,
  assignees: [{ id: 'u1', name: 'Omar Said' }],
  ...extra,
});
const PROJECTS = [{ id: 'p1', code: 'CON', name: 'Contoso Tower', color: '#2F6DB5' }, { id: 'p2', code: 'FAB', name: 'Fabrikam Mall', color: '#7C56B4' }];

describe('POST /calendar.pdf', () => {
  const month = { view: 'month', from: '2026-11-01', to: '2026-12-05' };
  const pages = {
    'GET /calendar': () => ({ from: '2026-11-01', to: '2026-12-05', tasks: [task('t1', 'CON-1', 'Order the steel'), ...Array.from({ length: 9 }, (_, i) => task(`b${i}`, `CON-${10 + i}`, `Busy task ${i}`, { dueDate: '2026-11-24' }))], spanning: [], series: [] }),
    'GET /meetings': () => [{ id: 'm1', title: 'Site walk', startAt: '2026-11-20T06:00:00.000Z', endAt: '2026-11-20T07:00:00.000Z', status: 'SCHEDULED', projectId: 'p1' }],
    'GET /projects': () => PROJECTS,
  };

  it('prints the month grid with the items the page names — only those the calendar holds for this person — and lists a full day after it', async () => {
    const { a, asked } = await app(pages);
    const days = [
      { day: '2026-11-20', items: [{ kind: 'task', id: 't1' }, { kind: 'meeting', id: 'm1' }, { kind: 'task', id: 'secret' }] },
      { day: '2026-11-24', items: Array.from({ length: 9 }, (_, i) => ({ kind: 'task', id: `b${i}` })) },
      { day: '2027-01-02', items: [{ kind: 'task', id: 't1' }] },
    ];
    const res = await a.inject({ method: 'POST', url: '/api/v1/calendar.pdf', headers: await as('mgr'), payload: { ...month, team: true, filters: ['Project: Contoso Tower'], days } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(FILE('Calendar'));
    expect(asked.map((x) => x.url)).toContain('/api/v1/calendar?from=2026-11-01&to=2026-12-05&team=1');
    const text = textOf(res.rawPayload);
    expect(text).toContain('November 2026 · Month view');
    expect(text).toContain('Project: Contoso Tower');
    expect(text).toContain('CON-1 Order the steel');
    expect(text).toContain('10:00 Site walk'); // company time (Muscat)
    expect(text).toMatch(/\+\d+ more/);
    expect(text).toContain('Days with more than their box shows');
    expect(text).toContain('Busy task 8');
    expect(text).not.toContain('secret');
  });

  it('the agenda is a list by day; the page’s refusal is the PDF’s', async () => {
    const { a } = await app(pages);
    const res = await a.inject({ method: 'POST', url: '/api/v1/calendar.pdf', headers: await as('mgr'), payload: { view: 'agenda', from: '2026-11-19', to: '2026-11-25', days: [{ day: '2026-11-20', items: [{ kind: 'task', id: 't1' }] }] } });
    const text = textOf(res.rawPayload);
    expect(text).toContain('Fri 20 Nov 2026 · 1 item');
    expect(text).toContain('Contoso Tower · To do');
    expect((await a.inject({ method: 'POST', url: '/api/v1/calendar.pdf', headers: await as('outsider'), payload: { ...month, days: [] } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: '/api/v1/calendar.pdf', headers: await as('mgr'), payload: { view: 'year', from: '2026-11-01', to: '2026-11-02', days: [] } })).statusCode).toBe(400);
  });
});

// ── Projects ────────────────────────────────────────────────────────────────
const overview = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: id.toUpperCase(),
  number: null,
  name,
  clientName: 'Contoso',
  status: 'ACTIVE',
  color: '#2F6DB5',
  targetDate: '2026-12-31',
  stats: { total: 10, done: 5, open: 5, overdue: 1, nextDue: '2026-11-20', lastActivityAt: '2026-11-18T08:00:00.000Z' },
  owner: { id: 'u1', name: 'Omar Said' },
  health: { rag: 'AMBER', completion: { mode: 'COUNT', pct: 50 }, accountable: { name: 'Mariam', role: 'MANAGER' } },
  ...extra,
});

describe('POST /projects/overview.pdf', () => {
  it('prints the cards the page shows, in its order, and nothing the overview doesn’t hold', async () => {
    const { a, asked } = await app({ 'GET /projects/overview': () => [overview('con', 'Contoso Tower'), overview('fab', 'Fabrikam Mall', { health: undefined }), overview('nwt', 'Northwind Depot')] });
    const res = await a.inject({ method: 'POST', url: '/api/v1/projects/overview.pdf', headers: await as('mgr'), payload: { all: true, tab: 'active', ids: ['nwt', 'ghost', 'con'], filters: ['Search: “tower”', 'Sort: Name'] } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(FILE('Projects'));
    expect(asked.map((x) => x.url)).toEqual(['/api/v1/projects/overview?all=1']);
    const text = textOf(res.rawPayload);
    expect(text).toContain('Active · 2 projects');
    expect(text).toContain('Search: “tower”');
    expect(text.indexOf('Northwind Depot')).toBeLessThan(text.indexOf('Contoso Tower'));
    expect(text).not.toContain('Fabrikam Mall');
    expect(text).toContain('Amber');
    expect(text).toContain('50% done · 5 of 10 tasks');
    expect(text).toContain('Manager: Mariam');
    expect((await a.inject({ method: 'POST', url: '/api/v1/projects/overview.pdf', headers: await as('cl', ['CLIENT']), payload: { ids: [] } })).statusCode).toBe(403);
  });
});

// ── Kanban Board ────────────────────────────────────────────────────────────
const COLUMNS = [
  { id: 'c-todo', name: 'To do', category: 'TODO', position: 0, color: '#5B6C82', enabled: true },
  { id: 'c-doing', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '#2F6DB5', enabled: true },
  { id: 'c-off', name: 'Parked', category: 'BACKLOG', position: 2, color: '#8F8580', enabled: false },
];

describe('POST /board.pdf', () => {
  const many = Array.from({ length: 40 }, (_, i) => task(`k${i}`, `CON-${100 + i}`, `Long column card ${i}`, { columnId: 'c-todo' }));
  const pages = {
    'GET /tasks': () => [task('t1', 'CON-1', 'Order the steel', { columnId: 'c-doing', columnCategory: 'IN_PROGRESS', priority: 'URGENT', dueDate: '2026-11-02' }), task('t2', 'CON-2', 'Parked idea', { columnId: 'c-off' }), ...many],
    'GET /projects/:id/columns': () => COLUMNS,
    'GET /projects': () => PROJECTS,
  };

  it('a project board: its shown columns and cards from the board’s own answer, a long column over several pages', async () => {
    const { a, asked } = await app(pages);
    const payload = {
      projectId: 'p1',
      date: '2026-11-19',
      filters: ['Search: “steel”'],
      columns: [
        { id: 'c-todo', keys: many.map((t) => t.key) },
        { id: 'c-doing', keys: ['CON-1', 'CON-999'] },
        { id: 'c-off', keys: ['CON-2'] },
      ],
    };
    const res = await a.inject({ method: 'POST', url: '/api/v1/board.pdf', headers: await as('mgr'), payload });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(FILE('Kanban Board'));
    expect(asked.map((x) => x.url)).toContain('/api/v1/tasks?projectId=p1&boardDate=2026-11-19');
    expect(asked.map((x) => x.url)).toContain('/api/v1/projects/p1/columns');
    const pdf = readPdfText(res.rawPayload);
    const text = pdf.text.replace(/\s+/g, ' ');
    expect(text).toContain('Contoso Tower (CON) · Thu 19 Nov 2026');
    expect(text).toContain('Order the steel');
    expect(text).toContain('Long column card 39');
    expect(text).not.toContain('Parked idea'); // a hidden column is left out
    expect(text).not.toContain('CON-999');
    expect(pdf.pages).toBeGreaterThan(1);
  });

  it('All projects: the six status columns, each card with its project; the page’s refusal is the PDF’s', async () => {
    const { a, asked } = await app(pages);
    const res = await a.inject({ method: 'POST', url: '/api/v1/board.pdf', headers: await as('mgr'), payload: { projectId: 'all', month: '2026-11', columns: [{ id: 'status:IN_PROGRESS', keys: ['CON-1'] }, { id: 'status:TODO', keys: ['CON-1'] }] } });
    expect(res.statusCode).toBe(200);
    expect(asked.map((x) => x.url)).toContain('/api/v1/tasks?month=2026-11&undated=true');
    const text = textOf(res.rawPayload);
    expect(text).toContain('All projects · November 2026');
    expect(text).toContain('CON-1 · Contoso Tower');
    expect(text).toContain('In progress');
    expect((await a.inject({ method: 'POST', url: '/api/v1/board.pdf', headers: await as('outsider'), payload: { projectId: 'p1', columns: [] } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: '/api/v1/board.pdf', headers: await as('mgr'), payload: { projectId: 'p1', date: '2026-11-19', month: '2026-11', columns: [] } })).statusCode).toBe(400);
  });
});

// ── My Tasks ────────────────────────────────────────────────────────────────
describe('POST /tasks/mine.pdf', () => {
  it('prints the page’s groups and rows from My Tasks’ own answer, with status, priority, due and checklist', async () => {
    const { a, asked } = await app({
      'GET /tasks/mine': () => [
        task('t1', 'CON-1', 'Order the steel', { priority: 'URGENT', dueDate: '2026-11-02', counts: { comments: 0, attachments: 0, checklistDone: 2, checklistTotal: 5 } }),
        task('t2', 'FAB-4', 'Check the lifts', { projectId: 'p2', columnCategory: 'IN_PROGRESS', startDate: '2026-12-01', dueDate: '2026-12-05' }),
      ],
      'GET /projects': () => PROJECTS,
    });
    const res = await a.inject({ method: 'POST', url: '/api/v1/tasks/mine.pdf', headers: await as('mgr'), payload: { filters: ['Priority: Urgent'], groups: [{ label: 'Tasks', ids: ['t1', 'nope'] }, { label: 'Upcoming', ids: ['t2', 't1'] }] } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(FILE('My Tasks'));
    expect(asked.map((x) => x.url)).toContain('/api/v1/tasks/mine');
    const text = textOf(res.rawPayload);
    expect(text).toContain('Priority: Urgent');
    expect(text).toContain('Tasks · 1');
    expect(text).toContain('Upcoming · 1');
    expect(text).toContain('CON-1');
    expect(text).toContain('Contoso Tower');
    expect(text).toContain('Fabrikam Mall');
    expect(text).toContain('In progress');
    expect(text).toContain('Overdue');
    expect(text).toContain('2/5');
    expect((await a.inject({ method: 'POST', url: '/api/v1/tasks/mine.pdf', headers: await as('cl', ['CLIENT']), payload: { groups: [] } })).statusCode).toBe(403);
  });
});

// ── My performance ──────────────────────────────────────────────────────────
describe('GET /kpis/people/…/export.pdf', () => {
  const kpis = (id: string) => ({
    person: { id, name: id === 'u1' ? 'Omar Said' : 'Mariam', active: true },
    scope: id === 'mgr' ? 'self' : 'manager',
    projects: [{ id: 'p1', code: 'CON', name: 'Contoso Tower' }],
    period: { label: 'November 2026' },
    today: '2026-11-19',
    trend: { kind: 'month', points: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].map((label, i) => ({ key: label, label, current: i === 5 })) },
    tiles: [
      { metric: 'onTime', label: 'On time', unit: 'percent', direction: 'higher', value: 82, target: 90, light: 'amber', words: 'Close', trend: [70, 75, null, 80, 85, 82] },
      { metric: 'daysLate', label: 'Days late', unit: 'days', direction: 'lower', value: 2, target: 3, light: 'green', words: 'On target', trend: [4, 3, 3, 2, 2, 2] },
    ],
  });

  it('my own: the tiles with their targets, the trend as bars and the projects counted, as the page asks', async () => {
    const { a, asked } = await app({ 'GET /kpis/people/me': () => kpis('mgr'), 'GET /kpis/people/:userId': (req) => kpis((req.params as { userId: string }).userId) });
    const res = await a.inject({ method: 'GET', url: '/api/v1/kpis/people/me/export.pdf?period=custom&from=2026-11-01&to=2026-11-19', headers: await as('mgr') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(FILE('My performance'));
    expect(asked[0]!.url).toBe('/api/v1/kpis/people/me?period=custom&from=2026-11-01&to=2026-11-19');
    const text = textOf(res.rawPayload);
    expect(text).toContain('My performance');
    expect(text).toContain('On time');
    expect(text).toContain('82%');
    expect(text).toContain('At least 90% · Close');
    expect(text).toContain('Trend · last 6 months');
    expect(text).toContain('Contoso Tower (CON)');
  });

  it('a person’s: as their manager sees them; refused as the page refuses; a bad id is a 404', async () => {
    const { a } = await app({ 'GET /kpis/people/:userId': (req) => kpis((req.params as { userId: string }).userId) });
    const res = await a.inject({ method: 'GET', url: '/api/v1/kpis/people/u1/export.pdf', headers: await as('mgr') });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(FILE('Performance'));
    expect(textOf(res.rawPayload)).toContain('Omar Said · Performance');
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/people/u1/export.pdf', headers: await as('outsider') })).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/people/u1/export.pdf', headers: await as('cl', ['CLIENT']) })).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/api/v1/kpis/people/bad%20id/export.pdf', headers: await as('mgr') })).statusCode).toBe(404);
  });
});
