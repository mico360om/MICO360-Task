import { MS_SCOPES } from './microsoft-config';

/**
 * Microsoft's sign-in (Entra ID OAuth 2.0 v2, authorization code with PKCE) and the four Graph calls
 * Teams links need, with plain fetch (no Microsoft library). Every call has a time limit; a busy or
 * briefly unavailable Microsoft is tried once more — except a meeting create that may already have
 * reached Microsoft (a timeout or a 500), so one save never makes two Teams meetings. Errors carry our
 * own plain words and Microsoft's error code, never a token or a response body.
 */

/** `config`: the server's own Microsoft settings are refused (a wrong or expired client secret) — no person's connection is at fault. */
export type MicrosoftErrorKind = 'auth' | 'config' | 'denied' | 'forbidden' | 'throttled' | 'unavailable' | 'network' | 'timeout' | 'not-found' | 'bad-response' | 'tenant';

export class MicrosoftError extends Error {
  constructor(
    readonly kind: MicrosoftErrorKind,
    message: string,
    readonly status?: number,
    /** Microsoft's own error code (invalid_grant, Forbidden …): never a token. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MicrosoftError';
  }
}

export interface MicrosoftClientOptions {
  clientId: string;
  clientSecret: string;
  /** The tenant id, or "organizations". */
  authority: string;
  loginBase: string;
  graphBase: string;
  redirectUri: string;
  /** Each call's time limit (8 s). */
  timeoutMs?: number;
  /** The wait before the one retry (0.5 s; a Retry-After up to 2 s is honoured). */
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface MeetingTimes {
  subject: string;
  start: Date;
  end: Date;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The tenant (`tid`) an access token was issued in — read from the token's claims; null when it has none. */
export function tenantOfAccessToken(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { tid?: unknown };
    return typeof claims.tid === 'string' && claims.tid ? claims.tid.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function errorFrom(res: Response, what: string, tokenEndpoint = false): Promise<MicrosoftError> {
  let code: string | undefined;
  let suberror: string | undefined;
  try {
    const body = (await res.json()) as { error?: string | { code?: string }; suberror?: string };
    code = typeof body.error === 'string' ? body.error : body.error?.code;
    suberror = body.suberror;
  } catch {
    /* not JSON */
  }
  const s = res.status;
  // The sign-in server refusing the APP (its client secret expired or was mistyped) is the server's setup:
  // every person's connection is still good once the setting is put right.
  if (tokenEndpoint && (code === 'invalid_client' || code === 'unauthorized_client' || (s === 401 && code !== 'invalid_grant'))) {
    return new MicrosoftError('config', `Microsoft refused this server's app settings — check MS_CLIENT_ID and MS_CLIENT_SECRET (${what}).`, s, code);
  }
  // The person's own connection: refused, revoked, or Microsoft wants them to sign in again.
  if (code === 'invalid_grant' || code === 'interaction_required' || code === 'consent_required' || code === 'login_required' || s === 401) {
    return new MicrosoftError('auth', suberror === 'consent_required' ? `Microsoft needs consent again (${what}).` : `Microsoft no longer accepts this connection (${what}).`, s, code);
  }
  if (code === 'access_denied') return new MicrosoftError('denied', `Microsoft access was declined (${what}).`, s, code);
  if (s === 403) return new MicrosoftError('forbidden', `Microsoft refused (${what}).`, s, code);
  if (s === 404) return new MicrosoftError('not-found', `Microsoft has no such item (${what}).`, s, code);
  if (s === 429) return new MicrosoftError('throttled', `Microsoft is busy (${what}).`, s, code);
  if (s >= 500) return new MicrosoftError('unavailable', `Microsoft is unavailable (${what}).`, s, code);
  return new MicrosoftError('bad-response', `Microsoft answered ${s} (${what}).`, s, code);
}

export function createMicrosoftClient(opts: MicrosoftClientOptions) {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const retryDelay = opts.retryDelayMs ?? 500;
  const login = `${opts.loginBase.replace(/\/+$/, '')}/${encodeURIComponent(opts.authority)}/oauth2/v2.0`;
  const graph = opts.graphBase.replace(/\/+$/, '');
  const scope = MS_SCOPES.join(' ');

  async function once(url: string, init: RequestInit, what: string): Promise<Response> {
    try {
      return await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new MicrosoftError('timeout', `Microsoft didn’t answer in time (${what}).`);
      throw new MicrosoftError('network', `Microsoft couldn’t be reached (${what}).`);
    }
  }

  /**
   * One call, tried once more on 429 / 503 — and, when `safe` (repeating it does no harm), on any 5xx,
   * a timeout or a lost connection too.
   */
  async function call(url: string, init: RequestInit, what: string, safe: boolean): Promise<Response> {
    let res: Response;
    try {
      res = await once(url, init, what);
    } catch (err) {
      if (!safe) throw err;
      await sleep(retryDelay);
      return once(url, init, what);
    }
    const again = res.status === 429 || res.status === 503 || (safe && res.status >= 500);
    if (!again) return res;
    const after = Number(res.headers.get('retry-after'));
    await res.body?.cancel().catch(() => undefined);
    // Microsoft's Retry-After, up to 2 s (a save never waits longer); else the usual short wait.
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(Math.max(after * 1000, retryDelay), 2000) : retryDelay);
    return once(url, init, what);
  }

  async function token(form: Record<string, string>, what: string): Promise<TokenSet> {
    const body = new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, scope, ...form });
    const res = await call(`${login}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, what, true);
    if (!res.ok) throw await errorFrom(res, what, true);
    const data = (await res.json().catch(() => null)) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
    if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
      throw new MicrosoftError('bad-response', `Microsoft’s answer had no tokens (${what}).`);
    }
    const seconds = Number(data.expires_in);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000) };
  }

  const bearer = (access: string, json = false): Record<string, string> => ({ authorization: `Bearer ${access}`, ...(json ? { 'content-type': 'application/json' } : {}) });
  const times = (t: MeetingTimes) => ({ subject: t.subject.slice(0, 250), startDateTime: t.start.toISOString(), endDateTime: t.end.toISOString() });

  return {
    /** Microsoft's sign-in and consent page for one connect. */
    authorizeUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
      const q = new URLSearchParams({
        client_id: opts.clientId,
        response_type: 'code',
        redirect_uri: opts.redirectUri,
        response_mode: 'query',
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return `${login}/authorize?${q.toString()}`;
    },

    exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
      return token({ grant_type: 'authorization_code', code, redirect_uri: opts.redirectUri, code_verifier: codeVerifier }, 'sign-in');
    },

    refresh(refreshToken: string): Promise<TokenSet> {
      return token({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh');
    },

    async me(access: string): Promise<{ id: string; displayName: string | null; email: string | null }> {
      const res = await call(`${graph}/me?$select=id,displayName,mail,userPrincipalName`, { headers: bearer(access) }, 'profile', true);
      if (!res.ok) throw await errorFrom(res, 'profile');
      const me = (await res.json().catch(() => null)) as { id?: unknown; displayName?: unknown; mail?: unknown; userPrincipalName?: unknown } | null;
      if (!me || typeof me.id !== 'string') throw new MicrosoftError('bad-response', 'Microsoft’s profile answer had no id.');
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      return { id: me.id, displayName: str(me.displayName), email: str(me.mail) ?? str(me.userPrincipalName) };
    },

    async createMeeting(access: string, t: MeetingTimes): Promise<{ id: string; joinWebUrl: string }> {
      const res = await call(`${graph}/me/onlineMeetings`, { method: 'POST', headers: bearer(access, true), body: JSON.stringify(times(t)) }, 'create', false);
      if (!res.ok) throw await errorFrom(res, 'create');
      const made = (await res.json().catch(() => null)) as { id?: unknown; joinWebUrl?: unknown } | null;
      const id = typeof made?.id === 'string' ? made.id : '';
      const url = typeof made?.joinWebUrl === 'string' ? made.joinWebUrl : '';
      if (!id || id.length > 500 || !/^https:\/\/[^\s]+$/i.test(url) || url.length > 2000) throw new MicrosoftError('bad-response', 'Microsoft’s answer had no join link.');
      return { id, joinWebUrl: url };
    },

    async updateMeeting(access: string, id: string, t: MeetingTimes): Promise<void> {
      const res = await call(`${graph}/me/onlineMeetings/${encodeURIComponent(id)}`, { method: 'PATCH', headers: bearer(access, true), body: JSON.stringify(times(t)) }, 'update', true);
      if (!res.ok) throw await errorFrom(res, 'update');
      await res.body?.cancel().catch(() => undefined);
    },

    /** 'gone' when Microsoft has no such meeting any more (deleted in Teams already). */
    async deleteMeeting(access: string, id: string): Promise<'deleted' | 'gone'> {
      const res = await call(`${graph}/me/onlineMeetings/${encodeURIComponent(id)}`, { method: 'DELETE', headers: bearer(access) }, 'delete', true);
      if (res.status === 404) return 'gone';
      if (!res.ok) throw await errorFrom(res, 'delete');
      await res.body?.cancel().catch(() => undefined);
      return 'deleted';
    },
  };
}

export type MicrosoftClient = ReturnType<typeof createMicrosoftClient>;
