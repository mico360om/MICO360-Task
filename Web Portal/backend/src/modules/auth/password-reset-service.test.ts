import { describe, it, expect, beforeEach } from 'vitest';
import { createPasswordResetService } from './password-reset-service';
import type { PasswordResetStore, ResetUserRepo, ResetMailer } from './password-reset-service';
import { hashResetToken } from '../../lib/reset-token';
import { EmailUnavailableError, InvalidResetTokenError, WeakPasswordError } from './errors';

function harness(user: { id: string; email: string } | null, opts: { configured?: boolean; failSend?: boolean } = {}) {
  let clock = new Date('2026-09-26T08:00:00.000Z').getTime();
  const now = () => new Date(clock);
  const rows: { id: string; userId: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null; createdAt: Date }[] = [];
  let seq = 0;
  const store: PasswordResetStore = {
    async create(data) {
      for (const r of rows) if (r.userId === data.userId && r.consumedAt === null) r.consumedAt = now();
      rows.push({ id: `r${seq++}`, consumedAt: null, createdAt: now(), ...data });
    },
    async findActiveByHash(tokenHash) {
      return rows.find((r) => r.tokenHash === tokenHash && r.consumedAt === null) ?? null;
    },
    async countIssuedSince(userId, since) {
      return rows.filter((r) => r.userId === userId && r.createdAt >= since).length;
    },
    async consume(id) {
      const r = rows.find((x) => x.id === id && x.consumedAt === null);
      if (!r) return false;
      r.consumedAt = now();
      return true;
    },
    async consumeAllForUser(userId) {
      for (const r of rows) if (r.userId === userId && r.consumedAt === null) r.consumedAt = now();
    },
  };
  const updates: { userId: string; passwordHash: string }[] = [];
  const users: ResetUserRepo = {
    async findActiveByIdentifier() {
      return user;
    },
    async setPasswordAndUnlock(userId, passwordHash) {
      updates.push({ userId, passwordHash });
    },
  };
  const emails: { email: string; link: string }[] = [];
  const mailer: ResetMailer = {
    async sendPasswordReset(email, link) {
      if (opts.failSend) throw new Error('mailjet down');
      emails.push({ email, link });
    },
    isConfigured: () => opts.configured ?? true,
  };
  const revoked: string[] = [];
  const disconnected: string[] = [];
  const warnings: string[] = [];
  const pending: Promise<void>[] = [];
  const svc = createPasswordResetService({
    store,
    users,
    mailer,
    ttlSeconds: 3600,
    appUrl: 'https://app.test',
    hashPassword: async (p) => `hashed:${p}`,
    revokeSessions: async (userId) => { revoked.push(userId); },
    onSessionsRevoked: (userId) => { disconnected.push(userId); },
    runInBackground: (task) => { pending.push(task().catch((err) => void warnings.push(String(err)))); },
    logger: { warn: (msg) => void warnings.push(msg) },
    now,
  });
  const flush = () => Promise.all(pending.splice(0));
  /** Request a link and return its token. */
  const requestToken = async (identifier = 'ada@x.com') => {
    await svc.requestReset(identifier);
    await flush();
    return new URL(emails.at(-1)!.link).searchParams.get('token')!;
  };
  return { svc, rows, updates, emails, revoked, disconnected, warnings, flush, requestToken, advance: (ms: number) => (clock += ms) };
}

describe('PasswordResetService.resetPassword — session revocation', () => {
  it('revokes every existing session for the user after a successful reset', async () => {
    const h = harness({ id: 'u1', email: 'ada@x.co' });
    const token = await h.requestToken('ada@x.co');
    await h.svc.resetPassword(token, 'Str0ngpass');
    expect(h.updates).toHaveLength(1);
    expect(h.revoked).toEqual(['u1']);
    expect(h.disconnected).toEqual(['u1']);
  });

  it('does not revoke sessions when the reset is rejected', async () => {
    const h = harness({ id: 'u1', email: 'ada@x.co' });
    await expect(h.svc.resetPassword('bogus-token', 'Str0ngpass')).rejects.toThrow();
    expect(h.revoked).toEqual([]);
  });
});

describe('PasswordResetService.requestReset', () => {
  it('emails a reset link containing a token when the account exists', async () => {
    const h = harness({ id: 'u1', email: 'ada@x.com' });
    const res = await h.svc.requestReset('ada@x.com');
    await h.flush();
    expect(res).toEqual({ sent: true });
    expect(h.rows).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]!.link).toMatch(/^https:\/\/app\.test\/reset\?token=[A-Za-z0-9_-]+$/);
  });

  it('does not reveal whether the account exists (still returns sent, sends nothing)', async () => {
    const h = harness(null);
    const res = await h.svc.requestReset('ghost@x.com');
    await h.flush();
    expect(res).toEqual({ sent: true });
    expect(h.rows).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  it('answers 503 EMAIL_NOT_CONFIGURED for known and unknown accounts alike when email is off', async () => {
    await expect(harness({ id: 'u1', email: 'a@x.com' }, { configured: false }).svc.requestReset('a@x.com')).rejects.toBeInstanceOf(EmailUnavailableError);
    await expect(harness(null, { configured: false }).svc.requestReset('ghost@x.com')).rejects.toBeInstanceOf(EmailUnavailableError);
  });

  it('logs a send failure but keeps the generic answer', async () => {
    const h = harness({ id: 'u1', email: 'ada@x.com' }, { failSend: true });
    await expect(h.svc.requestReset('ada@x.com')).resolves.toEqual({ sent: true });
    await h.flush();
    expect(h.warnings.join(' ')).toMatch(/mailjet down/);
  });

  it('throttles reset emails per account', async () => {
    const h = harness({ id: 'u1', email: 'ada@x.com' });
    await h.svc.requestReset('ada@x.com');
    await h.svc.requestReset('ada@x.com');
    await h.flush();
    expect(h.emails).toHaveLength(1);
    h.advance(61_000);
    await h.svc.requestReset('ada@x.com');
    await h.flush();
    expect(h.emails).toHaveLength(2);
  });
});

describe('PasswordResetService.resetPassword', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness({ id: 'u1', email: 'ada@x.com' });
  });

  it('sets the new password (hashed) and unlocks the account for a valid token', async () => {
    const token = await h.requestToken();
    await h.svc.resetPassword(token, 'NewPass123');
    expect(h.updates).toEqual([{ userId: 'u1', passwordHash: 'hashed:NewPass123' }]);
    expect(h.rows[0]!.consumedAt).not.toBeNull(); // single-use
  });

  it('rejects a weak new password before touching the token', async () => {
    const token = await h.requestToken();
    await expect(h.svc.resetPassword(token, 'short')).rejects.toBeInstanceOf(WeakPasswordError);
    expect(h.updates).toHaveLength(0);
    expect(h.rows[0]!.consumedAt).toBeNull();
  });

  it('rejects an unknown token', async () => {
    await expect(h.svc.resetPassword('bogus', 'NewPass123')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('rejects an already-used token', async () => {
    const token = await h.requestToken();
    await h.svc.resetPassword(token, 'NewPass123');
    await expect(h.svc.resetPassword(token, 'AnotherPass1')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('lets only one of two parallel resets with the same link through', async () => {
    const token = await h.requestToken();
    const results = await Promise.allSettled([h.svc.resetPassword(token, 'NewPass123'), h.svc.resetPassword(token, 'OtherPass123')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(h.updates).toHaveLength(1);
  });

  it('invalidates older links once a newer one is issued or a reset succeeds', async () => {
    const first = await h.requestToken();
    h.advance(61_000);
    const second = await h.requestToken();
    await expect(h.svc.resetPassword(first, 'NewPass123')).rejects.toBeInstanceOf(InvalidResetTokenError);
    await h.svc.resetPassword(second, 'NewPass123');
    expect(h.rows.every((r) => r.consumedAt !== null)).toBe(true);
  });

  it('rejects an expired token', async () => {
    const token = await h.requestToken();
    h.rows[0]!.expiresAt = new Date(Date.parse('2026-09-26T08:00:00.000Z') - 1000); // force-expire
    // sanity: the stored hash matches the emitted token
    expect(h.rows[0]!.tokenHash).toBe(hashResetToken(token));
    await expect(h.svc.resetPassword(token, 'NewPass123')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });
});
