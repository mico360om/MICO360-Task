import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Microsoft's sign-in (Entra ID OAuth 2.0 v2) and the few Microsoft Graph calls Teams
 * links need — for tests and local browser checks only. It listens on 127.0.0.1, checks the request
 * the way Microsoft does (client id and secret, redirect address, PKCE S256, single-use codes, rotating
 * refresh tokens, bearer tokens) and can be told to fail: 401/403/429/500, a hang, a dropped
 * connection, `invalid_grant`, another tenant. Never part of the running app (MS_LOGIN_BASE_URL and
 * MS_GRAPH_BASE_URL point at Microsoft unless a test sets them).
 */

export interface FakeTeamsMeeting {
  id: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
  joinWebUrl: string;
  /** The Microsoft user (oid) whose account made it. */
  ownerOid: string;
}

export interface FakeMicrosoftUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}

export type FakeOp = 'authorize' | 'token' | 'me' | 'create' | 'update' | 'delete';
/** A status to answer with, a call that never answers ('hang'), a closed connection ('drop'), or a refused refresh token. */
export type FakeFailure = number | 'hang' | 'drop' | 'invalid_grant' | 'consent_required';

export interface FakeMicrosoft {
  base: string;
  loginBase: string;
  graphBase: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  user: FakeMicrosoftUser;
  meetings: Map<string, FakeTeamsMeeting>;
  /** Every sign-in page request, every token request (form fields) and every Graph call. */
  authRequests: URLSearchParams[];
  tokenRequests: URLSearchParams[];
  graphRequests: Array<{ method: string; path: string; body: unknown }>;
  /** Every access and refresh token given out (tests check none of them shows up anywhere). */
  issuedTokens: string[];
  /** The next `times` calls of `op` fail as told. */
  failNext(op: FakeOp, how: FakeFailure, times?: number): void;
  /** The sign-in page answers "access denied" (the person pressed Cancel). */
  setDeny(deny: boolean): void;
  /** The tenant (directory) put into new tokens — another company's, say. */
  setTokenTenant(tid: string | null): void;
  /** The person signing in (a different account each test, if wanted). */
  setUser(user: Partial<FakeMicrosoftUser>): void;
  /** Takes back every token (the person removed the app's access, or an admin revoked it). */
  revokeAll(): void;
  /** Every access token given so far runs out (the refresh tokens still work). */
  expireAccess(): void;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of req) parts.push(c as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const graphError = (code: string, message: string) => ({ error: { code, message } });

export interface FakeMicrosoftOptions {
  port?: number;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  user?: Partial<FakeMicrosoftUser>;
  /** Show a small "Accept / Cancel" page at sign-in instead of answering at once (browser checks). */
  interactive?: boolean;
}

export async function startFakeMicrosoft(opts: FakeMicrosoftOptions = {}): Promise<FakeMicrosoft> {
  const clientId = opts.clientId ?? '0e3c6d4a-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const clientSecret = opts.clientSecret ?? `stand-in-secret-${randomBytes(6).toString('hex')}`;
  const tenantId = opts.tenantId ?? '7d1f2e3a-4b5c-4d6e-9f80-112233445566';
  const user: FakeMicrosoftUser = {
    id: randomUUID(),
    displayName: 'Khurram Test',
    mail: 'khurram@prolens.example',
    userPrincipalName: 'khurram@prolens.example',
    ...opts.user,
  };
  const meetings = new Map<string, FakeTeamsMeeting>();
  const codes = new Map<string, { redirectUri: string; challenge: string; scope: string; user: FakeMicrosoftUser }>();
  const refreshTokens = new Map<string, FakeMicrosoftUser>();
  const accessTokens = new Map<string, FakeMicrosoftUser>();
  const authRequests: URLSearchParams[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const graphRequests: FakeMicrosoft['graphRequests'] = [];
  const issuedTokens: string[] = [];
  const failures = new Map<FakeOp, FakeFailure[]>();
  const hung = new Set<ServerResponse>();
  let deny = false;
  let tokenTenant: string | null = tenantId;
  let base = '';

  function failure(op: FakeOp): FakeFailure | undefined {
    const list = failures.get(op);
    return list?.shift();
  }

  /** Answers a planned failure; true when it did (the handler stops). */
  function failed(op: FakeOp, res: ServerResponse): boolean {
    const how = failure(op);
    if (how === undefined) return false;
    if (how === 'hang') {
      hung.add(res);
      return true;
    }
    if (how === 'drop') {
      res.socket?.destroy();
      return true;
    }
    if (how === 'invalid_grant') {
      json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS70008: The provided authorization code or refresh token has expired due to inactivity.', error_codes: [70008] });
      return true;
    }
    if (how === 'consent_required') {
      json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented to use the application.', suberror: 'consent_required', error_codes: [65001] });
      return true;
    }
    const code = how === 401 ? 'InvalidAuthenticationToken' : how === 403 ? 'Forbidden' : how === 429 ? 'TooManyRequests' : how >= 500 ? 'ServiceNotAvailable' : 'BadRequest';
    json(res, how, graphError(code, `Stand-in failure ${how}.`), how === 429 ? { 'retry-after': '1' } : {});
    return true;
  }

  function accessToken(u: FakeMicrosoftUser, scope: string): string {
    const payload: Record<string, unknown> = { aud: 'https://graph.microsoft.com', oid: u.id, upn: u.userPrincipalName, scp: scope, exp: Math.floor(Date.now() / 1000) + 3600, n: randomBytes(6).toString('hex') };
    if (tokenTenant) payload.tid = tokenTenant;
    const token = `${b64({ typ: 'JWT', alg: 'none' })}.${b64(payload)}.${randomBytes(16).toString('base64url')}`;
    accessTokens.set(token, u);
    issuedTokens.push(token);
    return token;
  }

  function tokens(u: FakeMicrosoftUser, scope: string) {
    const refresh = `0.stand-in-refresh.${randomBytes(24).toString('base64url')}`;
    refreshTokens.set(refresh, u);
    issuedTokens.push(refresh);
    return { token_type: 'Bearer', scope, expires_in: 3599, ext_expires_in: 3599, access_token: accessToken(u, scope), refresh_token: refresh };
  }

  function bearer(req: IncomingMessage): FakeMicrosoftUser | null {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return accessTokens.get(token) ?? null;
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base);
      const path = url.pathname;
      try {
        // ── Sign-in and consent: /{tenant}/oauth2/v2.0/authorize
        let m = path.match(/^\/([^/]+)\/oauth2\/v2\.0\/authorize$/);
        if (req.method === 'GET' && m) {
          authRequests.push(url.searchParams);
          if (failed('authorize', res)) return;
          const q = url.searchParams;
          const redirect = q.get('redirect_uri') ?? '';
          if (q.get('client_id') !== clientId || !redirect) return json(res, 400, { error: 'invalid_request', error_description: 'AADSTS700016: Application not found.' });
          const back = new URL(redirect);
          const state = q.get('state');
          if (state !== null) back.searchParams.set('state', state);
          if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) {
            back.searchParams.set('error', 'invalid_request');
          } else if (deny || url.searchParams.get('stand_in_answer') === 'cancel') {
            back.searchParams.set('error', 'access_denied');
            back.searchParams.set('error_description', 'AADSTS65004: User declined to consent to access the app.');
          } else if (opts.interactive && url.searchParams.get('stand_in_answer') !== 'accept') {
            const accept = new URL(url.toString());
            accept.searchParams.set('stand_in_answer', 'accept');
            const cancel = new URL(url.toString());
            cancel.searchParams.set('stand_in_answer', 'cancel');
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(
              `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Stand-in Microsoft sign-in</title>` +
                `<body style="font-family:system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem"><p style="color:#a00;font-weight:600">Test stand-in — not Microsoft</p>` +
                `<h1 style="font-size:1.3rem">Let MICO360 Tasks make Teams meetings for ${user.userPrincipalName}?</h1>` +
                `<p>Scopes asked for: ${q.get('scope') ?? ''}</p><p><a id="accept" href="${accept.toString().replace(/"/g, '&quot;')}">Accept</a> · <a id="cancel" href="${cancel.toString().replace(/"/g, '&quot;')}">Cancel</a></p></body>`,
            );
          } else {
            const code = `stand-in-code-${randomBytes(12).toString('base64url')}`;
            codes.set(code, { redirectUri: redirect, challenge: q.get('code_challenge')!, scope: q.get('scope') ?? '', user: { ...user } });
            back.searchParams.set('code', code);
          }
          res.writeHead(302, { location: back.toString() });
          return res.end();
        }
        // ── Tokens: /{tenant}/oauth2/v2.0/token
        m = path.match(/^\/([^/]+)\/oauth2\/v2\.0\/token$/);
        if (req.method === 'POST' && m) {
          const form = new URLSearchParams(await readBody(req));
          tokenRequests.push(form);
          if (failed('token', res)) return;
          if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
            return json(res, 401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
          }
          const grant = form.get('grant_type');
          if (grant === 'authorization_code') {
            const code = form.get('code') ?? '';
            const c = codes.get(code);
            codes.delete(code); // single use, even when the rest is wrong
            if (!c || c.redirectUri !== form.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS70008: The provided authorization code is invalid or expired.' });
            const verifier = form.get('code_verifier') ?? '';
            if (createHash('sha256').update(verifier).digest('base64url') !== c.challenge) {
              return json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS501481: The Code_Verifier does not match the code_challenge supplied in the authorization request.' });
            }
            return json(res, 200, tokens(c.user, c.scope));
          }
          if (grant === 'refresh_token') {
            const refresh = form.get('refresh_token') ?? '';
            const u = refreshTokens.get(refresh);
            if (!u) return json(res, 400, { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired or was revoked.' });
            refreshTokens.delete(refresh); // strict rotation: the old one never works again
            return json(res, 200, tokens(u, form.get('scope') ?? ''));
          }
          return json(res, 400, { error: 'unsupported_grant_type' });
        }
        // ── Graph
        if (path.startsWith('/v1.0/')) {
          const raw = req.method === 'GET' || req.method === 'DELETE' ? '' : await readBody(req);
          let body: unknown = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = raw;
          }
          graphRequests.push({ method: req.method ?? 'GET', path: path + url.search, body });
          const op: FakeOp | null =
            path === '/v1.0/me' ? 'me' : path === '/v1.0/me/onlineMeetings' ? 'create' : path.startsWith('/v1.0/me/onlineMeetings/') ? (req.method === 'DELETE' ? 'delete' : 'update') : null;
          if (op && failed(op, res)) return;
          const who = bearer(req);
          if (!who) return json(res, 401, graphError('InvalidAuthenticationToken', 'Access token has expired or is not yet valid.'));
          if (req.method === 'GET' && path === '/v1.0/me') {
            return json(res, 200, { id: who.id, displayName: who.displayName, mail: who.mail, userPrincipalName: who.userPrincipalName });
          }
          if (req.method === 'POST' && path === '/v1.0/me/onlineMeetings') {
            const b = (body ?? {}) as Partial<FakeTeamsMeeting>;
            if (!b.startDateTime || !b.endDateTime) return json(res, 400, graphError('BadRequest', 'startDateTime and endDateTime are required.'));
            const id = `MSo${randomBytes(18).toString('base64url')}`;
            const meeting: FakeTeamsMeeting = {
              id,
              subject: b.subject ?? '',
              startDateTime: b.startDateTime,
              endDateTime: b.endDateTime,
              joinWebUrl: `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${randomBytes(12).toString('hex')}%40thread.v2/0?context=%7b%22Tid%22%3a%22${tokenTenant ?? ''}%22%7d`,
              ownerOid: who.id,
            };
            meetings.set(id, meeting);
            return json(res, 201, { ...meeting, ownerOid: undefined, creationDateTime: new Date().toISOString() });
          }
          m = path.match(/^\/v1\.0\/me\/onlineMeetings\/([^/]+)$/);
          if (m) {
            const id = decodeURIComponent(m[1]!);
            const meeting = meetings.get(id);
            if (!meeting || meeting.ownerOid !== who.id) return json(res, 404, graphError('NotFound', 'The meeting was not found.'));
            if (req.method === 'PATCH') {
              const b = (body ?? {}) as Partial<FakeTeamsMeeting>;
              if (b.subject !== undefined) meeting.subject = b.subject;
              if (b.startDateTime !== undefined) meeting.startDateTime = b.startDateTime;
              if (b.endDateTime !== undefined) meeting.endDateTime = b.endDateTime;
              return json(res, 200, { ...meeting, ownerOid: undefined });
            }
            if (req.method === 'DELETE') {
              meetings.delete(id);
              res.writeHead(204);
              return res.end();
            }
          }
          return json(res, 404, graphError('NotFound', 'Unknown stand-in Graph call.'));
        }
        return json(res, 404, { error: 'not_found' });
      } catch (err) {
        json(res, 500, { error: 'server_error', error_description: String(err) });
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    base,
    loginBase: base,
    graphBase: `${base}/v1.0`,
    clientId,
    clientSecret,
    tenantId,
    user,
    meetings,
    authRequests,
    tokenRequests,
    graphRequests,
    issuedTokens,
    failNext(op, how, times = 1) {
      const list = failures.get(op) ?? [];
      for (let i = 0; i < times; i++) list.push(how);
      failures.set(op, list);
    },
    setDeny(d) {
      deny = d;
    },
    setTokenTenant(tid) {
      tokenTenant = tid;
    },
    setUser(u) {
      Object.assign(user, u);
    },
    revokeAll() {
      refreshTokens.clear();
      accessTokens.clear();
    },
    expireAccess() {
      accessTokens.clear();
    },
    async close() {
      for (const res of hung) res.socket?.destroy();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
