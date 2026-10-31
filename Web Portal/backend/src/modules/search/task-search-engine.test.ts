import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTaskSearchEngine } from './task-search-engine';

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
