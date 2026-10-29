import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived, single-use signed tokens: the `state` of the Google sign-in (it says which
 * administrator started it) and the backup download links. The key is derived from the server's
 * secret for one purpose, so a token made for one thing never works for another. Used ones are
 * remembered until they expire (in memory: one server).
 */
export function createOneTimeTokens(opts: { secret: string; purpose: string; now?: () => Date }) {
  const now = opts.now ?? (() => new Date());
  const key = Buffer.from(hkdfSync('sha256', opts.secret, 'mico360-one-time-tokens', `mico360/backups/${opts.purpose}`, 32));
  const used = new Map<string, number>();

  const sign = (body: string) => createHmac('sha256', key).update(body).digest('base64url');

  function forgetExpired(): void {
    const t = now().getTime();
    for (const [n, exp] of used) if (exp < t) used.delete(n);
  }

  return {
    issue(data: Record<string, string>, ttlMs: number): string {
      const body = Buffer.from(JSON.stringify({ ...data, exp: now().getTime() + ttlMs, n: randomBytes(12).toString('base64url') })).toString('base64url');
      return `${body}.${sign(body)}`;
    },

    /** The token's data, once; null when it is changed, expired, already used or for another purpose. */
    verify(token: string): Record<string, string> | null {
      if (typeof token !== 'string') return null;
      const [body, sig] = token.split('.');
      if (!body || !sig) return null;
      const want = Buffer.from(sign(body));
      const got = Buffer.from(sig);
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
      } catch {
        return null;
      }
      const exp = Number(payload.exp);
      const nonce = String(payload.n ?? '');
      if (!Number.isFinite(exp) || exp < now().getTime() || !nonce) return null;
      forgetExpired();
      if (used.has(nonce)) return null;
      used.set(nonce, exp);
      return Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'exp' && k !== 'n').map(([k, v]) => [k, String(v)]));
    },
  };
}

export type OneTimeTokens = ReturnType<typeof createOneTimeTokens>;
