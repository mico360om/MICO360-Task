import { createSign } from 'node:crypto';
import type { PushMessage, PushSendResult, PushTransport } from './push-sender';

/**
 * Firebase Cloud Messaging (HTTP v1) push transport, dependency-free: the service-account JWT is
 * signed with node:crypto, exchanged for an OAuth access token (cached until shortly before it
 * expires), and each device gets its own `messages:send` call.
 */

/** The fields of a Firebase service-account key file this transport needs. */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface FcmTransportDeps {
  serviceAccount: FcmServiceAccount;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** Renew the OAuth token this long before Google says it expires. */
const TOKEN_SLACK_MS = 60_000;

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/**
 * Parse a service-account key (the JSON downloaded from Firebase → Project settings → Service
 * accounts). Returns null when required fields are missing.
 */
export function parseServiceAccount(json: string): FcmServiceAccount | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (k: string) => (typeof raw[k] === 'string' && (raw[k] as string).trim() ? (raw[k] as string) : null);
  const projectId = str('project_id');
  const clientEmail = str('client_email');
  const privateKey = str('private_key');
  if (!projectId || !clientEmail || !privateKey) return null;
  return {
    project_id: projectId,
    client_email: clientEmail,
    // Keys pasted into env vars often carry literal "\n" sequences instead of newlines.
    private_key: privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey,
    ...(str('token_uri') ? { token_uri: str('token_uri')! } : {}),
  };
}

/** A signed RS256 JWT asserting the service account, for Google's OAuth token endpoint. */
export function signServiceAccountJwt(account: FcmServiceAccount, nowMs: number): string {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? DEFAULT_TOKEN_URI, iat, exp: iat + 3600 }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

/** Did FCM say this device token is dead (app uninstalled, token rotated, wrong project)? */
function isDeadToken(status: number, body: unknown): boolean {
  const error = (body as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null)?.error;
  const codes = (error?.details ?? []).map((d) => d?.errorCode).filter(Boolean);
  if (codes.includes('UNREGISTERED') || codes.includes('SENDER_ID_MISMATCH')) return true;
  if (status === 404 && error?.status === 'NOT_FOUND') return true;
  // A malformed token is INVALID_ARGUMENT too, but so is a bad payload — only prune when it's the token.
  return status === 400 && codes.includes('INVALID_ARGUMENT') && /registration token/i.test(error?.message ?? '');
}

/** FCM data values must be strings. */
function stringData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return out;
}

/** An FCM transport always reports which tokens were dead. */
export interface FcmTransport extends PushTransport {
  send(messages: PushMessage[]): Promise<PushSendResult>;
}

export function createFcmTransport({ serviceAccount, fetchImpl = fetch, now = () => Date.now() }: FcmTransportDeps): FcmTransport {
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`;

  async function fetchAccessToken(): Promise<string> {
    const res = await fetchImpl(serviceAccount.token_uri ?? DEFAULT_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signServiceAccountJwt(serviceAccount, now()),
      }).toString(),
    });
    if (!res.ok) throw new Error(`FCM auth failed (${res.status}).`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('FCM auth returned no access token.');
    cached = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  /** The cached OAuth token, or one shared refresh for all concurrent sends. */
  function accessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && cached && now() < cached.expiresAt - TOKEN_SLACK_MS) return Promise.resolve(cached.token);
    if (forceRefresh) cached = null;
    inFlight ??= fetchAccessToken().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function post(message: PushMessage, token: string): Promise<Response> {
    return fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: message.to,
          notification: { title: message.title, ...(message.body ? { body: message.body } : {}) },
          data: stringData(message.data),
          // 'default' is the notification channel the Android app creates on launch.
          android: { priority: 'HIGH', notification: { channel_id: 'default' } },
        },
      }),
    });
  }

  return {
    async send(messages: PushMessage[]): Promise<PushSendResult> {
      const invalidTokens: string[] = [];
      let failures = 0;
      await Promise.all(
        messages.map(async (message) => {
          let res = await post(message, await accessToken());
          // An OAuth token revoked early: fetch a new one and retry once.
          if (res.status === 401) res = await post(message, await accessToken(true));
          if (res.ok) return;
          const body = await res.json().catch(() => null);
          if (isDeadToken(res.status, body)) invalidTokens.push(message.to);
          else failures++;
        }),
      );
      if (failures > 0 && failures === messages.length) throw new Error(`FCM rejected all ${failures} push message(s).`);
      return { invalidTokens };
    },
  };
}
