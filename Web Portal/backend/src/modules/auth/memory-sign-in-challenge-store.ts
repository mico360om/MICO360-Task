import type { ChallengeRow, SignInChallengeStore } from './sign-in-challenge';

/** In-memory sign-in challenges with the Prisma store's rules (tests). */
export function createMemorySignInChallengeStore(): SignInChallengeStore & { rows: ChallengeRow[] } {
  const rows: ChallengeRow[] = [];
  const byId = (id: string) => rows.find((r) => r.id === id);
  return {
    rows,
    async findOpen(userId, kind, sentTo, now) {
      return (
        [...rows]
          .reverse()
          .find((r) => r.userId === userId && r.kind === kind && r.sentTo.toLowerCase() === sentTo.toLowerCase() && r.consumedAt === null && r.expiresAt > now) ?? null
      );
    },
    async create(row) {
      rows.push({ ...row, attempts: 0, consumedAt: null });
    },
    async rotateToken(id, tokenHash) {
      const r = byId(id);
      if (!r || r.consumedAt) return false;
      r.tokenHash = tokenHash;
      return true;
    },
    async findByTokenHash(tokenHash) {
      return rows.find((r) => r.tokenHash === tokenHash) ?? null;
    },
    async recordSend(id, { codeHash, at, expiresAt }) {
      const r = byId(id);
      if (!r || r.consumedAt) return false;
      Object.assign(r, { codeHash, lastSentAt: at, expiresAt, sends: r.sends + 1 });
      return true;
    },
    async sendsSince(userId, since) {
      return rows.filter((r) => r.userId === userId && r.lastSentAt >= since).reduce((n, r) => n + r.sends, 0);
    },
    async failuresSince(userId, since) {
      return rows.filter((r) => r.userId === userId && r.createdAt >= since).reduce((n, r) => n + r.attempts, 0);
    },
    async claimAttempt(id, max) {
      const r = byId(id);
      if (!r || r.consumedAt || r.attempts >= max) return false;
      r.attempts += 1;
      return true;
    },
    async consume(id, at) {
      const r = byId(id);
      if (!r || r.consumedAt) return false;
      r.consumedAt = at;
      r.attempts = Math.max(0, r.attempts - 1);
      return true;
    },
    async endAll(userId, at) {
      for (const r of rows) if (r.userId === userId && r.consumedAt === null) r.consumedAt = at;
    },
  };
}
