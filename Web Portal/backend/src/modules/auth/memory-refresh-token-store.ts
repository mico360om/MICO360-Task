import type { RefreshTokenStore } from './token-service';

export interface MemoryRefreshRow {
  userId: string;
  hash: string;
  expiresAt: Date;
  familyId: string | null;
  revokedAt: Date | null;
  successorEnc?: string | null;
  purpose?: 'biometric' | null;
  /** Its session was ended by Log out (endSession). */
  signedOut?: boolean;
}

/** In-memory refresh-token store with the same rotation semantics as the Prisma one (tests / dev). */
export function createMemoryRefreshTokenStore(): RefreshTokenStore & { rows: MemoryRefreshRow[] } {
  const rows: MemoryRefreshRow[] = [];
  return {
    rows,
    async save(userId, hash, expiresAt, familyId, purpose) {
      rows.push({ userId, hash, expiresAt, familyId: familyId ?? null, revokedAt: null, purpose: purpose ?? null });
    },
    async findValid(hash) {
      const r = rows.find((x) => x.hash === hash && x.revokedAt === null && x.expiresAt.getTime() > Date.now());
      return r ? { userId: r.userId } : null;
    },
    async revoke(hash) {
      const r = rows.find((x) => x.hash === hash && x.revokedAt === null);
      if (r) r.revokedAt = new Date();
    },
    async revokeAllForUser(userId) {
      for (const r of rows) if (r.userId === userId && r.revokedAt === null) r.revokedAt = new Date();
    },
    async rotate(hash, now) {
      const r = rows.find((x) => x.hash === hash);
      if (!r || r.expiresAt.getTime() <= now.getTime()) return { status: 'invalid' };
      if (r.revokedAt === null) {
        r.revokedAt = now;
        return { status: 'rotated', userId: r.userId, familyId: r.familyId };
      }
      if (r.signedOut) return { status: 'reused', userId: r.userId, familyId: r.familyId, revokedAt: r.revokedAt, successorEnc: null, signedOut: true };
      return { status: 'reused', userId: r.userId, familyId: r.familyId, revokedAt: r.revokedAt, successorEnc: r.successorEnc ?? null };
    },
    async setSuccessor(hash, successorEnc) {
      const r = rows.find((x) => x.hash === hash);
      if (r && !r.signedOut) r.successorEnc = successorEnc;
    },
    async endSession(hash, at) {
      const r = rows.find((x) => x.hash === hash);
      if (!r) return;
      if (r.purpose === 'biometric') {
        if (r.revokedAt === null) r.revokedAt = at;
        return;
      }
      const session = r.familyId ? rows.filter((x) => x.familyId === r.familyId && x.purpose !== 'biometric') : [r];
      for (const x of session) {
        if (x.revokedAt === null) x.revokedAt = at;
        x.signedOut = true;
        x.successorEnc = null;
      }
    },
    async signedOut(hash) {
      return rows.find((x) => x.hash === hash)?.signedOut === true;
    },
    async revokeFamily(familyId) {
      for (const r of rows) if (r.familyId === familyId && r.revokedAt === null) r.revokedAt = new Date();
    },
    async revokeBiometricKeys(userId) {
      for (const r of rows) if (r.userId === userId && r.purpose === 'biometric' && r.revokedAt === null) r.revokedAt = new Date();
    },
    async extendBiometricKeys(userId, expiresAt, now) {
      for (const r of rows) {
        const live = r.userId === userId && r.purpose === 'biometric' && r.revokedAt === null && r.expiresAt.getTime() > now.getTime();
        if (live && r.expiresAt.getTime() < expiresAt.getTime()) r.expiresAt = expiresAt;
      }
    },
  };
}
