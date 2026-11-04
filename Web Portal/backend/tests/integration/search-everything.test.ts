import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine, type SearchAllInput } from '../../src/modules/search/search-engine';
import { createVocabulary } from '../../src/modules/search/search-fuzzy';
import { createPrismaSearchWords } from '../../src/modules/search/prisma-search-words';
import type { SearchScopeAll } from '../../src/modules/search/search-scope';
import type { SearchKind } from '../../src/modules/search/search-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23 Search everything: every kind found, ranked, filtered, counted; spelling mistakes; some words.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaSearchWords(prisma);
const vocabulary = createVocabulary({ load: store.load, store: store.store, ttlMs: 0 });
const taskIndex = createTaskSearchIndex({ prisma, words: vocabulary });
const index = createSearchIndex({ prisma, words: vocabulary });
const stale: string[] = [];
const engine = createSearchEngine({ prisma, timeZone: 'Asia/Muscat', suggest: (w) => vocabulary.suggest(w), onStale: (kind, id) => stale.push(`${kind}:${id}`) });

// Letters only (no digits), so the words are vocabulary words for the spelling pass.
const L = Array.from({ length: 5 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const T = L.toUpperCase();
const w = (word: string) => `${word}${L}`;

const everyone: SearchScopeAll = { projectIds: null, meetings: { full: null, invitee: [], editable: null } };
let owner = '';
let bilal = '';
let sara = '';
const p: Record<string, string> = {};
const t: Record<string, string> = {};
const m: Record<string, string> = {};
let note = '';
let file = '';
let inspection = '';

const run = (q: string, extra: Partial<SearchAllInput> = {}) => engine.search({ q, scope: everyone, viewerId: owner, limit: 20, withCounts: true, ...extra });
const found = async (q: string, extra: Partial<SearchAllInput> = {}) => (await run(q, extra)).hits.map((h) => `${h.kind}:${h.id}`);

beforeAll(async () => {
  await prisma.$connect();
  const user = (name: string) => prisma.user.create({ data: { email: `${name}.${L}@search.test`, username: `${name}_${L}`, passwordHash: 'x', firstName: name[0]!.toUpperCase() + name.slice(1), lastName: `Search${T}` } }).then((u) => u.id);
  owner = await user('owner');
  bilal = await user('bilal');
  sara = await user('sara');
  const project = (code: string, data: Record<string, unknown> = {}) => prisma.project.create({ data: { code: `${code}${T}`, name: `Project ${code} ${L}`, createdById: owner, ownerId: owner, status: 'ACTIVE', ...data } }).then((x) => x.id);
  p.a = await project('A', { name: `Rig ${w('overhaul')}`, description: `Shutdown of the north ${w('platform')}`, clientName: `Client ${w('petro')}` });
  p.b = await project('B');
  p.arc = await project('ARC', { status: 'ARCHIVED' });
  const column = (projectId: string, category: 'TODO' | 'DONE') => prisma.kanbanColumn.create({ data: { projectId, name: category === 'DONE' ? 'Done' : 'To do', category, position: category === 'DONE' ? 1 : 0 } }).then((c) => c.id);
  const todo = await column(p.a!, 'TODO');
  const done = await column(p.a!, 'DONE');
  const arcTodo = await column(p.arc!, 'TODO');
  let n = 0;
  const task = async (name: string, data: Record<string, unknown>, projectId = p.a!, columnId = todo) => {
    n += 1;
    t[name] = (await prisma.task.create({ data: { key: `A${T}-${n}`, title: `Task ${n}`, projectId, columnId, createdById: owner, ...data } })).id;
    return t[name]!;
  };
  // One word (kestrel) in a title, a description, a comment, a file's text, a meeting's title and a note.
  await task('title', { title: `Inspect the ${w('kestrel')} pump` });
  await task('described', { description: `Check the ${w('kestrel')} valve` });
  await task('commented', {});
  await prisma.comment.create({ data: { taskId: t.commented!, userId: bilal, body: `Who has the ${w('kestrel')} permit?` } });
  await task('done', { title: `Old ${w('kestrel')} work`, columnId: done, completedAt: new Date() });
  await task('typo', { title: `Service the ${w('generator')}` });
  await task('arabic', { title: `إدارة الموقع ${L}` });
  await task('archived', { title: `Archived ${w('kestrel')} job` }, p.arc!, arcTodo);
  await task('assigned', { title: `Fuel ${w('pump')} log`, dueDate: new Date('2026-11-20T08:00:00Z') });
  await prisma.taskAssignee.create({ data: { taskId: t.assigned!, userId: sara } });
  await task('words', { title: `Crane ${w('lift')} plan`, description: `Night ${w('shift')}` });
  await task('withfile', { title: 'Permits' });
  file = (await prisma.attachment.create({ data: { taskId: t.withfile!, uploadedById: bilal, filename: `permit-${L}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `k-${L}.pdf`, url: '/u/x' } })).id;
  await prisma.searchFileText.create({ data: { fileId: file, status: 'READ', method: 'pdf', text: `Hot work certificate for the ${w('kestrel')} area. Isolation ${w('lockout')} required.`, readAt: new Date() } });

  const startAt = new Date('2026-11-10T06:00:00Z');
  const meeting = (title: string, data: Record<string, unknown> = {}) => prisma.meeting.create({ data: { title, organizerId: owner, createdById: owner, startAt, status: 'SCHEDULED', projectId: p.a!, ...data } }).then((x) => x.id);
  m.one = await meeting(`Weekly ${w('kestrel')} review`, { description: `Walk-down ${w('findings')}`, attendees: { create: [{ userId: bilal }] } });
  await prisma.agendaItem.create({ data: { meetingId: m.one, title: `Hot work ${w('permits')}` } });
  await prisma.decision.create({ data: { meetingId: m.one, title: `Stop night ${w('lifts')}`, createdById: owner } });
  await prisma.actionItem.create({ data: { meetingId: m.one, description: `Order flood ${w('lights')}`, createdById: owner } });
  note = (await prisma.meetingNote.create({ data: { meetingId: m.one, authorId: sara, body: `Gas test before ${w('entry')} near the ${w('kestrel')} tank` } })).id;
  await prisma.meetingMinutes.create({ data: { meetingId: m.one, status: 'DRAFT', content: JSON.stringify({ summary: `Draft ${w('summary')}`, discussion: [], decisions: [], risks: [], nextSteps: [] }) } });
  m.two = await meeting('Monthly review', { status: 'COMPLETED' });
  await prisma.meetingMinutes.create({ data: { meetingId: m.two, status: 'APPROVED', approvedAt: new Date(), content: JSON.stringify({ summary: `Agreed the ${w('budget')}`, discussion: [{ topic: 'Scaffolds', text: `Tag every ${w('scaffold')}` }], decisions: [], risks: [], nextSteps: [] }) } });

  inspection = (
    await prisma.inspection.create({
      data: {
        projectId: p.a!, title: `Crane ${w('preuse')} check`, formVersion: 1, inspectorId: bilal, startedById: bilal, place: 'Rig 3',
        structure: { sections: [{ id: 's1', title: 'Hooks', items: [{ id: 'i1', kind: 'CHECK', label: `Safety ${w('latch')} works`, help: null }] }], clientSignature: 'NONE', supervisorSignature: 'NONE' },
        answers: { create: { itemId: 'i1', result: 'FAIL', note: `Spring ${w('weak')}`, editedAt: new Date(), answeredById: bilal } },
      },
    })
  ).id;

  await taskIndex.refresh(Object.values(t));
  await index.refresh('project', Object.values(p));
  await index.meetingChanged(m.one);
  await index.meetingChanged(m.two);
  await index.refresh('file', [file]);
  await index.refresh('inspection', [inspection]);
});

afterAll(async () => {
  const projectIds = Object.values(p);
  await prisma.searchIndex.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { meetingId: { in: Object.values(m) } }, { recordId: { in: [file, inspection] } }] } });
  await prisma.inspection.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.meeting.deleteMany({ where: { id: { in: Object.values(m) } } });
  await prisma.actionItem.deleteMany({ where: { createdById: owner } });
  await prisma.decision.deleteMany({ where: { createdById: owner } });
  await prisma.comment.deleteMany({ where: { task: { projectId: { in: projectIds } } } });
  await prisma.attachment.deleteMany({ where: { task: { projectId: { in: projectIds } } } });
  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner, bilal, sara] } } });
  await prisma.$disconnect();
});

describe('search everything (database)', () => {
  it('finds every kind of item by its own words, with its project, state and where it opens', async () => {
    const expectOne = async (q: string, kind: SearchKind, id: string) => {
      const r = await run(q);
      expect(r.hits.map((h) => `${h.kind}:${h.id}`), q).toContain(`${kind}:${id}`);
      return r.hits.find((h) => h.id === id)!;
    };
    const project = await expectOne(w('platform'), 'project', p.a!);
    expect(project.target).toEqual({ type: 'project', projectId: p.a });
    expect(project.matches[0]).toMatchObject({ label: 'Description' });
    expect((await expectOne(w('petro'), 'project', p.a!)).matches[0]!.label).toBe('Client');
    const meeting = await expectOne(w('permits'), 'meeting', m.one!);
    expect(meeting).toMatchObject({ status: { label: 'Scheduled', done: false }, date: { kind: 'starts' }, project: { id: p.a } });
    expect(meeting.matches[0]).toMatchObject({ label: 'Agenda item' });
    expect((await expectOne(w('lifts'), 'meeting', m.one!)).matches[0]!.label).toBe('Decision');
    expect((await expectOne(w('lights'), 'meeting', m.one!)).matches[0]!.label).toBe('Action item');
    const n = await expectOne(w('entry'), 'note', note);
    expect(n).toMatchObject({ context: `Weekly ${w('kestrel')} review`, target: { type: 'meeting', meetingId: m.one, noteId: note } });
    expect(n.matches[0]!.label).toMatch(/^Discussion note by Sara Search/);
    const minutes = await expectOne(w('scaffold'), 'minutes', m.two!);
    expect(minutes).toMatchObject({ status: { label: 'Final' }, target: { type: 'meeting', meetingId: m.two, section: 'minutes' } });
    const f = await expectOne(w('lockout'), 'file', file);
    expect(f).toMatchObject({ title: `permit-${L}.pdf`, key: `A${T}-10`, target: { type: 'file', taskId: t.withfile, fileId: file } });
    expect(f.matches[0]!.label).toBe('Text in the file');
    expect(f.matches[0]!.snippet).toContain(`Isolation ${w('lockout')}`);
    const i = await expectOne(w('latch'), 'inspection', inspection);
    expect(i).toMatchObject({ status: { label: 'In progress' }, target: { type: 'inspection', inspectionId: inspection } });
    await expectOne(w('weak'), 'inspection', inspection);
    const task = await expectOne(w('generator'), 'task', t.typo!);
    expect(task).toMatchObject({ key: expect.stringMatching(/^A/), target: { type: 'task', taskId: t.typo } });
  });

  it('ranks the title first, then the description, notes and comments, the file text last; done after open', async () => {
    const order = await found(w('kestrel'));
    const at = (key: string) => order.indexOf(key);
    expect(order).not.toContain(`task:${t.archived}`); // an archived project's task: only when asked
    expect(at(`task:${t.title}`)).toBeLessThan(at(`task:${t.described}`));
    expect(at(`meeting:${m.one}`)).toBeLessThan(at(`task:${t.described}`));
    expect(at(`task:${t.described}`)).toBeLessThan(at(`task:${t.commented}`));
    expect(at(`task:${t.described}`)).toBeLessThan(at(`note:${note}`));
    expect(at(`task:${t.commented}`)).toBeLessThan(at(`file:${file}`));
    expect(at(`note:${note}`)).toBeLessThan(at(`file:${file}`));
    expect(at(`task:${t.title}`)).toBeLessThan(at(`task:${t.done}`));
  });

  it('counts each kind; filters by kind, project, open or done, person and date; archived only when asked', async () => {
    const r = await run(w('kestrel'));
    expect(r.counts).toMatchObject({ task: 4, meeting: 1, note: 1, file: 1, project: 0 });
    expect(r.total).toBe(7);
    // One kind chosen: the counts still give every kind (the type chips), the total only the chosen.
    const files = await run(w('kestrel'), { kinds: ['file'] });
    expect(files.counts).toMatchObject({ task: 4, meeting: 1, note: 1, file: 1 });
    expect(files.total).toBe(1);
    const done = await run(w('kestrel'), { kinds: ['task'], taskStatuses: ['DONE'] });
    expect(done.counts).toMatchObject({ task: 4, note: 1 });
    expect(done.total).toBe(1);
    expect(await found(w('kestrel'), { kinds: ['note', 'file'] })).toEqual(expect.arrayContaining([`note:${note}`, `file:${file}`]));
    expect((await found(w('kestrel'), { kinds: ['note', 'file'] })).length).toBe(2);
    expect(await found(w('kestrel'), { done: true })).toEqual([`task:${t.done}`]);
    expect(await found(w('kestrel'), { projectId: p.b })).toEqual([]);
    expect(await found(w('kestrel'), { personId: sara })).toEqual([`note:${note}`]);
    expect(await found(w('kestrel'), { personId: bilal })).toEqual(expect.arrayContaining([`meeting:${m.one}`, `file:${file}`]));
    expect(await found(w('pump'), { from: new Date('2026-11-19'), to: new Date('2026-11-21') })).toEqual([`task:${t.assigned}`]);
    expect(await found(w('pump'), { from: new Date('2026-12-01') })).toEqual([]);
    expect(await found(w('kestrel'), { includeArchived: true })).toContain(`task:${t.archived}`);
    expect(await found(w('kestrel'), { taskStatuses: ['DONE'] })).toEqual([`task:${t.done}`]);
  });

  it('finds spelling mistakes (one letter off for short words, two for long), marked and corrected', async () => {
    const r = await run(`genrator${L}`);
    expect(r.hits.map((h) => h.id)).toEqual([t.typo]);
    expect(r.hits[0]!.match).toBe('close');
    expect(r.corrected).toEqual([{ from: `genrator${L}`, to: w('generator') }]);
    expect(r.hits[0]!.titleRanges.length).toBeGreaterThan(0);
    // Two letters off a long word too.
    expect((await run(`ganarator${L}`)).hits.map((h) => h.id)).toContain(t.typo);
  });

  it('when few items hold every word, those holding some of them follow (marked)', async () => {
    const r = await run(`${w('lift')} ${w('nothingsuch')} ${w('shift')}`);
    expect(r.hits.map((h) => h.id)).toEqual([t.words]);
    expect(r.hits[0]!.match).toBe('some');
    // All the words found: an exact result, not marked.
    expect((await run(`${w('lift')} ${w('shift')}`)).hits[0]).not.toHaveProperty('match');
  });

  it('Arabic spellings match (أ إ آ → ا, ة → ه)', async () => {
    const r = await run(`ادارة ${L}`);
    expect(r.hits[0]).toMatchObject({ id: t.arabic });
    expect(r.hits[0]).not.toHaveProperty('match');
    expect(r.hits.slice(1).every((h) => h.match === 'some')).toBe(true);
  });

  it('a task’s number comes first', async () => {
    const key = (await prisma.task.findUniqueOrThrow({ where: { id: t.typo! } })).key;
    const r = await run(key.replace('-', ' '));
    expect(r.hits[0]!.id).toBe(t.typo);
  });

  it('pages through the results', async () => {
    const first = await run(w('kestrel'), { limit: 2 });
    expect(first.hits).toHaveLength(2);
    expect(first.next).toEqual({ offset: 2, extra: false });
    const second = await run(w('kestrel'), { limit: 2, offset: 2, withCounts: false });
    expect(second.hits.map((h) => h.id)).not.toContain(first.hits[0]!.id);
  });

  it('an invitee from another company: the meeting by its agenda, never its decisions, action items or notes; final minutes only', async () => {
    const invitee: SearchScopeAll = { projectIds: [], meetings: { full: [], invitee: [m.one!, m.two!], editable: [] } };
    const as = (q: string) => found(q, { scope: invitee });
    expect(await as(w('permits'))).toEqual([`meeting:${m.one}`]);
    expect(await as(w('lifts'))).toEqual([]);
    expect(await as(w('lights'))).toEqual([]);
    expect(await as(w('entry'))).toEqual([]);
    expect(await as(w('summary'))).toEqual([]); // draft minutes
    expect(await as(w('budget'))).toEqual([`minutes:${m.two}`]); // final minutes
    expect(await as(w('kestrel'))).toEqual([`meeting:${m.one}`]); // its title; no tasks, files or notes
  });

  it('draft minutes only for those who may change the meeting', async () => {
    const team = (editable: string[]): SearchScopeAll => ({ projectIds: [p.a!], meetings: { full: [m.one!, m.two!], invitee: [], editable } });
    expect(await found(w('summary'), { scope: team([]) })).toEqual([]);
    expect(await found(w('summary'), { scope: team([m.one!]) })).toEqual([`minutes:${m.one}`]);
  });

  it('nothing outside the scope: another project’s items, meetings not listed', async () => {
    const other: SearchScopeAll = { projectIds: [p.b!], meetings: { full: [], invitee: [], editable: [] } };
    expect(await found(w('kestrel'), { scope: other })).toEqual([]);
    expect(await found(w('latch'), { scope: other })).toEqual([]);
    expect(await found(w('platform'), { scope: other })).toEqual([]);
  });

  it('an item the index was behind on is left out and re-indexed', async () => {
    await prisma.meetingNote.update({ where: { id: note }, data: { deletedAt: new Date() } });
    stale.length = 0;
    expect(await found(w('entry'))).toEqual([]);
    await index.meetingChanged(m.one!);
    expect(await prisma.searchIndex.count({ where: { kind: 'note', recordId: note } })).toBe(0);
    await prisma.meetingNote.update({ where: { id: note }, data: { deletedAt: null } });
    await index.meetingChanged(m.one!);
    expect(await found(w('entry'))).toEqual([`note:${note}`]);
  });

  it('the heals: a row of an older version is rewritten; a changed item is caught by its fingerprint', async () => {
    await prisma.searchIndex.update({ where: { kind_recordId: { kind: 'inspection', recordId: inspection } }, data: { version: 0 } });
    expect(await index.healRecent()).toBeGreaterThan(0);
    await prisma.$executeRaw`UPDATE inspections SET place = ${`Bay ${w('seven')}`}, updatedAt = updatedAt WHERE id = ${inspection}`;
    await index.healAll();
    expect(await found(w('seven'))).toEqual([`inspection:${inspection}`]);
  });
});
