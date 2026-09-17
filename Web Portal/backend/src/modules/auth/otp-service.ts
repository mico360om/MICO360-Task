import { generateOtpCode, hashOtp, verifyOtp, isExpired } from '../../lib/otp';
import { InvalidOtpError, OtpExpiredError, TooManyOtpAttemptsError } from './errors';

export interface OtpUser {
  id: string;
  email: string;
  roles: string[];
}

export interface OtpUserLookup {
  findActiveByIdentifier(identifier: string): Promise<OtpUser | null>;
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
  create(data: { userId: string; codeHash: string; expiresAt: Date; attempts: number }): Promise<void>;
  findActiveForUser(userId: string): Promise<OtpRecord | null>;
  incrementAttempts(id: string): Promise<void>;
  consume(id: string): Promise<void>;
}

export interface OtpMailer {
  sendLoginCode(email: string, code: string): Promise<void>;
}

export interface OtpServiceDeps {
  users: OtpUserLookup;
  otps: OtpStore;
  mailer: OtpMailer;
  ttlSeconds: number;
  otpLength: number;
  maxAttempts: number;
}

export function createOtpService(deps: OtpServiceDeps) {
  /** Generate + email a one-time login code (T2.10). Never reveals whether the account exists. */
  async function requestLoginOtp(identifier: string): Promise<{ sent: true }> {
    const user = await deps.users.findActiveByIdentifier(identifier);
    if (user) {
      const code = generateOtpCode(deps.otpLength);
      const codeHash = await hashOtp(code);
      const expiresAt = new Date(Date.now() + deps.ttlSeconds * 1000);
      await deps.otps.create({ userId: user.id, codeHash, expiresAt, attempts: 0 });
      await deps.mailer.sendLoginCode(user.email, code);
    }
    return { sent: true };
  }

  /** Verify a submitted login code; returns the user on success (single-use, expiring, rate-limited). */
  async function verifyLoginOtp(identifier: string, code: string): Promise<OtpUser> {
    const user = await deps.users.findActiveByIdentifier(identifier);
    if (!user) throw new InvalidOtpError();

    const otp = await deps.otps.findActiveForUser(user.id);
    if (!otp) throw new InvalidOtpError();
    if (isExpired(otp.expiresAt)) throw new OtpExpiredError();
    if (otp.attempts >= deps.maxAttempts) throw new TooManyOtpAttemptsError();

    const ok = await verifyOtp(code, otp.codeHash);
    if (!ok) {
      await deps.otps.incrementAttempts(otp.id);
      throw new InvalidOtpError();
    }

    await deps.otps.consume(otp.id);
    return user;
  }

  return { requestLoginOtp, verifyLoginOtp };
}

export type OtpService = ReturnType<typeof createOtpService>;
