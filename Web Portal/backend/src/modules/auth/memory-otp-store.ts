import type { OtpRecord, OtpStore } from './otp-service';

export interface MemoryOtpRow extends OtpRecord {
  createdAt: Date;
}

/** In-memory login-code store with the same semantics as the Prisma one (tests / dev). */
export function createMemoryOtpStore(now: () => Date = () => new Date()): OtpStore & { rows: MemoryOtpRow[] } {
  const rows: MemoryOtpRow[] = [];
  let seq = 0;
  return {
    rows,
    async create(data) {
      for (const r of rows) if (r.userId === data.userId && r.consumedAt === null) r.consumedAt = now();
      rows.push({ id: `otp${seq++}`, consumedAt: null, createdAt: now(), ...data });
    },
    async findActiveForUser(userId) {
      return [...rows].reverse().find((o) => o.userId === userId && o.consumedAt === null) ?? null;
    },
    async countIssuedSince(userId, since) {
      return rows.filter((r) => r.userId === userId && r.createdAt >= since).length;
    },
    async countFailuresSince(userId, since) {
      return rows.filter((r) => r.userId === userId && r.createdAt >= since).reduce((n, r) => n + r.attempts, 0);
    },
    async claimAttempt(id, max) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.consumedAt !== null || r.attempts >= max) return false;
      r.attempts += 1;
      return true;
    },
    async consume(id) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.consumedAt !== null) return false;
      r.consumedAt = now();
      r.attempts -= 1;
      return true;
    },
  };
}
