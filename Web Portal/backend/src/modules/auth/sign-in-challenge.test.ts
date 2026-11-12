import { describe, it, expect, beforeEach } from 'vitest';
import { createSignInChallenges, CHALLENGE_MAX_LIFE_MS, CODE_TTL_MS } from './sign-in-challenge';
import { createMemorySignInChallengeStore } from './memory-sign-in-challenge-store';
import { hashChallengeToken } from '../../lib/sign-in-code';

const MIN = 60_000;
let clock: number;
let sent: { to: string; code: string; kind: string; minutes: number; brand?: unknown }[];
let warnings: { msg: string; ctx?: Record<string, unknown> }[];
let failSend: boolean;
let store: ReturnType<typeof createMemorySignInChallengeStore>;

function make() {
  return createSignInChallenges({
    store,
    key: 'test-key',
    now: () => new Date(clock),
    logger: { warn: (msg, ctx) => warnings.push({ msg, ...(ctx ? { ctx } : {}) }) },
    emailOptions: async () => ({ brand: { companyName: 'Prolens' } }),
    mailer: {
      isConfigured: () => true,
      async sendSignInCode(to, code, opts) {
        if (failSend) throw new Error('provider down');
        sent.push({ to, code, kind: opts.kind, minutes: opts.expiresInMinutes, brand: opts.brand });
      },
    },
  });
}
const ada = { id: 'u1', email: 'ada@acme.com' };
const lastCode = () => sent[sent.length - 1]!.code;
const err = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; status?: number }) => ({ code: e.code, status: e.status }));

beforeEach(() => {
  clock = Date.parse('2026-11-07T08:00:00Z');
  sent = [];
  warnings = [];
  failSend = false;
  store = createMemorySignInChallengeStore();
});

describe('Sign-in challenge: start', () => {
  it('emails a 6-digit code valid 10 minutes to the account’s address and answers with a token and the address masked', async () => {
    const view = await make().start(ada, 'VERIFY_EMAIL');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ada@acme.com', kind: 'VERIFY_EMAIL', minutes: 10, brand: { companyName: 'Prolens' } });
    expect(sent[0]!.code).toMatch(/^\d{6}$/);
    expect(view).toMatchObject({ kind: 'VERIFY_EMAIL', sentTo: 'a•••@acme.com', codeSent: true });
    expect(view.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(view.expiresAt) - clock).toBe(CODE_TTL_MS);
    expect(Date.parse(view.resendAt) - clock).toBe(MIN);
    // Only hashes are stored: neither the code nor the token.
    const row = store.rows[0]!;
    expect(JSON.stringify(row)).not.toContain(sent[0]!.code);
    expect(JSON.stringify(row)).not.toContain(view.token);
    expect(row.tokenHash).toBe(hashChallengeToken(view.token));
  });

  it('signing in again while one is open reuses it: a new token, the same code still works, no second email', async () => {
    const svc = make();
    const first = await svc.start(ada, 'VERIFY_EMAIL');
    clock += 3 * MIN;
    const second = await svc.start(ada, 'VERIFY_EMAIL');
    expect(sent).toHaveLength(1);
    expect(second.codeSent).toBe(false);
    expect(second.token).not.toBe(first.token);
    expect(store.rows).toHaveLength(1);
    // The first token no longer answers; the second does, with the code from the first email.
    expect(await err(svc.verify(first.token, lastCode()))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
    expect(await svc.verify(second.token, lastCode())).toEqual({ userId: 'u1', kind: 'VERIFY_EMAIL', sentTo: 'ada@acme.com' });
  });

  it('a new address (the email was changed) gets a new challenge, not the old one', async () => {
    const svc = make();
    await svc.start(ada, 'VERIFY_EMAIL');
    clock += 2 * MIN;
    const view = await svc.start({ id: 'u1', email: 'ada@new.com' }, 'VERIFY_EMAIL');
    expect(view.codeSent).toBe(true);
    expect(sent.map((s) => s.to)).toEqual(['ada@acme.com', 'ada@new.com']);
  });

  it('once the code has expired (10 minutes), signing in again sends a fresh code', async () => {
    const svc = make();
    await svc.start(ada, 'VERIFY_EMAIL');
    clock += CODE_TTL_MS;
    const view = await svc.start(ada, 'VERIFY_EMAIL');
    expect(view.codeSent).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('at most 5 codes an hour per account: the sixth sign-in is refused with 429 TOO_MANY_CODES', async () => {
    const svc = make();
    for (let i = 0; i < 5; i++) {
      await svc.start(ada, 'VERIFY_EMAIL');
      clock += CODE_TTL_MS + 1000; // each one expired before the next sign-in
    }
    expect(sent).toHaveLength(5);
    expect(await err(svc.start(ada, 'VERIFY_EMAIL'))).toEqual({ code: 'TOO_MANY_CODES', status: 429 });
    clock += 60 * MIN;
    expect((await svc.start(ada, 'VERIFY_EMAIL')).codeSent).toBe(true);
  });

  it('an email that can’t go: 502 CODE_NOT_SENT, the challenge is ended, only the provider’s words are logged', async () => {
    failSend = true;
    const svc = make();
    expect(await err(svc.start(ada, 'VERIFY_EMAIL'))).toEqual({ code: 'CODE_NOT_SENT', status: 502 });
    expect(store.rows[0]!.consumedAt).not.toBeNull();
    expect(warnings).toEqual([{ msg: 'sign-in code could not be sent', ctx: { userId: 'u1', error: 'provider down' } }]);
    // Signing in again tries a new code (the dead challenge isn't reused).
    failSend = false;
    clock += MIN;
    expect((await svc.start(ada, 'VERIFY_EMAIL')).codeSent).toBe(true);
  });
});

describe('Sign-in challenge: verify', () => {
  it('the right code works once; used again it is refused', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    expect(await svc.verify(token, lastCode())).toMatchObject({ userId: 'u1' });
    expect(await err(svc.verify(token, lastCode()))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
  });

  it('a wrong code is refused (401 WRONG_CODE); the right one still works after it', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    expect(await err(svc.verify(token, wrong))).toEqual({ code: 'WRONG_CODE', status: 401 });
    expect(await svc.verify(token, ` ${lastCode().slice(0, 3)} ${lastCode().slice(3)} `)).toMatchObject({ userId: 'u1' });
  });

  it('a code after 10 minutes is refused (expired)', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    clock += CODE_TTL_MS;
    expect(await err(svc.verify(token, lastCode()))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
  });

  it('5 wrong codes end the challenge: even the right code is refused after that', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await err(svc.verify(token, wrong)))?.code).toBe('WRONG_CODE');
    expect(await err(svc.verify(token, lastCode()))).toEqual({ code: 'TOO_MANY_WRONG_CODES', status: 429 });
  });

  it('10 wrong codes an hour per account, across challenges', async () => {
    const svc = make();
    for (let round = 0; round < 2; round++) {
      const { token } = await svc.start(ada, 'VERIFY_EMAIL');
      const wrong = lastCode() === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await err(svc.verify(token, wrong));
      clock += CODE_TTL_MS + 1000;
    }
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    expect(await err(svc.verify(token, lastCode()))).toEqual({ code: 'TOO_MANY_WRONG_CODES', status: 429 });
  });

  it('parallel guesses are each counted: of 8 at once only 5 are compared', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    const results = await Promise.all(Array.from({ length: 8 }, () => err(svc.verify(token, wrong))));
    expect(results.filter((r) => r?.code === 'WRONG_CODE')).toHaveLength(5);
    expect(results.filter((r) => r?.code === 'TOO_MANY_WRONG_CODES')).toHaveLength(3);
  });

  it('an unknown token is refused like an expired one', async () => {
    expect(await err(make().verify('nope', '123456'))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
  });

  it('endAll ends the person’s open challenges (an email change, a deactivation)', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    await svc.endAll('u1');
    expect(await err(svc.verify(token, lastCode()))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
  });
});

describe('Sign-in challenge: resend', () => {
  it('within the minute nothing is sent: the seconds to wait come back', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    clock += 20_000;
    expect(await svc.resend(token)).toMatchObject({ codeSent: false, retryAfterSeconds: 40 });
    expect(sent).toHaveLength(1);
  });

  it('after the minute a new code goes; the earlier code stops working, the new one works', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    const first = lastCode();
    clock += MIN;
    const again = await svc.resend(token);
    expect(again.codeSent).toBe(true);
    expect(sent).toHaveLength(2);
    expect(Date.parse(again.expiresAt) - clock).toBe(CODE_TTL_MS);
    if (first !== lastCode()) expect((await err(svc.verify(token, first)))?.code).toBe('WRONG_CODE');
    expect(await svc.verify(token, lastCode())).toMatchObject({ userId: 'u1' });
  });

  it('the hourly allowance counts resends too, and a challenge never outlives 30 minutes', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    for (let i = 0; i < 4; i++) {
      clock += MIN;
      expect((await svc.resend(token)).codeSent).toBe(true);
    }
    clock += MIN;
    expect(await err(svc.resend(token))).toEqual({ code: 'TOO_MANY_CODES', status: 429 });
    // A fresh challenge 30 minutes on: its codes stop at the 30-minute mark.
    clock += 61 * MIN;
    const fresh = await svc.start(ada, 'VERIFY_EMAIL');
    for (let i = 0; i < 2; i++) {
      clock += 9 * MIN;
      await svc.resend(fresh.token);
    }
    clock += 9 * MIN;
    const late = await svc.resend(fresh.token);
    expect(Date.parse(late.expiresAt) - Date.parse(store.rows[store.rows.length - 1]!.createdAt.toISOString())).toBe(CHALLENGE_MAX_LIFE_MS);
    clock += 4 * MIN;
    expect(await err(svc.resend(fresh.token))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
  });

  it('a used or unknown challenge can’t be resent', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    await svc.verify(token, lastCode());
    clock += MIN;
    expect(await err(svc.resend(token))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
    expect(await err(svc.resend('nope'))).toEqual({ code: 'SIGN_IN_EXPIRED', status: 401 });
  });
});

describe('Review fixes: a challenge used up by wrong codes never traps the person', () => {
  it('after 5 wrong codes, signing in again starts a fresh challenge with a new code that works', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await err(svc.verify(token, wrong));
    clock += MIN;
    const again = await svc.start(ada, 'VERIFY_EMAIL');
    expect(again.codeSent).toBe(true);
    expect(sent).toHaveLength(2);
    expect(await svc.verify(again.token, lastCode())).toMatchObject({ userId: 'u1' });
  });

  it('“Send another code” on a used-up challenge sends nothing and says to sign in again', async () => {
    const svc = make();
    const { token } = await svc.start(ada, 'VERIFY_EMAIL');
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await err(svc.verify(token, wrong));
    clock += MIN;
    expect(await err(svc.resend(token))).toEqual({ code: 'TOO_MANY_WRONG_CODES', status: 429 });
    expect(sent).toHaveLength(1);
  });

  it('an email that couldn’t go ends its challenge without touching the wrong-code count', async () => {
    failSend = true;
    const svc = make();
    await err(svc.start(ada, 'VERIFY_EMAIL'));
    expect(store.rows[0]!.attempts).toBe(0);
    expect(store.rows[0]!.consumedAt).not.toBeNull();
  });
});
