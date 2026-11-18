import { describe, it, expect, beforeEach } from 'vitest';
import { createTwoStep, browserLabel, noticeTime, TRUST_DAYS } from './two-step';
import { createMemoryTrustedBrowserStore } from './memory-trusted-browser-store';

const DAY = 24 * 3600_000;
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let clock: number;
let store: ReturnType<typeof createMemoryTrustedBrowserStore>;
let notices: { to: string; browser: string; at: Date }[];
let mailOn: boolean;

function make(o: { switchedOn?: boolean; failNotice?: boolean } = {}) {
  return createTwoStep({
    switchedOn: o.switchedOn ?? true,
    mailConfigured: () => mailOn,
    store,
    key: 'two-step-test-key-long-enough',
    now: () => new Date(clock),
    notifyTrusted: async (user, info) => {
      if (o.failNotice) throw new Error('provider down');
      notices.push({ to: user.email, ...info });
    },
  });
}
const ada = { id: 'u1', email: 'ada@acme.com', roles: ['ADMIN'], tokenVersion: 3 };

beforeEach(() => {
  clock = Date.parse('2026-11-14T06:12:00Z');
  store = createMemoryTrustedBrowserStore();
  notices = [];
  mailOn = true;
});

describe('two-step sign-in: who and when', () => {
  it('is asked of administrators only (Manager View is still an administrator), and only while it is on', () => {
    const on = make();
    expect(on.state()).toEqual({ on: true, reason: null });
    expect(on.required({ roles: ['ADMIN'] })).toBe(true);
    expect(on.required({ roles: ['EMPLOYEE', 'ADMIN'] })).toBe(true);
    expect(on.required({ roles: ['EMPLOYEE'] })).toBe(false);
    expect(on.required({ roles: ['CLIENT'] })).toBe(false);
    expect(on.required({ roles: [] })).toBe(false);
  });

  it('break-glass: ADMIN_TWO_STEP=off switches it off (said so), and no one is asked', () => {
    const off = make({ switchedOn: false });
    expect(off.state()).toEqual({ on: false, reason: 'switched-off' });
    expect(off.required({ roles: ['ADMIN'] })).toBe(false);
  });

  it('with no mail provider at all it cannot send a code: off, said so (never a locked-out administrator)', () => {
    mailOn = false;
    const svc = make();
    expect(svc.state()).toEqual({ on: false, reason: 'email-not-set-up' });
    expect(svc.required({ roles: ['ADMIN'] })).toBe(false);
    // The switch on the server wins the explanation.
    expect(make({ switchedOn: false }).state()).toEqual({ on: false, reason: 'switched-off' });
  });
});

describe('two-step sign-in: trusted browsers', () => {
  it('trusting a browser gives a signed cookie value for 30 days, stores only the browser’s short name, and emails a notice', async () => {
    const svc = make();
    const t = await svc.trust(ada, CHROME_WIN);
    expect(t.maxAgeSeconds).toBe(TRUST_DAYS * 24 * 3600);
    expect(t.expiresAt.getTime() - clock).toBe(30 * DAY);
    expect(t.label).toBe('Chrome on Windows');
    expect(t.value.split('.')).toHaveLength(3);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ userId: 'u1', sessionVersion: 3, label: 'Chrome on Windows', revokedAt: null });
    expect(JSON.stringify(store.rows[0])).not.toContain('Mozilla');
    expect(notices).toEqual([{ to: 'ada@acme.com', browser: 'Chrome on Windows', at: new Date(clock) }]);
    expect(await svc.trustedUntil(ada, t.value)).toEqual(t.expiresAt);
  });

  it('a notice that can’t be sent never stops the trust (it is only logged)', async () => {
    const t = await make({ failNotice: true }).trust(ada, CHROME_WIN);
    expect(await make().trustedUntil(ada, t.value)).toEqual(t.expiresAt);
  });

  it('asks again after 30 days', async () => {
    const svc = make();
    const t = await svc.trust(ada, CHROME_WIN);
    clock += 30 * DAY - 1000;
    expect(await svc.trustedUntil(ada, t.value)).not.toBeNull();
    clock += 2000;
    expect(await svc.trustedUntil(ada, t.value)).toBeNull();
  });

  it('asks again after a password change or Sign out everywhere (the session version moved on)', async () => {
    const svc = make();
    const t = await svc.trust(ada, CHROME_WIN);
    expect(await svc.trustedUntil({ ...ada, tokenVersion: 4 }, t.value)).toBeNull();
    expect(await svc.count({ ...ada, tokenVersion: 4 })).toBe(0);
  });

  it('is one person’s: another account (even with the same cookie) is asked', async () => {
    const svc = make();
    const t = await svc.trust(ada, CHROME_WIN);
    expect(await svc.trustedUntil({ id: 'u2', tokenVersion: 3 }, t.value)).toBeNull();
  });

  it('a forged, altered or foreign value is never trusted', async () => {
    const svc = make();
    const t = await svc.trust(ada, CHROME_WIN);
    const [h, p, s] = t.value.split('.');
    expect(await svc.trustedUntil(ada, `${h}.${p}.${s!.slice(0, -2)}xx`)).toBeNull();
    expect(await svc.trustedUntil(ada, 'not-a-cookie')).toBeNull();
    expect(await svc.trustedUntil(ada, '')).toBeNull();
    expect(await svc.trustedUntil(ada, null)).toBeNull();
    const other = createTwoStep({ switchedOn: true, mailConfigured: () => true, store, key: 'another-key-long-enough-xx', now: () => new Date(clock) });
    expect(await other.trustedUntil(ada, t.value)).toBeNull();
  });

  it('Forget all trusted browsers ends every one of them (the count says so)', async () => {
    const svc = make();
    const a = await svc.trust(ada, CHROME_WIN);
    const b = await svc.trust(ada, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    await svc.trust({ ...ada, id: 'u2', email: 'bo@acme.com' }, CHROME_WIN);
    expect(await svc.count(ada)).toBe(2);
    expect(await svc.forgetAll('u1')).toBe(2);
    expect(await svc.count(ada)).toBe(0);
    expect(await svc.trustedUntil(ada, a.value)).toBeNull();
    expect(await svc.trustedUntil(ada, b.value)).toBeNull();
    // Someone else's stay.
    expect(await svc.count({ id: 'u2', tokenVersion: 3 })).toBe(1);
    expect(await svc.forgetAll('u1')).toBe(0);
  });

  it('counts only live ones: not expired, not forgotten, made under the current session version', async () => {
    const svc = make();
    await svc.trust(ada, CHROME_WIN);
    await svc.trust({ ...ada, tokenVersion: 2 }, CHROME_WIN);
    clock += 10 * DAY;
    await svc.trust(ada, CHROME_WIN);
    expect(await svc.count(ada)).toBe(2);
    clock += 25 * DAY;
    expect(await svc.count(ada)).toBe(1);
  });

  it('each person’s cookie has its own name (two administrators on one browser keep their own), Secure-prefixed over https', () => {
    const svc = make();
    const a = svc.cookieName('u1', false);
    expect(a).toMatch(/^mico_tb_[0-9a-f]{12}$/);
    expect(svc.cookieName('u2', false)).not.toBe(a);
    expect(svc.cookieName('u1', true)).toBe(`__Secure-${a}`);
  });
});

describe('browserLabel', () => {
  it('names the browser and the system, never a version or the whole user agent', () => {
    expect(browserLabel(CHROME_WIN)).toBe('Chrome on Windows');
    expect(browserLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari on macOS');
    expect(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe('Edge on Windows');
    expect(browserLabel(undefined)).toBe('A browser');
    expect(browserLabel('curl/8.0')).toBe('A browser');
  });
});

describe('noticeTime (the trusted-browser email)', () => {
  it('"14 Nov 10:12" in the company’s time zone, 24-hour', () => {
    expect(noticeTime(new Date('2026-11-14T06:12:00Z'), 'Asia/Muscat')).toBe('14 Nov 10:12');
    expect(noticeTime(new Date('2026-11-03T23:05:00Z'), 'Asia/Muscat')).toBe('4 Nov 03:05');
    expect(noticeTime(new Date('2026-11-14T06:12:00Z'), 'UTC')).toBe('14 Nov 06:12');
  });
});
