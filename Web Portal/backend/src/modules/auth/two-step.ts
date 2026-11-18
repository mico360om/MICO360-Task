import { createHash, randomUUID } from 'node:crypto';
import { signToken, verifyToken } from '../../lib/tokens';
import { describeUserAgent } from '../error-log/user-agent';

/**
 * 1.24 two-step sign-in for administrators (docs/superpowers/specs/2026-11-14-two-step-sign-in-design.md).
 *
 * An administrator's right password is not enough on its own: the website's sign-in then asks for a
 * 6-digit code emailed to them (the onboarding sign-in challenge, kind TWO_STEP). "Trust this browser
 * for 30 days" leaves a signed, httpOnly cookie that names a row of trusted_browsers; the code is asked
 * again after 30 days, on a new browser, after "Forget all trusted browsers", and after anything that
 * moves the person's session version on (a password change, Sign out everywhere). The Android app and
 * the extension can't take the code step (they never say they can), so administrators are refused there.
 *
 * Break-glass: ADMIN_TWO_STEP=off on the server switches it off (an Error-log warning at start-up and a
 * red banner for administrators). With no mail provider at all no code could be sent, so it is off too
 * and said so the same way — an administrator is never locked out by a server that can't email.
 */
export const TRUST_DAYS = 30;
const TRUST_MS = TRUST_DAYS * 24 * 3600_000;
export const ADMIN_ROLE = 'ADMIN';

export type TwoStepOffReason = 'switched-off' | 'email-not-set-up';
export type TwoStepState = { on: true; reason: null } | { on: false; reason: TwoStepOffReason };

export interface TrustedBrowserRow {
  id: string;
  userId: string;
  /** The person's tokenVersion when it was trusted. */
  sessionVersion: number;
  /** "Chrome on Windows". */
  label: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TrustedBrowserStore {
  create(row: Omit<TrustedBrowserRow, 'revokedAt'>): Promise<void>;
  find(id: string): Promise<TrustedBrowserRow | null>;
  /** Live ones: not revoked, not expired, made under this session version. */
  countLive(userId: string, sessionVersion: number, now: Date): Promise<number>;
  /** "Forget all": every unrevoked one of the person's ends; how many. */
  revokeAll(userId: string, at: Date): Promise<number>;
}

export interface TwoStepDeps {
  /** ADMIN_TWO_STEP: false when it is switched off on the server (break-glass). */
  switchedOn: boolean;
  /** A mail provider is configured (codes can be sent at all). */
  mailConfigured: () => boolean;
  store: TrustedBrowserStore;
  /** The key the trusted-browser cookie is signed with (derived from the server's secret for this one use). */
  key: string;
  now?: () => Date;
  /** "New trusted browser for your admin account" (best effort: a failure is only logged). */
  notifyTrusted?: (user: { id: string; email: string }, info: { browser: string; at: Date }) => Promise<unknown>;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

/** "Chrome on Windows": the browser and system names only (never a version or the whole user agent). */
export function browserLabel(userAgent: string | null | undefined): string {
  const { browser, system } = describeUserAgent(userAgent);
  const name = browser.replace(/\s+\d+$/, '');
  if (name === 'Unknown browser') return 'A browser';
  return system === 'Unknown system' ? name : `${name} on ${system}`;
}

export const isAdminRoles = (roles: readonly string[] | undefined): boolean => (roles ?? []).includes(ADMIN_ROLE);

const COOKIE_PREFIX = 'mico_tb_';

export function createTwoStep(deps: TwoStepDeps) {
  const now = deps.now ?? (() => new Date());
  if (!deps.key) throw new Error('two-step sign-in needs a key');

  function state(): TwoStepState {
    if (!deps.switchedOn) return { on: false, reason: 'switched-off' };
    if (!deps.mailConfigured()) return { on: false, reason: 'email-not-set-up' };
    return { on: true, reason: null };
  }

  /** Must this sign-in pass the code step (or a trusted browser)? Administrators, while it is on. */
  const required = (user: { roles?: readonly string[] }): boolean => isAdminRoles(user.roles) && state().on;

  /**
   * One cookie per person (two administrators sharing a browser keep their own). Over https it carries
   * the __Secure- prefix, so a page on plain http can't plant one.
   */
  function cookieName(userId: string, secure: boolean): string {
    const name = `${COOKIE_PREFIX}${createHash('sha256').update(`trusted-browser:${userId}`).digest('hex').slice(0, 12)}`;
    return secure ? `__Secure-${name}` : name;
  }

  /** Until when this browser is trusted for this person (null: ask for the code). */
  async function trustedUntil(user: { id: string; tokenVersion?: number }, cookie: string | null | undefined): Promise<Date | null> {
    if (!cookie) return null;
    let claims: Record<string, unknown>;
    try {
      claims = verifyToken(cookie, deps.key) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (claims.typ !== 'trusted-browser' || claims.sub !== user.id || typeof claims.tb !== 'string') return null;
    const version = user.tokenVersion ?? 0;
    if (claims.ver !== version) return null;
    const row = await deps.store.find(claims.tb);
    const at = now();
    if (!row || row.userId !== user.id || row.revokedAt || row.sessionVersion !== version || row.expiresAt.getTime() <= at.getTime()) return null;
    return row.expiresAt;
  }

  /** Trust this browser for 30 days: the cookie's value and life. The person is emailed a short notice. */
  async function trust(user: { id: string; email: string; tokenVersion?: number }, userAgent: string | null | undefined): Promise<{ value: string; maxAgeSeconds: number; expiresAt: Date; label: string }> {
    const at = now();
    const id = randomUUID();
    const label = browserLabel(userAgent).slice(0, 120);
    const expiresAt = new Date(at.getTime() + TRUST_MS);
    const version = user.tokenVersion ?? 0;
    await deps.store.create({ id, userId: user.id, sessionVersion: version, label, createdAt: at, expiresAt });
    const value = signToken({ typ: 'trusted-browser', sub: user.id, tb: id, ver: version }, deps.key, TRUST_MS / 1000);
    // Review fix: the notice never holds up the sign-in (a slow mail provider); a failure is only logged.
    void Promise.resolve()
      .then(() => deps.notifyTrusted?.({ id: user.id, email: user.email }, { browser: label, at }))
      .catch((err: unknown) => deps.logger?.warn('the new trusted browser notice could not be sent', { userId: user.id, error: err instanceof Error ? err.message : String(err) }));
    return { value, maxAgeSeconds: TRUST_MS / 1000, expiresAt, label };
  }

  /** "Trusted browsers: N". */
  const count = (user: { id: string; tokenVersion?: number }): Promise<number> => deps.store.countLive(user.id, user.tokenVersion ?? 0, now());

  /** "Forget all trusted browsers": every one asks for the code again (this page stays signed in). */
  const forgetAll = (userId: string): Promise<number> => deps.store.revokeAll(userId, now());

  return { state, required, cookieName, trustedUntil, trust, count, forgetAll };
}

export type TwoStep = ReturnType<typeof createTwoStep>;

/** Where the trusted-browser cookie is sent: the sign-in API only (never another page or route). */
export const TRUST_COOKIE_PATH = '/api/v1/auth';

/** The Set-Cookie value: httpOnly, SameSite=Strict, the sign-in API only; Secure over https. Max-Age 0 clears it. */
export function trustCookieHeader(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${value}; Path=${TRUST_COOKIE_PATH}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

/** The website's own address (scheme, host and port) from APP_URL, or null. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** "14 Nov 10:12" in the company's time (the trusted-browser email). */
export function noticeTime(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}
