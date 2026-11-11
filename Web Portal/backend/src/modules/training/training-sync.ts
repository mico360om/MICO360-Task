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

const PIECE = 300;
function chunks<T>(list: readonly T[], size = PIECE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function createTrainingSync(ctx: TrainingContext) {
  const { prisma } = ctx;
  /** I4: TRAINING_ASSIGNED notices go out after the answer, one batch at a time (single-flight). */
  let notices: Promise<void> = Promise.resolve();
  const later = (work: () => Promise<void>) => {
    notices = notices.then(work).catch((err) => ctx.logger?.warn('training: assignment notices failed', { err: String((err as Error)?.message ?? err) }));
  };

  /** R7: the enrolment of each (person, course) touched, after its assignees changed — in batches (I4). */
  async function settleEnrolments(pairs: readonly { userId: string; courseId: string }[]): Promise<number> {
    const byCourse = new Map<string, Set<string>>();
    for (const { userId, courseId } of pairs) (byCourse.get(courseId) ?? byCourse.set(courseId, new Set()).get(courseId)!).add(userId);
    let withdrawn = 0;
    const now = ctx.clock();
    for (const [courseId, users] of byCourse) {
      for (const part of chunks([...users])) {
        const active = new Map(
          (await prisma.trainingAssignee.groupBy({ by: ['userId'], where: { courseId, userId: { in: part }, withdrawnAt: null }, _count: { _all: true } })).map((g) => [g.userId, g._count._all]),
        );
        const existing = new Map((await prisma.trainingEnrolment.findMany({ where: { courseId, userId: { in: part } }, select: { id: true, userId: true, completedAt: true, selfStarted: true, withdrawnAt: true } })).map((e) => [e.userId, e]));
        const missing = part.filter((u) => !existing.has(u) && (active.get(u) ?? 0) > 0);
        if (missing.length) await prisma.trainingEnrolment.createMany({ data: missing.map((userId) => ({ userId, courseId })), skipDuplicates: true });
        const toWithdraw: string[] = [];
        const toRestore: string[] = [];
        for (const e of existing.values()) {
          const next = enrolmentAfterSync(e, active.get(e.userId) ?? 0);
          if (next === 'withdraw') toWithdraw.push(e.id);
          else if (next === 'restore') toRestore.push(e.id);
        }
        if (toWithdraw.length) withdrawn += (await prisma.trainingEnrolment.updateMany({ where: { id: { in: toWithdraw }, withdrawnAt: null }, data: { withdrawnAt: now } })).count;
        if (toRestore.length) await prisma.trainingEnrolment.updateMany({ where: { id: { in: toRestore } }, data: { withdrawnAt: null } });
      }
    }
    return withdrawn;
  }

  async function run(opts: { people?: readonly PersonRecord[]; assignmentIds?: readonly string[]; noticesNow?: boolean }): Promise<SyncResult> {
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
    const existing = opts.people
      ? (
          await Promise.all(
            chunks(people.map((p) => p.id)).map((part) =>
              prisma.trainingAssignee.findMany({ where: { assignmentId: { in: assignments.map((a) => a.id) }, userId: { in: part } }, select: { id: true, assignmentId: true, userId: true, withdrawnAt: true } }),
            ),
          )
        ).flat()
      : await prisma.trainingAssignee.findMany({ where: { assignmentId: { in: assignments.map((a) => a.id) } }, select: { id: true, assignmentId: true, userId: true, withdrawnAt: true } });
    const rowsOf = new Map<string, typeof existing>();
    for (const r of existing) (rowsOf.get(r.assignmentId) ?? rowsOf.set(r.assignmentId, []).get(r.assignmentId)!).push(r);
    const today = ctx.today();
    const now = ctx.clock();
    const reached = new Map<string, Set<string>>();
    const reach = (userId: string, courseId: string) => (reached.get(userId) ?? reached.set(userId, new Set()).get(userId)!).add(courseId);
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
      const plan = planAssignmentSync(facts, courseFacts(course), people, rowsOf.get(a.id) ?? [], today);
      // I4: the new assignees in a few inserts; only rows this sync wrote (its own moment) count as reached.
      for (const part of chunks(plan.add)) {
        await prisma.trainingAssignee.createMany({
          data: part.map((x) => ({ assignmentId: a.id, userId: x.userId, courseId: a.courseId, mandatory: x.mandatory, dueDay: x.dueDay, assignedAt: now })),
          skipDuplicates: true,
        });
        const mine = await prisma.trainingAssignee.findMany({ where: { assignmentId: a.id, userId: { in: part.map((x) => x.userId) }, assignedAt: now }, select: { userId: true } });
        for (const m of mine) {
          added++;
          touched.push({ userId: m.userId, courseId: a.courseId });
          reach(m.userId, a.courseId);
        }
      }
      for (const r of plan.reactivate) {
        const n = await prisma.trainingAssignee.updateMany({ where: { id: r.assigneeId, withdrawnAt: { not: null } }, data: { withdrawnAt: null, assignedAt: now, dueDay: r.dueDay, mandatory: a.mandatory } });
        if (n.count) {
          touched.push({ userId: r.userId, courseId: a.courseId });
          reach(r.userId, a.courseId);
        }
      }
      for (const part of chunks(plan.withdraw)) {
        await prisma.trainingAssignee.updateMany({ where: { id: { in: part.map((w) => w.assigneeId) }, withdrawnAt: null }, data: { withdrawnAt: now } });
        for (const w of part) touched.push({ userId: w.userId, courseId: a.courseId });
      }
    }
    const withdrawn = await settleEnrolments(touched);
    if (reached.size) {
      const byId = new Map(people.map((p) => [p.id, p]));
      later(() => tellAssigned(reached, byId, courses));
      if (opts.noticesNow) await notices;
    }
    return { added, withdrawn };
  }

  /** At most one TRAINING_ASSIGNED notice per person per sync, listing the courses (staff only). */
  async function tellAssigned(reached: Map<string, Set<string>>, people: ReadonlyMap<string, PersonRecord>, courses: Map<string, { title: string }>): Promise<void> {
    const staff = [...reached.keys()].filter((id) => {
      const p = people.get(id);
      return !!p && !p.client && p.active;
    });
    const courseIds = [...new Set(staff.flatMap((id) => [...reached.get(id)!]))];
    const open = new Set<string>();
    for (const part of chunks(staff)) {
      for (const e of await prisma.trainingEnrolment.findMany({ where: { userId: { in: part }, courseId: { in: courseIds }, completedAt: null }, select: { userId: true, courseId: true } })) open.add(`${e.userId}|${e.courseId}`);
    }
    for (const userId of staff) {
      // Only courses they don't already have finished.
      const list = [...reached.get(userId)!].filter((c) => open.has(`${userId}|${c}`));
      if (list.length === 0) continue;
      const titles = list.map((id) => courses.get(id)?.title ?? 'A course');
      const one = list.length === 1;
      try {
        await ctx.notify({
          userId,
          type: 'TRAINING_ASSIGNED',
          title: one ? `New training: ${titles[0]}` : `New training: ${list.length} courses`,
          body: one ? 'Open it from My learning in the Learning Hub.' : titles.slice(0, 5).join(' · ') + (titles.length > 5 ? ` and ${titles.length - 5} more` : ''),
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
    /** The 15-minute sweep (under the job lock): its notices are sent before it ends. */
    all: () => run({ noticesNow: true }),
    /** Resolves once every queued TRAINING_ASSIGNED notice has gone (tests, a clean stop). */
    idle: () => notices,
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
