import { generateResetToken } from '../../lib/reset-token';
import { HttpError } from '../../lib/http-errors';
import type { DeliveryResult } from '../email/email-service';
import type { WelcomeEmailParams } from '../email/email-templates';
import type { UserRepository, UserSummary } from './user-repository';

/** Where welcome links are kept: hashed, single use, with their own expiry (7 days). */
export interface WelcomeTokenStore {
  /** Store a new link. It doesn't end the earlier ones yet: the email may still fail. Returns its id. */
  create(data: { userId: string; tokenHash: string; expiresAt: Date }): Promise<string>;
  /** The new link's email went: the person's earlier unused welcome links stop working. */
  replaceEarlier(userId: string, keepId: string): Promise<void>;
  /** The email couldn't be sent: this link never works (the earlier one, if any, still does). */
  discard(id: string): Promise<void>;
}

export interface WelcomeMailer {
  /** False when no mail provider is configured, so nothing can be sent. */
  isConfigured(): boolean;
  /** True when emails to the address are blocked (it bounced or was marked as spam). */
  isBlocked(email: string): Promise<boolean>;
  sendWelcome(email: string, params: WelcomeEmailParams): Promise<DeliveryResult>;
}

/** Why a person didn't get a welcome email. */
export type WelcomeRefusal =
  | 'NOT_FOUND'
  | 'ACCOUNT_INACTIVE'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_LOCKED'
  | 'NO_EMAIL'
  | 'EMAIL_BLOCKED'
  | 'TOO_SOON'
  | 'DELIVERY_FAILED';

/** Each reason as a clause that finishes "Not sent: …" (the website builds its sentences from these). */
export const WELCOME_REFUSAL_WHY: Record<WelcomeRefusal, string> = {
  NOT_FOUND: 'the account no longer exists',
  ACCOUNT_INACTIVE: 'the account is inactive',
  ACCOUNT_SUSPENDED: 'the account is suspended',
  ACCOUNT_LOCKED: 'the account is locked after too many failed sign-in attempts (unlock it first)',
  NO_EMAIL: 'the account has no email address',
  EMAIL_BLOCKED: 'emails to this address are blocked (it bounced or was marked as spam)',
  TOO_SOON: 'a welcome email was sent to them less than a minute ago',
  DELIVERY_FAILED: 'the email couldn’t be delivered (try again later)',
};

/** What happened for one person. Never carries the link. */
export interface WelcomeOutcome {
  userId: string;
  /** Null when the account no longer exists. */
  username: string | null;
  name: string | null;
  email: string | null;
  sent: boolean;
  /** When it went (ISO), for a sent email. */
  sentAt?: string;
  reason?: WelcomeRefusal;
  why?: string;
}

export interface WelcomeServiceDeps {
  users: Pick<UserRepository, 'findById' | 'markWelcomeSent'>;
  tokens: WelcomeTokenStore;
  mailer: WelcomeMailer;
  /** The website's address: the link opens its set-password (reset) page. */
  appUrl: string;
  /** The site's app downloads for the email, read at send time (null: the site doesn't offer it). */
  downloads?: () => { androidAppUrl: string | null; extensionUrl: string | null };
  /** How long a welcome link works. Default 7 days. */
  ttlSeconds?: number;
  /** One welcome email per person this often, so a double click never sends two. Default a minute. */
  resendGapMs?: number;
  /** People emailed at once by sendMany. Default 4. */
  concurrency?: number;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
  now?: () => Date;
}

/** Email isn't set up on this server: nothing can be sent (the same words as the daily emails). */
export class WelcomeEmailUnavailableError extends HttpError {
  constructor() {
    super(
      'Email isn’t set up on this server yet, so no welcome email can be sent. An administrator needs to add the email (Mailjet) keys.',
      'EMAIL_NOT_CONFIGURED',
      503,
    );
  }
}

const WEEK_SECONDS = 7 * 24 * 3600;
const displayName = (u: UserSummary) => `${u.firstName} ${u.lastName}`.trim() || u.username;

/**
 * Welcome emails, sent only when an administrator asks: a "Set your password" link (a single-use,
 * hashed token on the password-reset page, valid 7 days). The person's current password keeps working
 * until they use it; sending again replaces the earlier link once the new one has gone.
 */
export function createWelcomeService(deps: WelcomeServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const ttlSeconds = deps.ttlSeconds ?? WEEK_SECONDS;
  const resendGapMs = deps.resendGapMs ?? 60_000;
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const appUrl = deps.appUrl.replace(/\/+$/, '');
  // People being sent to right now: a second send meanwhile is "too soon" (the database can't see it yet).
  const inFlight = new Set<string>();

  const isConfigured = () => deps.mailer.isConfigured();

  function refused(userId: string, user: UserSummary | null, reason: WelcomeRefusal): WelcomeOutcome {
    return {
      userId,
      username: user?.username ?? null,
      name: user ? displayName(user) : null,
      email: user?.email ?? null,
      sent: false,
      reason,
      why: WELCOME_REFUSAL_WHY[reason],
    };
  }

  /** Why this person can't have one now, or null. */
  function refusalFor(user: UserSummary, at: Date): WelcomeRefusal | null {
    if (user.status === 'INACTIVE') return 'ACCOUNT_INACTIVE';
    if (user.status === 'SUSPENDED') return 'ACCOUNT_SUSPENDED';
    if (user.status !== 'ACTIVE') return 'ACCOUNT_INACTIVE';
    if (user.locked) return 'ACCOUNT_LOCKED';
    if (!user.email.trim() || !user.email.includes('@')) return 'NO_EMAIL';
    if (user.welcomeSentAt && at.getTime() - user.welcomeSentAt.getTime() < resendGapMs) return 'TOO_SOON';
    return null;
  }

  async function deliver(user: UserSummary, at: Date): Promise<WelcomeOutcome> {
    const reason = refusalFor(user, at);
    if (reason) return refused(user.id, user, reason);
    const email = user.email.trim();
    if (await deps.mailer.isBlocked(email)) return refused(user.id, user, 'EMAIL_BLOCKED');

    const { token, tokenHash } = generateResetToken();
    const linkId = await deps.tokens.create({ userId: user.id, tokenHash, expiresAt: new Date(at.getTime() + ttlSeconds * 1000) });
    const apps = deps.downloads?.() ?? { androidAppUrl: null, extensionUrl: null };
    let result: DeliveryResult;
    try {
      result = await deps.mailer.sendWelcome(email, {
        firstName: user.firstName,
        username: user.username,
        setPasswordLink: `${appUrl}/reset?token=${token}&welcome=1`,
        expiresInDays: Math.round(ttlSeconds / 86_400),
        androidAppUrl: apps.androidAppUrl,
        extensionUrl: apps.extensionUrl,
      });
    } catch (err) {
      await deps.tokens.discard(linkId);
      // Only the provider's words: never the link.
      deps.logger?.warn('welcome email could not be sent', { userId: user.id, error: err instanceof Error ? err.message : String(err) });
      return refused(user.id, user, 'DELIVERY_FAILED');
    }
    if (result === 'suppressed') {
      await deps.tokens.discard(linkId);
      return refused(user.id, user, 'EMAIL_BLOCKED');
    }
    await deps.tokens.replaceEarlier(user.id, linkId);
    await deps.users.markWelcomeSent(user.id, at);
    return { userId: user.id, username: user.username, name: displayName(user), email, sent: true, sentAt: at.toISOString() };
  }

  async function sendOne(userId: string): Promise<WelcomeOutcome> {
    const user = await deps.users.findById(userId);
    if (!user) return refused(userId, null, 'NOT_FOUND');
    if (inFlight.has(userId)) return refused(userId, user, 'TOO_SOON');
    inFlight.add(userId);
    try {
      return await deliver(user, now());
    } finally {
      inFlight.delete(userId);
    }
  }

  /** Email one person (an administrator asked). Refusals are answers, not errors. */
  async function send(userId: string): Promise<WelcomeOutcome> {
    if (!isConfigured()) throw new WelcomeEmailUnavailableError();
    return sendOne(userId);
  }

  /** Email several people (each once, a few at a time), in the order asked; each says if it went. */
  async function sendMany(userIds: string[]): Promise<WelcomeOutcome[]> {
    if (!isConfigured()) throw new WelcomeEmailUnavailableError();
    const ids = [...new Set(userIds)];
    const out: WelcomeOutcome[] = new Array(ids.length);
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const i = next++;
        out[i] = await sendOne(ids[i]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    return out;
  }

  return { isConfigured, send, sendMany };
}

export type WelcomeService = ReturnType<typeof createWelcomeService>;
