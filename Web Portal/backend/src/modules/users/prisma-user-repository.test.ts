import { describe, it, expect } from 'vitest';
import { tombstone } from './prisma-user-repository';

describe('tombstone (freeing a deleted account’s email / username)', () => {
  it('keeps the original recognisable and makes it unique', () => {
    const a = tombstone('ali@mico360.com', 'ckuser00000001');
    expect(a.startsWith('ali@mico360.com~deleted-')).toBe(true);
    expect(a).not.toBe('ali@mico360.com');
  });

  it('never exceeds the 191-character column', () => {
    expect(tombstone('x'.repeat(191), 'ckuser00000001').length).toBeLessThanOrEqual(191);
  });

  it('works for Arabic usernames', () => {
    expect(tombstone('علي', 'ckuser00000001').startsWith('علي~deleted-')).toBe(true);
  });
});

// Review fix #8, reviewer's follow-up: inside the hold, the person changed and the administrators counted
// are read with locks (the latest committed rows, whenever the transaction's snapshot began), so the
// rule never rests on when MariaDB starts a snapshot.
describe('withAdminsHeld (stand-in client)', () => {
  it('locks the sentinel, then the person, and counts the active administrators with a locking read', async () => {
    const { vi } = await import('vitest');
    const { createPrismaUserRepository } = await import('./prisma-user-repository');
    const statements: string[] = [];
    const raw = (strings: TemplateStringsArray | { strings?: string[]; sql?: string }, ...values: unknown[]) => {
      const text = Array.isArray(strings) ? (strings as TemplateStringsArray).join('?') : String((strings as { sql?: string }).sql ?? '');
      statements.push(text.replace(/\s+/g, ' ').trim());
      void values;
      return Promise.resolve(text.includes('COUNT') ? [{ n: 2n }] : [{ id: 'u1' }]);
    };
    const tx = {
      $queryRaw: vi.fn(raw),
      user: {
        findFirst: vi.fn(async () => null),
        count: vi.fn(async () => {
          statements.push('plain count');
          return 2;
        }),
      },
    };
    const prisma = {
      jobLock: { createMany: vi.fn(async () => ({ count: 0 })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const repo = createPrismaUserRepository(prisma as never);
    const n = await repo.withAdminsHeld!(async (held) => {
      await held.findById('u1');
      return held.countActiveAdmins('u1');
    });
    expect(n).toBe(2);
    expect(statements[0]).toMatch(/^SELECT name FROM job_locks WHERE name = \? FOR UPDATE$/);
    expect(statements[1]).toMatch(/^SELECT id FROM users WHERE id = \? FOR UPDATE$/);
    expect(statements[2]).toMatch(/COUNT\(DISTINCT u\.id\)[\s\S]*FROM users u[\s\S]*r\.name = 'ADMIN'[\s\S]*LOCK IN SHARE MODE$/);
    expect(statements).not.toContain('plain count');
  });
});
