import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1.23.2 — the server's one Prisma client opens a steady pool: DATABASE_URL with connection_limit=10 and
// pool_timeout=20 added when it sets none (lib/db-pool); a value in the URL is kept.
const made: unknown[] = [];
// 1.23.3 — and it tells each request's timing about its database calls (lib/request-timing).
const middlewares: unknown[] = [];
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(opts?: unknown) {
      made.push(opts);
    }
    $use(mw: unknown) {
      middlewares.push(mw);
    }
    async $transaction() {
      return null;
    }
  },
}));

describe('the server’s Prisma client', () => {
  const before = process.env.DATABASE_URL;
  beforeEach(() => {
    made.length = 0;
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma;
  });
  afterEach(() => {
    process.env.DATABASE_URL = before;
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it('uses DATABASE_URL with the pool’s defaults', async () => {
    process.env.DATABASE_URL = 'mysql://u:p@db.example:3306/mico';
    await import('./prisma');
    expect(made).toEqual([{ datasources: { db: { url: 'mysql://u:p@db.example:3306/mico?connection_limit=10&pool_timeout=20' } } }]);
  });

  it('keeps a connection_limit set in DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'mysql://u:p@db.example:3306/mico?connection_limit=4';
    await import('./prisma');
    expect(made).toEqual([{ datasources: { db: { url: 'mysql://u:p@db.example:3306/mico?connection_limit=4' } } }]);
  });

  it('measures each request’s time in the database (once, even when the module loads again)', async () => {
    middlewares.length = 0;
    process.env.DATABASE_URL = 'mysql://u:p@db.example:3306/mico';
    const first = await import('./prisma');
    vi.resetModules();
    const again = await import('./prisma'); // the same client, kept on globalThis outside production
    expect(again.prisma).toBe(first.prisma);
    expect(middlewares).toHaveLength(2); // the timing, then the save retry layer — once each
  });

  // 1.23.29 — a save conflict (MariaDB 1020, a deadlock) is tried again by lib/save-retry, as the LAST
  // middleware (a retry's `next` runs the query again only past the last one), inside the request timing.
  it('tries a save conflict again, as the last middleware, inside the request timing', async () => {
    middlewares.length = 0;
    process.env.DATABASE_URL = 'mysql://u:p@db.example:3306/mico';
    const { prisma } = await import('./prisma');
    expect(middlewares).toHaveLength(2);
    type Mw = (p: unknown, next: (p: unknown) => Promise<unknown>) => Promise<unknown>;
    const [, retry] = middlewares as Mw[];
    const conflict = Object.assign(new Error('Raw query failed. Code: `1020`.'), { code: 'P2010', meta: { code: '1020' } });
    let tries = 0;
    const out = await retry!({ model: 'Task', action: 'update', args: {}, dataPath: [], runInTransaction: false }, async () => {
      if (++tries === 1) throw conflict;
      return 'saved';
    });
    expect(out).toBe('saved');
    expect(tries).toBe(2);
    expect(() => (prisma as unknown as { $use(mw: unknown): void }).$use(() => null)).toThrow(/before withSaveRetries/);
  });
});
