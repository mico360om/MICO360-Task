import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { applyReportFilter, createReportService, type ReportTask } from './report-service';
import { filterSummary, loadReportBundle, reportSheets } from './report-export';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

// Task archive (bulk lane): reports leave archived tasks out unless "Include archived" is ticked
// (?includeArchived=true on every /reports/* page and export); then they are counted and listed, each
// marked "Archived" in the task list (Excel, PDF).
const ARCHIVED_AT = new Date('2026-11-02T08:00:00Z');
const tasks: ReportTask[] = [
  { id: '1', projectId: 'p1', projectName: 'MICO', columnCategory: 'DONE', columnName: 'Done', key: 'MICO-1', title: 'Live done', createdAt: new Date('2026-10-01'), dueDate: null, completedAt: new Date('2026-10-05'), assigneeIds: ['u1'] },
  { id: '2', projectId: 'p1', projectName: 'MICO', columnCategory: 'TODO', columnName: 'To do', key: 'MICO-2', title: 'Live open', createdAt: new Date('2026-10-01'), dueDate: null, completedAt: null, assigneeIds: ['u1'] },
  { id: '3', projectId: 'p1', projectName: 'MICO', columnCategory: 'DONE', columnName: 'Done', key: 'MICO-3', title: 'Archived done', createdAt: new Date('2026-10-01'), dueDate: null, completedAt: new Date('2026-10-06'), assigneeIds: ['u1'], archivedAt: ARCHIVED_AT },
  { id: '4', projectId: 'p1', projectName: 'MICO', columnCategory: 'TODO', columnName: 'To do', key: 'MICO-4', title: 'Archived open', createdAt: new Date('2026-10-01'), dueDate: new Date('2026-10-02'), completedAt: null, assigneeIds: ['u1'], archivedAt: ARCHIVED_AT },
];

describe('reports and archived tasks', () => {
  it('leaves archived tasks out by default, and keeps them when asked', () => {
    expect(applyReportFilter(tasks).map((t) => t.id)).toEqual(['1', '2']);
    expect(applyReportFilter(tasks, { includeArchived: false }).map((t) => t.id)).toEqual(['1', '2']);
    expect(applyReportFilter(tasks, { includeArchived: true }).map((t) => t.id)).toEqual(['1', '2', '3', '4']);
  });

  it('the task list marks an archived task, in its status and its own field', async () => {
    const svc = createReportService({ data: { async getTasks() { return tasks; }, async getUsers() { return [{ id: 'u1', username: 'ada' }]; } }, now: () => new Date('2026-11-11T08:00:00Z') });
    const plain = await svc.taskListReport({});
    expect(plain.map((r) => r.key)).toEqual(['MICO-2', 'MICO-1']);
    expect(plain.every((r) => !r.archived)).toBe(true);
    const all = await svc.taskListReport({ includeArchived: true });
    const archived = all.find((r) => r.key === 'MICO-3')!;
    expect(archived).toMatchObject({ archived: true, status: 'Done · Archived' });
    // An archived open task is never overdue (it is in nobody's open lists) but is counted when asked.
    expect(all.find((r) => r.key === 'MICO-4')).toMatchObject({ archived: true, overdue: false, status: 'To do · Archived' });
    expect((await svc.completionReport({ includeArchived: true })).total).toBe(4);
    expect((await svc.completionReport({})).total).toBe(2);
  });

  it('the Excel task sheet shows the mark, and the filters line says archived tasks are in', async () => {
    const svc = createReportService({ data: { async getTasks() { return tasks; }, async getUsers() { return []; } } });
    const bundle = await loadReportBundle(svc, { filter: { includeArchived: true }, from: '2026-10-01', to: '2026-10-31' });
    const meta = { title: 'Tasks report', generatedAt: new Date(), timeZone: 'Asia/Muscat', from: '2026-10-01', to: '2026-10-31', includeArchived: true };
    const sheet = reportSheets(bundle, meta, ['tasks']).find((s) => s.name === 'Tasks')!;
    expect(sheet.rows.map((r) => r[3])).toContain('Done · Archived');
    expect(filterSummary(meta, ['tasks'])).toContain('Archived tasks included');
    expect(filterSummary({ ...meta, includeArchived: false }, ['tasks'])).not.toContain('Archived');
  });
});

const tokenService = createTokenService({
  accessSecret: 'rep-arch-access',
  refreshSecret: 'rep-arch-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

describe('report routes: ?includeArchived', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    const reportService = createReportService({ data: { async getTasks() { return tasks; }, async getUsers() { return [{ id: 'u1', username: 'ada' }]; } } });
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    app = await buildApp({ authService, tokenService, reportService });
  });
  const get = async (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'admin', roles: ['ADMIN'] })).accessToken}` } });

  it('every report page leaves archived tasks out unless asked', async () => {
    expect((await get('/reports/completion')).json().data.total).toBe(2);
    expect((await get('/reports/completion?includeArchived=true')).json().data.total).toBe(4);
    expect((await get('/reports/projects?includeArchived=true')).json().data[0].total).toBe(4);
    expect((await get('/reports/status?includeArchived=false')).json().data).toEqual({ DONE: 1, TODO: 1 });
    expect((await get('/reports/workload?includeArchived=true')).json().data[0].assigned).toBe(4);
    expect((await get('/reports/completion?includeArchived=maybe')).statusCode).toBe(400);
  });

  it('the exports follow it too', async () => {
    const plain = await get('/reports/projects.csv');
    expect(plain.body).toContain(',2,');
    const all = await get('/reports/projects.csv?includeArchived=true');
    expect(all.body).toContain(',4,');
    expect((await get('/reports/export.xlsx?includeArchived=true&sections=tasks')).statusCode).toBe(200);
    expect((await get('/reports/timeseries?from=2026-10-01&to=2026-10-10&includeArchived=true')).json().data.points[0]).toBeTruthy();
  });
});
