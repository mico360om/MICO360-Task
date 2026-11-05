import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { registerErrorLogRoutes } from './error-log-routes';
import { createErrorLogService, type ErrorLogService } from './error-log-service';
import { createMemoryErrorLogRepository } from './error-log-repository';
import { createMapStore } from './stack';
import { createAuthGuard } from '../auth/auth-guard';
import { createTokenService } from '../auth/token-service';
import { HttpError } from '../../lib/http-errors';
import type { DatabaseCheckResult } from './database-check';

const tokenService = createTokenService({
  accessSecret: 'el-access',
  refreshSecret: 'el-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const bearer = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

let repo: ReturnType<typeof createMemoryErrorLogRepository>;
let service: ErrorLogService;
let collecting: boolean;
let audited: Record<string, unknown>[];

let check: DatabaseCheckResult | null = null;

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'VALIDATION' } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { code: 'X', message: (err as Error).message } });
  });
  // The API's own global limit (the error routes opt out: they answer 204 whatever happens).
  await app.register(rateLimit, { global: true, max: 20, timeWindow: '1 minute' });
  const userIdOf = (req: { headers: { authorization?: string } }) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    try {
      return tokenService.verifyAccess(h.slice(7)).sub as string;
    } catch {
      return null;
    }
  };
  await app.register(
    async (api) =>
      registerErrorLogRoutes(api, {
        service,
        guard: createAuthGuard(tokenService),
        userIdOf,
        audit: { async record(d: Record<string, unknown>) { audited.push(d); return {} as never; } } as never,
        databaseCheck: { latest: () => check, run: async () => { runs++; check = { ...(check ?? FRESH), checkedAt: '2026-11-05T14:00:00.000Z' }; return check; } },
      }),
    { prefix: '/api/v1' },
  );
  return app;
}

const report = { kind: 'ERROR', detail: 'error', message: 'TypeError: boom', page: '/board', version: '1.22.4' };

beforeEach(() => {
  repo = createMemoryErrorLogRepository();
  collecting = true;
  audited = [];
  service = createErrorLogService({
    repo,
    maps: createMapStore({ webRoot: null }),
    timeZone: 'Asia/Muscat',
    serverVersion: () => '1.22.4',
    collecting: async () => collecting,
    warn: () => {},
    limits: { perAddressPerMinute: 60 },
  });
});

describe('POST /client-errors (any page, signed in or not)', () => {
  it('answers 204 at once, as text/plain JSON (sendBeacon) or JSON; the signed-in person is from the token', async () => {
    const app = await makeApp();
    const a = await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'text/plain;charset=UTF-8', ...(await bearer('u1', ['EMPLOYEE'])) }, payload: JSON.stringify({ reports: [report] }) });
    expect(a.statusCode).toBe(204);
    expect(a.body).toBe('');
    const b = await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'application/json' }, payload: { reports: [report] } });
    expect(b.statusCode).toBe(204);
    await service.settled();
    expect(repo.eventRows.map((e) => [e.userId, e.signedIn])).toEqual([['u1', true], [null, false]]);
  });

  it('a person named in the body is never believed', async () => {
    const app = await makeApp();
    await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'application/json' }, payload: { reports: [{ ...report, userId: 'admin1' }], userId: 'admin1' } });
    await service.settled();
    expect(repo.eventRows[0]!.userId).toBeNull();
  });

  it('204 for everything the page could get wrong: bad JSON, a body over 16 KB, another type, too many', async () => {
    const app = await makeApp();
    const send = (payload: string, type = 'text/plain') => app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': type }, payload });
    expect((await send('{nope')).statusCode).toBe(204);
    expect((await send('{nope', 'application/json')).statusCode).toBe(204);
    expect((await send('x'.repeat(17 * 1024))).statusCode).toBe(204);
    expect((await send('<a/>', 'application/xml')).statusCode).toBe(204);
    for (let i = 0; i < 70; i++) expect((await send(JSON.stringify({ reports: [report] }))).statusCode).toBe(204);
    await service.settled();
    // The address's 60 a minute were taken (the global API limit of 20 doesn't apply here): the
    // text/plain one that wasn't JSON used one of them, so 59 reports were kept.
    expect(repo.groups[0]!.count).toBe(59);
  });

  it('says when collecting is switched off, so the page stops sending', async () => {
    collecting = false;
    const app = await makeApp();
    const r = await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'text/plain' }, payload: JSON.stringify({ reports: [report] }) });
    expect(r.statusCode).toBe(204);
    expect(r.headers['x-collect-browser-errors']).toBe('off');
    collecting = true;
    const on = await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'text/plain' }, payload: JSON.stringify({ reports: [report] }) });
    expect(on.headers['x-collect-browser-errors']).toBeUndefined();
  });
});

describe('POST /client-errors/csp (the browser’s own security-policy reports)', () => {
  it('takes application/csp-report and application/reports+json, always 204', async () => {
    const app = await makeApp();
    const a = await app.inject({
      method: 'POST',
      url: '/api/v1/client-errors/csp',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { 'document-uri': 'https://t/board', 'blocked-uri': 'inline', 'effective-directive': 'script-src-elem' } }),
    });
    expect(a.statusCode).toBe(204);
    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/client-errors/csp',
      headers: { 'content-type': 'application/reports+json' },
      payload: JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://t/projects', blockedURL: 'eval', effectiveDirective: 'script-src' } }]),
    });
    expect(b.statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/v1/client-errors/csp', headers: { 'content-type': 'application/csp-report' }, payload: 'garbage' })).statusCode).toBe(204);
    await service.settled();
    expect(repo.groups.map((g) => g.title).sort()).toEqual(['The security policy blocked script-src-elem: inline', 'The security policy blocked script-src: eval']);
  });
});

describe('the Error log page’s routes: administrators only', () => {
  async function seeded() {
    const app = await makeApp();
    await app.inject({ method: 'POST', url: '/api/v1/client-errors', headers: { 'content-type': 'application/json' }, payload: { reports: [report] } });
    await service.settled();
    return app;
  }

  it('403 for anyone else, 401 signed out', async () => {
    const app = await seeded();
    const id = repo.groups[0]!.id;
    for (const [method, url] of [['GET', '/api/v1/error-log'], ['GET', `/api/v1/error-log/${id}`], ['POST', `/api/v1/error-log/${id}/fixed`], ['DELETE', `/api/v1/error-log/${id}/fixed`], ['POST', '/api/v1/error-log/visit']] as const) {
      expect((await app.inject({ method, url, headers: await bearer('m1', ['PROJECT_MANAGER']) })).statusCode).toBe(403);
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('lists, opens, marks as fixed (audited) and back, and keeps the visit', async () => {
    const app = await seeded();
    const admin = await bearer('admin1', ['ADMIN']);
    const list = await app.inject({ method: 'GET', url: '/api/v1/error-log?kind=errors&range=7d', headers: admin });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: { groups: { id: string; title: string }[]; counts: Record<string, number>; next: string | null } };
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.counts.errors).toBe(1);
    const id = body.data.groups[0]!.id;
    const detail = await app.inject({ method: 'GET', url: `/api/v1/error-log/${id}`, headers: admin });
    expect(detail.json().data.events).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/v1/error-log/nope', headers: admin })).statusCode).toBe(404);
    const fixed = await app.inject({ method: 'POST', url: `/api/v1/error-log/${id}/fixed`, headers: admin });
    expect(fixed.json().data.status).toBe('FIXED');
    expect((await app.inject({ method: 'GET', url: '/api/v1/error-log?status=fixed', headers: admin })).json().data.groups).toHaveLength(1);
    const back = await app.inject({ method: 'DELETE', url: `/api/v1/error-log/${id}/fixed`, headers: admin });
    expect(back.json().data.status).toBe('OPEN');
    expect(audited.map((a) => a.action)).toEqual(['error-log.fixed', 'error-log.not-fixed']);
    expect(audited[0]).toMatchObject({ module: 'error-log', entityId: id, userId: 'admin1' });
    const v1 = await app.inject({ method: 'POST', url: '/api/v1/error-log/visit', headers: admin });
    expect(v1.json().data.previousVisitAt).toBeNull();
    const v2 = await app.inject({ method: 'POST', url: '/api/v1/error-log/visit', headers: admin });
    expect(typeof v2.json().data.previousVisitAt).toBe('string');
  });

  it('checks its query', async () => {
    const app = await seeded();
    const admin = await bearer('admin1', ['ADMIN']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/error-log?kind=everything', headers: admin })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/error-log?range=1y', headers: admin })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/error-log?q=${'x'.repeat(300)}`, headers: admin })).statusCode).toBe(400);
  });
});

// 1.23.1 — the database self-check's result on System Settings → Error log (administrators only).
describe('GET /error-log carries the database check', () => {
  it('null until it ran; then its summary, server and problems — for an administrator only', async () => {
    const app = await makeApp();
    check = null;
    const before = await app.inject({ method: 'GET', url: '/api/v1/error-log', headers: await bearer('a1', ['ADMIN']) });
    expect(before.json().data.databaseCheck).toBeNull();
    check = { checkedAt: '2026-11-05T13:00:00.000Z', ok: false, server: { product: 'MariaDB', version: '11.4.5-MariaDB-log', sqlMode: 'STRICT_TRANS_TABLES', lowerCaseTableNames: 0 }, problems: [{ kind: 'column', name: 'tasks.x', text: 'Column tasks.x is missing' }], summary: 'Database check: 1 problem (MariaDB 11.4.5)', strict: true, pool: 10 };
    const after = await app.inject({ method: 'GET', url: '/api/v1/error-log', headers: await bearer('a1', ['ADMIN']) });
    expect(after.json().data.databaseCheck).toEqual(check);
    expect(after.json().data.groups).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/error-log', headers: await bearer('u1', ['EMPLOYEE']) })).statusCode).toBe(403);
  });
});

// 1.23.2 — "Check again" beside the result (administrators only; a client's session is refused).
let runs = 0;
const FRESH = { checkedAt: '', ok: true, server: null, problems: [], summary: 'Database check: OK (MySQL 8.0.46)', strict: true, pool: 10 };
describe('POST /error-log/database-check runs the check again', () => {
  it('for an administrator: runs it and answers the new result', async () => {
    const app = await makeApp();
    runs = 0;
    check = null;
    const res = await app.inject({ method: 'POST', url: '/api/v1/error-log/database-check', headers: await bearer('a1', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(runs).toBe(1);
    expect(res.json().data).toMatchObject({ summary: 'Database check: OK (MySQL 8.0.46)', checkedAt: '2026-11-05T14:00:00.000Z', strict: true, pool: 10 });
  });

  it('anyone else is refused — an employee, a client account, nobody signed in', async () => {
    const app = await makeApp();
    runs = 0;
    expect((await app.inject({ method: 'POST', url: '/api/v1/error-log/database-check', headers: await bearer('u1', ['EMPLOYEE']) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/error-log/database-check', headers: await bearer('c1', ['CLIENT']) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/error-log/database-check' })).statusCode).toBe(401);
    expect(runs).toBe(0);
  });
});
