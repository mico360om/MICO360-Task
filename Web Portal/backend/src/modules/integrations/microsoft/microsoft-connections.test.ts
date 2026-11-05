import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { startFakeMicrosoft, type FakeMicrosoft } from './fake-microsoft';
import { createMicrosoftClient } from './microsoft-client';
import { createMemoryConnectionStore, type MicrosoftConnectionStore } from './connection-store';
import { createMicrosoftConnections, NotConnectedError, type MicrosoftConnections } from './microsoft-connections';
import type { MicrosoftConfig } from './microsoft-config';

let ms: FakeMicrosoft;
let store: MicrosoftConnectionStore;
let svc: MicrosoftConnections;
let logs: string[];
let active: Set<string>;
let clock: number;
const REDIRECT = 'http://localhost:4780/api/v1/integrations/microsoft/callback';
const OTHER_TENANT = '0f0f0f0f-1111-2222-3333-444444444444';

function config(tenant: MicrosoftConfig['tenant']): MicrosoftConfig {
  return {
    clientId: ms.clientId,
    clientSecret: ms.clientSecret,
    tenant,
    authority: tenant.mode === 'single' ? tenant.tenantId : 'organizations',
    tokenKey: randomBytes(32),
    redirectUri: REDIRECT,
    loginBase: ms.loginBase,
    graphBase: ms.graphBase,
  };
}

function build(tenant: MicrosoftConfig['tenant'] = { mode: 'single', tenantId: ms.tenantId }, cfg = config(tenant)) {
  logs = [];
  const logger = { warn: (m: string, c?: Record<string, unknown>) => logs.push(`${m} ${JSON.stringify(c ?? {})}`), info: (m: string, c?: Record<string, unknown>) => logs.push(`${m} ${JSON.stringify(c ?? {})}`) };
  svc = createMicrosoftConnections({
    config: cfg,
    client: createMicrosoftClient({ ...cfg, timeoutMs: 400, retryDelayMs: 1 }),
    store,
    isActiveUser: async (id) => active.has(id),
    now: () => new Date(clock),
    logger,
  });
  return cfg;
}

/** Press Connect, go through the stand-in sign-in, come back to the callback with the browser's cookie. */
async function connect(userId: string, opts: { cookie?: (c: string) => string; state?: (s: string) => string } = {}) {
  const begun = svc.begin(userId);
  const res = await fetch(begun.authorizeUrl, { redirect: 'manual' });
  const back = new URL(res.headers.get('location')!);
  const state = back.searchParams.get('state') ?? '';
  const answer = { code: back.searchParams.get('code') ?? undefined, state: opts.state ? opts.state(state) : state, error: back.searchParams.get('error') ?? undefined };
  return { done: await svc.complete(answer, opts.cookie ? opts.cookie(begun.cookie.value) : begun.cookie.value), answer, cookie: begun.cookie.value };
}

beforeAll(async () => {
  ms = await startFakeMicrosoft();
});
afterAll(async () => {
  await ms.close();
});
beforeEach(() => {
  store = createMemoryConnectionStore();
  active = new Set(['u1', 'u2']);
  clock = Date.now();
  ms.setDeny(false);
  ms.setTokenTenant(ms.tenantId);
  build();
});

describe('Connect Microsoft account (PKCE + a single-use state bound to the person and the browser)', () => {
  it('connects: the refresh token is kept sealed, "Connected as …" shows the account', async () => {
    const { done } = await connect('u1');
    expect(done).toMatchObject({ result: 'connected', userId: 'u1', email: ms.user.mail });
    const row = await store.get('u1');
    expect(row?.refreshTokenEnc).toBeTruthy();
    for (const t of ms.issuedTokens) expect(row!.refreshTokenEnc).not.toContain(t);
    expect(row).toMatchObject({ tenantId: ms.tenantId, microsoftUserId: ms.user.id, email: ms.user.mail, displayName: ms.user.displayName, problem: null });
    expect(await svc.status('u1')).toMatchObject({ available: true, connected: true, email: ms.user.mail, name: ms.user.displayName, problem: null });
    expect(JSON.stringify(await svc.status('u1'))).not.toMatch(/refresh|stand-in-refresh/);
  });

  it('asks Microsoft with S256 PKCE: the challenge in the URL, the verifier only in the token request', async () => {
    await connect('u1');
    const auth = ms.authRequests.at(-1)!;
    const tok = ms.tokenRequests.at(-1)!;
    expect(auth.get('code_challenge_method')).toBe('S256');
    expect(auth.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.get('code_verifier')).toBeNull();
    expect(tok.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('a flow begun by one person can’t connect another person’s Microsoft account (the browser cookie is theirs)', async () => {
    // The attacker begins (their own signed-in page gets the cookie) and sends the victim Microsoft's address.
    const attacker = svc.begin('u1');
    const back = new URL((await fetch(attacker.authorizeUrl, { redirect: 'manual' })).headers.get('location')!);
    // The victim's browser comes back without the attacker's cookie (or with one of its own flow).
    const own = svc.begin('u2');
    expect((await svc.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, own.cookie.value)).result).toBe('failed');
    expect((await svc.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, null)).result).toBe('failed');
    expect(await store.get('u1')).toBeNull();
    expect(await store.get('u2')).toBeNull();
  });

  it('refuses a missing, changed, expired or reused state — nothing is saved', async () => {
    expect((await connect('u1', { state: () => '' })).done.result).toBe('failed');
    expect((await connect('u1', { state: (s) => s.slice(0, -2) + (s.endsWith('A') ? 'BB' : 'AA') })).done.result).toBe('failed');
    expect(await store.get('u1')).toBeNull();
    // Expired: the sign-in took longer than ten minutes.
    const begun = svc.begin('u1');
    const back = new URL((await fetch(begun.authorizeUrl, { redirect: 'manual' })).headers.get('location')!);
    clock += 10 * 60_000 + 1;
    expect((await svc.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, begun.cookie.value)).result).toBe('failed');
    expect(await store.get('u1')).toBeNull();
    // Reused: a state that already connected doesn't connect again.
    clock = Date.now();
    const { answer, cookie } = await connect('u1');
    expect((await svc.complete(answer, cookie)).result).toBe('failed');
  });

  it('refuses the callback in another browser (the flow cookie is missing or different)', async () => {
    expect((await connect('u1', { cookie: () => '' })).done.result).toBe('failed');
    expect((await connect('u1', { cookie: () => randomBytes(24).toString('base64url') })).done.result).toBe('failed');
    expect(await store.get('u1')).toBeNull();
  });

  it('Cancel on Microsoft’s page: "denied", nothing saved', async () => {
    ms.setDeny(true);
    expect((await connect('u1')).done).toMatchObject({ result: 'denied', userId: 'u1' });
    expect(await store.get('u1')).toBeNull();
  });

  it('a person deactivated meanwhile is not connected', async () => {
    const begun = svc.begin('u1');
    const back = new URL((await fetch(begun.authorizeUrl, { redirect: 'manual' })).headers.get('location')!);
    active.delete('u1');
    expect((await svc.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, begun.cookie.value)).result).toBe('failed');
    expect(await store.get('u1')).toBeNull();
  });
});

describe('tenants', () => {
  it('one company: a token from another tenant is refused', async () => {
    ms.setTokenTenant(OTHER_TENANT);
    expect((await connect('u1')).done).toMatchObject({ result: 'failed', reason: 'tenant' });
    expect(await store.get('u1')).toBeNull();
  });

  it('a token without a tenant is refused (fail closed)', async () => {
    ms.setTokenTenant(null);
    expect((await connect('u1')).done.result).toBe('failed');
  });

  it('several tenants: any work tenant, or only the allowed ones; never a personal account', async () => {
    build({ mode: 'multi', allowed: null });
    ms.setTokenTenant(OTHER_TENANT);
    expect((await connect('u1')).done.result).toBe('connected');
    build({ mode: 'multi', allowed: [ms.tenantId] });
    expect((await connect('u2')).done.result).toBe('failed');
    ms.setTokenTenant(ms.tenantId);
    expect((await connect('u2')).done.result).toBe('connected');
    build({ mode: 'multi', allowed: null });
    ms.setTokenTenant('9188040d-6c67-4c5b-b112-36a304b66dad');
    await store.remove('u1');
    expect((await connect('u1')).done.result).toBe('failed');
  });

  it('every refreshed token is checked too', async () => {
    await connect('u1');
    ms.expireAccess();
    svc.forgetAccess('u1');
    ms.setTokenTenant(OTHER_TENANT);
    await expect(svc.accessToken('u1')).rejects.toMatchObject({ kind: 'tenant' });
    expect((await svc.status('u1')).connected).toBe(false);
  });
});

describe('access tokens', () => {
  it('kept in memory only; refreshed when they run out; the rotated refresh token is saved sealed', async () => {
    await connect('u1');
    const sealedBefore = (await store.get('u1'))!.refreshTokenEnc;
    const first = await svc.accessToken('u1');
    expect(await svc.accessToken('u1')).toBe(first); // cached
    clock += 2 * 3600_000; // past its end
    const second = await svc.accessToken('u1');
    expect(second).not.toBe(first);
    expect((await store.get('u1'))!.refreshTokenEnc).not.toBe(sealedBefore);
  });

  it('two calls at once refresh once (a rotated refresh token is never used twice)', async () => {
    await connect('u1');
    svc.forgetAccess('u1');
    const [a, b] = await Promise.all([svc.accessToken('u1'), svc.accessToken('u1')]);
    expect(a).toBe(b);
    expect((await svc.status('u1')).connected).toBe(true);
  });

  it('a revoked connection: marked "connect again", the token dropped, nothing logged with a token', async () => {
    await connect('u1');
    ms.revokeAll();
    svc.forgetAccess('u1');
    await expect(svc.accessToken('u1')).rejects.toMatchObject({ kind: 'auth' });
    const status = await svc.status('u1');
    expect(status.connected).toBe(false);
    expect(status.problem).toMatch(/connect .*again/i);
    expect((await store.get('u1'))!.refreshTokenEnc).toBeNull();
    for (const t of ms.issuedTokens) for (const line of logs) expect(line).not.toContain(t);
  });

  it('not connected: a plain NotConnectedError', async () => {
    await expect(svc.accessToken('u2')).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('a token sealed with another key can’t be read: "connect again"', async () => {
    await connect('u1');
    build(); // a new MS_TOKEN_KEY
    await expect(svc.accessToken('u1')).rejects.toBeInstanceOf(NotConnectedError);
    expect((await svc.status('u1')).problem).toMatch(/connect .*again/i);
  });
});

describe('disconnect and deactivation', () => {
  it('Disconnect deletes the stored connection and forgets the access token', async () => {
    await connect('u1');
    await svc.accessToken('u1');
    expect(await svc.disconnect('u1')).toMatchObject({ email: ms.user.mail });
    expect(await store.get('u1')).toBeNull();
    await expect(svc.accessToken('u1')).rejects.toBeInstanceOf(NotConnectedError);
    expect(await svc.disconnect('u1')).toBeNull();
  });

  it('a deactivated account’s connection is removed, and a deactivated person’s stored one is never used', async () => {
    await connect('u1');
    await connect('u2');
    expect(await svc.removeForUser('u1')).toBe(true);
    expect(await store.get('u1')).toBeNull();
    active.delete('u2');
    await expect(svc.accessToken('u2')).rejects.toBeInstanceOf(NotConnectedError);
  });
});

describe('review fixes: which refusals end a connection', () => {
  it('a wrong or expired client secret (the server’s setup) keeps everyone’s connection: no problem, the sealed token stays', async () => {
    const key = randomBytes(32);
    const good = { ...config({ mode: 'single', tenantId: ms.tenantId }), tokenKey: key };
    build(undefined, good);
    await connect('u1');
    build(undefined, { ...good, clientSecret: 'a-mistyped-secret' });
    await expect(svc.accessToken('u1')).rejects.toMatchObject({ kind: 'config' });
    const row = await store.get('u1');
    expect(row?.refreshTokenEnc).toBeTruthy();
    expect(row?.problem).toBeNull();
    expect(logs.join('\n')).toMatch(/client secret|setup/i);
    // The secret is put right: the same connection works again — nobody connects again.
    build(undefined, good);
    expect(await svc.accessToken('u1')).toBeTruthy();
  });

  it('Microsoft asking the person to sign in again (conditional access) ends it: Settings says connect again', async () => {
    const key = randomBytes(32);
    const good = { ...config({ mode: 'single', tenantId: ms.tenantId }), tokenKey: key };
    build(undefined, good);
    await connect('u1');
    svc.forgetAccess('u1');
    ms.failNext('token', 'interaction_required');
    await expect(svc.accessToken('u1')).rejects.toMatchObject({ kind: 'auth' });
    expect((await svc.status('u1')).problem).toMatch(/again/i);
  });

  it('Disconnect while a refresh is on its way: the refreshed token is not kept', async () => {
    const key = randomBytes(32);
    build(undefined, { ...config({ mode: 'single', tenantId: ms.tenantId }), tokenKey: key });
    await connect('u1');
    svc.forgetAccess('u1');
    const pending = svc.accessToken('u1');
    await svc.disconnect('u1');
    await expect(pending).rejects.toBeInstanceOf(NotConnectedError);
    expect(await store.get('u1')).toBeNull();
    await expect(svc.accessToken('u1')).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('a very long Microsoft display name still connects (kept to the column’s 200 characters)', async () => {
    ms.setUser({ displayName: 'N'.repeat(256) });
    try {
      expect((await connect('u1')).done.result).toBe('connected');
      expect((await store.get('u1'))!.displayName!.length).toBeLessThanOrEqual(200);
    } finally {
      ms.setUser({ displayName: 'Khurram Test' });
    }
  });
});

// Security review (1.23): Connect flows waiting for Microsoft's answer were kept for everyone together,
// the oldest dropped at 1000 — one person pressing Connect a thousand times broke everyone else's.
describe('waiting Connect flows', () => {
  it('each person has one: a new Connect replaces their earlier one, and never drops someone else’s', async () => {
    const victim = svc.begin('u1');
    for (let i = 0; i < 1100; i++) svc.begin('u2');
    const res = await fetch(victim.authorizeUrl, { redirect: 'manual' });
    const back = new URL(res.headers.get('location')!);
    expect((await svc.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, victim.cookie.value)).result).toBe('connected');
    // Their own earlier Connect no longer completes once they pressed it again.
    const first = svc.begin('u3');
    svc.begin('u3');
    const r1 = await fetch(first.authorizeUrl, { redirect: 'manual' });
    const b1 = new URL(r1.headers.get('location')!);
    expect((await svc.complete({ code: b1.searchParams.get('code')!, state: b1.searchParams.get('state')! }, first.cookie.value)).result).toBe('failed');
  });
});

