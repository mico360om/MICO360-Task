import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createReportService, type ReportTask } from './report-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

const tasks: ReportTask[] = [
  { id: '1', projectId: 'p1', projectName: 'MICO', columnCategory: 'DONE', createdAt: new Date('2000-01-01'), dueDate: null, completedAt: new Date(), assigneeIds: ['u1'] },
  { id: '2', projectId: 'p1', projectName: 'MICO', columnCategory: 'TODO', createdAt: new Date('2000-01-01'), dueDate: null, completedAt: null, assigneeIds: ['u1'] },
];

const tokenService = createTokenService({
  accessSecret: 'rep-access',
  refreshSecret: 'rep-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const reportService = createReportService({
    data: { async getTasks() { return tasks; }, async getUsers() { return [{ id: 'u1', username: 'ada' }]; } },
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, reportService });
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

  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/status' });
    expect(res.statusCode).toBe(401);
  });

  it('exports the project performance report as a CSV download (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects.csv', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="project-performance.csv"');
    const lines = res.body.split('\r\n');
    expect(lines[0]).toBe('projectId,projectName,total,completed,overdue,completionPct');
    expect(lines[1]).toBe('p1,MICO,2,1,0,50');
  });

  it('forbids an employee from the CSV export (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/workload.csv', headers: { authorization: `Bearer ${await token(['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(403);
  });

  it('exports an Excel (SpreadsheetML) workbook (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects.xls', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.ms-excel');
    expect(res.headers['content-disposition']).toContain('project-performance.xls');
    expect(res.body).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(res.body).toContain('ss:Name="Project Performance"');
    expect(res.body).toContain('<Data ss:Type="Number">2</Data>'); // total = 2
  });

  it('exports a PDF (200) with a valid envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/projects.pdf', headers: { authorization: `Bearer ${await token(['ADMIN'])}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('project-performance.pdf');
    const body = res.rawPayload.toString('latin1');
    expect(body.startsWith('%PDF-1.')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(body).toContain('(Project Performance) Tj');
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
    expect(res.headers['content-disposition']).toContain('completion-trend.csv');
    const lines = res.body.split('\r\n');
    expect(lines[0]).toBe('date,created,completed,overdue,remaining,ideal');
    expect(lines[1]).toBe('2000-01-01,2,0,0,2,2');
  });
});
