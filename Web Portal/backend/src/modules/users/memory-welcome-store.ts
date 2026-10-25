import type { WelcomeTokenStore } from './welcome-service';

/** Welcome links in memory, with the same rules as the database (tests / dev). */
export function createMemoryWelcomeTokenStore() {
  const rows: { id: string; userId: string; tokenHash: string; expiresAt: Date; consumed: boolean }[] = [];
  let seq = 0;
  const store: WelcomeTokenStore = {
    async create(data) {
      const id = `w${seq++}`;
      rows.push({ id, consumed: false, ...data });
      return id;
    },
    async replaceEarlier(userId, keepId) {
      for (const r of rows) if (r.userId === userId && r.id !== keepId) r.consumed = true;
    },
    async discard(id) {
      for (const r of rows) if (r.id === id) r.consumed = true;
    },
  };
  return { store, rows, live: (userId: string) => rows.filter((r) => r.userId === userId && !r.consumed) };
}
