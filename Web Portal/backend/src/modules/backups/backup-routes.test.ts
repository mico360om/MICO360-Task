import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerBackupRoutes, type BackupRouteDeps } from './backup-routes';
import { createOneTimeTokens } from './one-time-tokens';
import { createAuthGuard } from '../auth/auth-guard';
import { createTokenService } from '../auth/token-service';
import { ConflictError, HttpError } from '../../lib/http-errors';
import type { BackupOverview } from './backup-service';
import type { AuditService } from '../audit/audit-service';

const tokenService = createTokenService({
  accessSecret: 'bk-access',
  refreshSecret: 'bk-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const OVERVIEW = { folder: '/data/backups', copies: [], warning: null } as unknown as BackupOverview;
let dir: string;
let clock: Date;
let admins: Set<string>;
let audited: Record<string, unknown>[];
let started: string[];
let connectResult: { result: 'connected' | 'denied' | 'failed'; userId: string | null; email: string | null };
let driveSetUp: boolean;
let disconnected: number;

async function makeApp() {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'VALIDATION' } });
    return reply.status(500).send({ error: { code: 'INTERNAL', message: (err as Error).message } });
  });
  const file = join(dir, 'mico360-tasks-backup-2026-10-30-0200-abcdef.tar.gz');
  writeFileSync(file, Buffer.from('the whole archive'));
  const deps: BackupRouteDeps = {
    guard: createAuthGuard(tokenService),
    service: {
      overview: async () => OVERVIEW,
      start: async (by: string) => {
        started.push(by);
        return { id: 'run1', status: 'RUNNING', trigger: 'MANUAL', startedAt: clock } as never;
      },
      fileFor: async (id: string) => (id === 'run1' ? { path: file, fileName: 'mico360-tasks-backup-2026-10-30-0200-abcdef.tar.gz', sizeBytes: 17 } : null),
    },
    drive: {
      connectUrl: (userId: string) => {
        if (!driveSetUp) throw new ConflictError('Google Drive isn’t set up on this server yet.', 'DRIVE_NOT_SET_UP');
        return `https://accounts.google.com/o/oauth2/v2/auth?state=for-${userId}`;
      },
      complete: async () => connectResult,
      disconnect: async () => {
        disconnected += 1;
        return { email: 'owner@gmail.com' };
      },
    },
    downloads: createOneTimeTokens({ secret: 'bk-access', purpose: 'backup-download', now: () => clock }),
    isActiveAdmin: async (id) => admins.has(id),
    audit: { async record(d: Record<string, unknown>) { audited.push(d); return {} as never; } } as unknown as AuditService,
    appUrl: 'https://task.mico360.com',
  };
  await app.register(async (api) => registerBackupRoutes(api, deps), { prefix: '/api/v1' });
  return app;
}

const bearer = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mico-bk-routes-'));
  clock = new Date('2026-10-30T08:00:00Z');
  admins = new Set(['admin1']);
  audited = [];
  started = [];
  connectResult = { result: 'connected', userId: 'admin1', email: 'owner@gmail.com' };
  driveSetUp = true;
  disconnected = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('backup routes', () => {
  it('are for administrators only: 401 signed out, 403 for an employee (the Google callback excepted)', async () => {
    const app = await makeApp();
    const emp = await bearer('e1', ['EMPLOYEE']);
    const calls: [string, string][] = [
      ['GET', '/api/v1/backups'],
      ['POST', '/api/v1/backups'],
      ['POST', '/api/v1/backups/run1/download-link'],
      ['POST', '/api/v1/backups/google/connect'],
      ['DELETE', '/api/v1/backups/google'],
    ];
    for (const [method, url] of calls) {
      expect((await app.inject({ method: method as 'GET', url })).statusCode, `${method} ${url} signed out`).toBe(401);
      expect((await app.inject({ method: method as 'GET', url, headers: emp })).statusCode, `${method} ${url} employee`).toBe(403);
    }
    expect(started).toEqual([]);
    expect(disconnected).toBe(0);
    await app.close();
  });

  it('GET /backups gives the overview', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/backups', headers: await bearer('admin1', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(OVERVIEW);
    await app.close();
  });

  it('POST /backups starts "Back up now" (202) and records who did it', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/backups', headers: await bearer('admin1', ['ADMIN']) });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ id: 'run1', status: 'RUNNING' });
    expect(started).toEqual(['admin1']);
    expect(audited).toEqual([expect.objectContaining({ userId: 'admin1', module: 'backups', action: 'backup.create', entityId: 'run1' })]);
    await app.close();
  });

  it('download: a link for a kept copy, which streams the file once, as an attachment, and is audited', async () => {
    const app = await makeApp();
    const admin = await bearer('admin1', ['ADMIN']);
    expect((await app.inject({ method: 'POST', url: '/api/v1/backups/nope/download-link', headers: admin })).statusCode).toBe(404);
    const link = await app.inject({ method: 'POST', url: '/api/v1/backups/run1/download-link', headers: admin });
    expect(link.statusCode).toBe(200);
    const url = link.json().data.url as string;
    expect(url).toMatch(/^\/api\/v1\/backups\/download\?token=/);
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('the whole archive');
    expect(res.headers['content-disposition']).toBe('attachment; filename="mico360-tasks-backup-2026-10-30-0200-abcdef.tar.gz"');
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.headers['content-length']).toBe('17');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(audited).toEqual([expect.objectContaining({ userId: 'admin1', module: 'backups', action: 'backup.download', entityId: 'run1', newValue: { fileName: 'mico360-tasks-backup-2026-10-30-0200-abcdef.tar.gz', sizeBytes: 17 } })]);
    // Once only.
    const again = await app.inject({ method: 'GET', url });
    expect(again.statusCode).toBe(410);
    expect(again.body).toMatch(/press Download again/);
    await app.close();
  });

  it('a download link runs out after 2 minutes, and stops working for someone who is no longer an administrator', async () => {
    const app = await makeApp();
    const admin = await bearer('admin1', ['ADMIN']);
    const late = (await app.inject({ method: 'POST', url: '/api/v1/backups/run1/download-link', headers: admin })).json().data.url as string;
    clock = new Date(clock.getTime() + 121_000);
    expect((await app.inject({ method: 'GET', url: late })).statusCode).toBe(410);
    const demoted = (await app.inject({ method: 'POST', url: '/api/v1/backups/run1/download-link', headers: admin })).json().data.url as string;
    admins.delete('admin1');
    expect((await app.inject({ method: 'GET', url: demoted })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/backups/download?token=forged.token' })).statusCode).toBe(410);
    expect(audited).toEqual([]);
    await app.close();
  });

  it('Connect Google Drive: the Google page to go to; a plain 409 when Drive isn’t set up here', async () => {
    const app = await makeApp();
    const admin = await bearer('admin1', ['ADMIN']);
    const res = await app.inject({ method: 'POST', url: '/api/v1/backups/google/connect', headers: admin });
    expect(res.json().data).toEqual({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=for-admin1' });
    driveSetUp = false;
    const off = await app.inject({ method: 'POST', url: '/api/v1/backups/google/connect', headers: admin });
    expect(off.statusCode).toBe(409);
    expect(off.json().error).toEqual({ code: 'DRIVE_NOT_SET_UP', message: 'Google Drive isn’t set up on this server yet.' });
    await app.close();
  });

  it('Google sends the administrator back to System Settings, saying how it went (and a connection is audited)', async () => {
    const app = await makeApp();
    for (const [result, userId] of [['connected', 'admin1'], ['denied', 'admin1'], ['failed', null]] as const) {
      connectResult = { result, userId, email: result === 'connected' ? 'owner@gmail.com' : null };
      const res = await app.inject({ method: 'GET', url: '/api/v1/backups/google/callback?code=c&state=s' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`https://task.mico360.com/admin/settings?drive=${result}#backups`);
    }
    expect(audited).toEqual([expect.objectContaining({ userId: 'admin1', module: 'backups', action: 'backup.drive-connect', newValue: { email: 'owner@gmail.com' } })]);
    await app.close();
  });

  it('Disconnect forgets the connection and is audited', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/backups/google', headers: await bearer('admin1', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(disconnected).toBe(1);
    expect(audited).toEqual([expect.objectContaining({ userId: 'admin1', module: 'backups', action: 'backup.drive-disconnect', oldValue: { email: 'owner@gmail.com' } })]);
    await app.close();
  });
});
