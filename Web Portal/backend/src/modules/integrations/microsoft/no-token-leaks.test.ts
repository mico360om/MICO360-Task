import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { startFakeMicrosoft, type FakeMicrosoft } from './fake-microsoft';
import { createMicrosoftClient } from './microsoft-client';
import { createMemoryConnectionStore } from './connection-store';
import { createMicrosoftConnections } from './microsoft-connections';
import { memoryTeamsLinkStore } from './teams-link-store';
import { createTeamsMeetings } from './teams-meetings';
import { registerMicrosoftRoutes } from './microsoft-routes';
import type { MicrosoftConfig } from './microsoft-config';
import { createAuthGuard } from '../../auth/auth-guard';
import { createTokenService } from '../../auth/token-service';
import { memoryMeetings } from '../../meetings/meeting-memory.fixture';
import { createMeetingService } from '../../meetings/meeting-service';
import { createLogger } from '../../../lib/logger';

/**
 * Tokens never leave the server's memory and its sealed database column: not in a log line, an error
 * message, an audit entry or an HTTP answer — through every success and failure path.
 */
let ms: FakeMicrosoft;
beforeAll(async () => {
  ms = await startFakeMicrosoft();
});
afterAll(async () => {
  await ms.close();
});

describe('no Microsoft token, secret, code or verifier anywhere it could be seen', () => {
  it('logs, errors, audit entries and answers stay clean through connect, refresh and every Graph failure', async () => {
    const lines: string[] = [];
    // The app's own structured logger, writing to a sink we read (errors are serialised as it does in production).
    const logger = createLogger({ service: 'test', level: 'debug', sink: (line: string) => void lines.push(line) });
    const seen: string[] = [];
    const cfg: MicrosoftConfig = {
      clientId: ms.clientId, clientSecret: ms.clientSecret, tenant: { mode: 'single', tenantId: ms.tenantId }, authority: ms.tenantId,
      tokenKey: randomBytes(32), redirectUri: 'http://localhost:4780/api/v1/integrations/microsoft/callback', loginBase: ms.loginBase, graphBase: ms.graphBase,
    };
    const client = createMicrosoftClient({ ...cfg, timeoutMs: 200, retryDelayMs: 1 });
    const store = createMemoryConnectionStore();
    const connections = createMicrosoftConnections({ config: cfg, client, store, isActiveUser: async () => true, logger });
    const meetings = memoryMeetings();
    const teams = createTeamsMeetings({ connections, client, store: memoryTeamsLinkStore(meetings.rows), logger, delayMs: 0 });
    const meetingService = createMeetingService({ meetings, onChanged: (m, k) => teams.onMeetingChanged(m, k) });
    const tokenService = createTokenService({
      accessSecret: 'leak-access', refreshSecret: 'leak-refresh', accessTtl: 900, refreshTtl: 1000,
      refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
    });
    const audited: unknown[] = [];
    const app = Fastify();
    await app.register(async (api) => registerMicrosoftRoutes(api, {
      guard: createAuthGuard(tokenService), connections, teams, appUrl: 'http://localhost:4780',
      audit: { record: async (d: unknown) => { audited.push(d); return {} as never; } } as never,
      canEditMeeting: async () => true, getMeeting: (id) => meetings.findById(id),
    }), { prefix: '/api/v1' });
    const auth = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'org', roles: ['EMPLOYEE'] })).accessToken}` };
    const call = async (method: 'GET' | 'POST' | 'DELETE', url: string, headers: Record<string, string> = auth) => {
      const res = await app.inject({ method, url, headers });
      seen.push(res.body, JSON.stringify(res.headers));
      return res;
    };
    const connect = async () => {
      const begun = await call('POST', '/api/v1/integrations/microsoft/connect');
      const back = new URL((await fetch(begun.json().data.url as string, { redirect: 'manual' })).headers.get('location')!);
      return call('GET', `${back.pathname}${back.search}`, { cookie: String(begun.headers['set-cookie']).split(';')[0]! });
    };
    const attempt = async (fn: () => Promise<unknown>) => {
      try {
        seen.push(JSON.stringify(await fn()));
      } catch (err) {
        seen.push(String(err), JSON.stringify(err), (err as Error).stack ?? '');
      }
    };

    ms.failNext('token', 500, 2);
    await connect(); // the code exchange fails
    ms.setDeny(true);
    await connect(); // Cancel at Microsoft
    ms.setDeny(false);
    expect((await connect()).headers.location).toMatch(/teams=connected/);
    await call('GET', '/api/v1/integrations/microsoft');

    const m = await meetingService.createMeeting({ title: 'Leak check', organizerId: 'org', createdById: 'org', startAt: new Date(Date.now() + 86_400_000) });
    for (const how of [403, 500, 'hang', 'drop'] as const) {
      ms.failNext('create', how);
      await attempt(() => call('POST', `/api/v1/meetings/${m.id}/teams-link`));
    }
    ms.failNext('create', 401, 2);
    await attempt(() => teams.makeLink(m.id, { id: 'org' }));
    await attempt(() => teams.makeLink(m.id, { id: 'org' }));
    ms.failNext('update', 500, 2);
    await meetingService.updateMeeting(m.id, { title: 'Leak check 2' });
    await teams.idle();
    ms.failNext('delete', 'hang', 2);
    await meetingService.cancelMeeting(m.id);
    await teams.idle();
    // A refused refresh: the connection breaks, and says so.
    ms.revokeAll();
    connections.forgetAccess('org');
    await attempt(() => connections.accessToken('org'));
    await call('GET', '/api/v1/integrations/microsoft');
    await call('DELETE', '/api/v1/integrations/microsoft');

    const secrets = [
      ...ms.issuedTokens,
      ms.clientSecret,
      ...ms.tokenRequests.flatMap((f) => [f.get('code'), f.get('code_verifier'), f.get('refresh_token')]).filter((v): v is string => !!v),
    ];
    expect(secrets.length).toBeGreaterThan(6);
    expect(lines.length).toBeGreaterThan(3);
    const everything = [...lines, ...seen, JSON.stringify(audited)].join('\n');
    for (const s of secrets) expect(everything.includes(s), `a secret leaked: ${s.slice(0, 12)}…`).toBe(false);
  });
});
