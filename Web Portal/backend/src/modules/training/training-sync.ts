import { Prisma } from '@prisma/client';
import { courseFacts, type TrainingContext } from './training-context';
import { stringList, type PersonRecord } from './prisma-training-store';
import { enrolmentAfterSync, planAssignmentSync, type AssignmentFacts } from './training-targets';

/**
 * R7 membership-following assignments on the database: the sync adds assignees for new matches (with their
 * own due day, R6) and withdraws the assignee rows of people who no longer match; an unfinished enrolment
 * with no active assignee left (and not started by the person themselves) is withdrawn (hidden), a
 * finished one is kept. Runs every 15 minutes on one instance, for one person when they open My training
 * (or the portal's Help & training), and right after an assignment or rule is made. A person reached for
 * the first time gets one TRAINING_ASSIGNED notice per sync listing the courses (staff only).
 */
export interface SyncResult {
  added: number;
  withdrawn: number;
}

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export function createTrainingSync(ctx: TrainingContext) {
  const { prisma } = ctx;

  /** R7: the enrolment of each (person, course) touched, after its assignees changed. */
  async function settleEnrolments(pairs: readonly { userId: string; courseId: string }[]): Promise<number> {
    let withdrawn = 0;
    const seen = new Set<string>();
    for (const { userId, courseId } of pairs) {
      const k = `${userId}|${courseId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const active = await prisma.trainingAssignee.count({ where: { userId, courseId, withdrawnAt: null } });
      let e = await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true, completedAt: true, selfStarted: true, withdrawnAt: true } });
      if (!e) {
        if (active === 0) continue;
        try {
          e = await prisma.trainingEnrolment.create({ data: { userId, courseId }, select: { id: true, completedAt: true, selfStarted: true, withdrawnAt: true } });
        } catch (err) {
          if (!isUnique(err)) throw err;
          e = await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true, completedAt: true, selfStarted: true, withdrawnAt: true } });
          if (!e) continue;
        }
      }
      const next = enrolmentAfterSync(e, active);
      if (next === 'withdraw') {
        await prisma.trainingEnrolment.update({ where: { id: e.id }, data: { withdrawnAt: ctx.clock() } });
        withdrawn++;
      } else if (next === 'restore') {
        await prisma.trainingEnrolment.update({ where: { id: e.id }, data: { withdrawnAt: null } });
      }
    }
    return withdrawn;
  }

  async function run(opts: { people?: readonly PersonRecord[]; assignmentIds?: readonly string[] }): Promise<SyncResult> {
    const assignments = await prisma.trainingAssignment.findMany({
      where: { withdrawnAt: null, ...(opts.assignmentIds ? { id: { in: [...opts.assignmentIds] } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (assignments.length === 0) return { added: 0, withdrawn: 0 };
    const courseIds = [...new Set(assignments.map((a) => a.courseId))];
    const courses = new Map(
      (await prisma.trainingCourse.findMany({ where: { id: { in: courseIds } }, select: { id: true, title: true, audience: true, moduleKey: true, roleKeys: true, companyIds: true, status: true } })).map((c) => [c.id, c]),
    );
    const people = opts.people ?? [...(await ctx.people()).values()];
    const userFilter = opts.people ? { userId: { in: people.map((p) => p.id) } } : {};
    const existing = await prisma.trainingAssignee.findMany({
      where: { assignmentId: { in: assignments.map((a) => a.id) }, ...userFilter },
      select: { id: true, assignmentId: true, userId: true, withdrawnAt: true },
    });
    const today = ctx.today();
    const now = ctx.clock();
    const reached = new Map<string, Set<string>>();
    const touched: { userId: string; courseId: string }[] = [];
    let added = 0;
    for (const a of assignments) {
      const course = courses.get(a.courseId);
      if (!course) continue;
      const facts: AssignmentFacts = {
        id: a.id,
        courseId: a.courseId,
        targetKind: a.targetKind,
        targetId: a.targetId,
        mandatory: a.mandatory,
        dueDay: a.dueDay,
        dueDays: a.dueDays,
        newAccountsOnly: a.newAccountsOnly,
        scopeCompanyIds: a.scopeCompanyIds === null ? null : stringList(a.scopeCompanyIds),
        createdAt: a.createdAt,
        createdDay: ctx.dayOf(a.createdAt),
        frozen: a.frozenAt !== null,
      };
      const plan = planAssignmentSync(facts, courseFacts(course), people, existing.filter((r) => r.assignmentId === a.id), today);
      for (const add of plan.add) {
        try {
          await prisma.trainingAssignee.create({ data: { assignmentId: a.id, userId: add.userId, courseId: a.courseId, mandatory: add.mandatory, dueDay: add.dueDay, assignedAt: now } });
        } catch (err) {
          if (isUnique(err)) continue; // another sync reached them first
          throw err;
        }
        added++;
        touched.push({ userId: add.userId, courseId: a.courseId });
        (reached.get(add.userId) ?? reached.set(add.userId, new Set()).get(add.userId)!).add(a.courseId);
      }
      for (const r of plan.reactivate) {
        const n = await prisma.trainingAssignee.updateMany({ where: { id: r.assigneeId, withdrawnAt: { not: null } }, data: { withdrawnAt: null, assignedAt: now, dueDay: r.dueDay, mandatory: a.mandatory } });
        if (n.count) {
          touched.push({ userId: r.userId, courseId: a.courseId });
          (reached.get(r.userId) ?? reached.set(r.userId, new Set()).get(r.userId)!).add(a.courseId);
        }
      }
      for (const w of plan.withdraw) {
        await prisma.trainingAssignee.updateMany({ where: { id: w.assigneeId, withdrawnAt: null }, data: { withdrawnAt: now } });
        touched.push({ userId: w.userId, courseId: a.courseId });
      }
    }
    const withdrawn = await settleEnrolments(touched);
    await tellAssigned(reached, people, courses);
    return { added, withdrawn };
  }

  /** At most one TRAINING_ASSIGNED notice per person per sync, listing the courses (staff only). */
  async function tellAssigned(reached: Map<string, Set<string>>, people: readonly PersonRecord[], courses: Map<string, { title: string }>): Promise<void> {
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const [userId, ids] of reached) {
      const p = byId.get(userId);
      if (!p || p.client || !p.active) continue;
      // Only courses they don't already have finished.
      const open = await prisma.trainingEnrolment.findMany({ where: { userId, courseId: { in: [...ids] }, completedAt: null }, select: { courseId: true } });
      const list = open.map((e) => e.courseId);
      if (list.length === 0) continue;
      const titles = list.map((id) => courses.get(id)?.title ?? 'A course');
      const one = list.length === 1;
      try {
        await ctx.notify({
          userId,
          type: 'TRAINING_ASSIGNED',
          title: one ? `New training: ${titles[0]}` : `New training: ${list.length} courses`,
          body: one ? 'Open it from My training.' : titles.slice(0, 5).join(' · ') + (titles.length > 5 ? ` and ${titles.length - 5} more` : ''),
          entityType: one ? 'training-course' : 'training-my',
          entityId: one ? list[0]! : null,
          projectId: null,
        });
      } catch (err) {
        ctx.logger?.warn('training: an assignment notice could not be sent', { userId, err: String((err as Error)?.message ?? err) });
      }
    }
  }

  /** Withdraws an assignment: its people lose it (unfinished training with nothing else left is withdrawn). */
  async function withdrawAssignments(ids: readonly string[], byId: string | null): Promise<number> {
    if (ids.length === 0) return 0;
    const now = ctx.clock();
    await prisma.trainingAssignment.updateMany({ where: { id: { in: [...ids] }, withdrawnAt: null }, data: { withdrawnAt: now, withdrawnById: byId } });
    const rows = await prisma.trainingAssignee.findMany({ where: { assignmentId: { in: [...ids] }, withdrawnAt: null }, select: { userId: true, courseId: true } });
    await prisma.trainingAssignee.updateMany({ where: { assignmentId: { in: [...ids] }, withdrawnAt: null }, data: { withdrawnAt: now } });
    return settleEnrolments(rows);
  }

  /** R10: a certificate past its expiry puts its course into a retake (lessons count again from then). */
  async function applyExpiry(userId?: string): Promise<number> {
    const certs = await prisma.trainingCertificate.findMany({ where: { revokedAt: null, expiresAt: { lte: ctx.clock() }, ...(userId ? { userId } : {}) }, select: { userId: true, courseId: true, expiresAt: true } });
    let n = 0;
    for (const c of certs) {
      const r = await prisma.trainingEnrolment.updateMany({
        where: { userId: c.userId, courseId: c.courseId, completedAt: { lt: c.expiresAt! }, OR: [{ retakeFrom: null }, { retakeFrom: { lt: c.expiresAt! } }] },
        data: { retakeFrom: c.expiresAt },
      });
      n += r.count;
    }
    return n;
  }

  return {
    all: () => run({}),
    person: async (p: PersonRecord) => {
      await applyExpiry(p.id);
      return run({ people: [p] });
    },
    assignments: (ids: readonly string[]) => run({ assignmentIds: ids }),
    withdrawAssignments,
    settleEnrolments,
    applyExpiry,
  };
}

export type TrainingSync = ReturnType<typeof createTrainingSync>;
