import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../../app';
import { createProjectService } from './project-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { CreateProjectData, ProjectRecord, ProjectRepository } from './project-repository';
import { PROJECT_ICONS, PROJECT_ICON_PATHS, projectInitials } from './project-icons';
import { jpegHeader, pngHeader, webpLossy } from '../../lib/test-images';

/** Projects in memory; deleted ones keep their code (as the database's unique index does). */
function repo(): ProjectRepository {
  const rows = new Map<string, ProjectRecord & { deleted?: boolean }>();
  let seq = 0;
  return {
    async create(data: CreateProjectData) {
      const now = new Date();
      const rec: ProjectRecord = {
        id: `p${seq++}`, code: data.code, number: data.number ?? null, name: data.name, description: data.description ?? null, clientName: data.clientName ?? null,
        managerId: data.managerId ?? null, ownerId: data.ownerId ?? null, status: data.status ?? 'PLANNING', priority: data.priority ?? 'NORMAL',
        color: data.color ?? '#8B1E1E', icon: data.icon ?? null, imageUrl: null, startDate: null, targetDate: null, notes: null,
        carryForward: data.carryForward ?? true, defaultDueToday: data.defaultDueToday ?? false,
        createdById: data.createdById, createdAt: now, updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { const p = rows.get(id); return p && !p.deleted ? p : null; },
    async findByCode(code) { return [...rows.values()].find((p) => p.code === code && !p.deleted) ?? null; },
    async codeInUse(code) { return [...rows.values()].some((p) => p.code === code); },
    async list() { return [...rows.values()].filter((p) => !p.deleted); },
    async listForUser() { return []; },
    async isAccessibleTo() { return false; },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch, updatedAt: new Date() }; rows.set(id, u); return u; },
    async softDelete(id) { rows.set(id, { ...rows.get(id)!, deleted: true }); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'ident-access',
  refreshSecret: 'ident-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const removed: string[] = [];
let saved = 0;
const storage = {
  async save() { saved += 1; return { storageKey: `img-${saved}.png`, url: `/uploads/img-${saved}.png`, sizeBytes: 10 }; },
  async remove(key: string) { removed.push(key); },
};

let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  removed.length = 0;
  saved = 0;
  app = await buildApp({ authService, tokenService, projectService: createProjectService({ projects: repo() }), chatAttachmentStorage: storage as never });
});

const auth = async (roles = ['ADMIN']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id: 'admin', roles })).accessToken}` });
const create = async (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/projects', headers: await auth(), payload: { name: 'Rig Inspection', ...payload } });

describe('Project identity: code, icon and colour', () => {
  it('keeps an icon and a colour, and refuses unknown ones', async () => {
    const ok = await create({ code: 'RIG', icon: 'rocket', color: '#1E5A8B' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data).toMatchObject({ icon: 'rocket', color: '#1E5A8B' });
    expect((await create({ code: 'RIGB', icon: 'unicorn' })).statusCode).toBe(400);
    expect((await create({ code: 'RIGC', color: 'red; background:url(x)' })).statusCode).toBe(400);
    const id = ok.json().data.id as string;
    const put = await app.inject({ method: 'PUT', url: `/api/v1/projects/${id}`, headers: await auth(), payload: { icon: null, color: '#2E7D53' } });
    expect(put.json().data).toMatchObject({ icon: null, color: '#2E7D53', code: 'RIG', name: 'Rig Inspection' });
  });

  it('writes codes in capitals and refuses badly formed ones with a clear reason', async () => {
    expect((await create({ code: ' mob ' })).json().data.code).toBe('MOB');
    for (const code of ['A', '1AB', 'AB-12', 'ABCDEFGHIJK', 'م']) {
      const res = await create({ code });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toMatch(/2–10 letters or digits/);
    }
  });

  it('refuses a code already in use (409) — also one a deleted project had', async () => {
    const first = await create({ code: 'MICO' });
    expect((await create({ code: 'mico' })).json().error.code).toBe('DUPLICATE_PROJECT_CODE');
    await app.inject({ method: 'DELETE', url: `/api/v1/projects/${first.json().data.id}`, headers: await auth() });
    expect((await create({ code: 'MICO' })).statusCode).toBe(409);
  });

  it('checks a code before saving: free, taken (with a free suggestion) or badly formed — admins only', async () => {
    await create({ code: 'MICO' });
    await create({ code: 'MICO2' });
    const check = async (code: string, roles = ['ADMIN']) =>
      app.inject({ method: 'GET', url: `/api/v1/projects/code-check?code=${encodeURIComponent(code)}`, headers: await auth(roles) });
    expect((await check('rig')).json().data).toEqual({ code: 'RIG', valid: true, available: true });
    expect((await check('mico')).json().data).toEqual({ code: 'MICO', valid: true, available: false, suggestion: 'MICO3' });
    expect((await check('1x')).json().data).toMatchObject({ code: '1X', valid: false, available: false });
    // Anyone signed in may create a project, so anyone may check a code first.
    expect((await check('rig', ['EMPLOYEE'])).statusCode).toBe(200);
  });
});

describe('Project image upload', () => {
  function upload(content: Buffer, type: string) {
    const boundary = '----mico360image';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo"\r\nContent-Type: ${type}\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  }
  async function project() {
    return (await create({ code: 'IMG', name: 'Images' })).json().data.id as string;
  }
  const send = async (id: string, buf: Buffer, type: string) => {
    const u = upload(buf, type);
    return app.inject({ method: 'POST', url: `/api/v1/projects/${id}/image`, headers: { ...(await auth()), ...u.headers }, payload: u.payload });
  };

  it('takes PNG, JPEG and WebP within the limits, replaces the old file and removes it on request', async () => {
    const id = await project();
    const first = await send(id, pngHeader(512, 512), 'image/png');
    expect(first.statusCode).toBe(200);
    expect(first.json().data.imageUrl).toBe('/uploads/img-1.png');
    expect((await send(id, jpegHeader(800, 600), 'image/jpeg')).json().data.imageUrl).toBe('/uploads/img-2.png');
    expect(removed).toEqual(['img-1.png']); // the replaced picture doesn't linger
    expect((await send(id, webpLossy(256, 256), 'image/webp')).statusCode).toBe(200);
    const cleared = await app.inject({ method: 'DELETE', url: `/api/v1/projects/${id}/image`, headers: await auth() });
    expect(cleared.json().data.imageUrl).toBeNull();
    expect(removed).toEqual(['img-1.png', 'img-2.png', 'img-3.png']);
  });

  it('refuses other types, content that is not what it says, huge dimensions and tiny ones', async () => {
    const id = await project();
    const gif = await send(id, Buffer.from('GIF89a\x01\x00\x01\x00'), 'image/gif');
    expect(gif.statusCode).toBe(400);
    expect(gif.json().error.message).toMatch(/PNG, JPG or WebP/);
    const renamed = await send(id, pngHeader(64, 64), 'image/jpeg');
    expect(renamed.statusCode).toBe(400);
    expect(renamed.json().error.message).toBe('This file isn’t a real PNG, JPG or WebP picture — it may be damaged or renamed.');
    const text = await send(id, Buffer.from('plain text'), 'image/png');
    expect(text.json().error.message).toBe('This file isn’t a real PNG, JPG or WebP picture — it may be damaged or renamed.');
    const huge = await send(id, pngHeader(6000, 400), 'image/png');
    expect(huge.statusCode).toBe(400);
    expect(huge.json().error.message).toMatch(/4096/);
    expect((await send(id, pngHeader(8, 8), 'image/png')).statusCode).toBe(400);
    expect((await send(id, Buffer.from('plain text'), 'image/png')).statusCode).toBe(400);
    expect(saved).toBe(0);
  });
});

// The web app draws these icons; the server only accepts their names. Fails when the lists drift.
const web = resolve(__dirname, '../../../../frontend/src/lib/project-icons.tsx');
describe('project icons', () => {
  it.skipIf(!existsSync(web))('the web app draws exactly the icons the server accepts', () => {
    const drawn = [...readFileSync(web, 'utf8').matchAll(/^\s{2}'?([a-z-]+)'?: \[/gm)].map((m) => m[1]);
    expect(drawn).toEqual([...PROJECT_ICONS]);
  });

  // The minutes PDF draws a project's icon itself, so it keeps the same shapes as the web app.
  it.skipIf(!existsSync(web))('the server draws each icon with the web app’s exact shapes', () => {
    const lines = [...readFileSync(web, 'utf8').matchAll(/^\s{2}'?([a-z-]+)'?: \[(.*)\],$/gm)];
    const webPaths = Object.fromEntries(lines.map((m) => [m[1], [...m[2]!.matchAll(/'([^']+)'/g)].map((p) => p[1])]));
    expect(webPaths).toEqual(PROJECT_ICON_PATHS);
  });

  it('gives a project the same two initials as the web app’s tile, in any script', () => {
    expect(projectInitials('Falcon CRM')).toBe('FC');
    expect(projectInitials('falcon')).toBe('FA');
    expect(projectInitials('مشروع الحفر')).toBe('ما');
    expect(projectInitials('   ')).toBe('?');
  });
});
