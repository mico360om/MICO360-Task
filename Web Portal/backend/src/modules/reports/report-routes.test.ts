import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createReportService, type ReportTask } from './report-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { inspectXlsx } from '../../lib/xlsx-inspect';
import { inspectPdf } from '../../lib/pdf-inspect';

const tasks: ReportTask[] = [
  { id: '1', projectId: 'p1', projectName: 'MICO', columnCategory: 'DONE', createdAt: new Date('2000-01-01'), dueDate: null, completedAt: new Date(), assigneeIds: ['u1'] },
  { id: '2', projectId: 'p1', projectName: 'MICO', columnCategory: 'TODO', createdAt: new Date('2000-01-01'), dueDate: null, completedAt: null, assigneeIds: ['u1'] },
  { id: '3', projectId: 'p2', projectName: 'RIG', columnCategory: 'TODO', createdAt: new Date('2001-01-01'), dueDate: null, completedAt: null, assigneeIds: ['u2'] },
];
/** CSV lines, ignoring a leading byte-order mark (U+FEFF, added for Excel). */
const csvLines = (body: string) => (body.charCodeAt(0) === 0xfeff ? body.slice(1) : body).split('\r\n');

const tokenService = createTokenService({
  accessSecret: 'rep-access',
  refreshSecret: 'rep-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const reportService = createReportService({
    data: { async getTasks() { return tasks; }, async getUsers() { return [{ id: 'u1', username: 'ada' }, { id: 'u2', username: 'omar' }]; } },
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const reportNames = {
    async project(id: string) { return ({ p1: 'MICO360 Platform', p2: 'Rig Inspection Portal' } as Record<string, string>)[id] ?? null; },
    async user(id: string) { return ({ admin: 'Aisha Khan', u2: 'Omar Ahmed' } as Record<string, string>)[id] ?? null; },
  };
  return buildApp({ authService, tokenService, reportService, reportNames });
}
async function token(roles: string[]) {
  return (await tokenService.issueTokens({ id: 'admin', roles })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Report routes (admin only)', () => {
  it('returns the project performance report to an admin (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].total).toBe(2);
    expect(res.json().data[0].completionPct).toBe(50);
  });

  it('forbids an employee (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(403);
  });

  it('names every CSV / .xls download like the other exports: report, filters, day', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const csv = await app.inject({ method: 'GET', url: '/api/v1/reports/workload.csv?userId=u2', headers: admin });
    expect(csv.headers['content-disposition']).toMatch(/filename="user-workload-omar-ahmed-\d{4}-\d{2}-\d{2}\.csv"/);
    const xls = await app.inject({ method: 'GET', url: '/api/v1/reports/status.xls?projectId=p1', headers: admin });
    expect(xls.headers['content-disposition']).toMatch(/filename="status-breakdown-mico360-platform-\d{4}-\d{2}-\d{2}\.xls"/);
    const trend = await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries.csv?from=2000-01-01&to=2000-01-02', headers: admin });
    expect(trend.headers['content-disposition']).toMatch(/filename="completion-trend-\d{4}-\d{2}-\d{2}\.csv"/);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/status' });
    expect(res.statusCode).toBe(401);
  });

  it('exports the project performance report as a CSV download (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects.csv', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="project-performance-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = csvLines(res.body);
    expect(lines[0]).toBe('projectId,projectName,total,completed,overdue,completionPct');
    expect(lines[1]).toBe('p1,MICO,2,1,0,50');
  });

  it('applies the on-screen project and team filters to reports and every export', async () => {
    const admin = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const projects = await app.inject({ method: 'GET', url: '/api/v1/reports/projects?projectId=p2', headers: admin });
    expect(projects.json().data.map((r: { projectId: string }) => r.projectId)).toEqual(['p2']);

    const csv = await app.inject({ method: 'GET', url: '/api/v1/reports/projects.csv?projectId=p2', headers: admin });
    expect(csvLines(csv.body).filter(Boolean).slice(1)).toEqual(['p2,RIG,1,0,0,0']);

    const workload = await app.inject({ method: 'GET', url: '/api/v1/reports/workload.csv?userId=u2', headers: admin });
    expect(csvLines(workload.body).filter(Boolean).slice(1)).toEqual(['u2,omar,1,0,0']);

    const status = await app.inject({ method: 'GET', url: '/api/v1/reports/status.xls?projectId=p1&userId=u1', headers: admin });
    expect(status.statusCode).toBe(200);
    expect(status.body).toContain('DONE');

    const series = await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries.csv?from=2000-01-01&to=2000-01-01&userId=u2', headers: admin });
    expect(csvLines(series.body)[1]).toBe('2000-01-01,0,0,0,0,0');
  });

  it('rejects impossible calendar dates in a range (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries?from=2000-02-30&to=2000-03-01', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(400);
  });

  it('forbids an employee from the CSV export (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/workload.csv', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(403);
  });

  it('exports an Excel (SpreadsheetML) workbook (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects.xls', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.ms-excel');
    expect(res.headers['content-disposition']).toMatch(/project-performance-\d{4}-\d{2}-\d{2}\.xls"/);
    expect(res.body).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(res.body).toContain('ss:Name="Project Performance"');
    expect(res.body).toContain('<Data ss:Type="Number">2</Data>'); // total = 2
  });

  it('exports a PDF (200) with a valid envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects.pdf', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/project-performance-\d{4}-\d{2}-\d{2}\.pdf/);
    const body = res.rawPayload.toString('latin1');
    expect(body.startsWith('%PDF-1.')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
    // A branded single-section report: the logo header, the section and its rows.
    const text = inspectPdf(res.rawPayload).pages.flat();
    expect(text).toEqual(expect.arrayContaining(['Project performance', 'Project', 'MICO', 'RIG']));
  });

  it('exports the full report as an Excel workbook: one sheet per section, filters and author noted', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/export.xlsx?projectId=p1', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="tasks-report-mico360-platform-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(res.headers['cache-control']).toBe('no-store');
    const { sheets, text } = inspectXlsx(res.rawPayload);
    expect(sheets).toEqual(['Summary', 'Status', 'Projects', 'Team workload', 'Trend', 'Tasks']);
    expect(text[0]!.join(' ')).toContain('Project: MICO360 Platform');
    expect(text[0]!.join(' ')).toContain('by Aisha Khan');
    // The project filter applies: only MICO's row.
    expect(text[2]).toContain('MICO');
    expect(text[2]).not.toContain('RIG');
  });

  it('exports the full report as a branded PDF, or just the sections asked for', async () => {
    const auth = { authorization: `Bearer ${await token(['ADMIN'])}` };
    const full = await app.inject({ method: 'GET', url: '/api/v1/reports/export.pdf?userId=u2', headers: auth });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('application/pdf');
    expect(full.headers['content-disposition']).toMatch(/filename="tasks-report-omar-ahmed-\d{4}-\d{2}-\d{2}\.pdf"/);
    const text = inspectPdf(full.rawPayload).pages.flat();
    expect(text).toEqual(expect.arrayContaining(['Tasks report', 'Summary', 'Status breakdown', 'Project performance', 'Team workload', 'Completion trend', 'Tasks']));
    expect(text.join(' ')).toContain('Team member: Omar Ahmed');
    const some = await app.inject({ method: 'GET', url: '/api/v1/reports/export.pdf?sections=summary,tasks', headers: auth });
    const someText = inspectPdf(some.rawPayload).pages.flat();
    expect(someText).toEqual(expect.arrayContaining(['Summary', 'Tasks']));
    expect(someText).not.toContain('Team workload');
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/export.pdf?sections=bogus', headers: auth })).statusCode).toBe(400);
  });

  it('exports each single report as a real .xlsx too', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/workload.xlsx', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/user-workload-\d{4}-\d{2}-\d{2}\.xlsx/);
    expect(inspectXlsx(res.rawPayload).sheets).toEqual(['Team workload']);
  });

  it('keeps the full-report exports admin-only', async () => {
    const emp = `Bearer ${await token(['EMPLOYEE'])}`;
    for (const url of ['/api/v1/reports/export.xlsx', '/api/v1/reports/export.pdf', '/api/v1/reports/projects.xlsx']) {
      expect((await app.inject({ method: 'GET', url, headers: { authorization: emp } })).statusCode, url).toBe(403);
    }
  });

  it('forbids an employee from the Excel and PDF exports (403)', async () => {
    const emp = `Bearer ${await token(['EMPLOYEE'])}`;
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/status.xls', headers: { authorization: emp } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/status.pdf', headers: { authorization: emp } })).statusCode).toBe(403);
  });

  it('returns a daily time series over an explicit range (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/timeseries?from=2000-01-01&to=2000-01-03',
      headers: { authorization: `Bearer ${await token(['ADMIN'])}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.from).toBe('2000-01-01');
    expect(body.to).toBe('2000-01-03');
    expect(body.points.map((p: { date: string }) => p.date)).toEqual(['2000-01-01', '2000-01-02', '2000-01-03']);
    // both fixture tasks were created 2000-01-01
    expect(body.points[0].created).toBe(2);
    expect(Array.isArray(body.velocity)).toBe(true);
  });

  it('defaults to a 30-day window when no range is given (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.points).toHaveLength(30);
  });

  it('rejects an invalid date range (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries?from=2000-02-01&to=2000-01-01', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(400);
  });

  it('forbids an employee from the time series (403) and rejects unauthenticated (401)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries' })).statusCode).toBe(401);
  });

  it('exports the time series as a CSV download (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/timeseries.csv?from=2000-01-01&to=2000-01-02', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/completion-trend-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = csvLines(res.body);
    expect(lines[0]).toBe('date,created,completed,overdue,remaining,ideal');
    expect(lines[1]).toBe('2000-01-01,2,0,0,2,2');
  });
});
