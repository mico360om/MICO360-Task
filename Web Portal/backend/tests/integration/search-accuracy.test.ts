import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTaskSearchIndex } from '../../src/modules/search/task-search-index';
import { createSearchIndex } from '../../src/modules/search/search-index';
import { createSearchEngine } from '../../src/modules/search/search-engine';
import { createVocabulary } from '../../src/modules/search/search-fuzzy';
import { createPrismaSearchWords } from '../../src/modules/search/prisma-search-words';
import type { SearchScopeAll } from '../../src/modules/search/search-scope';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.23 Search everything — the accuracy test set: 63 questions over a seeded set of projects, tasks,
// meetings, notes, minutes, files and inspections (English and Arabic), each with the items that must
// come back — whole words, parts of words, spelling mistakes, Arabic spellings, file text, notes and
// minutes, task numbers, contacts and questions holding only some of the words. 1.23.6: with checklist
// items, external contacts and the client named on a project as results of their own. Measured: recall@10
// (the expected items among the first ten), precision@1 (the first result is one of them) and
// precision@10 (of the first ten, how many are expected). The numbers are printed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const words = createPrismaSearchWords(prisma);
const vocabulary = createVocabulary({ load: words.load, store: words.store, ttlMs: 0 });
const taskIndex = createTaskSearchIndex({ prisma, words: vocabulary });
const index = createSearchIndex({ prisma, words: vocabulary });
const engine = createSearchEngine({ prisma, timeZone: 'Asia/Muscat', suggest: (w) => vocabulary.suggest(w) });

const TAG = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const ids: Record<string, string> = {};
let scope: SearchScopeAll;
let owner = '';

async function seed(): Promise<void> {
  owner = (await prisma.user.create({ data: { email: `acc-${TAG}@x.test`, username: `acc_${TAG}`, passwordHash: 'x', firstName: 'Ahmed', lastName: `Accuracy${TAG}` } })).id;
  const project = async (key: string, code: string, data: { name: string; description?: string; clientName?: string }) => {
    ids[key] = (await prisma.project.create({ data: { code: `${code}${TAG}`, createdById: owner, ownerId: owner, status: 'ACTIVE', ...data } })).id;
    const todo = await prisma.kanbanColumn.create({ data: { projectId: ids[key]!, name: 'To do', category: 'TODO', position: 0 } });
    const done = await prisma.kanbanColumn.create({ data: { projectId: ids[key]!, name: 'Done', category: 'DONE', position: 1 } });
    return { todo: todo.id, done: done.id, code: `${code}${TAG}` };
  };
  const P1 = await project('P1', 'RGO', { name: 'North Field Rig Overhaul', description: 'Major overhaul of drilling rig 7 including mast inspection and mud pump replacement.', clientName: 'Petroleum Development Oman' });
  const P2 = await project('P2', 'SRX', { name: 'Sohar Refinery Expansion', description: 'New hydrocracker unit and tank farm.' });
  const P3 = await project('P3', 'PMA', { name: 'مشروع صيانة المضخات', description: 'صيانة دورية للمضخات في محطة الضخ الرئيسية' });
  const n: Record<string, number> = {};
  const task = async (key: string, p: { todo: string; done: string; code: string }, projectKey: string, title: string, data: { description?: string; done?: boolean; comment?: string; checklist?: string[]; tag?: string; contact?: { name: string; company: string } } = {}) => {
    n[p.code] = (n[p.code] ?? 0) + 1;
    const t = await prisma.task.create({ data: { key: `${p.code}-${n[p.code]}`, title, description: data.description ?? null, projectId: ids[projectKey]!, columnId: data.done ? p.done : p.todo, createdById: owner, ...(data.done ? { completedAt: new Date() } : {}) } });
    ids[key] = t.id;
    if (data.comment) await prisma.comment.create({ data: { taskId: t.id, userId: owner, body: data.comment } });
    for (const [i, text] of (data.checklist ?? []).entries()) {
      const item = await prisma.checklistItem.create({ data: { taskId: t.id, text, position: i } });
      // 1.23.6: checklist items are results of their own (CK1, CK2… in the order made).
      ids[`CK${Object.keys(ids).filter((k) => k.startsWith('CK')).length + 1}`] = item.id;
    }
    if (data.tag) {
      const tag = await prisma.tag.upsert({ where: { name: `${data.tag}-${TAG}` }, update: {}, create: { name: `${data.tag}-${TAG}` } });
      await prisma.taskTag.create({ data: { taskId: t.id, tagId: tag.id } });
    }
    // 1.23.6: an external contact is a result of its own (C1).
    if (data.contact) ids.C1 = (await prisma.taskExternalContact.create({ data: { taskId: t.id, name: data.contact.name, company: data.contact.company } })).id;
    return t;
  };
  await task('T1', P1, 'P1', 'Replace mud pump liners', { description: 'Liners worn on pump 2; order spares from Weatherford.' });
  await task('T2', P1, 'P1', 'Mast inspection before rig move', { description: 'Level 3 inspection of the derrick mast.' });
  await task('T3', P1, 'P1', 'Generator overhaul', { description: 'Caterpillar 3512 generator 500-hour service.', comment: 'Injectors replaced, waiting for load test.' });
  await task('T4', P1, 'P1', 'Hot work permit for welding', { description: 'Welding on the substructure; gas test required.' });
  await task('T5', P1, 'P1', 'Electrical isolation of top drive', { description: 'Lock-out tag-out before maintenance', checklist: ['Verify zero energy', 'Apply locks'] });
  await task('T6', P1, 'P1', 'Scaffolding inspection', { done: true });
  await task('T7', P1, 'P1', 'Calibrate pressure gauges');
  await task('T8', P1, 'P1', 'Crane lift plan for BOP', { comment: 'Lift plan approved by Ahmed' });
  await task('T9', P1, 'P1', 'Order drill pipe', { tag: 'procurement' });
  await task('T10', P1, 'P1', 'Safety stand-down meeting follow-up');
  await task('T11', P2, 'P2', 'Hydrocracker reactor foundation');
  await task('T12', P2, 'P2', 'Tank farm fire water piping', { description: 'Hydrotest the fire water ring main' });
  await task('T13', P2, 'P2', 'Heat exchanger bundle pulling', { contact: { name: 'Khalid Al Balushi', company: 'Larsen & Toubro' } });
  await task('T14', P2, 'P2', 'Instrument loop checks');
  await task('T15', P2, 'P2', 'Commissioning procedure review');
  await task('T16', P3, 'P3', 'إصلاح المضخة رقم ٣', { description: 'تغيير مانع التسرب الميكانيكي' });
  await task('T17', P3, 'P3', 'فحص الصمامات');
  await task('T18', P3, 'P3', 'تقرير السلامة الشهري');

  const file = async (key: string, taskKey: string, filename: string, text: string) => {
    ids[key] = (await prisma.attachment.create({ data: { taskId: ids[taskKey]!, uploadedById: owner, filename, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `acc-${TAG}-${key}`, url: '/u/x' } })).id;
    await prisma.searchFileText.create({ data: { fileId: ids[key]!, status: 'READ', method: 'pdf', text, readAt: new Date() } });
  };
  await file('F1', 'T4', 'hot-work-permit.pdf', 'Hot work permit valid for 12 hours; fire watch must remain 30 minutes after welding.');
  await file('F2', 'T15', 'commissioning-procedure.docx', 'Pre-commissioning checks for the hydrogen compressor, nitrogen purge and leak test.');
  await file('F3', 'T7', 'gauge-calibration.xlsx', 'Gauge PG-101 calibrated, deviation 0.5 percent');
  await file('F4', 'T16', 'تقرير-الإصلاح.pdf', 'تم استبدال مانع التسرب في المضخة الثالثة');

  const startAt = new Date('2026-11-09T05:00:00Z');
  const meeting = async (key: string, projectKey: string, title: string, data: { description?: string; agenda: string[]; decision?: string; action?: string; notes: { key: string; body: string; type?: 'DECISION' }[]; minutes?: { key: string; status: 'APPROVED' | 'DRAFT'; summary: string; risks?: string[] } }) => {
    const m = await prisma.meeting.create({ data: { title, description: data.description ?? null, projectId: ids[projectKey]!, organizerId: owner, createdById: owner, startAt, status: 'SCHEDULED' } });
    ids[key] = m.id;
    for (const [i, a] of data.agenda.entries()) await prisma.agendaItem.create({ data: { meetingId: m.id, title: a, position: i } });
    if (data.decision) await prisma.decision.create({ data: { meetingId: m.id, title: data.decision, createdById: owner } });
    if (data.action) await prisma.actionItem.create({ data: { meetingId: m.id, description: data.action, createdById: owner } });
    for (const note of data.notes) ids[note.key] = (await prisma.meetingNote.create({ data: { meetingId: m.id, authorId: owner, body: note.body, type: note.type ?? 'DISCUSSION' } })).id;
    if (data.minutes) {
      await prisma.meetingMinutes.create({ data: { meetingId: m.id, status: data.minutes.status, ...(data.minutes.status === 'APPROVED' ? { approvedAt: new Date() } : {}), content: JSON.stringify({ summary: data.minutes.summary, discussion: [], decisions: [], risks: data.minutes.risks ?? [], nextSteps: [] }) } });
      ids[data.minutes.key] = m.id;
    }
  };
  await meeting('M1', 'P1', 'Weekly rig progress review', {
    description: 'Progress on the overhaul',
    agenda: ['Mud pump status', 'Mast inspection results'],
    decision: 'Proceed with mast certification by Bureau Veritas',
    action: 'Expedite liner delivery',
    notes: [{ key: 'N1', body: 'Mud pump liners arrive Thursday' }, { key: 'N2', body: 'Use a rental generator during the overhaul', type: 'DECISION' }],
    minutes: { key: 'MIN1', status: 'APPROVED', summary: 'Overhaul is on schedule except the mud pumps', risks: ['Late delivery of liners'] },
  });
  await meeting('M2', 'P2', 'Refinery HSE committee', { agenda: ['Permit to work audit'], notes: [{ key: 'N3', body: 'Three permit violations found at the tank farm' }], minutes: { key: 'MIN2', status: 'DRAFT', summary: 'HSE committee agreed stricter permit audits' } });
  await meeting('M3', 'P3', 'اجتماع صيانة المضخات', { agenda: ['جدول الصيانة'], notes: [{ key: 'N4', body: 'تأخر وصول قطع الغيار' }] });

  const inspection = async (key: string, projectKey: string, title: string, items: string[], note: string | null, place: string | null) => {
    ids[key] = (
      await prisma.inspection.create({
        data: {
          projectId: ids[projectKey]!, title, formVersion: 1, inspectorId: owner, startedById: owner, place,
          structure: { sections: [{ id: 's1', title: 'Checks', items: items.map((label, i) => ({ id: `i${i}`, kind: 'CHECK', label, help: null })) }], clientSignature: 'NONE', supervisorSignature: 'NONE' },
          ...(note ? { answers: { create: { itemId: 'i1', result: 'FAIL', note, editedAt: new Date(), answeredById: owner } } } : {}),
        },
      })
    ).id;
  };
  await inspection('I1', 'P1', 'Derrick mast inspection', ['Check pins and bolts', 'Check welds for cracks'], 'Crack found at leg weld 4', 'Rig 7');
  await inspection('I2', 'P2', 'Fire extinguisher monthly check', ['Pressure gauge in green zone'], null, null);

  const taskIds = Object.entries(ids).filter(([k]) => /^T\d+$/.test(k)).map(([, v]) => v);
  await taskIndex.refresh(taskIds);
  await index.refresh('project', [ids.P1!, ids.P2!, ids.P3!]);
  for (const k of ['M1', 'M2', 'M3']) await index.meetingChanged(ids[k]!);
  await index.refresh('file', [ids.F1!, ids.F2!, ids.F3!, ids.F4!]);
  await index.refresh('inspection', [ids.I1!, ids.I2!]);
  // 1.23.6: the new kinds, as the server indexes them — checklist items, contacts, the client named on P1.
  for (const t of taskIds) await index.taskPartsChanged(t);
  for (const p of [ids.P1!, ids.P2!, ids.P3!]) await index.projectChanged(p);
  // The person running these projects: sees all of them, the meetings in full, the drafts too.
  const meetings = [ids.M1!, ids.M2!, ids.M3!];
  scope = { projectIds: [ids.P1!, ids.P2!, ids.P3!], meetings: { full: meetings, invitee: [], editable: meetings } };
}

/** What each question must find (by the seeded item's name). */
const QUESTIONS: [string, string[]][] = [
  // Whole words
  ['mud pump liners', ['T1']],
  ['mast inspection', ['T2', 'I1', 'M1']],
  ['generator overhaul', ['T3']],
  ['hot work permit', ['T4', 'F1']],
  ['electrical isolation', ['T5']],
  ['scaffolding', ['T6']],
  ['pressure gauges', ['T7']],
  ['crane lift plan', ['T8']],
  ['drill pipe', ['T9']],
  ['hydrocracker', ['T11', 'P2']],
  ['fire water', ['T12']],
  ['heat exchanger', ['T13']],
  // Parts of words
  ['hydrocrack', ['T11']],
  ['calibrat', ['T7', 'F3']],
  ['scaff', ['T6']],
  ['commission', ['T15', 'F2']],
  ['exchang', ['T13']],
  ['isolat', ['T5']],
  // Spelling mistakes
  ['genarator', ['T3']],
  ['scafolding', ['T6']],
  ['hydrocraker', ['T11']],
  ['calibarte', ['T7']],
  ['excahnger', ['T13']],
  ['inspecton', ['T2', 'I1']],
  ['welidng', ['T4']],
  ['derick', ['I1']],
  ['compresor', ['F2']],
  ['permt', ['T4']],
  // Arabic (letter forms, ة/ه, hamza)
  ['المضخة', ['T16', 'F4']],
  ['اصلاح', ['T16']],
  ['الصمامات', ['T17']],
  ['تقرير السلامة', ['T18']],
  ['صيانة', ['P3', 'M3']],
  ['مانع التسرب', ['T16', 'F4']],
  // The text inside files
  ['fire watch', ['F1']],
  ['nitrogen purge', ['F2']],
  ['PG-101', ['F3']],
  ['leak test', ['F2']],
  ['deviation', ['F3']],
  ['استبدال', ['F4']],
  // Notes, minutes, decisions, agenda, action items
  ['liners arrive thursday', ['N1']],
  ['rental generator', ['N2']],
  ['permit violations', ['N3']],
  ['on schedule', ['MIN1']],
  ['Bureau Veritas', ['M1']],
  ['expedite', ['M1']],
  ['permit to work audit', ['M2']],
  ['stricter permit audits', ['MIN2']],
  ['قطع الغيار', ['N4']],
  ['late delivery', ['MIN1']],
  // Inspections
  ['crack found', ['I1']],
  ['fire extinguisher', ['I2']],
  ['green zone', ['I2']],
  // Task numbers, however typed
  ['@T3', ['T3']],
  ['@T8loose', ['T8']],
  ['@T5hash', ['T5']],
  // Projects, clients and contacts
  ['North Field', ['P1']],
  ['Petroleum Development Oman', ['P1', 'CL1']],
  ['tank farm', ['P2', 'T12']],
  ['Khalid Al Balushi', ['T13', 'C1']],
  ['Larsen', ['T13', 'C1']],
  // 1.23.6 Checklist items, and the client named on a project
  ['verify zero energy', ['CK1', 'T5']],
  ['apply locks', ['CK2', 'T5']],
  // Some of the words
  ['mud pump vibration', ['T1']],
  ['generator load test schedule', ['T3']],
];

/** The kind each seeded name is. */
const KIND: Record<string, string> = { P: 'project', T: 'task', F: 'file', M: 'meeting', N: 'note', I: 'inspection' };
const keyOf = (name: string) =>
  name.startsWith('MIN') ? `minutes:${ids[name]}`
  // 1.23.6: a checklist item; a contact and a client are "Clients & contacts" results.
  : name.startsWith('CK') ? `checklist:${ids[name]}`
  : name === 'C1' ? `contact:contact:${ids.C1}`
  : name === 'CL1' ? 'contact:client:petroleum development oman'
  : `${KIND[name[0]!]}:${ids[name]}`;

beforeAll(async () => {
  await prisma.$connect();
  await seed();
});

afterAll(async () => {
  const projectIds = [ids.P1, ids.P2, ids.P3].filter((x): x is string => !!x);
  await prisma.searchIndex.deleteMany({ where: { kind: 'client', recordId: 'petroleum development oman' } });
  await prisma.searchIndex.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { taskId: { in: Object.entries(ids).filter(([k]) => /^T\d+$/.test(k)).map(([, v]) => v) } }, { meetingId: { in: [ids.M1, ids.M2, ids.M3].filter((x): x is string => !!x) } }, { recordId: { in: [ids.F1, ids.F2, ids.F3, ids.F4, ids.I1, ids.I2].filter((x): x is string => !!x) } }] } });
  await prisma.inspection.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.decision.deleteMany({ where: { createdById: owner } });
  await prisma.actionItem.deleteMany({ where: { createdById: owner } });
  await prisma.meeting.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.comment.deleteMany({ where: { task: { projectId: { in: projectIds } } } });
  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.tag.deleteMany({ where: { name: { endsWith: `-${TAG}` } } });
  await prisma.user.deleteMany({ where: { id: owner } });
  await prisma.$disconnect();
});

describe('search accuracy (the test set)', () => {
  it(`finds what ${QUESTIONS.length} questions ask for: recall@10, precision@1 and precision@10`, async () => {
    const numberOf = async (name: string) => (await prisma.task.findUniqueOrThrow({ where: { id: ids[name]! } })).key;
    const rows: { q: string; recall: number; p1: number; p10: number; top: string[] }[] = [];
    for (const [raw, expected] of QUESTIONS) {
      let q = raw;
      if (raw === '@T3') q = await numberOf('T3');
      if (raw === '@T8loose') q = (await numberOf('T8')).replace('-', ' ').toLowerCase();
      if (raw === '@T5hash') q = `#${await numberOf('T5')}`;
      const { hits } = await engine.search({ q, scope, viewerId: owner, limit: 10 });
      const top = hits.slice(0, 10).map((h) => `${h.kind}:${h.id}`);
      const want = expected.map(keyOf);
      const found = want.filter((k) => top.includes(k)).length;
      rows.push({ q, recall: found / want.length, p1: top[0] && want.includes(top[0]) ? 1 : 0, p10: top.length ? top.filter((k) => want.includes(k)).length / Math.min(top.length, 10) : 0, top });
    }
    const mean = (k: 'recall' | 'p1' | 'p10') => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    const missed = rows.filter((r) => r.recall < 1 || r.p1 < 1).map((r) => `${r.q} → ${r.top.slice(0, 3).join(', ') || 'nothing'}`);
    console.log(`[search accuracy] ${rows.length} questions — recall@10 ${mean('recall').toFixed(3)}, precision@1 ${mean('p1').toFixed(3)}, precision@10 ${mean('p10').toFixed(3)}${missed.length ? `\n  not perfect:\n  ${missed.join('\n  ')}` : ''}`);
    expect(rows.length).toBeGreaterThanOrEqual(60);
    expect(mean('recall')).toBeGreaterThanOrEqual(0.95);
    expect(mean('p1')).toBeGreaterThanOrEqual(0.9);
  });
});
