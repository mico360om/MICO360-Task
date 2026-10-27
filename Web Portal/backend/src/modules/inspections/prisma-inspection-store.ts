import type { Prisma, PrismaClient } from '@prisma/client';
import { readStructure } from './inspection-form-input';
import type { InspectionStatus, ItemResult, SignatureRole } from './inspection-rules';
import type {
  AnswerOutcome,
  AnswerRecord,
  FollowUpRecord,
  FormRecord,
  InspectionRecord,
  InspectionStore,
  Refusal,
  SignatureRecord,
} from './inspection-store';

type Tx = Prisma.TransactionClient;
type InspectionRow = Prisma.InspectionGetPayload<object>;
type AnswerRow = Prisma.InspectionAnswerGetPayload<object>;

/** A locked step may write up to 300 answers: give it time. */
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

const toForm = (r: Prisma.InspectionFormGetPayload<object>): FormRecord => ({
  id: r.id,
  title: r.title,
  description: r.description,
  structure: readStructure({ sections: r.sections, clientSignature: r.clientSignature, supervisorSignature: r.supervisorSignature }),
  version: r.version,
  createdById: r.createdById,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toInspection = (r: InspectionRow): InspectionRecord => ({
  id: r.id,
  projectId: r.projectId,
  formId: r.formId,
  formVersion: r.formVersion,
  title: r.title,
  description: r.description,
  structure: readStructure(r.structure),
  place: r.place,
  taskId: r.taskId,
  status: (r.status === 'FINISHED' ? 'FINISHED' : 'IN_PROGRESS') as InspectionStatus,
  inspectorId: r.inspectorId,
  startedById: r.startedById,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  finishId: r.finishId,
  revision: r.revision,
  reopenedAt: r.reopenedAt,
  reopenedById: r.reopenedById,
  counts: { itemCount: r.itemCount, passed: r.passedCount, failed: r.failedCount, na: r.naCount },
  clientVisible: r.clientVisible,
  clientVisibleProjectId: r.clientVisibleProjectId,
  updatedAt: r.updatedAt,
});

const RESULTS = new Set(['PASS', 'FAIL', 'NA']);
const toAnswer = (r: AnswerRow): AnswerRecord => ({
  itemId: r.itemId,
  result: r.result && RESULTS.has(r.result) ? (r.result as ItemResult) : null,
  reading: r.reading,
  note: r.note,
  editedAt: r.editedAt,
  answeredById: r.answeredById,
});

const toSignature = (r: Prisma.InspectionSignatureGetPayload<object>): SignatureRecord => ({
  role: r.role as SignatureRole,
  name: r.name,
  method: r.method === 'TYPED' ? 'TYPED' : 'DRAWN',
  image: r.image ? Buffer.from(r.image) : null,
  signedAt: r.signedAt,
  capturedById: r.capturedById,
  revision: r.revision,
});

const toFollowUp = (r: { itemId: string; taskId: string | null; createdById: string; createdAt: Date }): FollowUpRecord => ({
  itemId: r.itemId,
  taskId: r.taskId,
  createdById: r.createdById,
  createdAt: r.createdAt,
});

const countsData = (c: { itemCount: number; passed: number; failed: number; na: number }) => ({ itemCount: c.itemCount, passedCount: c.passed, failedCount: c.failed, naCount: c.na });

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';

/** The inspection's row, locked for the rest of the transaction (null when it is gone or deleted). */
async function lockLive(tx: Tx, id: string): Promise<InspectionRow | null> {
  await tx.$queryRaw`SELECT id FROM inspections WHERE id = ${id} FOR UPDATE`;
  return tx.inspection.findFirst({ where: { id, deletedAt: null } });
}

function refusal(r: InspectionRow | null, actorId: string): Refusal | null {
  if (!r) return { kind: 'gone' };
  if (r.status !== 'IN_PROGRESS') return { kind: 'finished' };
  if (r.inspectorId !== actorId) return { kind: 'not-inspector', inspectorId: r.inspectorId };
  return null;
}

export function createPrismaInspectionStore(prisma: PrismaClient): InspectionStore {
  const live = { deletedAt: null } as const;
  const newestFirst = [{ startedAt: 'desc' as const }, { id: 'desc' as const }];

  /** Reserves a follow-up (see InspectionStore.claimFollowUp): the unique key decides between two at once. */
  async function claim(inspectionId: string, itemId: string, createdById: string, at: Date, staleBefore: Date, tries = 3): ReturnType<InspectionStore['claimFollowUp']> {
    try {
      await prisma.inspectionFollowUp.create({ data: { inspectionId, itemId, createdById, createdAt: at } });
      return { claimed: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    const existing = await prisma.inspectionFollowUp.findUnique({
      where: { inspectionId_itemId: { inspectionId, itemId } },
      select: { id: true, itemId: true, taskId: true, createdById: true, createdAt: true, task: { select: { deletedAt: true } } },
    });
    // Released between the two steps: try again (a few times at most).
    if (!existing) {
      if (tries <= 1) throw new Error('The follow-up could not be reserved.');
      return claim(inspectionId, itemId, createdById, at, staleBefore, tries - 1);
    }
    const taskGone = existing.taskId !== null && (!existing.task || existing.task.deletedAt !== null);
    const abandoned = existing.taskId === null && existing.createdAt.getTime() < staleBefore.getTime();
    if (taskGone || abandoned) {
      // Taken over only if nobody else took it over meanwhile (the row is still as it was read).
      const { count } = await prisma.inspectionFollowUp.updateMany({
        where: { id: existing.id, taskId: existing.taskId, createdAt: existing.createdAt },
        data: { taskId: null, createdById, createdAt: at },
      });
      if (count === 1) return { claimed: true };
      const now = await prisma.inspectionFollowUp.findUnique({ where: { id: existing.id } });
      return { claimed: false, existing: toFollowUp(now ?? existing) };
    }
    return { claimed: false, existing: toFollowUp(existing) };
  }

  return {
    async createForm(d) {
      const r = await prisma.inspectionForm.create({
        data: {
          title: d.title,
          description: d.description,
          sections: d.structure.sections as unknown as Prisma.InputJsonValue,
          clientSignature: d.structure.clientSignature,
          supervisorSignature: d.structure.supervisorSignature,
          createdById: d.createdById,
        },
      });
      return toForm(r);
    },
    async findForm(id) {
      const r = await prisma.inspectionForm.findFirst({ where: { id, ...live } });
      return r ? toForm(r) : null;
    },
    async listForms() {
      return (await prisma.inspectionForm.findMany({ where: live, orderBy: [{ title: 'asc' }, { id: 'asc' }] })).map(toForm);
    },
    async updateForm(id, expectedVersion, d) {
      const { count } = await prisma.inspectionForm.updateMany({
        where: { id, version: expectedVersion, ...live },
        data: {
          title: d.title,
          description: d.description,
          sections: d.structure.sections as unknown as Prisma.InputJsonValue,
          clientSignature: d.structure.clientSignature,
          supervisorSignature: d.structure.supervisorSignature,
          version: { increment: 1 },
        },
      });
      const r = await prisma.inspectionForm.findFirst({ where: { id, ...live } });
      if (!r) return null;
      return count === 1 ? toForm(r) : 'stale';
    },
    async deleteForm(id) {
      const { count } = await prisma.inspectionForm.updateMany({ where: { id, ...live }, data: { deletedAt: new Date() } });
      return count === 1;
    },

    async createInspection(d) {
      const r = await prisma.inspection.create({
        data: {
          projectId: d.projectId,
          formId: d.formId,
          formVersion: d.formVersion,
          title: d.title,
          description: d.description,
          structure: d.structure as unknown as Prisma.InputJsonValue,
          place: d.place,
          taskId: d.taskId,
          inspectorId: d.inspectorId,
          startedById: d.inspectorId,
          startedAt: d.at,
          itemCount: d.itemCount,
        },
      });
      return toInspection(r);
    },
    async findInspection(id) {
      const r = await prisma.inspection.findFirst({ where: { id, ...live } });
      return r ? toInspection(r) : null;
    },
    async listForProject(projectId) {
      return (await prisma.inspection.findMany({ where: { projectId, ...live }, orderBy: newestFirst })).map(toInspection);
    },
    async listForTask(taskId) {
      return (await prisma.inspection.findMany({ where: { taskId, ...live }, orderBy: newestFirst })).map(toInspection);
    },
    async answers(inspectionId) {
      return (await prisma.inspectionAnswer.findMany({ where: { inspectionId }, orderBy: { id: 'asc' } })).map(toAnswer);
    },
    async signatures(inspectionId) {
      return (await prisma.inspectionSignature.findMany({ where: { inspectionId, supersededAt: null }, orderBy: { createdAt: 'asc' } })).map(toSignature);
    },
    async earlierSignatures(inspectionId) {
      const rows = await prisma.inspectionSignature.findMany({ where: { inspectionId, supersededAt: { not: null } }, orderBy: [{ revision: 'asc' }, { createdAt: 'asc' }] });
      return rows.map((r) => ({ ...toSignature(r), revision: r.revision, supersededAt: r.supersededAt! }));
    },
    async followUps(inspectionId) {
      return (await prisma.inspectionFollowUp.findMany({ where: { inspectionId }, orderBy: { createdAt: 'asc' } })).map(toFollowUp);
    },

    async writeAnswers(id, actorId, writes, count) {
      return prisma.$transaction(async (tx) => {
        const r = await lockLive(tx, id);
        const refused = refusal(r, actorId);
        if (refused) return refused;
        const itemIds = [...new Set(writes.map((w) => w.itemId))];
        const stored = new Map((await tx.inspectionAnswer.findMany({ where: { inspectionId: id, itemId: { in: itemIds } } })).map((a) => [a.itemId, toAnswer(a)]));
        const results: AnswerOutcome[] = [];
        for (const w of writes) {
          const current = stored.get(w.itemId);
          if (current && current.editedAt.getTime() > w.editedAt.getTime()) {
            results.push({ itemId: w.itemId, status: 'stale', answer: current });
            continue;
          }
          if (current && current.editedAt.getTime() === w.editedAt.getTime()) {
            results.push({ itemId: w.itemId, status: 'same', answer: current });
            continue;
          }
          const data = { result: w.result, reading: w.reading, note: w.note, editedAt: w.editedAt, answeredById: actorId };
          await tx.inspectionAnswer.upsert({ where: { inspectionId_itemId: { inspectionId: id, itemId: w.itemId } }, create: { inspectionId: id, itemId: w.itemId, ...data }, update: data });
          const next: AnswerRecord = { itemId: w.itemId, ...data };
          stored.set(w.itemId, next);
          results.push({ itemId: w.itemId, status: 'applied', answer: next });
        }
        let row = r!;
        if (results.some((x) => x.status === 'applied')) {
          const all = (await tx.inspectionAnswer.findMany({ where: { inspectionId: id } })).map(toAnswer);
          row = await tx.inspection.update({ where: { id }, data: countsData(count(all)) });
        }
        return { kind: 'ok' as const, results, inspection: toInspection(row) };
      }, TX);
    },

    async finish(id, actorId, input) {
      return prisma.$transaction(async (tx) => {
        const r = await lockLive(tx, id);
        if (r && r.status === 'FINISHED') {
          return r.finishId === input.finishId ? { kind: 'already' as const, inspection: toInspection(r) } : { kind: 'finished-other' as const, inspection: toInspection(r) };
        }
        const refused = refusal(r, actorId);
        if (refused) return refused;
        if (r!.revision !== input.revision) return { kind: 'stale-revision' as const, revision: r!.revision };
        const all = (await tx.inspectionAnswer.findMany({ where: { inspectionId: id }, orderBy: { id: 'asc' } })).map(toAnswer);
        const problem = input.check(all);
        if (problem !== null) return { kind: 'problem' as const, problem };
        // A reopen keeps earlier revisions' signatures (superseded); this revision's are written once.
        await tx.inspectionSignature.deleteMany({ where: { inspectionId: id, revision: r!.revision, supersededAt: null } });
        for (const s of input.signatures) {
          await tx.inspectionSignature.create({
            data: { inspectionId: id, revision: r!.revision, role: s.role, name: s.name, method: s.method, image: s.image ?? null, signedAt: s.signedAt, capturedById: s.capturedById },
          });
        }
        const row = await tx.inspection.update({
          where: { id },
          data: { status: 'FINISHED', finishedAt: input.at, finishId: input.finishId, ...countsData(input.count(all)) },
        });
        return { kind: 'ok' as const, inspection: toInspection(row) };
      }, TX);
    },

    async reopen(id, byUserId, at) {
      return prisma.$transaction(async (tx) => {
        const r = await lockLive(tx, id);
        if (!r || r.status !== 'FINISHED') return false;
        // Kept (they no longer count): the staff report lists them as an earlier signed revision.
        await tx.inspectionSignature.updateMany({ where: { inspectionId: id, supersededAt: null }, data: { supersededAt: at } });
        await tx.inspection.update({
          where: { id },
          data: { status: 'IN_PROGRESS', finishedAt: null, finishId: null, revision: { increment: 1 }, reopenedAt: at, reopenedById: byUserId, clientVisible: false, clientVisibleProjectId: null },
        });
        return true;
      }, TX);
    },
    async takeOver(id, userId) {
      const { count } = await prisma.inspection.updateMany({ where: { id, status: 'IN_PROGRESS', ...live }, data: { inspectorId: userId } });
      return count === 1;
    },
    async deleteInspection(id) {
      const { count } = await prisma.inspection.updateMany({ where: { id, ...live }, data: { deletedAt: new Date(), clientVisible: false, clientVisibleProjectId: null } });
      return count === 1;
    },
    async setClientVisible(id, visible) {
      if (!visible) {
        const { count } = await prisma.inspection.updateMany({ where: { id, ...live }, data: { clientVisible: false, clientVisibleProjectId: null } });
        return count === 1;
      }
      // Shown only while finished, for the project it is filed under now: both are part of the write,
      // so a reopen can't slip between.
      return prisma.$transaction(async (tx) => {
        const r = await lockLive(tx, id);
        if (!r || r.status !== 'FINISHED') return false;
        await tx.inspection.update({ where: { id }, data: { clientVisible: true, clientVisibleProjectId: r.projectId } });
        return true;
      }, TX);
    },

    claimFollowUp: (inspectionId, itemId, createdById, at, staleBefore) => claim(inspectionId, itemId, createdById, at, staleBefore),
    async completeFollowUp(inspectionId, itemId, taskId) {
      await prisma.inspectionFollowUp.updateMany({ where: { inspectionId, itemId }, data: { taskId } });
    },
    async releaseFollowUp(inspectionId, itemId) {
      await prisma.inspectionFollowUp.deleteMany({ where: { inspectionId, itemId, taskId: null } });
    },
    async followUpOfTask(taskId) {
      const f = await prisma.inspectionFollowUp.findUnique({ where: { taskId }, select: { itemId: true, inspection: true } });
      if (!f || f.inspection.deletedAt !== null) return null;
      return { inspection: toInspection(f.inspection), itemId: f.itemId };
    },

    async clientInspections(projectId) {
      const rows = await prisma.inspection.findMany({
        where: { projectId, clientVisible: true, clientVisibleProjectId: projectId, status: 'FINISHED', ...live },
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map(toInspection);
    },
  };
}

