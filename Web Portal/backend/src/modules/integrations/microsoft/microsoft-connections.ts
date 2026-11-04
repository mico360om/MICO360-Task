import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MicrosoftConfig } from './microsoft-config';
import { MicrosoftError, tenantOfAccessToken, type MicrosoftClient } from './microsoft-client';
import type { MicrosoftConnectionStore } from './connection-store';
import { createTokenSealer } from './token-crypto';

/**
 * Each person's own Microsoft connection (1.23 Teams links): connecting (OAuth 2.0 authorization code
 * with PKCE S256), the access tokens Teams calls use, Disconnect, and removal when an account is
 * deactivated.
 *
 * Connecting: the website asks for a start ticket (2 minutes, single use, signed for the person); the
 * browser opens /start with it, which sets a flow cookie (HttpOnly) and goes to Microsoft with a state
 * (10 minutes, single use, signed, naming the person) and the PKCE challenge. Microsoft's callback must
 * bring that state back to the same browser (the cookie) — a leaked link can't connect someone else's
 * Microsoft account. The PKCE verifier and the pending flows stay in this server's memory.
 *
 * Refresh tokens are sealed (token-crypto.ts) in the database; access tokens live only in memory; both
 * are never logged, returned or put in an error message. Every token's tenant is checked.
 */

export class NotConnectedError extends Error {
  constructor(message = 'Microsoft Teams isn’t connected.') {
    super(message);
    this.name = 'NotConnectedError';
  }
}

export interface ConnectionStatus {
  /** Teams links are set up on this server. */
  available: boolean;
  connected: boolean;
  email: string | null;
  name: string | null;
  connectedAt: string | null;
  /** Why it stopped working (connect again), else null. */
  problem: string | null;
}

export type ConnectResult = { result: 'connected' | 'denied' | 'failed'; userId: string | null; email: string | null; reason?: 'tenant' | 'state' | 'browser' | 'inactive' | 'microsoft' };

export interface MicrosoftConnectionsDeps {
  config: MicrosoftConfig;
  client: MicrosoftClient;
  store: MicrosoftConnectionStore;
  /** An existing, active account (a deactivated person's connection is never used). */
  isActiveUser: (userId: string) => Promise<boolean>;
  now?: () => Date;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void; info?(msg: string, ctx?: Record<string, unknown>): void };
}

export const FLOW_COOKIE = 'mico_ms_flow';
const TICKET_TTL_MS = 2 * 60_000;
const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 1000;
/** Microsoft's tenant for personal accounts: they can't make Teams meetings through this API. */
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
export const REFUSED = 'Microsoft no longer accepts this connection. Connect Microsoft Teams again.';
const UNREADABLE = 'This server can no longer read the Microsoft connection (its key changed). Connect Microsoft Teams again.';
const TENANT_CHANGED = 'The Microsoft account now belongs to a tenant this site doesn’t allow. Connect Microsoft Teams again.';

const sha256 = (s: string) => createHash('sha256').update(s).digest();

function signer(key: Buffer, purpose: string, now: () => Date) {
  const k = Buffer.from(hkdfSync('sha256', key, 'mico360-ms-oauth', `mico360/microsoft/${purpose}`, 32));
  const sign = (body: string) => createHmac('sha256', k).update(body).digest('base64url');
  return {
    issue(data: Record<string, string>, ttlMs: number): string {
      const body = Buffer.from(JSON.stringify({ ...data, exp: now().getTime() + ttlMs, n: randomBytes(16).toString('base64url') })).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    /** The signed data with its nonce, or null when changed, expired or made for another purpose. */
    read(token: unknown): (Record<string, string> & { n: string; exp: number }) | null {
      if (typeof token !== 'string' || token.length > 2000) return null;
      const [body, sig] = token.split('.');
      if (!body || !sig) return null;
      const want = Buffer.from(sign(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
        const exp = Number(p.exp);
        if (!Number.isFinite(exp) || exp < now().getTime() || typeof p.n !== 'string' || !p.n) return null;
        return Object.fromEntries(Object.entries(p).map(([key, v]) => [key, key === 'exp' ? Number(v) : String(v)])) as Record<string, string> & { n: string; exp: number };
      } catch {
        return null;
      }
    },
  };
}

export function createMicrosoftConnections(deps: MicrosoftConnectionsDeps) {
  const { config, client, store } = deps;
  const now = deps.now ?? (() => new Date());
  const sealer = createTokenSealer(config.tokenKey);
  const tickets = signer(config.tokenKey, 'start-ticket', now);
  const states = signer(config.tokenKey, 'state', now);
  const usedTickets = new Map<string, number>();
  const pending = new Map<string, { userId: string; verifier: string; browser: Buffer; exp: number }>();
  const access = new Map<string, { token: string; until: number }>();
  const refreshing = new Map<string, Promise<string>>();

  function prune(): void {
    const t = now().getTime();
    for (const [n, exp] of usedTickets) if (exp < t) usedTickets.delete(n);
    for (const [n, p] of pending) if (p.exp < t) pending.delete(n);
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  }

  function tenantAllowed(tid: string | null): boolean {
    if (!tid || tid === CONSUMER_TENANT) return false;
    if (config.tenant.mode === 'single') return tid === config.tenant.tenantId.toLowerCase();
    return !config.tenant.allowed || config.tenant.allowed.includes(tid);
  }

  const warn = (msg: string, err: unknown, ctx: Record<string, unknown> = {}) =>
    deps.logger?.warn(msg, { ...ctx, ...(err instanceof MicrosoftError ? { kind: err.kind, status: err.status, code: err.code } : { error: err instanceof Error ? err.name : 'unknown' }) });

  async function status(userId: string): Promise<ConnectionStatus> {
    const row = await store.get(userId);
    return {
      available: true,
      connected: Boolean(row?.refreshTokenEnc && !row.problem),
      email: row?.email ?? null,
      name: row?.displayName ?? null,
      connectedAt: row ? row.connectedAt.toISOString() : null,
      problem: row?.problem ?? null,
    };
  }

  /** The start address's ticket for this person (2 minutes, once). */
  function connectTicket(userId: string): string {
    return tickets.issue({ u: userId }, TICKET_TTL_MS);
  }

  /** /start: Microsoft's sign-in address and the flow cookie, or null when the ticket is no good. */
  function begin(ticket: unknown): { authorizeUrl: string; cookie: { name: string; value: string; maxAgeSeconds: number }; userId: string } | null {
    prune();
    const t = tickets.read(ticket);
    if (!t?.u || usedTickets.has(t.n)) return null;
    usedTickets.set(t.n, t.exp);
    const verifier = randomBytes(32).toString('base64url');
    const browser = randomBytes(24).toString('base64url');
    const state = states.issue({ u: t.u }, STATE_TTL_MS);
    const nonce = states.read(state)!.n;
    pending.set(nonce, { userId: t.u, verifier, browser: sha256(browser), exp: now().getTime() + STATE_TTL_MS });
    return {
      authorizeUrl: client.authorizeUrl({ state, codeChallenge: createHash('sha256').update(verifier).digest('base64url') }),
      cookie: { name: FLOW_COOKIE, value: browser, maxAgeSeconds: STATE_TTL_MS / 1000 },
      userId: t.u,
    };
  }

  /** Microsoft's callback. */
  async function complete(answer: { code?: string; state?: string; error?: string }, browserCookie: string | null | undefined): Promise<ConnectResult> {
    prune();
    const s = states.read(answer.state);
    const flow = s ? pending.get(s.n) : undefined;
    if (s) pending.delete(s.n); // single use, whatever happens next
    if (!s || !flow || flow.userId !== s.u || flow.exp < now().getTime()) return { result: 'failed', userId: null, email: null, reason: 'state' };
    const userId = flow.userId;
    const cookie = typeof browserCookie === 'string' ? browserCookie : '';
    if (!cookie || !timingSafeEqual(sha256(cookie), flow.browser)) return { result: 'failed', userId, email: null, reason: 'browser' };
    if (answer.error) return { result: answer.error === 'access_denied' ? 'denied' : 'failed', userId, email: null };
    if (!answer.code) return { result: 'failed', userId, email: null, reason: 'microsoft' };
    if (!(await deps.isActiveUser(userId))) return { result: 'failed', userId, email: null, reason: 'inactive' };
    try {
      const set = await client.exchangeCode(answer.code, flow.verifier);
      const tid = tenantOfAccessToken(set.accessToken);
      if (!tenantAllowed(tid)) {
        deps.logger?.warn('Microsoft Teams: a sign-in from a tenant this site doesn’t allow was refused', { userId, tenant: tid });
        return { result: 'failed', userId, email: null, reason: 'tenant' };
      }
      const me = await client.me(set.accessToken);
      await store.save({
        userId,
        tenantId: tid!,
        microsoftUserId: me.id,
        email: me.email,
        displayName: me.displayName,
        refreshTokenEnc: sealer.seal(set.refreshToken, userId),
        problem: null,
        connectedAt: now(),
      });
      access.set(userId, { token: set.accessToken, until: set.expiresAt.getTime() });
      return { result: 'connected', userId, email: me.email };
    } catch (err) {
      warn('Microsoft Teams: connecting failed', err, { userId });
      return { result: 'failed', userId, email: null, reason: 'microsoft' };
    }
  }

  async function refreshFor(userId: string): Promise<string> {
    const row = await store.get(userId);
    if (!row?.refreshTokenEnc) throw new NotConnectedError(row?.problem ?? undefined);
    let refresh: string;
    try {
      refresh = sealer.open(row.refreshTokenEnc, userId);
    } catch {
      await store.setProblem(userId, UNREADABLE);
      throw new NotConnectedError(UNREADABLE);
    }
    let set;
    try {
      set = await client.refresh(refresh);
    } catch (err) {
      if (err instanceof MicrosoftError && err.kind === 'auth') await store.setProblem(userId, REFUSED);
      warn('Microsoft Teams: refreshing the connection failed', err, { userId });
      throw err;
    }
    const tid = tenantOfAccessToken(set.accessToken);
    if (!tenantAllowed(tid) || tid !== row.tenantId.toLowerCase()) {
      await store.setProblem(userId, TENANT_CHANGED);
      deps.logger?.warn('Microsoft Teams: a refreshed token from another tenant was refused', { userId, tenant: tid });
      throw new MicrosoftError('tenant', 'The Microsoft account’s tenant isn’t allowed here.');
    }
    await store.setToken(userId, sealer.seal(set.refreshToken, userId));
    access.set(userId, { token: set.accessToken, until: set.expiresAt.getTime() });
    return set.accessToken;
  }

  /** An access token for this person's own account (memory only; one refresh at a time per person). */
  async function accessToken(userId: string): Promise<string> {
    if (!(await deps.isActiveUser(userId))) {
      access.delete(userId);
      throw new NotConnectedError();
    }
    const hit = access.get(userId);
    if (hit && hit.until - 60_000 > now().getTime()) return hit.token;
    const running = refreshing.get(userId);
    if (running) return running;
    const job = refreshFor(userId).finally(() => refreshing.delete(userId));
    refreshing.set(userId, job);
    return job;
  }

  async function disconnect(userId: string): Promise<{ email: string | null } | null> {
    access.delete(userId);
    const row = await store.get(userId);
    if (!row) return null;
    await store.remove(userId);
    return { email: row.email };
  }

  async function removeForUser(userId: string): Promise<boolean> {
    access.delete(userId);
    return store.remove(userId);
  }

  return {
    status,
    connectTicket,
    begin,
    complete,
    accessToken,
    /** Drop a cached access token (Microsoft answered 401 to it). */
    forgetAccess: (userId: string) => void access.delete(userId),
    disconnect,
    removeForUser,
  };
}

export type MicrosoftConnections = ReturnType<typeof createMicrosoftConnections>;
