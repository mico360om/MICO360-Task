import { generateOtpCode, hashOtp, verifyOtp, isExpired } from '../../lib/otp';
import { EmailUnavailableError, InvalidOtpError, OtpExpiredError, TooManyOtpAttemptsError } from './errors';

export interface OtpUser {
  id: string;
  email: string;
  username: string;
  roles: string[];
  avatarUrl: string | null;
  tokenVersion?: number;
}

export interface OtpUserLookup {
  findActiveByIdentifier(identifier: string): Promise<OtpUser | null>;
  /** Clear the password lockout — a code proves mailbox ownership, like a password reset does. */
  clearLock?(userId: string): Promise<void>;
}

export interface OtpRecord {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export interface OtpStore {
  /** Store a new code and invalidate the user's earlier unused login codes. */
  create(data: { userId: string; codeHash: string; expiresAt: Date; attempts: number }): Promise<void>;
  findActiveForUser(userId: string): Promise<OtpRecord | null>;
  /** Login codes issued to the user since `since` (request throttling). */
  countIssuedSince(userId: string, since: Date): Promise<number>;
  /** Failed guesses against the user's login codes issued since `since`, across all codes. */
  countFailuresSince(userId: string, since: Date): Promise<number>;
  /** Atomically count a guess: attempts + 1 only while attempts < max and unused. False when exhausted. */
  claimAttempt(id: string, max: number): Promise<boolean>;
  /** Atomically mark the code used (and un-count the successful guess). False if already used. */
  consume(id: string): Promise<boolean>;
}

export interface OtpMailer {
  sendLoginCode(email: string, code: string): Promise<void>;
  /** False when no mail provider is configured at all. */
  isConfigured?(): boolean;
}

export interface OtpLogger {
  warn(msg: string, ctx?: Record<string, unknown>): void;
}

export interface OtpServiceDeps {
  users: OtpUserLookup;
  otps: OtpStore;
  mailer: OtpMailer;
  ttlSeconds: number;
  otpLength: number;
  /** Guesses allowed per code. */
  maxAttempts: number;
  /** Codes that may be requested per account. Default 1 a minute, 5 an hour. */
  requestLimits?: { perMinute: number; perHour: number };
  /** Failed guesses allowed per account per hour across every code. Default 10. */
  maxFailuresPerHour?: number;
  /** Runs the code issue + email off the request path, so known and unknown accounts answer alike. */
  runInBackground?: (task: () => Promise<void>) => void;
  logger?: OtpLogger;
  now?: () => Date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Compared against for unknown accounts so verify takes the same time either way.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashOtp(generateOtpCode(8)));

export function createOtpService(deps: OtpServiceDeps) {
  const limits = deps.requestLimits ?? { perMinute: 1, perHour: 5 };
  const maxFailuresPerHour = deps.maxFailuresPerHour ?? 10;
  const now = deps.now ?? (() => new Date());
  const runInBackground =
    deps.runInBackground ??
    ((task: () => Promise<void>) => {
      void task().catch((err) => deps.logger?.warn('login code could not be sent', { err }));
    });

  // Accounts with a code being issued right now: a burst of requests is throttled here, before
  // the database count (which can't see a code that hasn't been stored yet).
  const issuing = new Set<string>();

  async function issue(user: OtpUser): Promise<void> {
    if (issuing.has(user.id)) {
      deps.logger?.warn('login code request throttled', { userId: user.id });
      return;
    }
    issuing.add(user.id);
    try {
      await issueNow(user);
    } finally {
      issuing.delete(user.id);
    }
  }

  async function issueNow(user: OtpUser): Promise<void> {
    const at = now().getTime();
    const [lastMinute, lastHour] = await Promise.all([
      deps.otps.countIssuedSince(user.id, new Date(at - MINUTE)),
      deps.otps.countIssuedSince(user.id, new Date(at - HOUR)),
    ]);
    if (lastMinute >= limits.perMinute || lastHour >= limits.perHour) {
      deps.logger?.warn('login code request throttled', { userId: user.id });
      return;
    }
    const code = generateOtpCode(deps.otpLength);
    const codeHash = await hashOtp(code);
    await deps.otps.create({ userId: user.id, codeHash, expiresAt: new Date(at + deps.ttlSeconds * 1000), attempts: 0 });
    await deps.mailer.sendLoginCode(user.email, code);
  }

  /**
   * Generate + email a one-time login code (T2.10). Never reveals whether the account exists:
   * the answer is the same, and equally fast, for every identifier; per-account throttling and
   * delivery failures are only logged. If email isn't configured at all, every request gets 503.
   */
  async function requestLoginOtp(identifier: string): Promise<{ sent: true }> {
    if (deps.mailer.isConfigured && !deps.mailer.isConfigured()) throw new EmailUnavailableError();
    const user = await deps.users.findActiveByIdentifier(identifier);
    if (user) runInBackground(() => issue(user));
    return { sent: true };
  }

  /** Verify a submitted login code; returns the user on success (single-use, expiring, rate-limited). */
  async function verifyLoginOtp(identifier: string, code: string): Promise<OtpUser> {
    const user = await deps.users.findActiveByIdentifier(identifier);
    if (!user) {
      await verifyOtp(code, await getDummyHash());
      throw new InvalidOtpError();
    }

    // Guesses are capped per account, not just per code — requesting new codes doesn't reset it.
    const failures = await deps.otps.countFailuresSince(user.id, new Date(now().getTime() - HOUR));
    if (failures >= maxFailuresPerHour) throw new TooManyOtpAttemptsError('Too many incorrect codes. Try again in an hour or reset your password.');

    const otp = await deps.otps.findActiveForUser(user.id);
    if (!otp) throw new InvalidOtpError();
    if (isExpired(otp.expiresAt, now())) throw new OtpExpiredError();
    // Count the guess before the (slow) comparison so parallel guesses can't all pass the limit.
    if (!(await deps.otps.claimAttempt(otp.id, deps.maxAttempts))) throw new TooManyOtpAttemptsError();

    const ok = await verifyOtp(code, otp.codeHash);
    if (!ok) throw new InvalidOtpError();
    if (!(await deps.otps.consume(otp.id))) throw new InvalidOtpError();

    await deps.users.clearLock?.(user.id);
    return user;
  }

  return { requestLoginOtp, verifyLoginOtp };
}

export type OtpService = ReturnType<typeof createOtpService>;
