import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { randomBytes } from 'node:crypto';
import { startFakeMicrosoft, type FakeMicrosoft } from './fake-microsoft';
import { createMicrosoftClient } from './microsoft-client';
import { createMemoryConnectionStore, type MicrosoftConnectionStore } from './connection-store';
import { createMicrosoftConnections, FLOW_COOKIE, type MicrosoftConnections } from './microsoft-connections';
import { memoryTeamsLinkStore } from './teams-link-store';
import { createTeamsMeetings } from './teams-meetings';
import { registerMicrosoftRoutes } from './microsoft-routes';
import type { MicrosoftConfig } from './microsoft-config';
import { createAuthGuard } from '../../auth/auth-guard';
import { createTokenService } from '../../auth/token-service';
import { HttpError } from '../../../lib/http-errors';
import type { AuditService } from '../../audit/audit-service';
import { memoryMeetings, type MemoryMeetings } from '../../meetings/meeting-memory.fixture';

const tokenService = createTokenService({
  accessSecret: 'ms-access',
  refreshSecret: 'ms-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const bearer = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

let ms: FakeMicrosoft;
let app: FastifyInstance;
let store: MicrosoftConnectionStore;
let connections: MicrosoftConnections | null;
let audited: Array<Record<string, unknown>>;
let meetings: MemoryMeetings;
let invites: string[];

let activeCheck: (id: string) => Promise<boolean> = async () => true;
async function build(enabled = true) {
  const cfg: MicrosoftConfig = {
    clientId: ms.clientId, clientSecret: ms.clientSecret, tenant: { mode: 'single', tenantId: ms.tenantId }, authority: ms.tenantId,
    tokenKey: randomBytes(32), redirectUri: 'http://localhost:4780/api/v1/integrations/microsoft/callback', loginBase: ms.loginBase, graphBase: ms.graphBase,
  };
  const client = createMicrosoftClient({ ...cfg, timeoutMs: 300, retryDelayMs: 1 });
  store = createMemoryConnectionStore();
  connections = enabled ? createMicrosoftConnections({ config: cfg, client, store, isActiveUser: (id) => activeCheck(id) }) : null;
  meetings = memoryMeetings();
  const teams = createTeamsMeetings({ connections, client: enabled ? client : null, store: memoryTeamsLinkStore(meetings.rows), delayMs: 0 });
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: 'VALIDATION' } });
    return reply.status(500).send({ error: { code: 'INTERNAL' } });
  });
  await app.register(
    async (api) =>
      registerMicrosoftRoutes(api, {
        guard: createAuthGuard(tokenService),
        connections,
        teams,
        audit: { async record(d: Record<string, unknown>) { audited.push(d); return {} as never; } } as unknown as AuditService,
        appUrl: 'http://localhost:4780',
        canViewMeeting: async (userId, _r, id) => id !== 'hidden' && userId !== 'stranger',
        canEditMeeting: async (userId) => userId === 'org' || userId === 'manager',
        getMeeting: async (id) => (await meetings.findById(id))!,
        notify: { sendInvites: async (id) => { invites.push(id); return { sent: 1, failed: 0, recipients: [], skipped: [] }; } },
      }),
    { prefix: '/api/v1' },
  );
}

/** Connect as `userId` through the HTTP routes, the way the browser goes: Settings (Connect) → Microsoft → callback. */
async function connectOverHttp(userId: string, opts: { dropCookie?: boolean } = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/microsoft/connect', headers: await bearer(userId) });
  expect(res.statusCode).toBe(200);
  // The signed-in page's own answer sets the flow cookie and names Microsoft's page.
  const setCookie = String(res.headers['set-cookie']);
  expect(setCookie).toMatch(new RegExp(`^${FLOW_COOKIE}=[^;]+; Path=/api/v1/integrations/microsoft; Max-Age=600; HttpOnly; SameSite=Lax`));
  const url = res.json().data.url as string;
  expect(url.startsWith(`${ms.loginBase}/${ms.tenantId}/oauth2/v2.0/authorize?`)).toBe(true);
  const cookie = setCookie.split(';')[0]!;
  const atMicrosoft = await fetch(url, { redirect: 'manual' });
  const back = new URL(atMicrosoft.headers.get('location')!);
  return app.inject({ method: 'GET', url: `${back.pathname}${back.search}`, headers: opts.dropCookie ? {} : { cookie } });
}

beforeAll(async () => {
  ms = await startFakeMicrosoft();
});
afterAll(async () => {
  await ms.close();
});
beforeEach(async () => {
  activeCheck = async () => true;
  audited = [];
  invites = [];
  ms.setDeny(false);
  ms.meetings.clear();
  await build();
});

describe('Settings → Microsoft Teams (staff routes)', () => {
  it('status before connecting: available, not connected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/integrations/microsoft', headers: await bearer('u1') });
    expect(res.json().data).toMatchObject({ available: true, connected: false, email: null });
  });

  it('connect → Microsoft → back to Settings "connected"; Connected as …; an audit entry; no token in any answer', async () => {
    const back = await connectOverHttp('u1');
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe('http://localhost:4780/settings?teams=connected#microsoft-teams');
    expect(String(back.headers['set-cookie'])).toMatch(new RegExp(`^${FLOW_COOKIE}=; .*Max-Age=0`));
    const status = await app.inject({ method: 'GET', url: '/api/v1/integrations/microsoft', headers: await bearer('u1') });
    expect(status.json().data).toMatchObject({ connected: true, email: ms.user.mail, name: ms.user.displayName });
    for (const t of ms.issuedTokens) {
      expect(status.body).not.toContain(t);
      expect(JSON.stringify(audited)).not.toContain(t);
    }
    expect(audited).toEqual([expect.objectContaining({ module: 'integrations', action: 'microsoft.connect', userId: 'u1', newValue: { email: ms.user.mail } })]);
  });

  it('the callback in another browser (no flow cookie) connects nothing', async () => {
    const back = await connectOverHttp('u1', { dropCookie: true });
    expect(back.headers.location).toBe('http://localhost:4780/settings?teams=failed#microsoft-teams');
    expect(await store.get('u1')).toBeNull();
  });

  it('a link from another staff member can’t tie the victim’s Microsoft account to them (connect CSRF)', async () => {
    // Nothing a link opens sets the flow cookie: there is no GET that begins a connection.
    for (const url of ['/api/v1/integrations/microsoft/start?ticket=x', '/api/v1/integrations/microsoft/connect']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    // The attacker begins with their own session and sends the victim Microsoft's address.
    const mine = await app.inject({ method: 'POST', url: '/api/v1/integrations/microsoft/connect', headers: await bearer('attacker') });
    const atMicrosoft = await fetch(mine.json().data.url as string, { redirect: 'manual' });
    const back = new URL(atMicrosoft.headers.get('location')!);
    // The victim's browser (no cookie, or the cookie of its own Connect) comes back: nothing is saved.
    const victimOwn = await app.inject({ method: 'POST', url: '/api/v1/integrations/microsoft/connect', headers: await bearer('victim') });
    const victimCookie = String(victimOwn.headers['set-cookie']).split(';')[0]!;
    for (const headers of [{}, { cookie: victimCookie }]) {
      const res = await app.inject({ method: 'GET', url: `${back.pathname}${back.search}`, headers });
      expect(res.headers.location).toBe('http://localhost:4780/settings?teams=failed#microsoft-teams');
    }
    expect(await store.get('attacker')).toBeNull();
    expect(await store.get('victim')).toBeNull();
  });

  it('an unexpected failure at the callback goes back to Settings ("failed"), never an error page carrying the code', async () => {
    activeCheck = async () => {
      throw new Error('database down');
    };
    const back = await connectOverHttp('u1');
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe('http://localhost:4780/settings?teams=failed#microsoft-teams');
  });

  it('a callback with a forged or missing state goes back to Settings with "failed"', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/integrations/microsoft/callback?code=x&state=forged.state' });
    expect(res.headers.location).toBe('http://localhost:4780/settings?teams=failed#microsoft-teams');
    const none = await app.inject({ method: 'GET', url: '/api/v1/integrations/microsoft/callback?code=x' });
    expect(none.headers.location).toBe('http://localhost:4780/settings?teams=failed#microsoft-teams');
  });

  it('Cancel at Microsoft: back with "denied"', async () => {
    ms.setDeny(true);
    expect((await connectOverHttp('u1')).headers.location).toBe('http://localhost:4780/settings?teams=denied#microsoft-teams');
  });

  it('Disconnect: the connection is deleted, with an audit entry', async () => {
    await connectOverHttp('u1');
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/integrations/microsoft', headers: await bearer('u1') });
    expect(res.statusCode).toBe(200);
    expect(await store.get('u1')).toBeNull();
    expect(audited.at(-1)).toMatchObject({ module: 'integrations', action: 'microsoft.disconnect', userId: 'u1', oldValue: { email: ms.user.mail } });
  });

  it('signed out: 401; a client account: refused (staff only)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/integrations/microsoft' })).statusCode).toBe(401);
    for (const [method, url] of [['GET', '/api/v1/integrations/microsoft'], ['POST', '/api/v1/integrations/microsoft/connect'], ['DELETE', '/api/v1/integrations/microsoft'], ['POST', '/api/v1/meetings/m1/teams-link']] as const) {
      expect((await app.inject({ method, url, headers: await bearer('c1', ['CLIENT']) })).statusCode).toBe(403);
    }
  });

  it('not set up on this server: status says unavailable, Connect is refused plainly', async () => {
    await build(false);
    const status = await app.inject({ method: 'GET', url: '/api/v1/integrations/microsoft', headers: await bearer('u1') });
    expect(status.json().data).toMatchObject({ available: false, connected: false });
    const res = await app.inject({ method: 'POST', url: '/api/v1/integrations/microsoft/connect', headers: await bearer('u1') });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TEAMS_NOT_SET_UP');
  });
});

describe('Make Teams link (a meeting waiting for its link)', () => {
  async function meeting(over: Record<string, unknown> = {}) {
    return meetings.create({ title: 'OXY review', organizerId: 'org', createdById: 'org', status: 'SCHEDULED', startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 90_000_000), ...over });
  }

  it('the organizer makes it; the answer carries the link state', async () => {
    await connectOverHttp('org');
    const m = await meeting();
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${m.id}/teams-link`, headers: await bearer('org') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ made: true, teamsNotice: null, onlineMeetingProvider: 'TEAMS', teamsLinkPending: false });
    expect(res.json().data.onlineLink).toMatch(/^https:\/\/teams\.microsoft\.com\//);
    expect(res.body).not.toMatch(/onlineMeetingId|ownerId/);
  });

  it('invitations already sent: an updated invitation carries the new link', async () => {
    await connectOverHttp('org');
    const m = await meeting({ invitesSentAt: new Date() });
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${m.id}/teams-link`, headers: await bearer('org') });
    await new Promise((r) => setTimeout(r, 10));
    expect(invites).toEqual([m.id]);
  });

  it('someone who may edit but isn’t the organizer: a plain notice; no access: 403; unknown: 404', async () => {
    const m = await meeting();
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${m.id}/teams-link`, headers: await bearer('manager') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.teamsNotice.code).toBe('TEAMS_NOT_ORGANIZER');
    expect((await app.inject({ method: 'POST', url: `/api/v1/meetings/${m.id}/teams-link`, headers: await bearer('viewer') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/meetings/${m.id}/teams-link`, headers: await bearer('stranger') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/meetings/nope/teams-link', headers: await bearer('org') })).statusCode).toBe(404);
  });
});
