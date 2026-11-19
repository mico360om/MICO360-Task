import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { ForbiddenError } from '../../lib/http-errors';
import type { AppreciationService } from './appreciation-service';
import { appreciationXlsx } from './appreciation-routes';
import { unzipText } from '../../lib/xlsx-inspect';

// Employee Appreciation over HTTP: signed-out 401, a client account refused by the route table, bodies checked,
// the service asked as the signed-in person, the Excel file sent as an attachment.
const tokenService = createTokenService({
  accessSecret: 'ap-access',
  refreshSecret: 'ap-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const row = {
  id: 'a1', batchId: 'b1', title: 'Great Teamwork', message: 'Thanks Sara', theme: 'ocean', icon: 'team', animation: 'none', day: '2026-11-18',
  startsAt: '2026-11-17T20:00:00.000Z', endsAt: '2026-11-18T20:00:00.000Z', status: 'ACCEPTED', acceptedAt: '2026-11-18T05:00:00.000Z', popupClosedAt: null,
  sender: { id: 'm', name: 'Omar Said' }, company: { name: 'Contoso', logoUrl: null }, recipient: { id: 'sara', name: 'Sara Khan' }, companyId: 'c1',
  templateId: null, templateName: null, createdAt: '2026-11-17T08:00:00.000Z', cancelledAt: null, rawMessage: 'Thanks {name}', acceptNote: 'Thank you, it means a lot',
};

async function app() {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (name: string, out: unknown) => async (...args: unknown[]) => {
    calls.push([name, args]);
    if (args[0] === 'emp' && !['me', 'mine', 'accept', 'closePopup'].includes(name)) throw new ForbiddenError();
    return out;
  };
  const service = {
    me: rec('me', { canManage: false, today: '2026-11-18', serverNow: '2026-11-18T05:00:00.000Z', live: [] }),
    mine: rec('mine', []),
    accept: rec('accept', { acceptedAt: '2026-11-18T05:00:00.000Z', already: false }),
    closePopup: rec('closePopup', { popupClosedAt: '2026-11-18T05:00:00.000Z' }),
    templates: rec('templates', []),
    createTemplate: rec('createTemplate', { id: 't1' }),
    updateTemplate: rec('updateTemplate', { id: 't1' }),
    duplicateTemplate: rec('duplicateTemplate', { id: 't2' }),
    archiveTemplate: rec('archiveTemplate', { id: 't1' }),
    companies: rec('companies', []),
    people: rec('people', []),
    schedule: rec('schedule', { batchId: 'b1', ids: ['a1'] }),
    list: rec('list', { total: 0, page: 1, pageSize: 50, rows: [] }),
    exportRows: rec('exportRows', [row]),
    update: rec('update', row),
    cancel: rec('cancel', row),
    today: () => '2026-11-18',
  } as unknown as AppreciationService;
  const a = await buildApp({ authService, tokenService, appreciations: { service, timeZone: 'Asia/Muscat' } });
  const as = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
  return { a, as, calls };
}

const send = { recipientIds: ['sara'], day: '2026-11-20', title: 'Great Teamwork', message: 'Thanks {name}', theme: 'ocean', icon: 'team', animation: 'confetti' };

describe('appreciation routes', () => {
  it('signed out: 401; a client account: 403 CLIENT_NOT_ALLOWED on every route', async () => {
    const { a, as } = await app();
    expect((await a.inject({ method: 'GET', url: '/api/v1/appreciations/me' })).statusCode).toBe(401);
    for (const [method, url] of [['GET', '/api/v1/appreciations/me'], ['POST', '/api/v1/appreciations/me/a1/accept'], ['GET', '/api/v1/appreciations/manage'], ['GET', '/api/v1/appreciations/manage/templates']] as const) {
      const r = await a.inject({ method, url, headers: await as('cl', ['CLIENT']) });
      expect(r.statusCode).toBe(403);
      expect(r.json().error?.code ?? r.json().code).toBe('CLIENT_NOT_ALLOWED');
    }
  });

  it('the person’s own routes ask the service as them', async () => {
    const { a, as, calls } = await app();
    expect((await a.inject({ method: 'GET', url: '/api/v1/appreciations/me', headers: await as('emp') })).json().data.today).toBe('2026-11-18');
    expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/me/a1/accept', headers: await as('emp') })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/me/a1/close', headers: await as('emp') })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/v1/appreciations/me/history', headers: await as('emp') })).statusCode).toBe(200);
    expect(calls.map(([n, args]) => [n, args[0], args[1]])).toEqual([['me', 'emp', undefined], ['accept', 'emp', 'a1'], ['closePopup', 'emp', 'a1'], ['mine', 'emp', undefined]]);
    expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/me/bad%20id!/accept', headers: await as('emp') })).statusCode).toBe(404);
  });

  it('managing: an employee is refused by the service (403); bodies are checked (400)', async () => {
    const { a, as } = await app();
    expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/manage', headers: await as('emp'), payload: send })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/manage', headers: await as('mgr'), payload: send })).statusCode).toBe(201);
    for (const bad of [{ ...send, recipientIds: [] }, { ...send, theme: 'neon' }, { ...send, theme: '#12345' }, { ...send, theme: '#12345g' }, { ...send, theme: 'rgb(1,2,3)' }, { ...send, icon: 'unicorn' }, { ...send, animation: 'fireworks' }, { ...send, title: '' }, { ...send, message: 'x'.repeat(1001) }, { ...send, day: '18 Nov' }, { ...send, extra: 1 }]) {
      expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/manage', headers: await as('mgr'), payload: bad })).statusCode).toBe(400);
    }
    expect((await a.inject({ method: 'PATCH', url: '/api/v1/appreciations/manage/a1', headers: await as('mgr'), payload: {} })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PATCH', url: '/api/v1/appreciations/manage/a1', headers: await as('mgr'), payload: { title: 'New' } })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/v1/appreciations/manage?status=WRONG', headers: await as('mgr') })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/api/v1/appreciations/manage?status=EXPIRED&page=2', headers: await as('mgr') })).statusCode).toBe(200);
    expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/manage/templates', headers: await as('mgr'), payload: { name: 'N', ...send, recipientIds: undefined, day: undefined } })).statusCode).toBe(201);
  });

  it('1.24.4: a new theme, a new icon and a custom colour pass; the colour reaches the service in lower case', async () => {
    const { a, as, calls } = await app();
    for (const ok of [{ ...send, theme: 'plum', icon: 'handshake' }, { ...send, theme: '#1E6091', icon: 'thumbs-up' }]) {
      expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/manage', headers: await as('mgr'), payload: ok })).statusCode).toBe(201);
    }
    const tpl = { name: 'N', title: 'T', message: 'M', theme: '#F5F5A0', icon: 'sun', animation: 'none' };
    expect((await a.inject({ method: 'POST', url: '/api/v1/appreciations/manage/templates', headers: await as('mgr'), payload: tpl })).statusCode).toBe(201);
    expect((await a.inject({ method: 'PATCH', url: '/api/v1/appreciations/manage/a1', headers: await as('mgr'), payload: { theme: '#ABCDEF' } })).statusCode).toBe(200);
    const themes = calls.filter(([n]) => ['schedule', 'createTemplate', 'update'].includes(n)).map(([, args]) => JSON.stringify(args).match(/"theme":"([^"]+)"/)?.[1]);
    expect(themes).toEqual(['plum', '#1e6091', '#f5f5a0', '#abcdef']);
  });

  it('the history as an Excel file (attachment)', async () => {
    const { a, as } = await app();
    const r = await a.inject({ method: 'GET', url: '/api/v1/appreciations/manage/export.xlsx?status=ACCEPTED', headers: await as('mgr') });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect(r.headers["content-disposition"]).toBe("attachment; filename=\"Appreciations 18 Nov 2026.xlsx\""); // the company’s day
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  // 1.24.1: an optional note for the manager with the accept.
  it('accept takes an optional note (trimmed, up to 500 characters, plain text); anything else is refused', async () => {
    const { a, as, calls } = await app();
    const post = async (payload?: unknown) => a.inject({ method: 'POST', url: '/api/v1/appreciations/me/a1/accept', headers: await as('emp'), ...(payload === undefined ? {} : { payload: payload as object }) });
    expect((await post()).statusCode).toBe(200);
    expect((await post({})).statusCode).toBe(200);
    expect((await post({ note: '  Thank you!  ' })).statusCode).toBe(200);
    expect((await post({ note: '   ' })).statusCode).toBe(200);
    expect((await post({ note: 'x'.repeat(500) })).statusCode).toBe(200);
    expect((await post({ note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await post({ note: 5 })).statusCode).toBe(400);
    expect((await post({ note: null })).statusCode).toBe(200);
    expect(calls.filter(([n]) => n === 'accept').map(([, args]) => args[2])).toEqual([null, null, 'Thank you!', null, 'x'.repeat(500), null]);
  });

  it('the history can be asked for one record (the sender’s bell notice links to it)', async () => {
    const { a, as, calls } = await app();
    expect((await a.inject({ method: 'GET', url: '/api/v1/appreciations/manage?id=a1', headers: await as('mgr') })).statusCode).toBe(200);
    expect(calls.find(([n]) => n === 'list')![1][1]).toMatchObject({ id: 'a1' });
    expect((await a.inject({ method: 'GET', url: '/api/v1/appreciations/manage?id=bad%20id', headers: await as('mgr') })).statusCode).toBe(400);
  });

  it('the Excel file has a Note column (the note as written)', () => {
    const xml = unzipText(appreciationXlsx([row as never], 'Asia/Muscat', new Date('2026-11-18T06:00:00.000Z'))).get('xl/worksheets/sheet1.xml')!;
    expect(xml).toContain('Note');
    expect(xml).toContain('Thank you, it means a lot');
  });
});
