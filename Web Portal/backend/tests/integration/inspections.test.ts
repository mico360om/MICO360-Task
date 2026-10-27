import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { inspectionStoreContract } from '../../src/modules/inspections/inspection-store.contract';
import { createPrismaInspectionStore } from '../../src/modules/inspections/prisma-inspection-store';
import type { AnswerRecord, Counts } from '../../src/modules/inspections/inspection-store';
import { createInspectionPorts } from '../../src/modules/inspections/prisma-inspection-ports';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied. Only this file's projects
// (codes INA, INB) and its person (insp-owner@mico360.test) are made and removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaInspectionStore(prisma);
const CODES = ['INA', 'INB'];
const EMAIL = 'insp-owner@mico360.test';
let ownerId = '';
let a = { id: '', col: '' };
let b = { id: '', col: '' };
let n = 0;

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: CODES } }, select: { id: true } })).map((p) => p.id);
  await prisma.inspection.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.inspectionForm.deleteMany({ where: { createdById: { in: ['u-maker', ownerId].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function project(code: string) {
  const p = await prisma.project.create({ data: { code, name: `Project ${code}`, createdById: ownerId, ownerId } });
  const col = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To do', category: 'TODO', position: 0 } });
  return { id: p.id, col: col.id };
}

async function setup() {
  await cleanup();
  ownerId = (await prisma.user.create({ data: { email: EMAIL, username: 'insp-owner', passwordHash: 'x', firstName: 'Omar', lastName: 'Ahmed' } })).id;
  a = await project('INA');
  b = await project('INB');
}

const makeTask = async (projectId: string) => {
  const col = projectId === a.id ? a.col : b.col;
  return (await prisma.task.create({ data: { key: `IN-${++n}-${Date.now()}`, title: 'Inspect rig 3', projectId, columnId: col, createdById: ownerId } })).id;
};

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

inspectionStoreContract('MySQL (Prisma)', async () => {
  await setup();
  return {
    store,
    projectA: a.id,
    projectB: b.id,
    makeTask,
    deleteTask: async (taskId) => void (await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } })),
    moveInspection: async (id, projectId) => void (await prisma.inspection.update({ where: { id }, data: { projectId } })),
  };
});

describe('inspections in the database', () => {
  beforeEach(setup);

  const structure = {
    sections: [{ id: 's1', title: 'Deck', items: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, kind: 'CHECK' as const, label: `Item ${i}`, help: null })) }],
    clientSignature: 'NONE' as const,
    supervisorSignature: 'NONE' as const,
  };
  const count = (answers: AnswerRecord[]): Counts => ({ itemCount: 20, passed: answers.filter((x) => x.result === 'PASS').length, failed: answers.filter((x) => x.result === 'FAIL').length, na: 0 });
  const start = async () => {
    const form = await store.createForm({ title: 'Deck check', description: null, structure, createdById: ownerId });
    return store.createInspection({ projectId: a.id, formId: form.id, formVersion: 1, title: form.title, description: null, structure, place: null, taskId: null, inspectorId: ownerId, itemCount: 20, at: new Date() });
  };

  it('answers sent at the same moment as the finish are either in it or refused — never stored after it', async () => {
    const i = await start();
    const edits = structure.sections[0]!.items.map((it, k) => ({ itemId: it.id, result: 'PASS' as const, reading: null, note: null, editedAt: new Date(Date.UTC(2026, 9, 27, 8, 0, k)) }));
    await store.writeAnswers(i.id, ownerId, edits.slice(0, 19), count);
    const late = { ...edits[19]!, editedAt: new Date(Date.UTC(2026, 9, 27, 9)) };
    const [w, fin] = await Promise.all([
      store.writeAnswers(i.id, ownerId, [late], count),
      store.finish(i.id, ownerId, { finishId: 'f1', revision: 0, at: new Date(), signatures: [], check: (all) => (all.length === 20 ? null : `only ${all.length}`), count }),
    ]);
    const stored = await store.answers(i.id);
    const after = (await store.findInspection(i.id))!;
    if (fin.kind === 'ok') {
      // The finish saw all 20, so the write went first.
      expect(w.kind).toBe('ok');
      expect(stored).toHaveLength(20);
      expect(after.counts.passed).toBe(20);
    } else {
      // The finish went first and found 19; the write then went in while it was still open.
      expect(fin).toEqual({ kind: 'problem', problem: 'only 19' });
      expect(after.status).toBe('IN_PROGRESS');
    }
  });

  it('two people making the same follow-up at once: one claim, one wait', async () => {
    const i = await start();
    const at = new Date();
    const stale = new Date(at.getTime() - 120_000);
    const results = await Promise.all([1, 2, 3].map((k) => store.claimFollowUp(i.id, 'c1', `u-${k}`, at, stale)));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(await prisma.inspectionFollowUp.count({ where: { inspectionId: i.id } })).toBe(1);
  });

  it('a big signature image and long Arabic text round-trip', async () => {
    const i = await start();
    const note = 'تسرب بسيط عند الصمام الرئيسي — '.repeat(60).slice(0, 2000);
    await store.writeAnswers(i.id, ownerId, [{ itemId: 'c0', result: 'FAIL', reading: null, note, editedAt: new Date() }], count);
    expect((await store.answers(i.id))[0]!.note).toBe(note);
    const image = Buffer.alloc(400_000, 7);
    const all = structure.sections[0]!.items.map((it) => ({ itemId: it.id, result: 'PASS' as const, reading: null, note: null, editedAt: new Date(Date.UTC(2027, 0, 1)) }));
    await store.writeAnswers(i.id, ownerId, all, count);
    const fin = await store.finish(i.id, ownerId, {
      finishId: 'f1',
      revision: 0,
      at: new Date(),
      signatures: [{ role: 'INSPECTOR', name: 'عمر أحمد', method: 'DRAWN', image, signedAt: new Date(), capturedById: ownerId }],
      check: () => null,
      count,
    });
    expect(fin.kind).toBe('ok');
    const [s] = await store.signatures(i.id);
    expect(s!.name).toBe('عمر أحمد');
    expect(s!.image!.equals(image)).toBe(true);
  });

  it('deleting a project removes its inspections with their answers, signatures and follow-ups', async () => {
    const i = await start();
    await store.writeAnswers(i.id, ownerId, [{ itemId: 'c0', result: 'FAIL', reading: null, note: null, editedAt: new Date() }], count);
    await store.claimFollowUp(i.id, 'c0', ownerId, new Date(), new Date(0));
    await prisma.task.deleteMany({ where: { projectId: a.id } });
    await prisma.kanbanColumn.deleteMany({ where: { projectId: a.id } });
    await prisma.project.delete({ where: { id: a.id } });
    expect(await prisma.inspection.count({ where: { id: i.id } })).toBe(0);
    expect(await prisma.inspectionAnswer.count({ where: { inspectionId: i.id } })).toBe(0);
    expect(await prisma.inspectionFollowUp.count({ where: { inspectionId: i.id } })).toBe(0);
  });

  it('a task hard-deleted leaves its inspection, without the link', async () => {
    const task = await makeTask(a.id);
    const form = await store.createForm({ title: 'Deck check', description: null, structure, createdById: ownerId });
    const i = await store.createInspection({ projectId: a.id, formId: form.id, formVersion: 1, title: form.title, description: null, structure, place: null, taskId: task, inspectorId: ownerId, itemCount: 20, at: new Date() });
    await prisma.task.delete({ where: { id: task } });
    expect((await store.findInspection(i.id))!.taskId).toBeNull();
  });
});

describe('the inspection service’s view of the app, in the database', () => {
  beforeEach(setup);
  const ports = () =>
    createInspectionPorts({
      prisma,
      access: { canViewProject: async () => true, canViewTask: async () => true },
      authz: { canManageProject: async () => true },
      tasks: { createTask: async () => { throw new Error('not used'); } },
      columns: { listColumns: async (projectId) => prisma.kanbanColumn.findMany({ where: { projectId } }) },
      assignees: { eligibleAssignees: async (_p, ids) => ids, assertAssignable: async (_p, ids) => ids, notifyAssigned: async () => {} },
      broadcast: () => {},
      userNames: async () => new Map(),
    });

  it('knows who runs a project: its owner, a MANAGER member — not a plain member', async () => {
    const plain = await prisma.user.create({ data: { email: 'insp-plain@mico360.test', username: 'insp-plain', passwordHash: 'x', firstName: 'Sam', lastName: 'Member' } });
    const mgr = await prisma.user.create({ data: { email: 'insp-mgr@mico360.test', username: 'insp-mgr', passwordHash: 'x', firstName: 'Mona', lastName: 'Manager' } });
    try {
      await prisma.projectMember.createMany({ data: [{ projectId: a.id, userId: plain.id, role: 'MEMBER' }, { projectId: a.id, userId: mgr.id, role: 'MANAGER' }] });
      const p = ports();
      expect(await p.runsAnyProject(ownerId)).toBe(true);
      expect(await p.runsAnyProject(mgr.id)).toBe(true);
      expect(await p.runsAnyProject(plain.id)).toBe(false);
      expect(await p.peopleNames(a.id)).toEqual(expect.arrayContaining(['Omar Ahmed', 'Mona Manager', 'Sam Member', 'Omar']));
    } finally {
      await prisma.projectMember.deleteMany({ where: { userId: { in: [plain.id, mgr.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [plain.id, mgr.id] } } });
    }
  });

  it('finds the first Done column, and tells a done task from an open one', async () => {
    const p = ports();
    expect(await p.doneColumnOf(a.id)).toBeNull();
    const done = await prisma.kanbanColumn.create({ data: { projectId: a.id, name: 'Done', category: 'DONE', position: 5 } });
    expect(await p.doneColumnOf(a.id)).toBe(done.id);
    const open = await makeTask(a.id);
    expect((await p.task(open))!.done).toBe(false);
    await prisma.task.update({ where: { id: open }, data: { columnId: done.id } });
    expect((await p.task(open))!.done).toBe(true);
    await prisma.task.update({ where: { id: open }, data: { deletedAt: new Date() } });
    expect(await p.task(open)).toBeNull();
    expect((await p.taskSummaries([open])).get(open)).toMatchObject({ deleted: true });
  });
});
