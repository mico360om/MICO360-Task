import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { startFakeMicrosoft, type FakeMicrosoft } from './fake-microsoft';
import { createMicrosoftClient, MicrosoftError, tenantOfAccessToken, type MicrosoftClient } from './microsoft-client';

let ms: FakeMicrosoft;
let client: MicrosoftClient;
const REDIRECT = 'http://localhost:4780/api/v1/integrations/microsoft/callback';
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

/** Signs in at the stand-in the way a browser would: follows the sign-in page to the code. */
async function codeFor(url: string): Promise<{ code: string | null; error: string | null; state: string | null }> {
  const res = await fetch(url, { redirect: 'manual' });
  const back = new URL(res.headers.get('location')!);
  return { code: back.searchParams.get('code'), error: back.searchParams.get('error'), state: back.searchParams.get('state') };
}

beforeAll(async () => {
  ms = await startFakeMicrosoft();
});
afterAll(async () => {
  await ms.close();
});
beforeEach(() => {
  client = createMicrosoftClient({
    clientId: ms.clientId,
    clientSecret: ms.clientSecret,
    authority: ms.tenantId,
    loginBase: ms.loginBase,
    graphBase: ms.graphBase,
    redirectUri: REDIRECT,
    timeoutMs: 400,
    retryDelayMs: 1,
  });
});

describe('Microsoft sign-in (authorization code with PKCE)', () => {
  it('asks for the three delegated scopes, with S256 PKCE, the state and the registered redirect address', () => {
    const url = new URL(client.authorizeUrl({ state: 'st-1', codeChallenge: CHALLENGE }));
    expect(url.origin + url.pathname).toBe(`${ms.loginBase}/${ms.tenantId}/oauth2/v2.0/authorize`);
    const q = url.searchParams;
    expect(q.get('client_id')).toBe(ms.clientId);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('redirect_uri')).toBe(REDIRECT);
    expect(q.get('scope')).toBe('OnlineMeetings.ReadWrite User.Read offline_access');
    expect(q.get('state')).toBe('st-1');
    expect(q.get('code_challenge')).toBe(CHALLENGE);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('response_mode')).toBe('query');
    // The secret never goes to the browser.
    expect(url.toString()).not.toContain(ms.clientSecret);
  });

  it('exchanges the code with the verifier, and reads who signed in and their tenant', async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    const set = await client.exchangeCode(code!, VERIFIER);
    expect(set.refreshToken).toMatch(/^0\.stand-in-refresh/);
    expect(set.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(tenantOfAccessToken(set.accessToken)).toBe(ms.tenantId);
    const me = await client.me(set.accessToken);
    expect(me).toEqual({ id: ms.user.id, displayName: ms.user.displayName, email: ms.user.mail });
  });

  it('a wrong verifier is refused (PKCE), and a code works only once', async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    await expect(client.exchangeCode(code!, 'x'.repeat(43))).rejects.toMatchObject({ kind: 'auth' });
    const again = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    await client.exchangeCode(again.code!, VERIFIER);
    await expect(client.exchangeCode(again.code!, VERIFIER)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('a refresh gives a new refresh token (the old one stops working)', async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    const first = await client.exchangeCode(code!, VERIFIER);
    const next = await client.refresh(first.refreshToken);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    await expect(client.refresh(first.refreshToken)).rejects.toMatchObject({ kind: 'auth', code: 'invalid_grant' });
  });

  it('a revoked connection answers invalid_grant ("connect again"), without the token in the message', async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    const set = await client.exchangeCode(code!, VERIFIER);
    ms.revokeAll();
    const err = await client.refresh(set.refreshToken).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MicrosoftError);
    expect((err as MicrosoftError).kind).toBe('auth');
    expect(String((err as Error).message)).not.toContain(set.refreshToken);
    expect(JSON.stringify(err)).not.toContain(set.refreshToken);
  });
});

describe('Teams meetings in Microsoft Graph', () => {
  let access: string;
  beforeEach(async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    access = (await client.exchangeCode(code!, VERIFIER)).accessToken;
  });

  it('creates, updates and deletes an online meeting as the signed-in person', async () => {
    const made = await client.createMeeting(access, { subject: 'Monthly OXY review', start: new Date('2026-12-03T06:00:00Z'), end: new Date('2026-12-03T07:00:00Z') });
    expect(made.joinWebUrl).toMatch(/^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);
    expect(ms.meetings.get(made.id)).toMatchObject({ subject: 'Monthly OXY review', startDateTime: '2026-12-03T06:00:00.000Z', endDateTime: '2026-12-03T07:00:00.000Z' });
    await client.updateMeeting(access, made.id, { subject: 'Monthly OXY review (moved)', start: new Date('2026-12-04T06:00:00Z'), end: new Date('2026-12-04T07:30:00Z') });
    expect(ms.meetings.get(made.id)).toMatchObject({ subject: 'Monthly OXY review (moved)', startDateTime: '2026-12-04T06:00:00.000Z', endDateTime: '2026-12-04T07:30:00.000Z' });
    expect(await client.deleteMeeting(access, made.id)).toBe('deleted');
    expect(ms.meetings.has(made.id)).toBe(false);
    // Already gone at Microsoft: nothing to do.
    expect(await client.deleteMeeting(access, made.id)).toBe('gone');
  });

  it('names each failure plainly: 401, 403, 429 and 500 after one retry, a timeout, a dropped connection', async () => {
    const at = { subject: 'x', start: new Date(), end: new Date(Date.now() + 3600_000) };
    ms.failNext('create', 403);
    await expect(client.createMeeting(access, at)).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
    ms.failNext('create', 401);
    await expect(client.createMeeting(access, at)).rejects.toMatchObject({ kind: 'auth', status: 401 });
    ms.failNext('create', 429, 2);
    await expect(client.createMeeting(access, at)).rejects.toMatchObject({ kind: 'throttled' });
    ms.failNext('update', 500, 2);
    await expect(client.updateMeeting(access, 'any', at)).rejects.toMatchObject({ kind: 'unavailable' });
    ms.failNext('update', 'hang', 2);
    await expect(client.updateMeeting(access, 'any', at)).rejects.toMatchObject({ kind: 'timeout' });
    ms.failNext('delete', 'drop', 2);
    await expect(client.deleteMeeting(access, 'any')).rejects.toMatchObject({ kind: 'network' });
  });

  it('a busy or briefly unavailable Microsoft is tried once more', async () => {
    const at = { subject: 'retry', start: new Date(), end: new Date(Date.now() + 3600_000) };
    ms.failNext('create', 429);
    expect((await client.createMeeting(access, at)).id).toBeTruthy();
    ms.failNext('create', 503);
    expect((await client.createMeeting(access, at)).id).toBeTruthy();
  });

  it('never retries a create that may have reached Microsoft (a timeout or a 500), so no second meeting is made', async () => {
    const before = ms.graphRequests.filter((r) => r.method === 'POST').length;
    ms.failNext('create', 'hang');
    await expect(client.createMeeting(access, { subject: 'once', start: new Date(), end: new Date(Date.now() + 3600_000) })).rejects.toMatchObject({ kind: 'timeout' });
    ms.failNext('create', 500);
    await expect(client.createMeeting(access, { subject: 'once', start: new Date(), end: new Date(Date.now() + 3600_000) })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(ms.graphRequests.filter((r) => r.method === 'POST').length - before).toBe(2);
  });
});

describe('tenant of an access token', () => {
  it('reads tid from the token, or null when it has none or is not a JWT', () => {
    const tok = (p: unknown) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(p)).toString('base64url')}.sig`;
    expect(tenantOfAccessToken(tok({ tid: 'ABC-1' }))).toBe('abc-1');
    expect(tenantOfAccessToken(tok({ oid: 'x' }))).toBeNull();
    expect(tenantOfAccessToken('opaque-token')).toBeNull();
  });
});

describe('review fixes', () => {
  it('a wrong client secret is the server’s setup (kind config), not the person’s connection', async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    const set = await client.exchangeCode(code!, VERIFIER);
    const wrong = createMicrosoftClient({ clientId: ms.clientId, clientSecret: 'mistyped', authority: ms.tenantId, loginBase: ms.loginBase, graphBase: ms.graphBase, redirectUri: REDIRECT, timeoutMs: 400, retryDelayMs: 1 });
    await expect(wrong.refresh(set.refreshToken)).rejects.toMatchObject({ kind: 'config', code: 'invalid_client' });
  });

  it('interaction_required on a refresh ends the connection (kind auth)', async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    const set = await client.exchangeCode(code!, VERIFIER);
    ms.failNext('token', 'interaction_required');
    await expect(client.refresh(set.refreshToken)).rejects.toMatchObject({ kind: 'auth', code: 'interaction_required' });
  });

  it('honours Retry-After (up to 2 s) before the one retry', async () => {
    const { code } = await codeFor(client.authorizeUrl({ state: 's', codeChallenge: CHALLENGE }));
    const access = (await client.exchangeCode(code!, VERIFIER)).accessToken;
    ms.failNext('create', 429); // the stand-in says Retry-After: 1
    const t0 = Date.now();
    await client.createMeeting(access, { subject: 'wait', start: new Date(), end: new Date(Date.now() + 3600_000) });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });
});
