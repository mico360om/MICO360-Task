import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { createFcmTransport, parseServiceAccount, signServiceAccountJwt, type FcmServiceAccount } from './fcm-transport';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const account: FcmServiceAccount = { project_id: 'mico360-app', client_email: 'push@mico360-app.iam.gserviceaccount.com', private_key: privateKey };
const NOW = Date.parse('2026-10-01T08:00:00Z');

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake fetch for Google's token endpoint + FCM, with per-token FCM responses. */
function fakeFetch(fcm: (token: string, call: number) => Response) {
  const calls: Call[] = [];
  let fcmCalls = 0;
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('oauth2')) return json(200, { access_token: `ya29.token-${calls.length}`, expires_in: 3600 });
    const token = (JSON.parse(String(init?.body)) as { message: { token: string } }).message.token;
    return fcm(token, fcmCalls++);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const msg = (to: string) => ({ to, title: 'You were assigned a task', body: 'Fix login', data: { entityType: 'task', entityId: 't1' } });

describe('FCM service account', () => {
  it('parses the key file JSON, restoring escaped newlines in the private key', () => {
    const parsed = parseServiceAccount(JSON.stringify({ ...account, private_key: privateKey.replace(/\n/g, '\\n'), type: 'service_account' }));
    expect(parsed).toMatchObject({ project_id: 'mico360-app', client_email: account.client_email });
    expect(parsed!.private_key).toBe(privateKey);
    expect(parseServiceAccount('{"project_id":"x"}')).toBeNull();
    expect(parseServiceAccount('not json')).toBeNull();
  });

  it('signs an RS256 JWT for the FCM scope that verifies with the public key', () => {
    const jwt = signServiceAccountJwt(account, NOW);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    const ok = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('createFcmTransport (NTF-01)', () => {
  it('gets an OAuth token once and posts one FCM v1 message per device', async () => {
    const { impl, calls } = fakeFetch(() => json(200, { name: 'projects/mico360-app/messages/1' }));
    const transport = createFcmTransport({ serviceAccount: account, fetchImpl: impl, now: () => NOW });
    await expect(transport.send([msg('tokA'), msg('tokB')])).resolves.toEqual({ invalidTokens: [] });
    await transport.send([msg('tokC')]);

    const auth = calls.filter((c) => c.url.includes('oauth2'));
    expect(auth).toHaveLength(1); // cached across sends
    expect(String(auth[0]!.init.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    const sends = calls.filter((c) => c.url.includes('fcm.googleapis.com'));
    expect(sends).toHaveLength(3);
    expect(sends[0]!.url).toBe('https://fcm.googleapis.com/v1/projects/mico360-app/messages:send');
    expect((sends[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer ya29.token-1');
    expect(JSON.parse(String(sends[0]!.init.body))).toEqual({
      message: {
        token: 'tokA',
        notification: { title: 'You were assigned a task', body: 'Fix login' },
        data: { entityType: 'task', entityId: 't1' },
        android: { priority: 'HIGH', notification: { channel_id: 'default' } },
      },
    });
  });

  it('reports unregistered / foreign tokens so they can be pruned', async () => {
    const { impl } = fakeFetch((token) => {
      if (token === 'gone') return json(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } });
      if (token === 'other-app') return json(403, { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } });
      if (token === 'garbage') return json(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token', details: [{ errorCode: 'INVALID_ARGUMENT' }] } });
      return json(200, {});
    });
    const transport = createFcmTransport({ serviceAccount: account, fetchImpl: impl, now: () => NOW });
    const res = await transport.send([msg('ok'), msg('gone'), msg('other-app'), msg('garbage')]);
    expect(res.invalidTokens.sort()).toEqual(['garbage', 'gone', 'other-app']);
  });

  it('renews the OAuth token once on a 401 and retries', async () => {
    const { impl, calls } = fakeFetch((_t, n) => (n === 0 ? json(401, { error: { status: 'UNAUTHENTICATED' } }) : json(200, {})));
    const transport = createFcmTransport({ serviceAccount: account, fetchImpl: impl, now: () => NOW });
    await expect(transport.send([msg('tokA')])).resolves.toEqual({ invalidTokens: [] });
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('throws when every message fails for other reasons (so callers can log it)', async () => {
    const { impl } = fakeFetch(() => json(500, { error: { status: 'INTERNAL' } }));
    const transport = createFcmTransport({ serviceAccount: account, fetchImpl: impl, now: () => NOW });
    await expect(transport.send([msg('tokA')])).rejects.toThrow(/FCM/);
  });
});
