import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { PortalService } from './portal-service';
import { attachmentDisposition, downloadType } from './portal-routes';

// 1.23.7 The portal's files, bell and notification switches over HTTP (the service is a fake here; the
// real gate is tested on the database in tests/integration/client-permissions.test.ts).
async function appWith(portal: Partial<PortalService>) {
  const tokenService = createTokenService({
    accessSecret: 'perm-a', refreshSecret: 'perm-r', accessTtl: 900, refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
  const app = await buildApp({ authService, tokenService, portal: portal as PortalService });
  const authorization = `Bearer ${(await tokenService.issueTokens({ id: 'c1', roles: ['CLIENT'] })).accessToken}`;
  const staff = `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles: ['ADMIN'] })).accessToken}`;
  return { app, authorization, staff };
}

describe('a file sent to a client', () => {
  it('only types a browser shows safely keep their type; anything else is a plain download', () => {
    expect(downloadType('application/pdf')).toBe('application/pdf');
    expect(downloadType('IMAGE/PNG')).toBe('image/png');
    for (const t of ['text/html', 'image/svg+xml', 'application/javascript', 'text/xml', '']) expect(downloadType(t)).toBe('application/octet-stream');
  });

  it('its name can’t break the header, and keeps its own letters for the browser', () => {
    const h = attachmentDisposition('Pump "spec"\r\nSet-Cookie: x.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toMatch(/^attachment; filename="Pump _spec_ {2}Set-Cookie: x.pdf"; filename\*=UTF-8''/);
    expect(attachmentDisposition('تقرير.pdf')).toContain(`filename*=UTF-8''${encodeURIComponent('تقرير.pdf')}`);
  });

  it('comes as an attachment, never sniffed, in a sandbox, not stored by the browser', async () => {
    const { app, authorization } = await appWith({ async file() { return { content: Buffer.from('%PDF-1.4'), filename: 'Spec.pdf', mimeType: 'text/html' }; } });
    const r = await app.inject({ method: 'GET', url: '/api/v1/portal/projects/p1/tasks/t1/files/f1', headers: { authorization } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(r.headers['content-disposition']).toMatch(/^attachment;/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['content-security-policy'])).toContain('sandbox');
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('a staff session can’t use it (portal routes are for client accounts)', async () => {
    const { app, staff } = await appWith({ async file() { throw new Error('never'); } });
    const r = await app.inject({ method: 'GET', url: '/api/v1/portal/projects/p1/tasks/t1/files/f1', headers: { authorization: staff } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('uploading from the portal', () => {
  it('the file is read through the service, after its gate (the route hands a reader over)', async () => {
    const calls: string[] = [];
    const { app, authorization } = await appWith({
      async upload(_userId, projectId, taskId, read) {
        calls.push(`gate ${String(projectId)} ${String(taskId)}`);
        const f = await read();
        calls.push(`read ${f?.filename} ${f?.content.length}`);
        return { ok: true } as never;
      },
    });
    const boundary = '----perm';
    const payload = [`--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="note.txt"', 'Content-Type: text/plain', '', 'hello', `--${boundary}--`, ''].join('\r\n');
    const r = await app.inject({ method: 'POST', url: '/api/v1/portal/projects/p1/tasks/t1/files', headers: { authorization, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(r.statusCode).toBe(201);
    expect(calls).toEqual(['gate p1 t1', 'read note.txt 5']);
    await app.close();
  });
});

describe('the notification switches', () => {
  it('take booleans for the four kinds only (400 for anything else)', async () => {
    const seen: unknown[] = [];
    const { app, authorization } = await appWith({ async setSettings(_u, patch) { seen.push(patch); return { settings: { reply: true, signOff: true, minutes: false, document: true }, projects: [] }; } });
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/v1/portal/settings/notifications', headers: { authorization }, payload: payload as object });
    expect((await put({ minutes: false })).statusCode).toBe(200);
    expect((await put({ minutes: 'no' })).statusCode).toBe(400);
    expect((await put({ invitations: false })).statusCode).toBe(400);
    expect(seen).toEqual([{ minutes: false }]);
    await app.close();
  });
});
