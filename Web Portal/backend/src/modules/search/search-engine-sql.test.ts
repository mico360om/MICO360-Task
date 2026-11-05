import { describe, it, expect } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createSearchEngine, type SearchAllInput } from './search-engine';
import { constantOrderTerms } from '../../lib/sql-portability';
import type { SearchScopeAll } from './search-scope';

/**
 * A database that keeps each statement's text (its ? placeholders as Prisma writes them) and answers
 * nothing — or fails the task half's statements (`failTasks`), as the live task search did.
 */
function recording({ failTasks = false } = {}) {
  const sent: string[] = [];
  const prisma = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Prisma.sql(strings, ...values).sql;
      sent.push(sql);
      if (failTasks && /FROM task_search_index si/.test(sql)) return Promise.reject(new Error("Unknown column '0' in 'ORDER BY'"));
      return Promise.resolve([]);
    },
  } as unknown as PrismaClient;
  return { sent, engine: createSearchEngine({ prisma, timeZone: 'Asia/Muscat' }) };
}

const scope: SearchScopeAll = { projectIds: ['p1'], meetings: { full: ['m1'], fullProjects: ['p1'], invitee: ['m2'], editable: ['m1'], editor: 'u1' } };
const input = (q: string, more: Partial<SearchAllInput> = {}): SearchAllInput => ({ q, scope, viewerId: 'u1', limit: 10, withCounts: true, ...more });

// 1.23.1 — what MariaDB (the live site's server) reads as a column position never reaches it.
describe('search everything — SQL that MariaDB reads as MySQL 8 does', () => {
  for (const q of ['pump repair', 'MICO-142', '142', 'pump', '"mud pump" liners']) {
    it(`no constant sort term: “${q}”`, async () => {
      const { sent, engine } = recording();
      await engine.search(input(q));
      await engine.search(input(q, { kinds: ['task', 'note'], taskStatuses: ['TODO'], done: false, personId: 'u1', projectId: 'p1', includeArchived: true }));
      await engine.anyWords({ ...input(q), words: q.split(' ') });
      expect(sent.length).toBeGreaterThan(5);
      for (const sql of sent) expect(constantOrderTerms(sql), sql).toEqual([]);
    });
  }
});

// 1.23.1 — the task half failing never takes the other kinds down (the Search page still shows them).
describe('search everything — when the task half fails', () => {
  it('answers without tasks, says tasksUnavailable, and tells each failing step', async () => {
    const { engine } = recording({ failTasks: true });
    const told: unknown[] = [];
    const r = await engine.search(input('pump repair', { onTasksFailed: (err) => told.push(err) }));
    expect(r.tasksUnavailable).toBe(true);
    expect(r.counts?.task).toBe(0);
    expect(r.hits).toEqual([]);
    expect(told.length).toBeGreaterThan(0);
    expect(String(told[0])).toContain('Unknown column');
  });

  it('a search that worked says nothing', async () => {
    const { engine } = recording();
    expect(await engine.search(input('pump repair', { onTasksFailed: () => {} }))).not.toHaveProperty('tasksUnavailable');
  });

  it('without anyone to tell (the AI panel’s candidates), it fails as before', async () => {
    const { engine } = recording({ failTasks: true });
    await expect(engine.search(input('pump repair'))).rejects.toThrow('Unknown column');
  });
});
