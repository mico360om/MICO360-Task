import { describe, it, expect } from 'vitest';
import { buildApp } from './app';
import { createLogger } from './lib/logger';
import { createReportService } from './modules/reports/report-service';
import { createTokenService } from './modules/auth/token-service';
import { createAuthService } from './modules/auth/auth-service';

const tokenService = createTokenService({ accessSecret: 'app-a', refreshSecret: 'app-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

describe('health + metrics', () => {
  it('reports health with uptime and a timestamp', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.status).toBe('ok');
    expect(typeof d.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(d.timestamp))).toBe(false);
    expect(d.pictureShrinking).toBeNull(); // nothing has checked
  });

  it('says whether attached pictures are made smaller on this server', async () => {
    for (const on of [true, false]) {
      const app = await buildApp({ authService, tokenService, pictureShrinking: () => on });
      expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).json().data.pictureShrinking).toBe(on);
    }
  });

  it('exposes process metrics to admins only', async () => {
    const app = await buildApp({ authService, tokenService });
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics' })).statusCode).toBe(401);
    const member = (await tokenService.issueTokens({ id: 'm1', roles: ['EMPLOYEE'] })).accessToken;
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: { authorization: `Bearer ${member}` } })).statusCode).toBe(403);
    const admin = (await tokenService.issueTokens({ id: 'a1', roles: ['ADMIN'] })).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: { authorization: `Bearer ${admin}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(typeof d.rssMb).toBe('number');
    expect(typeof d.uptimeSeconds).toBe('number');
    expect(d.nodeVersion).toBe(process.version);
  });
});

describe('CORS for trusted origins (the Chrome extension, a separately hosted web app)', () => {
  it('lets a trusted origin edit, move and delete — not only read and create', async () => {
    const app = await buildApp({ authService, tokenService, corsOrigins: ['chrome-extension://abc'] });
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/tasks/t1',
        headers: { origin: 'chrome-extension://abc', 'access-control-request-method': method, 'access-control-request-headers': 'authorization,content-type,idempotency-key' },
      });
      expect(res.statusCode, method).toBe(204);
      expect(String(res.headers['access-control-allow-methods']), method).toContain(method);
      expect(res.headers['access-control-allow-origin']).toBe('chrome-extension://abc');
    }
  });

  it('lets a trusted origin read the file name of an export (Content-Disposition)', async () => {
    const app = await buildApp({ authService, tokenService, corsOrigins: ['chrome-extension://abc'] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin: 'chrome-extension://abc' } });
    expect(String(res.headers['access-control-expose-headers'])).toContain('Content-Disposition');
  });
});

describe('private data: caching and search engines', () => {
  it('API answers are never stored (no-store) and never indexed', async () => {
    const app = await buildApp({ authService, tokenService });
    for (const url of ['/api/v1/health', '/api/v1/config', '/api/v1/tasks/mine']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['cache-control'], url).toBe('no-store');
      expect(res.headers['x-robots-tag'], url).toBe('noindex, nofollow');
    }
  });

  it('uploaded files are never indexed', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/uploads/some-file.pdf' });
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});

describe('public asset CORP headers', () => {
  it('relaxes Cross-Origin-Resource-Policy to cross-origin for /uploads/* so the SPA can embed them from another origin', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/uploads/some-image.png' });
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('relaxes Cross-Origin-Resource-Policy to cross-origin for /email-assets/*', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/email-assets/logo.png' });
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('keeps API responses locked to same-origin CORP', async () => {
    const app = await buildApp({ authService, tokenService });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});

describe('structured error logging', () => {
  it('logs a JSON error entry on a 500 (not raw stack)', async () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'test', sink: (l) => lines.push(l) });
    // A report data source that throws forces a 500 from /reports/status.
    const reportService = createReportService({
      data: { async getTasks() { throw new Error('db down'); }, async getUsers() { return []; } },
    });
    const app = await buildApp({ authService, tokenService, reportService, logger });
    const token = (await tokenService.issueTokens({ id: 'admin', roles: ['ADMIN'] })).accessToken;

    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/status', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toBe('Something went wrong.'); // no stack leaked to client

    const entry = JSON.parse(lines.at(-1)!);
    expect(entry.level).toBe('error');
    expect(entry.url).toBe('/api/v1/reports/status');
    expect(entry.status).toBe(500);
    expect(entry.err.message).toBe('db down');
  });

  it('forwards 500s to the error reporter (Sentry seam)', async () => {
    const captured: { err: unknown; ctx?: Record<string, unknown> }[] = [];
    const errorReporter = { captureException: (err: unknown, ctx?: Record<string, unknown>) => captured.push({ err, ctx }) };
    const reportService = createReportService({ data: { async getTasks() { throw new Error('nope'); }, async getUsers() { return []; } } });
    const app = await buildApp({ authService, tokenService, reportService, errorReporter });
    const token = (await tokenService.issueTokens({ id: 'admin', roles: ['ADMIN'] })).accessToken;
    await app.inject({ method: 'GET', url: '/api/v1/reports/status', headers: { authorization: `Bearer ${token}` } });
    expect(captured).toHaveLength(1);
    expect((captured[0]!.err as Error).message).toBe('nope');
    expect(captured[0]!.ctx?.url).toBe('/api/v1/reports/status');
  });
});

describe('public client config', () => {
  it('reports where to download the Android app, or null to let the web app find it', async () => {
    const withUrl = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C', androidAppUrl: 'https://play.google.com/store/apps/details?id=com.mico360.tasks' } });
    expect((await withUrl.inject({ method: 'GET', url: '/api/v1/config' })).json().data.androidAppUrl).toBe('https://play.google.com/store/apps/details?id=com.mico360.tasks');
    const without = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C', androidAppUrl: '' } });
    expect((await without.inject({ method: 'GET', url: '/api/v1/config' })).json().data.androidAppUrl).toBeNull();
  });

  it('names no link for the app this site hosts itself, so the phone app opens the full address of its own server', async () => {
    // The phone's "Download" can't open a site-relative path; without a link it opens
    // <its server>/downloads/MICO360-Tasks.apk, and the website offers that same file.
    const hosted = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C', androidAppUrl: '/downloads/MICO360-Tasks.apk' } });
    expect((await hosted.inject({ method: 'GET', url: '/api/v1/config' })).json().data.androidAppUrl).toBeNull();
  });

  it('says the company week start and whether the weekly summary is on (asked each time: an administrator can change them)', async () => {
    let company = { weekStart: 1 as 0 | 1 | 6, weeklySummaryEnabled: false };
    const app = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C', company: async () => company } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().data).toMatchObject({ weekStart: 1, weeklySummaryEnabled: false });
    company = { weekStart: 6, weeklySummaryEnabled: true };
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().data).toMatchObject({ weekStart: 6, weeklySummaryEnabled: true });
    // Not known (or not readable): Sunday and on, as before.
    const none = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C' } });
    expect((await none.inject({ method: 'GET', url: '/api/v1/config' })).json().data).toMatchObject({ weekStart: 0, weeklySummaryEnabled: true });
    const broken = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C', company: async () => { throw new Error('db'); } } });
    const res = await broken.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ weekStart: 0, weeklySummaryEnabled: true });
  });

  it('says which app version the download offers (asked each time: the file can be replaced), null when none', async () => {
    let offered: string | null = '1.3.3';
    const app = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C', androidAppVersion: () => offered } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().data.androidAppVersion).toBe('1.3.3');
    offered = null;
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).json().data).toHaveProperty('androidAppVersion', null);
    const none = await buildApp({ authService, tokenService, appConfig: { timeZone: 'Asia/Muscat', productName: 'P', companyName: 'C' } });
    expect((await none.inject({ method: 'GET', url: '/api/v1/config' })).json().data).toHaveProperty('androidAppVersion', null);
  });
});

describe('task PDF pictures', () => {
  it('reads a task’s pictures from file storage and prints them small', async () => {
    const sharp = (await import('sharp')).default;
    const thumb = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const read: string[] = [];
    const task = {
      key: 'MICO-7', title: 'Inspect the rig', description: null, projectName: 'Rig', projectCode: 'RIG', projectNumber: null, projectColor: null, projectIcon: null,
      status: 'To do', category: 'TODO', priority: 'NORMAL', startDate: null, dueDate: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
      progress: 0, estimatedHours: null, actualHours: null, createdBy: 'Aisha', assignees: [], watchers: [], tags: [], repeat: null, overdue: false, isMilestone: false, meeting: null,
      checklist: [], blockedBy: [], blocks: [], comments: [], mentionable: [], activity: [],
      attachments: [{ filename: 'site.jpg', mimeType: 'image/jpeg', sizeBytes: 9, storageKey: 'abc.jpg', uploadedBy: 'Omar', uploadedAt: new Date() }],
    };
    const app = await buildApp({
      authService,
      tokenService,
      taskExportSource: { load: async () => task },
      readAttachment: async (key) => { read.push(key); return Buffer.from('stored'); },
      pictureThumbnail: async () => thumb,
    });
    const token = (await tokenService.issueTokens({ id: 'a1', roles: ['ADMIN'] })).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/export.pdf', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(read).toEqual(['abc.jpg']);
    expect(res.rawPayload.toString('latin1')).toMatch(/\/Subtype \/Image[\s\S]{0,200}\/Width 40\b|\/Width 40\b[\s\S]{0,200}\/Subtype \/Image/);
  });

  it('prints the project’s uploaded picture as the badge, read the way the minutes PDF reads it', async () => {
    const sharp = (await import('sharp')).default;
    const logo = await sharp({ create: { width: 44, height: 44, channels: 3, background: '#aa3322' } }).png().toBuffer();
    const asked: string[] = [];
    const task = {
      key: 'MICO-7', title: 'Inspect the rig', description: null, projectName: 'Rig', projectCode: 'RIG', projectNumber: null, projectColor: null, projectIcon: null,
      projectImageUrl: '/uploads/projects/rig.png',
      status: 'To do', category: 'TODO', priority: 'NORMAL', startDate: null, dueDate: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
      progress: 0, estimatedHours: null, actualHours: null, createdBy: 'Aisha', assignees: [], watchers: [], tags: [], repeat: null, overdue: false, isMilestone: false, meeting: null,
      checklist: [], blockedBy: [], blocks: [], comments: [], mentionable: [], activity: [], attachments: [],
    };
    const app = await buildApp({
      authService,
      tokenService,
      taskExportSource: { load: async () => task },
      readProjectImage: async (url) => { asked.push(url); return logo; },
    });
    const token = (await tokenService.issueTokens({ id: 'a1', roles: ['ADMIN'] })).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/export.pdf', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(asked).toEqual(['/uploads/projects/rig.png']);
    expect(res.rawPayload.toString('latin1')).toMatch(/\/Subtype \/Image[\s\S]{0,200}\/Width 44\b|\/Width 44\b[\s\S]{0,200}\/Subtype \/Image/);
  });

  it('checks the meeting a task came from with meeting access, as the task’s details do', async () => {
    const { inspectPdf } = await import('./lib/pdf-inspect');
    const task = {
      key: 'MICO-7', title: 'Inspect the rig', description: null, projectName: 'Rig', projectCode: 'RIG', projectNumber: null, projectColor: null, projectIcon: null,
      status: 'To do', category: 'TODO', priority: 'NORMAL', startDate: null, dueDate: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
      progress: 0, estimatedHours: null, actualHours: null, createdBy: 'Aisha', assignees: [], watchers: [], tags: [], repeat: null, overdue: false, isMilestone: false,
      meeting: { id: 'm1', title: 'Board pay review', startAt: new Date('2026-09-27T06:00:00Z') },
      checklist: [], blockedBy: [], blocks: [], comments: [], mentionable: [], activity: [], attachments: [],
    };
    const asked: string[] = [];
    const app = await buildApp({
      authService,
      tokenService,
      taskExportSource: { load: async () => task },
      meetingAccess: { canViewMeeting: async (_u: string, _r: string[], id: string) => (asked.push(id), false) } as never,
    });
    const token = (await tokenService.issueTokens({ id: 'e1', roles: ['EMPLOYEE'] })).accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/export.pdf', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(asked).toEqual(['m1']);
    expect(inspectPdf(res.rawPayload).pages.flat().join(' ')).not.toContain('Board pay review');
  });
});

describe('rate limiting behind a proxy', () => {
  it('keys anonymous requests by the real client IP (X-Forwarded-For) when the proxy is trusted', async () => {
    const app = await buildApp({ authService, tokenService, trustProxy: 'loopback', rateLimitMax: 3 });
    const hit = (ip: string) => app.inject({ method: 'GET', url: '/api/v1/config', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < 3; i++) expect((await hit('203.0.113.1')).statusCode).toBe(200);
    const limited = await hit('203.0.113.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    // A different client behind the same proxy has its own budget.
    expect((await hit('203.0.113.2')).statusCode).toBe(200);
  });

  it('keys signed-in requests by user, so colleagues behind one office IP do not share a budget', async () => {
    const app = await buildApp({ authService, tokenService, trustProxy: 'loopback', rateLimitMax: 2 });
    const a = (await tokenService.issueTokens({ id: 'user-a', roles: [] })).accessToken;
    const b = (await tokenService.issueTokens({ id: 'user-b', roles: [] })).accessToken;
    const hit = (token: string) =>
      app.inject({ method: 'GET', url: '/api/v1/config', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.7', authorization: `Bearer ${token}` } });
    expect((await hit(a)).statusCode).toBe(200);
    expect((await hit(a)).statusCode).toBe(200);
    expect((await hit(a)).statusCode).toBe(429);
    expect((await hit(b)).statusCode).toBe(200);
  });

  it('never rate limits uploads, web-app files or the health check', async () => {
    const app = await buildApp({ authService, tokenService, rateLimitMax: 1 });
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/uploads/x.png' })).statusCode).not.toBe(429);
      expect((await app.inject({ method: 'GET', url: '/assets/index-abc.js' })).statusCode).not.toBe(429);
    }
    // The API itself is still limited.
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/config' })).statusCode).toBe(429);
  });

  it('applies a stricter per-IP limit to sign-in endpoints', async () => {
    const app = await buildApp({ authService, tokenService, trustProxy: 'loopback', authRateLimitMax: 2 });
    const login = () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.9' }, payload: { identifier: 'x', password: 'y' } });
    expect((await login()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(429);
  });
});

describe('database error mapping', () => {
  it('turns Prisma input and race errors into clear 4xx responses instead of 500', async () => {
    const app = await buildApp({ authService, tokenService });
    const prismaError = (code: string) => Object.assign(new Error(`prisma ${code}`), { name: 'PrismaClientKnownRequestError', code });
    app.get('/t/:code', async (req) => {
      throw prismaError((req.params as { code: string }).code);
    });
    app.get('/t-validation', async () => {
      throw Object.assign(new Error('bad arg'), { name: 'PrismaClientValidationError' });
    });
    const status = async (url: string) => (await app.inject({ method: 'GET', url })).statusCode;
    expect(await status('/t/P2002')).toBe(409);
    expect(await status('/t/P2025')).toBe(404);
    expect(await status('/t/P2003')).toBe(409);
    expect(await status('/t/P2000')).toBe(400);
    expect(await status('/t-validation')).toBe(400);
    expect(await status('/t/P9999')).toBe(500);
  });
});
