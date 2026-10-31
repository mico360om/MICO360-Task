import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createTaskSearchEngine, type TaskSearchInput } from '../../src/modules/search/task-search-engine';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const index = createTaskSearchIndex({ prisma });
const engine = createTaskSearchEngine({ prisma, index, timeZone: 'Asia/Muscat' });

const CODES = ['SRCA', 'SRCB', 'SRCARC', 'SRCDEL', 'SRCBIG'];
const EMAILS = ['srch-owner@mico360.test', 'srch-bilal@mico360.test', 'srch-sara@mico360.test'];

let owner = '';
let bilal = '';
let sara = '';
const p = { a: '', b: '', archived: '', deleted: '' };
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
  await prisma.taskExternalContact.create({ data: { taskId: contact, name: 'Khalid Al-Hassan', company: 'Occidental Oman', designation: 'Logistics lead', email: 'khalid@oxy.example', phone: '+968 9555 1234', remarks: 'Calls after noon' } });
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
    for (const q of ['al-hassan', 'occidental', 'logistics', 'khalid@oxy', '9555', 'after noon']) expect(await where(q), q).toEqual(['SRCA', 'Pipe delivery', 'contact']);
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
