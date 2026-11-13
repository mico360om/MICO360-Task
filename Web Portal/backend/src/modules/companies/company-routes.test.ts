import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createCompanyService, type CompanySiteDefaults, type OnCompanyAccessChanged } from './company-service';
import { createMemoryCompanyRepository } from './memory-company-repository';
import { pngHeader } from '../../lib/test-images';

const tokenService = createTokenService({
  accessSecret: 'co-access',
  refreshSecret: 'co-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const SITE: CompanySiteDefaults = { timeZone: 'Asia/Muscat', weekStart: 0, workingHours: { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }, senderName: 'MICO360 Tasks' };

let mem: ReturnType<typeof createMemoryCompanyRepository>;
let audit: { records: Record<string, unknown>[] };
let onAccess: Mock<OnCompanyAccessChanged>;
let shrink: Mock<(content: Buffer, mimeType: string) => Promise<Buffer>>;
let stored: string[];
let removed: string[];
let app: Awaited<ReturnType<typeof buildApp>>;
let prolens: string;
let beta: string;
const betaMember = 'u-beta';

beforeEach(async () => {
  mem = createMemoryCompanyRepository();
  audit = { records: [] };
  onAccess = vi.fn<OnCompanyAccessChanged>();
  shrink = vi.fn(async (content: Buffer) => content);
  stored = [];
  removed = [];
  const storage = {
    async save() { const key = `logo-${stored.length + 1}.png`; stored.push(key); return { storageKey: key, url: `/uploads/${key}`, sizeBytes: 10 }; },
    async remove(key: string) { removed.push(key); },
  };
  const companyService = createCompanyService({
    companies: mem.repo,
    site: async () => SITE,
    audit: { async record(d) { audit.records.push(d as unknown as Record<string, unknown>); return {} as never; } },
    storage,
    shrink,
    onAccessChanged: onAccess,
  });
  prolens = (await mem.repo.create({ name: 'Prolens Projects LLC', code: 'PPL', createdById: null })).id;
  app = await buildApp({ authService, tokenService, companyService, chatAttachmentStorage: storage });
  beta = (await as(admin).post('/companies', { name: 'Beta Co', code: 'BETA' })).json().data.id;
  mem.addPerson({ id: betaMember, firstName: 'Bea', lastName: 'Member', username: 'bea', email: 'bea@x.co' });
  await mem.repo.addMembers(beta, [betaMember], null);
});

const admin = { id: 'admin', roles: ['ADMIN'] };
const employee = { id: 'emp', roles: ['EMPLOYEE'] };

function as(user: { id: string; roles: string[] }, extra: Record<string, string> = {}) {
  const headers = async () => ({ authorization: `Bearer ${(await tokenService.issueTokens(user)).accessToken}`, ...extra });
  return {
    get: async (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: await headers() }),
    post: async (url: string, payload?: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: await headers(), ...(payload !== undefined ? { payload: payload as object } : {}) }),
    put: async (url: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers: await headers(), payload: payload as object }),
    del: async (url: string) => app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: await headers() }),
    upload: async (url: string, file: { content: Buffer; type: string }) => {
      const boundary = '----mico360logo';
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo"\r\nContent-Type: ${file.type}\r\n\r\n`),
        file.content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { ...(await headers()), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    },
  };
}

const gif3mb = { content: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(3 * 1024 * 1024)]), type: 'image/gif' };

describe('Companies admin API', () => {
  it('only administrators manage companies', async () => {
    expect((await as(employee).get('/companies')).statusCode).toBe(403);
    expect((await as(employee).post('/companies', { name: 'Nope', code: 'NO' })).statusCode).toBe(403);
    expect((await as(employee).put(`/companies/${beta}`, { name: 'Nope' })).statusCode).toBe(403);
    expect((await as(employee).post(`/companies/${beta}/archive`)).statusCode).toBe(403);
    expect((await as(employee).get(`/companies/${beta}/people`)).statusCode).toBe(403);
    expect((await as(employee).get('/me/companies')).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/me/companies' })).statusCode).toBe(401);
  });

  it('create checks name, code and sender name; a company inherits the site’s settings', async () => {
    const created = (await as(admin).post('/companies', { name: 'Gamma Co', code: ' gam ' })).json().data;
    expect(created).toMatchObject({
      code: 'GAM',
      status: 'ACTIVE',
      timeZone: null,
      weekStart: null,
      workingHours: null,
      senderName: null,
      logoUrl: null,
      archivedAt: null,
      counts: { people: 0, projects: 0 },
      effective: { timeZone: 'Asia/Muscat', weekStart: 0, workingHours: SITE.workingHours, senderName: 'MICO360 Tasks' },
    });
    expect(typeof created.createdAt).toBe('string');
    expect((await as(admin).post('/companies', { name: 'beta co', code: 'B2' })).json().error).toEqual({ code: 'DUPLICATE_COMPANY_NAME', message: 'A company with this name already exists.' });
    const sameCode = await as(admin).post('/companies', { name: 'X', code: 'beta' });
    expect(sameCode.statusCode).toBe(409);
    expect(sameCode.json().error).toEqual({ code: 'DUPLICATE_COMPANY_CODE', message: 'A company with this code already exists.' });
    expect((await as(admin).post('/companies', { name: 'X', code: 'X2', senderName: 'A <b>' })).json().error.message).toBe('The sender name can’t contain < > or quotes.');
    expect((await as(admin).post('/companies', { name: 'X', code: 'X' })).json().error.message).toBe('Use 2–10 capital letters or digits for the short code.');
    expect((await as(admin).post('/companies', { name: '  ', code: 'X3' })).json().error.message).toBe('Give the company a name of up to 120 characters.');
    expect((await as(admin).post('/companies', { name: 'X', code: 'X4', weekStart: 3 })).statusCode).toBe(400);
    expect((await as(admin).post('/companies', { name: 'X', code: 'X5', workingHours: { days: [0], start: '17:00', end: '08:00' } })).json().error.message).toBe('The day has to end after it starts.');
  });

  it('every company uses the site’s time zone: none can be set (null is fine)', async () => {
    expect((await as(admin).post('/companies', { name: 'Delta', code: 'DEL', timeZone: null, weekStart: null, workingHours: null, senderName: null })).statusCode).toBe(201);
    const zone = await as(admin).post('/companies', { name: 'Echo', code: 'ECH', timeZone: 'Europe/London' });
    expect(zone.statusCode).toBe(400);
    expect(zone.json().error.message).toBe('Companies use the site’s time zone.');
  });

  it('own settings win over the site’s; clearing one inherits again', async () => {
    const own = (await as(admin).put(`/companies/${beta}`, { weekStart: 6, workingHours: { days: [6, 0, 1, 2, 3], start: '07:30', end: '16:30' }, senderName: 'Beta Projects' })).json().data;
    expect(own).toMatchObject({ weekStart: 6, senderName: 'Beta Projects', effective: { weekStart: 6, senderName: 'Beta Projects', workingHours: { days: [0, 1, 2, 3, 6], start: '07:30', end: '16:30' } } });
    const cleared = (await as(admin).put(`/companies/${beta}`, { weekStart: null, senderName: '' })).json().data;
    expect(cleared).toMatchObject({ weekStart: null, senderName: null, effective: { weekStart: 0, senderName: 'MICO360 Tasks' } });
    expect((await as(admin).put(`/companies/${beta}`, { code: 'ppl' })).json().error.code).toBe('DUPLICATE_COMPANY_CODE');
    expect((await as(admin).put(`/companies/${beta}`, { name: 'Beta Co', code: 'BETA' })).statusCode).toBe(200); // its own name and code
    expect((await as(admin).get('/companies/nope')).statusCode).toBe(404);
  });

  it('lists companies A–Z with their counts', async () => {
    mem.addProject({ id: 'p1', code: 'P1', name: 'One', companyIds: [beta] });
    const list = (await as(admin).get('/companies')).json().data as { name: string; counts: { people: number; projects: number } }[];
    expect(list.map((c) => [c.name, c.counts])).toEqual([['Beta Co', { people: 1, projects: 1 }], ['Prolens Projects LLC', { people: 0, projects: 0 }]]);
  });

  it('the last active company can’t be archived; archiving tells realtime who lost access', async () => {
    mem.addProject({ id: 'pb', code: 'PB', name: 'Beta project', companyIds: [beta] });
    const archived = await as(admin).post(`/companies/${beta}/archive`);
    expect(archived.json().data).toMatchObject({ status: 'ARCHIVED' });
    expect(typeof archived.json().data.archivedAt).toBe('string');
    expect(onAccess).toHaveBeenCalledWith(expect.arrayContaining([betaMember]), expect.any(Array));
    expect(onAccess).toHaveBeenLastCalledWith([betaMember], ['pb']);
    expect((await as(admin).post(`/companies/${prolens}/archive`)).json().error).toEqual({ code: 'LAST_ACTIVE_COMPANY', message: 'You can’t archive the last active company.' });
    expect((await as(admin).post(`/companies/${prolens}/archive`)).statusCode).toBe(409);
    onAccess.mockClear();
    const back = await as(admin).post(`/companies/${beta}/unarchive`);
    expect(back.json().data).toMatchObject({ status: 'ACTIVE', archivedAt: null });
    expect(onAccess).toHaveBeenCalledWith([betaMember], ['pb']);
  });

  it('a logo must be a small picture; a good one is stored smaller and replaces the old one', async () => {
    expect((await as(admin).upload(`/companies/${beta}/logo`, gif3mb)).json().error.message).toBe('The logo must be a PNG, JPEG or WebP picture up to 2 MB.');
    expect((await as(admin).upload(`/companies/${beta}/logo`, { content: Buffer.from('plain text'), type: 'image/png' })).json().error.message).toBe('The logo must be a PNG, JPEG or WebP picture up to 2 MB.');
    expect((await as(admin).upload(`/companies/${beta}/logo`, { content: Buffer.concat([pngHeader(64, 64), Buffer.alloc(2 * 1024 * 1024)]), type: 'image/png' })).statusCode).toBe(400);
    const first = await as(admin).upload(`/companies/${beta}/logo`, { content: pngHeader(900, 300), type: 'image/png' });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.logoUrl).toBe('/uploads/logo-1.png');
    expect(shrink).toHaveBeenCalledWith(expect.any(Buffer), 'image/png');
    await as(admin).upload(`/companies/${beta}/logo`, { content: pngHeader(900, 300), type: 'image/png' });
    expect(removed).toEqual(['logo-1.png']);
    const cleared = (await as(admin).del(`/companies/${beta}/logo`)).json().data;
    expect(cleared.logoUrl).toBeNull();
    expect(removed).toEqual(['logo-1.png', 'logo-2.png']);
    expect(audit.records.map((r) => r.action).slice(-3)).toEqual(['company.logo', 'company.logo', 'company.logo.remove']);
  });

  it('review fix #23: a logo the company can’t be saved with is not left on disk', async () => {
    const realUpdate = mem.repo.update;
    mem.repo.update = async () => {
      throw new Error('db down');
    };
    try {
      expect((await as(admin).upload(`/companies/${beta}/logo`, { content: pngHeader(900, 300), type: 'image/png' })).statusCode).toBe(500);
    } finally {
      mem.repo.update = realUpdate;
    }
    expect(stored).toEqual(['logo-1.png']);
    expect(removed).toEqual(['logo-1.png']);
  });

  it('every change is in the audit log', async () => {
    await as(admin).put(`/companies/${beta}`, { name: 'Beta LLC' });
    expect(audit.records.at(-1)).toMatchObject({ module: 'companies', action: 'company.update', entityId: beta, userId: 'admin', oldValue: { name: 'Beta Co' }, newValue: { name: 'Beta LLC' } });
    expect(audit.records.find((r) => r.action === 'company.create')).toMatchObject({ module: 'companies', entityId: beta, newValue: { name: 'Beta Co', code: 'BETA' } });
    await as(admin).post(`/companies/${beta}/archive`);
    await as(admin).post(`/companies/${beta}/unarchive`);
    expect(audit.records.slice(-2)).toMatchObject([
      { action: 'company.archive', oldValue: { status: 'ACTIVE' }, newValue: { status: 'ARCHIVED' } },
      { action: 'company.unarchive', oldValue: { status: 'ARCHIVED' }, newValue: { status: 'ACTIVE' } },
    ]);
  });

  it('people and projects per company; adding and removing people', async () => {
    mem.addPerson({ id: 'u-two', firstName: 'Tom', lastName: 'Two', username: 'tom', email: 'tom@x.co' });
    mem.addProject({ id: 'p1', code: 'P1', name: 'One', companyIds: [prolens, beta] });
    mem.addProject({ id: 'p2', code: 'P2', name: 'Two', companyIds: [beta] });
    const added = await as(admin).post(`/companies/${beta}/people`, { userIds: ['u-two'] });
    expect(added.json().data).toEqual({ changed: 1, refused: [] });
    expect(onAccess).toHaveBeenLastCalledWith(['u-two']);
    expect((await as(admin).get(`/companies/${beta}/people`)).json().data.map((p: { id: string }) => p.id)).toEqual([betaMember, 'u-two']);
    expect((await as(admin).get(`/companies/${beta}/projects`)).json().data).toEqual([
      { id: 'p1', code: 'P1', name: 'One', isMain: false, archived: false },
      { id: 'p2', code: 'P2', name: 'Two', isMain: true, archived: false },
    ]);
    expect((await as(admin).del(`/companies/${beta}/people/u-two`)).statusCode).toBe(204);
    expect(onAccess).toHaveBeenLastCalledWith(['u-two']);
    expect(audit.records.slice(-2).map((r) => r.action)).toEqual(['company.people.add', 'company.people.remove']);
    expect((await as(admin).post(`/companies/${beta}/people`, { userIds: [] })).statusCode).toBe(400);
  });

  it('with the membership rules wired, adding and removing people go through them (and a refusal is a 409 with its words)', async () => {
    const reason = 'Ana Alpha must keep at least one company. Add another company first.';
    const people = {
      add: vi.fn(async () => ({ changed: 1, refused: [{ userId: 'gone', name: '', reason: 'User not found.' }] })),
      remove: vi.fn(async () => ({ changed: 0, refused: [{ userId: 'ana', name: 'Ana Alpha', reason }] })),
    };
    const ruled = createCompanyService({ companies: mem.repo, site: async () => SITE, people, audit: { async record(d) { audit.records.push(d as unknown as Record<string, unknown>); return {} as never; } } });
    app = await buildApp({ authService, tokenService, companyService: ruled });
    const added = await as(admin).post(`/companies/${beta}/people`, { userIds: ['ana', 'gone'] });
    expect(added.json().data).toEqual({ changed: 1, refused: [{ userId: 'gone', name: '', reason: 'User not found.' }] });
    expect(people.add).toHaveBeenCalledWith(['ana', 'gone'], [beta], { id: 'admin', roles: ['ADMIN'] });
    expect(audit.records.at(-1)).toMatchObject({ action: 'company.people.add', newValue: { userIds: ['ana'] } });
    const refused = await as(admin).del(`/companies/${beta}/people/ana`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toEqual({ code: 'LAST_COMPANY', message: reason });
    expect(people.remove).toHaveBeenCalledWith(['ana'], [beta], { id: 'admin', roles: ['ADMIN'] });
    expect(audit.records.at(-1)!.action).not.toBe('company.people.remove');
  });
});
