import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1.23.2 — the server's one Prisma client opens a steady pool: DATABASE_URL with connection_limit=10 and
// pool_timeout=20 added when it sets none (lib/db-pool); a value in the URL is kept.
const made: unknown[] = [];
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor(opts?: unknown) {
      made.push(opts);
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
});
