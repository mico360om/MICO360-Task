import { describe, it, expect } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createSearchEngine, type SearchAllInput } from './search-engine';
import { constantOrderTerms, portabilityProblems } from '../../lib/sql-portability';
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

// 1.23.6 — the reader's filters, searches with filters and no words, and the two new kinds.
function recordingValues() {
  const sent: { sql: string; values: unknown[] }[] = [];
  const prisma = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = Prisma.sql(strings, ...values);
      sent.push({ sql: q.sql, values: q.values });
      return Promise.resolve([]);
    },
  } as unknown as PrismaClient;
  return { sent, engine: createSearchEngine({ prisma, timeZone: 'Asia/Muscat' }) };
}
const day = (k: string) => new Date(`${k}T00:00:00Z`);
const everyFilter: Partial<SearchAllInput> = {
  due: { from: day('2026-11-01'), before: day('2026-11-08'), open: true },
  priorities: ['HIGH', 'URGENT'],
  approval: true,
  assigneeIds: ['u1', 'u2'],
  creatorIds: ['u1'],
  organizerIds: ['u1'],
};

describe('search everything 1.23.6 — filters and filter-only searches in SQL both databases read', () => {
  const combos: Partial<SearchAllInput>[] = [
    everyFilter,
    { due: { none: true } },
    { due: { before: day('2026-11-07'), open: true }, kinds: ['checklist'], assigneeIds: ['u1'] },
    { unassigned: true },
    { creatorIds: ['u1'], kinds: ['project', 'meeting', 'note', 'file', 'contact'] },
    { organizerIds: ['u1'], kinds: ['meeting', 'minutes'] },
    { kinds: ['contact'], projectId: 'p1', done: false },
    { kinds: ['checklist'], personId: 'u1', from: day('2026-11-01'), to: day('2026-11-08') },
  ];
  for (const [i, more] of combos.entries()) {
    for (const q of ['pump repair', '']) {
      it(`combination ${i + 1}, ${q ? 'with words' : 'no words'}: portable`, async () => {
        const { sent, engine } = recordingValues();
        await engine.search(input(q, { ...more, browse: true, scope: { ...scope, clientAccounts: true } }));
        expect(sent.length).toBeGreaterThan(0);
        for (const s of sent) expect(portabilityProblems(s.sql), s.sql).toEqual([]);
      });
    }
  }

  it('no words and no filter asked for: nothing is searched at all', async () => {
    const { sent, engine } = recordingValues();
    const r = await engine.search(input('', {}));
    expect(sent).toEqual([]);
    expect(r.hits).toEqual([]);
  });

  it('no words but filters (browse): tasks are read without the word index', async () => {
    const { sent, engine } = recordingValues();
    await engine.search(input('', { browse: true, priorities: ['HIGH'] }));
    const tasks = sent.filter((s) => /FROM tasks t/.test(s.sql));
    expect(tasks.length).toBeGreaterThan(0);
    for (const s of tasks) expect(s.sql).not.toContain('task_search_index');
  });

  it('a due date, an assignee, a priority or approval: only the kinds that have one', async () => {
    const kindsAsked = async (more: Partial<SearchAllInput>) => {
      const { sent, engine } = recordingValues();
      await engine.search(input('pump', { ...more, scope: { ...scope, clientAccounts: true } }));
      const idx = sent.filter((s) => /FROM search_index si/.test(s.sql));
      return [...new Set(idx.flatMap((s) => s.values.filter((v): v is string => typeof v === 'string' && ['project', 'meeting', 'note', 'minutes', 'file', 'inspection', 'checklist', 'contact', 'client', 'account'].includes(v))))].sort();
    };
    expect(await kindsAsked({ due: { none: true } })).toEqual(['checklist']);
    expect(await kindsAsked({ assigneeIds: ['u1'] })).toEqual(['checklist']);
    expect(await kindsAsked({ priorities: ['HIGH'] })).toEqual([]);
    expect(await kindsAsked({ approval: true })).toEqual([]);
    expect(await kindsAsked({ organizerIds: ['u1'] })).toEqual(['meeting', 'minutes']);
  });

  it('client accounts are searched only for administrators (the scope says so)', async () => {
    const asked = async (clientAccounts: boolean) => {
      const { sent, engine } = recordingValues();
      await engine.search(input('pump', { kinds: ['contact'], scope: { ...scope, clientAccounts } }));
      return sent.some((s) => s.values.includes('account'));
    };
    expect(await asked(false)).toBe(false);
    expect(await asked(true)).toBe(true);
  });
});
