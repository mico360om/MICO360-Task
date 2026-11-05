import { describe, it, expect } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createTaskSearchEngine } from './task-search-engine';
import { constantOrderTerms } from '../../lib/sql-portability';

// The database is never asked when there is nothing to look for, or nowhere to look.
const untouchable = new Proxy({}, { get: () => { throw new Error('the database was asked'); } }) as PrismaClient;
const engine = createTaskSearchEngine({ prisma: untouchable, timeZone: 'Asia/Muscat' });

describe('task search engine — no database round trip when there is nothing to find', () => {
  it('a blank query, or only quotes, finds nothing', async () => {
    expect(await engine.search({ q: '   ', scope: { projectIds: null }, limit: 20 })).toEqual({ hits: [], nextOffset: null });
    expect(await engine.search({ q: '""', scope: { projectIds: null }, limit: 20, withTotal: true })).toEqual({ hits: [], nextOffset: null, total: 0, totalCapped: false });
  });

  it('someone who can see no project finds nothing', async () => {
    expect(await engine.search({ q: 'scaffold', scope: { projectIds: [] }, limit: 20 })).toEqual({ hits: [], nextOffset: null });
  });
});

// 1.23.1 — the live site's database server (MariaDB) reads a bare FALSE in ORDER BY as column position 0:
// every search of two words or more without a task number failed there with error 1054, "Unknown
// column '0' in 'ORDER BY'" (masked as "Unknown column '?' in '?'" in 1.23.0's Error log). MySQL 8, here,
// sorts by the constant. The statements the search sends hold no such term, whatever is typed.
describe('task search engine — SQL that MariaDB reads as MySQL 8 does', () => {
  /** A database that answers nothing and keeps each statement's text (with its ? placeholders). */
  function recording() {
    const sent: string[] = [];
    const prisma = {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        sent.push(Prisma.sql(strings, ...values).sql);
        return Promise.resolve([]);
      },
    } as unknown as PrismaClient;
    return { sent, engine: createTaskSearchEngine({ prisma, timeZone: 'Asia/Muscat' }) };
  }

  for (const q of ['pump repair', 'replace "mud pump" liners', 'MICO-142', 'mico 142', '142', 'pump', 'open mico 142 phase 2']) {
    it(`no constant sort term: “${q}”`, async () => {
      const { sent, engine: e } = recording();
      await e.search({ q, scope: { projectIds: null }, limit: 5, withTotal: true });
      await e.search({ q, scope: { projectIds: ['p1', 'p2'] }, limit: 5, statuses: ['TODO'], done: false, assigneeId: 'u1', projectId: 'p1' });
      expect(sent.length).toBe(3);
      for (const sql of sent) expect(constantOrderTerms(sql), sql).toEqual([]);
    });
  }
});
