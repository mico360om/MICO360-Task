import type { TrustedBrowserRow, TrustedBrowserStore } from './two-step';

/** In-memory trusted browsers with the Prisma store's rules (tests). */
export function createMemoryTrustedBrowserStore(): TrustedBrowserStore & { rows: TrustedBrowserRow[] } {
  const rows: TrustedBrowserRow[] = [];
  return {
    rows,
    async create(row) {
      rows.push({ ...row, revokedAt: null });
    },
    async find(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async countLive(userId, sessionVersion, now) {
      return rows.filter((r) => r.userId === userId && r.sessionVersion === sessionVersion && r.revokedAt === null && r.expiresAt > now).length;
    },
    async revokeAll(userId, at) {
      let n = 0;
      for (const r of rows) {
        if (r.userId === userId && r.revokedAt === null) {
          r.revokedAt = at;
          n += 1;
        }
      }
      return n;
    },
  };
}
