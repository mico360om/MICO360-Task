import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDatabaseCheck, expectedSchema, prismaDatabaseReads } from '../../src/modules/error-log/database-check';
import { databaseProbes } from '../../src/modules/error-log/database-probes';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createPrismaChecklistStore } from '../../src/modules/tasks/prisma-checklist-store';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine } from '../../src/modules/search/task-search-engine';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { constantOrderTerms, portabilityProblems } from '../../src/lib/sql-portability';
import { createTaskMergeService } from '../../src/modules/task-merge/merge-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23.1 — the database self-check on a real database (built by the migrations, as the live one is),
// and the live search failure (1054) looked for under every sql_mode the live server might run with.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const CODE = 'DBCHK';
let owner = '';

const engines = (client: PrismaClient) => ({
  taskSearch: createTaskSearchEngine({ prisma: client, index: createTaskSearchIndex({ prisma: client }), timeZone: 'Asia/Muscat' }),
  searchEngine: createSearchEngine({ prisma: client, timeZone: 'Asia/Muscat' }),
});

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: CODE }, select: { id: true } })).map((x) => x.id);
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: 'dbchk-owner@mico360.test' } });
}

beforeAll(async () => {
  await cleanup();
  owner = (await prisma.user.create({ data: { email: 'dbchk-owner@mico360.test', username: 'dbchk-owner', passwordHash: 'x', firstName: 'Check', lastName: 'Owner' } })).id;
  const project = await prisma.project.create({ data: { code: CODE, name: 'Database check yard', createdById: owner } });
  const todo = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'To do', category: 'TODO', position: 0 } });
  await prisma.task.create({ data: { key: `${CODE}-1`, title: 'Pump repair at the yard', projectId: project.id, columnId: todo.id, createdById: owner } });
  await prisma.task.create({ data: { key: `${CODE}-2`, title: 'Generator service', description: 'pump repair parts', projectId: project.id, columnId: todo.id, createdById: owner } });
  await createTaskSearchIndex({ prisma }).rebuildAll();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('database check on a database the migrations built', () => {
  it('OK: every table and column of the schema is there, and every query family works', async () => {
    const { taskSearch, searchEngine } = engines(prisma);
    const recorded: string[] = [];
    // 1.23.3: and the hold every checklist change takes (SELECT … FOR UPDATE).
    const probes = databaseProbes({ prisma, taskSearch, searchEngine, searchIndex: createSearchIndex({ prisma }), timeZone: 'Asia/Muscat', checklists: createPrismaChecklistStore(prisma) });
    expect(probes.map((p) => p.name)).toContain('checklists (holding a task while it changes)');
    // 1.23.6: the reader's filters, the new kinds, a saved search's count, every kind of the search index.
    expect(probes.map((p) => p.name)).toEqual(expect.arrayContaining(['a saved search’s count', 'search results: clients, accounts, contacts and checklist items', 'the search index (every kind’s heal and fingerprint)', 'temporary passwords and cancelled invitations', 'client permissions (roles, uploads, the portal bell)']));
    const check = createDatabaseCheck({ ...prismaDatabaseReads(prisma), probes, record: (p) => void recorded.push(p.text) });
    const r = await check.run();
    expect(r.problems).toEqual([]);
    expect(recorded).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.server?.product).toBe('MySQL');
    expect(r.summary).toMatch(/^Database check: OK \(MySQL \d+\.\d+\.\d+\)$/);
    expect(r.server?.sqlMode).toBeTypeOf('string');
    expect([0, 1, 2]).toContain(r.server?.lowerCaseTableNames);
  });

  it('a column the database lacks is named exactly', async () => {
    const recorded: string[] = [];
    const expected = [...expectedSchema(), { table: 'task_search_index', columns: ['taskId', 'nosuchcolumn'] }];
    const r = await createDatabaseCheck({ ...prismaDatabaseReads(prisma), expected, probes: [], record: (p) => void recorded.push(p.text) }).run();
    expect(r.problems.map((p) => p.text)).toEqual(['Column task_search_index.nosuchcolumn is missing']);
    expect(recorded[0]).toMatch(/^Database check: Column task_search_index\.nosuchcolumn is missing — MySQL /);
  });
});

/** One connection only, so a session's sql_mode holds for every query the probes send. */
function singleConnection(): PrismaClient {
  const single = new URL(url);
  single.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasources: { db: { url: single.toString() } } });
}

// Ruling out the live server's settings (1.23.1): MySQL 8 runs every search the same under each of
// these — the failure was MariaDB's reading of a constant sort term (`ORDER BY (FALSE)`), now gone.
const MODES = [
  'ANSI_QUOTES',
  'ANSI',
  'ONLY_FULL_GROUP_BY',
  'NO_BACKSLASH_ESCAPES',
  'TRADITIONAL',
  'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
  'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
  'PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,NO_BACKSLASH_ESCAPES',
  '',
];

describe('every search query under the sql_mode the live server might have', () => {
  for (const mode of MODES) {
    it(`sql_mode '${mode}'`, async () => {
      const client = singleConnection();
      try {
        await client.$executeRawUnsafe(`SET SESSION sql_mode = '${mode}'`);
        const m = (await client.$queryRaw<{ m: string }[]>`SELECT @@SESSION.sql_mode AS m`)[0]?.m ?? '';
        expect(m.split(',').filter(Boolean).sort()).toEqual(expect.arrayContaining(mode === 'ANSI' ? ['ANSI_QUOTES'] : mode.split(',').filter((x) => x && x !== 'TRADITIONAL')));
        const { taskSearch, searchEngine } = engines(client);
        // The words the top bar sends: two words (no number), a number, a bare number, a phrase.
        expect((await taskSearch.search({ q: 'pump repair', scope: { projectIds: null }, limit: 5, withTotal: true })).hits.map((h) => h.key).sort()).toEqual([`${CODE}-1`, `${CODE}-2`]);
        expect((await taskSearch.search({ q: `${CODE}-1`, scope: { projectIds: null }, limit: 5 })).hits[0]?.key).toBe(`${CODE}-1`);
        await taskSearch.search({ q: '1', scope: { projectIds: null }, limit: 5 });
        await taskSearch.search({ q: '"pump repair" yard', scope: { projectIds: null }, limit: 5, statuses: ['TODO'], done: false });
        const everything = await searchEngine.search({ q: 'pump repair', scope: { projectIds: null, meetings: { full: null, invitee: [], editable: null } }, viewerId: owner, limit: 5, withCounts: true });
        expect(everything.hits.map((h) => h.id).length).toBeGreaterThan(0);
        const recorded: string[] = [];
        // 1.23.2: and the merge's own SQL (its locks and late-writes look) under the same sql_mode.
        const taskMerge = createTaskMergeService({ prisma: client, timeZone: 'Asia/Muscat' });
        const r = await createDatabaseCheck({ ...prismaDatabaseReads(client), probes: databaseProbes({ prisma: client, taskSearch, searchEngine, searchIndex: createSearchIndex({ prisma: client }), timeZone: 'Asia/Muscat', taskMerge, checklists: createPrismaChecklistStore(client) }), record: (p) => void recorded.push(p.text) }).run();
        expect(r.problems).toEqual([]);
      } finally {
        await client.$disconnect();
      }
    });
  }

  it('the statements those searches send hold no constant sort term (MariaDB reads one as a column position)', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    try {
      const { taskSearch, searchEngine } = engines(client);
      for (const q of ['pump repair', `${CODE}-1`, '1', 'pump']) {
        await taskSearch.search({ q, scope: { projectIds: null }, limit: 5, withTotal: true });
        await searchEngine.search({ q, scope: { projectIds: null, meetings: { full: null, invitee: [], editable: null } }, viewerId: owner, limit: 5, withCounts: true });
      }
      const raw = sent.filter((s) => /task_search_index|search_index/.test(s));
      expect(raw.length).toBeGreaterThan(8);
      for (const sql of raw) expect(constantOrderTerms(sql), sql).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });
});

// 1.23.2 — the Management page's raw SQL on MariaDB: the start-up probe sends every raw form the page
// can send (a person's late tasks, late milestones, overdue action items, one form's failures), and
// none of them holds what MariaDB reads otherwise or refuses (lib/sql-portability).
describe('the Management page’s SQL, as the start-up check sends it', () => {
  it('every raw form is sent, and every statement is portable', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    try {
      const { taskSearch } = engines(client);
      const probe = databaseProbes({ prisma: client, taskSearch, timeZone: 'Asia/Muscat' }).find((p) => p.name === 'the Management page');
      expect(probe).toBeDefined();
      await probe!.run();
      const raw = sent.filter((s) => /^\s*SELECT\b/i.test(s) && !/^\s*SELECT\s+`/.test(s));
      // The person's late tasks, the late milestones, the overdue action items, one form's failures.
      expect(raw.some((s) => /EXISTS \(SELECT 1 FROM task_assignees ta WHERE ta\.taskId = t\.id AND ta\.userId = \?\)/.test(s))).toBe(true);
      expect(raw.some((s) => /t\.isMilestone = 1/.test(s))).toBe(true);
      expect(raw.some((s) => /FROM action_items a WHERE a\.dueDate IS NOT NULL/.test(s))).toBe(true);
      expect(raw.some((s) => /a\.itemId = \? AND i\.formId = \?/.test(s))).toBe(true);
      const problems = sent.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`));
      expect(problems).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });
});

// Review batch 4a: the new holds (board columns, the Workload swap, task links, repeat copies) as the
// start-up check sends them — every statement portable to MariaDB, none an isolation statement.
describe('board and task holds, as the start-up check sends them', () => {
  it('the probe runs, sends each hold, and every statement is portable', async () => {
    const sent: string[] = [];
    const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (e) => void sent.push(e.query));
    try {
      const { taskSearch } = engines(client);
      const probe = databaseProbes({ prisma: client, taskSearch, timeZone: 'Asia/Muscat' }).find((p) => p.name.startsWith('board and task holds'));
      expect(probe).toBeDefined();
      await probe!.run();
      for (const hold of [/FROM kanban_columns WHERE id = \? FOR UPDATE/, /FROM projects WHERE id = \? FOR UPDATE/, /FROM kanban_columns WHERE projectId = \? FOR UPDATE/, /SELECT version FROM tasks WHERE id = \? AND deletedAt IS NULL FOR UPDATE/, /AS stillDone, version FROM tasks WHERE id = \? FOR UPDATE/, /FROM job_locks WHERE name = \? FOR UPDATE/]) {
        expect(sent.some((q) => hold.test(q)), String(hold)).toBe(true);
      }
      const problems = sent.flatMap((sql) => portabilityProblems(sql).map((p) => `${p}: ${sql}`));
      expect(problems).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  });
});
