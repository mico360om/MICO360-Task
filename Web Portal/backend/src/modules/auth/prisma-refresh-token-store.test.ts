import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaRefreshTokenStore } from './prisma-refresh-token-store';

// The query shape against a stand-in client (no database needed).
describe('createPrismaRefreshTokenStore — fingerprint keys', () => {
  const stand = () => {
    const create = vi.fn(async () => ({}));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const store = createPrismaRefreshTokenStore({ refreshToken: { create, updateMany } } as unknown as PrismaClient);
    return { store, create, updateMany };
  };

  it('saves a key with its purpose, and a session token without one', async () => {
    const { store, create } = stand();
    const end = new Date('2026-11-19T00:00:00Z');
    await store.save('u1', 'h-key', end, 'fam-1', 'biometric');
    await store.save('u1', 'h-session', end, 'fam-2');
    expect(create).toHaveBeenNthCalledWith(1, { data: { userId: 'u1', tokenHash: 'h-key', expiresAt: end, familyId: 'fam-1', purpose: 'biometric' } });
    expect(create).toHaveBeenNthCalledWith(2, { data: { userId: 'u1', tokenHash: 'h-session', expiresAt: end, familyId: 'fam-2', purpose: null } });
  });

  it('revokeBiometricKeys revokes only that person’s live keys', async () => {
    const { store, updateMany } = stand();
    await store.revokeBiometricKeys!('u1');
    expect(updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', purpose: 'biometric', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });

  it('extendBiometricKeys moves on only live keys that end sooner (never back, never reviving one)', async () => {
    const { store, updateMany } = stand();
    const now = new Date('2026-10-20T00:00:00Z');
    const end = new Date('2026-11-19T00:00:00Z');
    await store.extendBiometricKeys!('u1', end, now);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', purpose: 'biometric', revokedAt: null, expiresAt: { gt: now, lt: end } },
      data: { expiresAt: end },
    });
  });
});
