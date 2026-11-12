import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine, type TaskSearchInput } from '../../src/modules/search/task-search-engine';
import { createSearchService } from '../../src/modules/search/search-service';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const index = createTaskSearchIndex({ prisma });
const engine = createTaskSearchEngine({ prisma, index, timeZone: 'Asia/Muscat' });

const CODES = ['SRCA', 'SRCB', 'SRCARC', 'SRCDEL', 'SRCBIG', 'SRN', 'SRN2', 'SRNARC'];
const EMAILS = ['srch-owner@mico360.test', 'srch-bilal@mico360.test', 'srch-sara@mico360.test'];

let owner = '';
let bilal = '';
let sara = '';
const p = { a: '', b: '', archived: '', deleted: '', n: '', n2: '', nArc: '' };
const col = { aTodo: '', aDoing: '', aDone: '', bTodo: '', arcTodo: '', delTodo: '' };
const t: Record<string, string> = {};

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((x) => x.id);
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.taskKeyAlias.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.comment.deleteMany({ where: { task: { projectId: { in: ids } } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.tag.deleteMany({ where: { name: { in: ['srch-safety'] } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

const all = { projectIds: null };
const run = (q: string, extra: Partial<TaskSearchInput> = {}) => engine.search({ q, scope: all, limit: 20, ...extra });
const keys = async (q: string, extra: Partial<TaskSearchInput> = {}) => (await run(q, extra)).hits.map((h) => h.key);

beforeAll(async () => {
  await prisma.$connect();
  await cleanup();
  const user = (email: string, username: string, firstName: string, lastName: string) =>
    prisma.user.create({ data: { email, username, passwordHash: 'x', firstName, lastName } }).then((u) => u.id);
  owner = await user(EMAILS[0]!, 'srch-owner', 'Owner', 'One');
  bilal = await user(EMAILS[1]!, 'srch-bilal', 'Bilal', 'Ahmed');
  sara = await user(EMAILS[2]!, 'srch-sara', 'Sara', 'Nasser');
  const project = (code: string, extra: { status?: 'ARCHIVED'; deletedAt?: Date } = {}) =>
    prisma.project.create({ data: { code, name: `Project ${code}`, createdById: owner, ...extra } }).then((x) => x.id);
  p.a = await project('SRCA');
  p.b = await project('SRCB');
  p.archived = await project('SRCARC', { status: 'ARCHIVED' });
  p.deleted = await project('SRCDEL', { deletedAt: new Date() });
  const column = (projectId: string, name: string, category: 'TODO' | 'IN_PROGRESS' | 'DONE', position: number) =>
    prisma.kanbanColumn.create({ data: { projectId, name, category, position } }).then((c) => c.id);
  col.aTodo = await column(p.a, 'To do', 'TODO', 0);
  col.aDoing = await column(p.a, 'Doing', 'IN_PROGRESS', 1);
  col.aDone = await column(p.a, 'Done', 'DONE', 2);
  col.bTodo = await column(p.b, 'To do', 'TODO', 0);
  col.arcTodo = await column(p.archived, 'To do', 'TODO', 0);
  col.delTodo = await column(p.deleted, 'To do', 'TODO', 0);
  let n = 0;
  const task = async (name: string, projectId: string, columnId: string, title: string, extra: Record<string, unknown> = {}) => {
    n += 1;
    const code = CODES.find((c) => c !== 'SRCBIG' && projectId === { SRCA: p.a, SRCB: p.b, SRCARC: p.archived, SRCDEL: p.deleted }[c])!;
    t[name] = (await prisma.task.create({ data: { key: `${code}-${n}`, title, projectId, columnId, createdById: owner, updatedAt: new Date(Date.UTC(2026, 9, 1, 0, n)), ...extra } })).id;
    return t[name]!;
  };

  await task('title', p.a, col.aTodo, 'Scaffold inspection on Rig 3');
  await task('described', p.a, col.aDoing, 'Weekly walk', { description: 'Look at the SCAFFOLDING near the gate' });
  const commented = await task('commented', p.a, col.aTodo, 'Crane lift plan');
  const first = await prisma.comment.create({ data: { taskId: commented, userId: bilal, body: 'Who has the scaffold permit?', createdAt: new Date('2026-10-28T08:00:00Z') } });
  await prisma.comment.create({ data: { taskId: commented, userId: sara, body: 'Hot work permit is with the supervisor', parentId: first.id, createdAt: new Date('2026-10-29T08:00:00Z') } });
  await prisma.comment.create({ data: { taskId: commented, userId: sara, body: 'forbiddenword in a deleted comment', deletedAt: new Date() } });
  const checked = await task('checklist', p.a, col.aTodo, 'Site handover');
  await prisma.checklistItem.create({ data: { taskId: checked, text: 'Photograph the base plates' } });
  const assigned = await task('assigned', p.a, col.aTodo, 'Generator service');
  await prisma.taskAssignee.create({ data: { taskId: assigned, userId: bilal } });
  const contact = await task('contact', p.a, col.aTodo, 'Pipe delivery');
  await prisma.taskExternalContact.create({ data: { taskId: contact, name: 'Khalid Al-Hassan', company: 'Occidental Oman', designation: 'Logistics lead', email: 'khalid@acme.example', phone: '+968 9555 1234', remarks: 'Calls after noon' } });
  const tagged = await task('tagged', p.a, col.aTodo, 'Toolbox talk');
  const tag = await prisma.tag.create({ data: { name: 'srch-safety' } });
  await prisma.taskTag.create({ data: { taskId: tagged, tagId: tag.id } });
  const filed = await task('file', p.a, col.aTodo, 'Insurance renewal');
  await prisma.attachment.create({ data: { taskId: filed, uploadedById: owner, filename: 'Policy_2026.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k1', url: '/u/k1' } });
  const moved = await task('moved', p.a, col.aTodo, 'Moved task');
  await prisma.taskKeyAlias.create({ data: { key: 'SRCB-77', taskId: moved, projectId: p.b } });
  await task('arabic', p.a, col.aTodo, 'إدارة الموقع', { description: 'المُدِير يراجع' });
  await task('phrase', p.a, col.aTodo, 'Permit for the scaffold');
  await task('done', p.a, col.aDone, 'Scaffold removed', { completedAt: new Date('2026-10-20T08:00:00Z') });
  await task('otherProject', p.b, col.bTodo, 'Scaffold in project B');
  await task('archived', p.archived, col.arcTodo, 'Scaffold in an archived project');
  await task('inDeletedProject', p.deleted, col.delTodo, 'Scaffold in a deleted project');
  await task('deletedTask', p.a, col.aTodo, 'Scaffold deleted task', { deletedAt: new Date() });
  await task('wild', p.a, col.aTodo, 'Discount 50% off_now');

  // 1.22.3 — task numbers however they are typed: SRN (a code ending in a letter), SRN2 (one ending in
  // a digit, so a run-together "SRN214" may be either) and an archived SRNARC. The exact number is
  // the least recently changed, so only the number rule can put it first.
  p.n = await project('SRN');
  p.n2 = await project('SRN2');
  p.nArc = await project('SRNARC', { status: 'ARCHIVED' });
  const nTodo = await column(p.n, 'To do', 'TODO', 0);
  const n2Todo = await column(p.n2, 'To do', 'TODO', 0);
  const nArcTodo = await column(p.nArc, 'To do', 'TODO', 0);
  let at = 0;
  const numbered = async (key: string, projectId: string, columnId: string, title: string) => {
    at += 1;
    t[key] = (await prisma.task.create({ data: { key, title, projectId, columnId, createdById: owner, updatedAt: new Date(Date.UTC(2026, 9, 2, 0, at)) } })).id;
    return t[key]!;
  };
  await numbered('SRN-142', p.n, nTodo, 'Valve check');
  await numbered('SRN-1420', p.n, nTodo, 'Pump overhaul');
  await numbered('SRN-14', p.n, nTodo, 'Gate repair');
  await numbered('SRN-3', p.n, nTodo, 'Order 142 bolts');
  await numbered('SRN2-14', p.n2, n2Todo, 'Fence line');
  await numbered('SRN2-142', p.n2, n2Todo, 'Second valve');
  await numbered('SRNARC-142', p.nArc, nArcTodo, 'Archived valve');
  // SRN-9 was SRN2-77 before it moved to SRN.
  const movedOnce = await numbered('SRN-9', p.n, nTodo, 'Cable tray');
  await prisma.taskKeyAlias.create({ data: { key: 'SRN2-77', taskId: movedOnce, projectId: p.n2 } });
  await index.rebuildAll();
}, 60_000);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Task search on MySQL (integration)', () => {
  it('finds a task by every field, saying where', async () => {
    const where = async (q: string) => {
      const [hit] = (await run(q)).hits;
      return hit ? [hit.key.split('-')[0], hit.title, ...hit.matches.map((m) => m.field)] : null;
    };
    expect(await where('rig 3')).toEqual(['SRCA', 'Scaffold inspection on Rig 3']);
    expect(await where('scaffolding')).toEqual(['SRCA', 'Weekly walk', 'description']);
    expect(await where('hot work')).toEqual(['SRCA', 'Crane lift plan', 'comment']);
    expect(await where('base plates')).toEqual(['SRCA', 'Site handover', 'checklist']);
    expect(await where('srch-bilal')).toEqual(['SRCA', 'Generator service', 'assignee']);
    expect(await where('nasser')).toBeNull(); // only a comment author — not a field of the task
    for (const q of ['al-hassan', 'occidental', 'logistics', 'khalid@acme', '9555', 'after noon']) expect(await where(q), q).toEqual(['SRCA', 'Pipe delivery', 'contact']);
    expect(await where('srch-safety')).toEqual(['SRCA', 'Toolbox talk', 'tag']);
    expect(await where('policy_2026')).toEqual(['SRCA', 'Insurance renewal', 'file']);
    expect(await where('srcb-77')).toEqual(['SRCA', 'Moved task', 'key']);
  });

  it('labels a comment with its author and day, a reply as a reply, with the words highlighted', async () => {
    const [hit] = (await run('permit supervisor')).hits;
    expect(hit?.title).toBe('Crane lift plan');
    const [m] = hit!.matches;
    expect(m?.label).toBe('Reply by Sara Nasser · 29 Oct 2026');
    expect(m!.ranges.map((r) => m!.snippet.slice(r.start, r.end))).toEqual(['permit', 'supervisor']);
  });

  it('never finds a deleted comment, a deleted task or a deleted project’s tasks', async () => {
    expect(await keys('forbiddenword')).toEqual([]);
    const found = (await run('scaffold', { includeArchived: true })).hits.map((h) => h.title);
    expect(found).not.toContain('Scaffold deleted task');
    expect(found).not.toContain('Scaffold in a deleted project');
  });

  it('finds tasks in archived projects only when asked', async () => {
    expect((await run('scaffold')).hits.map((h) => h.title)).not.toContain('Scaffold in an archived project');
    const hit = (await run('scaffold', { includeArchived: true })).hits.find((h) => h.title === 'Scaffold in an archived project');
    expect(hit?.project.archived).toBe(true);
  });

  it('a task’s exact number finds it even in an archived project ("open SRCARC-12")', async () => {
    const key = (await prisma.task.findUnique({ where: { id: t.archived! } }))!.key;
    expect((await run(key)).hits.map((h) => h.title)).toEqual(['Scaffold in an archived project']);
    expect((await run(key.toLowerCase(), { scope: { projectIds: [p.a] } })).hits).toEqual([]); // still only where you may look
    expect((await run(`${key} scaffold`)).hits).toEqual([]); // more than the number: archived stays out
  });

  it('matches part of a word, in any case', async () => {
    expect((await run('SCAFF')).hits.length).toBeGreaterThanOrEqual(4);
    expect((await run('affol')).hits.map((h) => h.title)).toContain('Weekly walk');
  });

  it('needs every word somewhere in the task, in any of its fields', async () => {
    expect((await run('crane scaffold')).hits.map((h) => h.title)).toEqual(['Crane lift plan']);
    expect(await keys('crane zebra')).toEqual([]);
  });

  it('a "quoted phrase" must appear as written', async () => {
    const phrase = (await run('"scaffold permit"')).hits.map((h) => h.title);
    expect(phrase).toEqual(['Crane lift plan']);
    expect((await run('scaffold permit')).hits.map((h) => h.title)).toEqual(expect.arrayContaining(['Crane lift plan', 'Permit for the scaffold']));
  });

  it('matches Arabic whatever its letter forms or diacritics', async () => {
    expect((await run('اداره')).hits.map((h) => h.title)).toEqual(['إدارة الموقع']);
    expect((await run('مدير')).hits.map((h) => h.title)).toEqual(['إدارة الموقع']);
    expect((await run('أدارة')).hits.map((h) => h.title)).toEqual(['إدارة الموقع']);
  });

  it('treats % and _ as plain letters', async () => {
    expect((await run('50%')).hits.map((h) => h.title)).toEqual(['Discount 50% off_now']);
    expect((await run('f_n')).hits.map((h) => h.title)).toEqual(['Discount 50% off_now']);
    expect(await keys('0%o')).toEqual([]);
  });

  it('lists open tasks first, then finished ones', async () => {
    const titles = (await run('scaffold')).hits.map((h) => h.title);
    expect(titles[titles.length - 1]).toBe('Scaffold removed');
    const done = (await run('scaffold')).hits.find((h) => h.title === 'Scaffold removed');
    expect(done?.done).toBe(true);
  });

  it('a task whose key is the query comes first', async () => {
    const key = (await prisma.task.findUnique({ where: { id: t.title! } }))!.key;
    expect((await keys(key))[0]).toBe(key);
  });

  it('only finds tasks in the projects the person can see', async () => {
    expect((await run('scaffold', { scope: { projectIds: [p.b] } })).hits.map((h) => h.title)).toEqual(['Scaffold in project B']);
    expect(await keys('scaffold', { scope: { projectIds: [] } })).toEqual([]);
    expect((await run('scaffold', { scope: { projectIds: [p.b, p.archived] }, includeArchived: true })).hits).toHaveLength(2);
  });

  it('filters by project, status, assignee and done', async () => {
    expect((await run('scaffold', { projectId: p.b })).hits.map((h) => h.title)).toEqual(['Scaffold in project B']);
    expect((await run('scaffold', { statuses: ['IN_PROGRESS'] })).hits.map((h) => h.title)).toEqual(['Weekly walk']);
    expect((await run('service', { assigneeId: bilal })).hits.map((h) => h.title)).toEqual(['Generator service']);
    expect(await keys('service', { assigneeId: sara })).toEqual([]);
    expect((await run('scaffold', { done: true })).hits.map((h) => h.title)).toEqual(['Scaffold removed']);
    expect((await run('scaffold', { done: false })).hits.map((h) => h.title)).not.toContain('Scaffold removed');
    // A project the person can't see stays out, even when asked for by id.
    expect(await keys('scaffold', { projectId: p.b, scope: { projectIds: [p.a] } })).toEqual([]);
  });

  it('pages through the results without repeats', async () => {
    const first = await run('scaffold', { limit: 2, withTotal: true });
    expect(first.hits).toHaveLength(2);
    expect(first.total).toBe(6);
    expect(first.nextOffset).toBe(2);
    const second = await run('scaffold', { limit: 2, offset: 2 });
    const third = await run('scaffold', { limit: 2, offset: 4 });
    expect(third.nextOffset).toBeNull();
    const ids = [...first.hits, ...second.hits, ...third.hits].map((h) => h.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('carries what a results row shows: project, status, due date and assignees', async () => {
    const [hit] = (await run('generator')).hits;
    expect(hit).toMatchObject({ project: { id: p.a, code: 'SRCA', name: 'Project SRCA', archived: false }, status: { name: 'To do', category: 'TODO' }, done: false, dueDate: null, assigneeCount: 1, assignees: [{ id: bilal, name: 'Bilal Ahmed' }] });
    expect(hit!.titleRanges).toEqual([{ start: 0, end: 9 }]);
  });

  it('a task the index has wrong text for is left out, and re-indexed', async () => {
    const id = t.title!;
    await prisma.task.update({ where: { id }, data: { title: 'Renamed without a refresh' } });
    expect((await run('scaffold inspection')).hits.map((h) => h.id)).not.toContain(id);
    await new Promise((r) => setTimeout(r, 200));
    expect((await run('renamed without')).hits.map((h) => h.id)).toEqual([id]);
    await prisma.task.update({ where: { id }, data: { title: 'Scaffold inspection on Rig 3' } });
    await index.taskChanged(id);
  });

  describe('a task number however it is typed (1.22.3)', () => {
    const mine = () => ({ projectIds: [p.n, p.n2, p.nArc] });

    it('MICO-142, mico-142, MICO142, mico 142, MICO_142 and #MICO-142 all find it first', async () => {
      for (const q of ['SRN-142', 'srn-142', 'SRN142', 'srn142', 'srn 142', 'SRN_142', '#SRN-142', '# srn 142', '  srn-142  ', 'SRN – 142']) {
        const found = await keys(q);
        expect(found[0], q).toBe('SRN-142');
        expect(found, q).not.toContain('SRNARC-142'); // an archived project's task only by its own number
      }
      // Run together, nothing else holds "srn142": only the number.
      expect(await keys('SRN142')).toEqual(['SRN-142']);
      // Exactly that number: never one that merely starts with it.
      expect(await keys('srn14')).toEqual(['SRN-14']);
    });

    it('"mico 142" still finds the other tasks with both words, after the number', async () => {
      const found = await keys('srn 142', { scope: mine() });
      expect(found[0]).toBe('SRN-142');
      expect(found.slice(1)).toEqual(expect.arrayContaining(['SRN-1420', 'SRN2-142', 'SRN-3']));
    });

    it('a run-together number tries every split (a code may end in digits)', async () => {
      expect(await keys('SRN214')).toEqual(['SRN2-14']);
      expect(await keys('srn2142')).toEqual(['SRN2-142']);
      expect(await keys('srn2 14')).toEqual(['SRN2-14', 'SRN2-142']); // the number, then the words
    });

    it('an old number, typed any way, finds the task it moved to, saying it was its former key', async () => {
      for (const q of ['SRN2-77', 'srn2-77', 'srn277', 'SRN2 77', 'srn2_77', '#SRN2-77']) {
        const [hit] = (await run(q)).hits;
        expect(hit?.key, q).toBe('SRN-9');
        expect(hit?.formerKeys, q).toEqual(['SRN2-77']);
        expect(hit?.matches.map((m) => [m.field, m.label, m.snippet]), q).toEqual([['key', 'Former key', 'SRN2-77']]);
      }
    });

    it('a bare number lists the tasks numbered …-142 first (any project, archived too), then the other matches', async () => {
      const found = await keys('142', { scope: mine() });
      expect(found.slice(0, 3).sort()).toEqual(['SRN-142', 'SRN2-142', 'SRNARC-142']);
      expect(found.slice(3).sort()).toEqual(['SRN-1420', 'SRN-3']);
      expect(found).not.toContain('SRN-14');
      // "#142" holds no other text: only the numbered ones.
      expect((await keys('#142', { scope: mine() })).sort()).toEqual(['SRN-142', 'SRN2-142', 'SRNARC-142']);
      const archived = (await run('142', { scope: mine() })).hits.find((h) => h.key === 'SRNARC-142');
      expect(archived?.project.archived).toBe(true);
      // A number with more words is a text search: archived stays out.
      expect(await keys('142 valve', { scope: mine() })).toEqual(expect.not.arrayContaining(['SRNARC-142']));
    });

    it('an archived project’s task is found by its exact number in any form, never by more words', async () => {
      for (const q of ['SRNARC-142', 'srnarc142', 'srnarc 142', 'SRNARC_142']) expect(await keys(q), q).toEqual(['SRNARC-142']);
      expect(await keys('srnarc142 valve')).toEqual([]);
    });

    it('only where the person may look: a number never reaches another project', async () => {
      expect(await keys('srn142', { scope: { projectIds: [p.n2] } })).toEqual([]);
      expect(await keys('srn142', { scope: { projectIds: [] } })).toEqual([]);
      expect(await keys('142', { scope: { projectIds: [p.n2] } })).toEqual(['SRN2-142']);
      expect(await keys('srn277', { scope: { projectIds: [p.n2] } })).toEqual([]); // its old project: the task is in SRN now
      // Filters still apply to a number.
      expect(await keys('srn142', { projectId: p.n2 })).toEqual([]);
      expect(await keys('srn142', { done: true })).toEqual([]);
    });

    it('the top bar (global search) lists the number first too', async () => {
      const service = createSearchService({ data: { getSearchData: async () => ({ tasks: [], projects: [], users: [], meetings: [] }) }, tasks: engine });
      expect((await service.search('srn 142', { allowedProjectIds: [p.n, p.n2] })).tasks[0]?.key).toBe('SRN-142');
      expect((await service.search('SRN142', { allowedProjectIds: [p.n, p.n2] })).tasks.map((x) => x.key)).toEqual(['SRN-142']);
      expect((await service.search('srn277', { allowedProjectIds: [p.n] })).tasks.map((x) => x.key)).toEqual(['SRN-9']);
      expect((await service.search('srn142', { allowedProjectIds: [p.n2] })).tasks).toEqual([]);
    });
  });

  it('answers within the time budget at a few thousand tasks', async () => {
    const big = await prisma.project.create({ data: { code: 'SRCBIG', name: 'Big', createdById: owner } });
    const column = await prisma.kanbanColumn.create({ data: { projectId: big.id, name: 'To do', category: 'TODO', position: 0 } });
    const N = 3000;
    const words = ['valve', 'pump', 'crane', 'rig', 'pipe', 'gate', 'fence', 'cable', 'tank', 'crew'];
    const rows = Array.from({ length: N }, (_, i) => ({
      id: `srchbig${String(i).padStart(6, '0')}`,
      key: `SRCBIG-${i + 1}`,
      title: `Check ${words[i % 10]} ${i}`,
      description: `${'Routine maintenance work on the site with the usual crew and tools. '.repeat(6)}${i % 500 === 0 ? 'scaffold permit needed' : ''}`,
      projectId: big.id,
      columnId: column.id,
      createdById: owner,
    }));
    for (let i = 0; i < N; i += 1000) await prisma.task.createMany({ data: rows.slice(i, i + 1000) });
    const comments = rows.flatMap((r, i) => [
      { taskId: r.id, userId: bilal, body: `Comment ${i} about the ${words[(i + 3) % 10]} and the weather today` },
      { taskId: r.id, userId: sara, body: `Follow-up ${i}: parts ordered for the ${words[(i + 7) % 10]}` },
    ]);
    for (let i = 0; i < comments.length; i += 2000) await prisma.comment.createMany({ data: comments.slice(i, i + 2000) });
    const builtAt = Date.now();
    expect(await index.refreshProject(big.id)).toBe(N);
    const buildMs = Date.now() - builtAt;

    await run('scaffold permit'); // warm up
    const timed = async (input: Partial<TaskSearchInput> & { q: string }) => {
      const start = performance.now();
      const res = await engine.search({ scope: all, limit: 20, ...input });
      return { ms: performance.now() - start, res };
    };
    const rare = await timed({ q: 'scaffold permit' });
    const common = await timed({ q: 'crew', withTotal: true });
    const scoped = await timed({ q: 'valve weather', scope: { projectIds: [big.id, p.a] } });
    console.log(`task search at ${N} tasks: index built in ${buildMs} ms; rare ${rare.ms.toFixed(0)} ms, common ${common.ms.toFixed(0)} ms, scoped ${scoped.ms.toFixed(0)} ms`);
    expect(rare.res.hits.filter((h) => h.project.code === 'SRCBIG')).toHaveLength(6);
    expect(common.res.hits).toHaveLength(20);
    expect(common.res.total).toBe(1001);
    expect(common.res.totalCapped).toBe(true);
    expect(scoped.res.hits.length).toBeGreaterThan(0);
    for (const x of [rare, common, scoped]) expect(x.ms).toBeLessThan(500);
  }, 120_000);
});
