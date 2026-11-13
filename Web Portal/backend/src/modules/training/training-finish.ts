import { Prisma, type PrismaClient } from '@prisma/client';
import { withRowLock } from '../../lib/sentinel-lock';
import { addMonths, certificateStatus, newCertificateCode } from './training-certificates';
import type { TrainingContext } from './training-context';
import { stringList, type PersonRecord } from './prisma-training-store';
import { OTHER_UNIT, allUnitsDone, certificateCoversUnits } from './training-modules';
import { loadStates, pairKey, type PairState } from './training-read';
import { cycleStart, isCourseComplete, retakeActive, reviewPending } from './training-state';

/**
 * Finishing a course (R9, R11) in one place: when a lesson is done (the learner side), and again for everyone
 * on a course when its lessons changed under them (R3, 12 Nov: a video link cleared, a lesson removed, a
 * starter course upgraded) — anyone who has now done every lesson people can see is finished, once, with the
 * certificate when the course gives one. `completedAt` is never moved for anyone already finished.
 * 1.23.30: a course with modules finishes when every module the person sees is done; each module is recorded
 * when first done (it stays done when lessons are added later); a finished person whose role grew gets an
 * updated certificate once their new modules are done, and keeps the old one (D3).
 */

export const COURSE = {
  id: true,
  title: true,
  summary: true,
  moduleKey: true,
  audience: true,
  roleKeys: true,
  difficulty: true,
  status: true,
  completionRule: true,
  inOrder: true,
  certificateOn: true,
  certificateMonths: true,
  issuerUserId: true,
  issuerTitle: true,
  signatureFileId: true,
  companyIds: true,
  version: true,
  starterKey: true,
  position: true,
} as const satisfies Prisma.TrainingCourseSelect;
export type CourseRow = Prisma.TrainingCourseGetPayload<{ select: typeof COURSE }>;

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
function chunks<T>(list: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** A course with modules: the done modules a certificate covers ("Other lessons" isn't a module). */
const doneModuleIds = (state: PairState): string[] => state.units.filter((u) => u.status === 'DONE' && u.unitId !== OTHER_UNIT).map((u) => u.unitId);

/** Everything the person needs is done: every module they see (1.23.30), else every lesson by the completion rule (R9). */
const finishedAll = (rule: string, state: PairState): boolean => (state.modules.length > 0 ? allUnitsDone(state.units) : isCourseComplete(rule, state.lessons, state.doneIds));

/** The person's certificates on the course still valid at `now` (not revoked, not expired). */
const validWhere = (userId: string, courseId: string, now: Date) => ({ userId, courseId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

type Db = PrismaClient | Prisma.TransactionClient;

export function createTrainingFinish(ctx: TrainingContext) {
  const { prisma } = ctx;

  /** What a certificate prints besides the course and the person: their company, the issuer's name. */
  async function certificateFacts(p: PersonRecord, course: CourseRow): Promise<{ companyId: string | null; issuerName: string | null }> {
    const companyId = (ctx.companyOfPerson ? await ctx.companyOfPerson(p.id).catch(() => null) : null) ?? p.primaryCompanyId ?? p.companyIds[0] ?? null;
    const issuer = course.issuerUserId ? await prisma.user.findUnique({ where: { id: course.issuerUserId }, select: { firstName: true, lastName: true, username: true } }) : null;
    return { companyId, issuerName: issuer ? (`${issuer.firstName} ${issuer.lastName}`.trim() || issuer.username).slice(0, 200) : null };
  }

  /** `expiresAt`: a D3 update keeps the expiry of the certificate it updates; otherwise from the course's months. */
  async function writeCertificate(
    db: Db,
    p: PersonRecord,
    course: CourseRow,
    state: PairState,
    facts: { companyId: string | null; issuerName: string | null },
    o: { keepOld?: boolean; completedAt?: Date; expiresAt?: Date | null },
  ): Promise<string> {
    const now = ctx.clock();
    // M10: an expired certificate stays EXPIRED (never revoked); only one still valid is replaced (rare: no retake then).
    // D3 (`keepOld`): the certificate for a grown role is added; the one held stays valid.
    if (!o.keepOld) await db.trainingCertificate.updateMany({ where: validWhere(p.id, course.id, now), data: { revokedAt: now, revokedReason: 'Replaced by a new certificate' } });
    const hasQuiz = state.lessons.some((l) => l.kind === 'QUIZ');
    const moduleIds = state.modules.length > 0 ? doneModuleIds(state) : null;
    for (let i = 0; ; i++) {
      try {
        const c = await db.trainingCertificate.create({
          data: {
            code: newCertificateCode(),
            userId: p.id,
            courseId: course.id,
            learnerName: p.name.slice(0, 200),
            courseTitle: course.title.slice(0, 160),
            companyId: facts.companyId,
            scorePct: hasQuiz ? state.bestScore : null,
            issuerName: facts.issuerName,
            issuerTitle: course.issuerTitle,
            signatureFileId: course.signatureFileId,
            issuedAt: now,
            completedAt: o.completedAt ?? now,
            ...(moduleIds ? { moduleIds } : {}),
            expiresAt: o.expiresAt !== undefined ? o.expiresAt : course.certificateMonths ? addMonths(now, course.certificateMonths) : null,
          },
          select: { id: true },
        });
        return c.id;
      } catch (err) {
        if (!isUnique(err) || i >= 4) throw err;
      }
    }
  }

  /**
   * The person's certificate for the course: its completion day (default now) and, for a course with modules, the
   * modules it covers. A still-valid certificate is replaced (revoked), unless `keepOld` (D3: the old stays valid).
   */
  async function issueCertificate(p: PersonRecord, course: CourseRow, state: PairState, o: { keepOld?: boolean; completedAt?: Date } = {}): Promise<string> {
    return writeCertificate(prisma, p, course, state, await certificateFacts(p, course), o);
  }

  /**
   * 1.23.30: each module done in this cycle and not recorded yet is recorded (`training_module_done`, LEARNED) —
   * once, even with two requests at the same moment (INSERT IGNORE on person × module); a retake's older record
   * is moved to the new day (one UPDATE, only while still older than the retake). The first module this call
   * recorded is returned ("Other lessons" is never recorded).
   */
  async function recordModules(userId: string, courseId: string, state: PairState): Promise<{ id: string; title: string } | null> {
    const since = cycleStart(state.enrolment);
    let first: { id: string; title: string } | null = null;
    for (const u of state.units) {
      if (u.status !== 'DONE' || u.unitId === OTHER_UNIT) continue;
      const doneAt = u.doneAt ?? ctx.clock();
      let wrote = 0;
      if (u.recordedAt === null) {
        wrote = (await prisma.trainingModuleDone.createMany({ data: [{ userId, courseId, moduleId: u.unitId, doneAt, via: 'LEARNED' }], skipDuplicates: true })).count;
      } else if (since && u.recordedAt.getTime() < since.getTime()) {
        wrote = (await prisma.trainingModuleDone.updateMany({ where: { userId, moduleId: u.unitId, doneAt: { lt: since } }, data: { doneAt, via: 'LEARNED' } })).count;
      }
      if (wrote > 0 && !first) first = { id: u.unitId, title: u.unit.title };
    }
    return first;
  }

  /**
   * The done modules' times for a certificate with no module list: done at the earlier of its lessons' last done
   * time and its record, and when its oldest lesson was made (doing a lesson again moves its done time, so whether
   * the module held a lesson when the certificate was issued is what tells it was finished for that certificate).
   */
  async function unitTimes(units: PairState['units']): Promise<{ unitId: string; doneAt: Date | null; firstLessonAt: Date | null }[]> {
    const lessonIds = units.flatMap((u) => u.unit.lessonIds);
    const made = new Map((lessonIds.length ? await prisma.trainingLesson.findMany({ where: { id: { in: lessonIds } }, select: { id: true, createdAt: true } }) : []).map((l) => [l.id, l.createdAt.getTime()]));
    const earliest = (list: (number | null | undefined)[]) => {
      const times = list.filter((t): t is number => typeof t === 'number');
      return times.length ? new Date(Math.min(...times)) : null;
    };
    return units.map((u) => ({ unitId: u.unitId, doneAt: earliest([u.doneAt?.getTime(), u.recordedAt?.getTime()]), firstLessonAt: earliest(u.unit.lessonIds.map((id) => made.get(id))) }));
  }

  /**
   * D3: a finished course whose person now has every module of a grown role done — an updated certificate when their
   * newest certificate for the course (whatever its state) is valid and doesn't cover those modules. Revoked (a
   * manager's decision) or expired: nothing. The new one keeps the old one's expiry (one cycle, one expiry) and the
   * old one stays valid. One at a time per person and course: the enrolment row is locked first, and the newest
   * certificate read again behind the lock.
   */
  async function updatedCertificate(userId: string, course: CourseRow, state: PairState, person: PersonRecord | null | undefined): Promise<string | null> {
    const units = state.units.filter((u) => u.status === 'DONE' && u.unitId !== OTHER_UNIT);
    let times: Awaited<ReturnType<typeof unitTimes>> | null = null;
    /** The certificate to update (its expiry), or null when there is nothing to do. */
    const toUpdate = async (db: Db): Promise<{ expiresAt: Date | null } | null> => {
      const c = await db.trainingCertificate.findFirst({
        where: { userId, courseId: course.id },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        select: { moduleIds: true, issuedAt: true, revokedAt: true, expiresAt: true },
      });
      if (!c || certificateStatus(c, ctx.clock()) !== 'VALID') return null;
      const moduleIds = c.moduleIds === null ? null : stringList(c.moduleIds);
      const done = moduleIds ? units.map((u) => ({ unitId: u.unitId, doneAt: u.doneAt })) : (times ??= await unitTimes(units));
      return certificateCoversUnits({ moduleIds, issuedAt: c.issuedAt }, done) ? null : { expiresAt: c.expiresAt };
    };
    if (!(await toUpdate(prisma))) return null;
    const p = person === undefined ? await ctx.person(userId) : person;
    if (!p) return null;
    const facts = await certificateFacts(p, course);
    const enrolmentId = state.enrolment!.id;
    return withRowLock(
      prisma,
      (tx) => tx.$queryRaw`SELECT id FROM training_enrolments WHERE id = ${enrolmentId} FOR UPDATE`,
      async (tx) => {
        const old = await toUpdate(tx);
        return old ? writeCertificate(tx, p, course, state, facts, { keepOld: true, expiresAt: old.expiresAt }) : null;
      },
    );
  }

  /**
   * One person's course after their lessons (or the course's lessons) changed: the modules newly done recorded
   * (1.23.30), R9 completion (once, even with two requests at the same moment; a course with modules: every module
   * the person sees), R11 review done, D3 an updated certificate when a finished person's grown role is done too,
   * else the saved % kept up to date (`touch`: and the last activity, when the person did something). `person` is
   * read only when a certificate is due. `moduleDone`: the module this call recorded (the first one).
   */
  async function settle(
    userId: string,
    course: CourseRow,
    state: PairState,
    o: { person?: PersonRecord | null; touch?: boolean } = {},
  ): Promise<{ courseCompleted: boolean; certificateId: string | null; moduleDone: { id: string; title: string } | null }> {
    const person = o.person;
    const e = state.enrolment;
    const now = ctx.clock();
    const status = state.state.status;
    let courseCompleted = status === 'COMPLETED';
    let certificateId: string | null = null;
    if (!e) return { courseCompleted, certificateId, moduleDone: null };
    const moduleDone = await recordModules(userId, course.id, state);
    if (status !== 'COMPLETED' && status !== 'REVIEW' && finishedAll(course.completionRule, state)) {
      const where = retakeActive(e) ? { id: e.id, completedAt: { lt: e.retakeFrom! } } : { id: e.id, completedAt: null };
      const won = await prisma.trainingEnrolment.updateMany({
        where,
        data: { completedAt: now, completedVersion: course.version, progressPct: 100, reviewFrom: null, reviewDueDay: null, reviewDoneAt: null, lastActivityAt: now },
      });
      if (won.count === 1) {
        courseCompleted = true;
        if (course.certificateOn) {
          const p = person === undefined ? await ctx.person(userId) : person;
          if (p) certificateId = await issueCertificate(p, course, state);
        }
      }
    } else if (status === 'REVIEW' && reviewPending(state.lessons, e, state.done).length === 0) {
      await prisma.trainingEnrolment.updateMany({ where: { id: e.id, reviewDoneAt: null }, data: { reviewDoneAt: now, completedVersion: course.version, lastActivityAt: now } });
      courseCompleted = true;
    } else if (status === 'COMPLETED' && course.certificateOn && state.modules.length > 0 && allUnitsDone(state.units)) {
      certificateId = await updatedCertificate(userId, course, state, person);
    } else if (status !== 'COMPLETED' && status !== 'REVIEW' && (o.touch || e.progressPct !== state.state.progressPct)) {
      // One UPDATE statement (MariaDB error 1020 on update()'s read-then-write when two requests race).
      await prisma.trainingEnrolment.updateMany({ where: { id: e.id }, data: { progressPct: state.state.progressPct, ...(o.touch ? { lastActivityAt: now } : {}) } });
    }
    return { courseCompleted, certificateId, moduleDone };
  }

  /**
   * The conversion (1.23.30): a person whose modules are all done is finished on `completedAt` (the day of their
   * last module), quietly — no notice — with the certificate when the course gives one. Nothing happens when they
   * are already finished (or reviewing), or still have something to do.
   */
  async function completeAt(userId: string, course: CourseRow, state: PairState, completedAt: Date, person: PersonRecord): Promise<{ completed: boolean; certificateId: string | null }> {
    const e = state.enrolment;
    const status = state.state.status;
    const nothing = { completed: false, certificateId: null };
    if (!e || status === 'COMPLETED' || status === 'REVIEW' || !finishedAll(course.completionRule, state)) return nothing;
    await recordModules(userId, course.id, state);
    const where = retakeActive(e) ? { id: e.id, completedAt: { lt: e.retakeFrom! } } : { id: e.id, completedAt: null };
    const won = await prisma.trainingEnrolment.updateMany({
      where,
      data: { completedAt, completedVersion: course.version, progressPct: 100, reviewFrom: null, reviewDueDay: null, reviewDoneAt: null },
    });
    if (won.count !== 1) return nothing;
    return { completed: true, certificateId: course.certificateOn ? await issueCertificate(person, course, state, { completedAt }) : null };
  }

  /**
   * R3: everyone part-way through these courses (or retaking, or reviewing) is looked at again: finished when
   * every lesson left is done. People already finished are never touched; withdrawn enrolments are left alone.
   */
  async function recheck(courseIds: readonly string[]): Promise<{ finished: number }> {
    let finished = 0;
    for (const courseId of [...new Set(courseIds)]) {
      const course = await prisma.trainingCourse.findUnique({ where: { id: courseId }, select: COURSE });
      // Review I1: only a course people can take finishes them (a draft being reworked waits for its Publish).
      if (!course || course.status !== 'PUBLISHED') continue;
      const open = await prisma.trainingEnrolment.findMany({
        where: { courseId, withdrawnAt: null, OR: [{ completedAt: null }, { retakeFrom: { not: null } }, { reviewFrom: { not: null }, reviewDoneAt: null }] },
        select: { userId: true },
      });
      for (const part of chunks(open.map((e) => e.userId), 200)) {
        const states = await loadStates(ctx, part.map((userId) => ({ userId, courseId })));
        for (const userId of part) {
          const state = states.get(pairKey(userId, courseId));
          if (!state || state.state.status === 'COMPLETED') continue;
          try {
            const out = await settle(userId, course, state);
            if (out.courseCompleted) finished++;
          } catch (err) {
            ctx.logger?.warn('training: finishing could not be checked for one person', { courseId, userId, err: String((err as Error)?.message ?? err) });
          }
        }
      }
    }
    return { finished };
  }

  return { issueCertificate, settle, completeAt, recheck };
}

export type TrainingFinish = ReturnType<typeof createTrainingFinish>;
