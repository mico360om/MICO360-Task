import { describe, it, expect, beforeEach } from 'vitest';
import { createPasswordResetService } from './password-reset-service';
import type { PasswordResetStore, ResetUserRepo, ResetMailer } from './password-reset-service';
import { hashResetToken } from '../../lib/reset-token';
import { InvalidResetTokenError, WeakPasswordError } from './errors';

function harness(user: { id: string; email: string } | null) {
  const rows: { id: string; userId: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];
  let seq = 0;
  const store: PasswordResetStore = {
    async create(data) {
      rows.push({ id: `r${seq++}`, consumedAt: null, ...data });
    },
    async findActiveByHash(tokenHash) {
      return rows.find((r) => r.tokenHash === tokenHash && r.consumedAt === null) ?? null;
    },
    async consume(id) {
      const r = rows.find((x) => x.id === id);
      if (r) r.consumedAt = new Date();
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
      emails.push({ email, link });
    },
  };
  const revoked: string[] = [];
  const svc = createPasswordResetService({
    store,
    users,
    mailer,
    ttlSeconds: 3600,
    appUrl: 'https://app.test',
    hashPassword: async (p) => `hashed:${p}`,
    revokeSessions: async (userId) => { revoked.push(userId); },
  });
  return { svc, rows, updates, emails, revoked };
}

describe('PasswordResetService.resetPassword — session revocation', () => {
  it('revokes every existing session for the user after a successful reset', async () => {
    const h = harness({ id: 'u1', email: 'ada@x.co' });
    await h.svc.requestReset('ada@x.co');
    const token = new URL(h.emails[0]!.link).searchParams.get('token')!;
    await h.svc.resetPassword(token, 'Str0ngpass');
    expect(h.updates).toHaveLength(1);
    expect(h.revoked).toEqual(['u1']);
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
    expect(res).toEqual({ sent: true });
    expect(h.rows).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]!.link).toMatch(/^https:\/\/app\.test\/reset\?token=[A-Za-z0-9_-]+$/);
  });

  it('does not reveal whether the account exists (still returns sent, sends nothing)', async () => {
    const h = harness(null);
    const res = await h.svc.requestReset('ghost@x.com');
    expect(res).toEqual({ sent: true });
    expect(h.rows).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });
});

describe('PasswordResetService.resetPassword', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness({ id: 'u1', email: 'ada@x.com' });
  });

  async function requestAndCaptureToken(): Promise<string> {
    await h.svc.requestReset('ada@x.com');
    return new URL(h.emails[0]!.link).searchParams.get('token')!;
  }

  it('sets the new password (hashed) and unlocks the account for a valid token', async () => {
    const token = await requestAndCaptureToken();
    await h.svc.resetPassword(token, 'NewPass123');
    expect(h.updates).toEqual([{ userId: 'u1', passwordHash: 'hashed:NewPass123' }]);
    expect(h.rows[0]!.consumedAt).not.toBeNull(); // single-use
  });

  it('rejects a weak new password before touching the token', async () => {
    const token = await requestAndCaptureToken();
    await expect(h.svc.resetPassword(token, 'short')).rejects.toBeInstanceOf(WeakPasswordError);
    expect(h.updates).toHaveLength(0);
    expect(h.rows[0]!.consumedAt).toBeNull();
  });

  it('rejects an unknown token', async () => {
    await expect(h.svc.resetPassword('bogus', 'NewPass123')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('rejects an already-used token', async () => {
    const token = await requestAndCaptureToken();
    await h.svc.resetPassword(token, 'NewPass123');
    await expect(h.svc.resetPassword(token, 'AnotherPass1')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('rejects an expired token', async () => {
    await h.svc.requestReset('ada@x.com');
    const token = new URL(h.emails[0]!.link).searchParams.get('token')!;
    h.rows[0]!.expiresAt = new Date(Date.now() - 1000); // force-expire
    // sanity: the stored hash matches the emitted token
    expect(h.rows[0]!.tokenHash).toBe(hashResetToken(token));
    await expect(h.svc.resetPassword(token, 'NewPass123')).rejects.toBeInstanceOf(InvalidResetTokenError);
  });
});
