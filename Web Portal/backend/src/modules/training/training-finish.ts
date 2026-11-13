import { Prisma } from '@prisma/client';
import { addMonths, newCertificateCode } from './training-certificates';
import type { TrainingContext } from './training-context';
import type { PersonRecord } from './prisma-training-store';
import { loadStates, pairKey, type PairState } from './training-read';
import { isCourseComplete, retakeActive, reviewPending } from './training-state';

/**
 * Finishing a course (R9, R11) in one place: when a lesson is done (the learner side), and again for everyone
 * on a course when its lessons changed under them (R3, 12 Nov: a video link cleared, a lesson removed, a
 * starter course upgraded) — anyone who has now done every lesson people can see is finished, once, with the
 * certificate when the course gives one. `completedAt` is never moved for anyone already finished.
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

export function createTrainingFinish(ctx: TrainingContext) {
  const { prisma } = ctx;

  async function issueCertificate(p: PersonRecord, course: CourseRow, state: PairState): Promise<string> {
    const now = ctx.clock();
    const companyId = (ctx.companyOfPerson ? await ctx.companyOfPerson(p.id).catch(() => null) : null) ?? p.primaryCompanyId ?? p.companyIds[0] ?? null;
    const issuer = course.issuerUserId ? await prisma.user.findUnique({ where: { id: course.issuerUserId }, select: { firstName: true, lastName: true, username: true } }) : null;
    // M10: an expired certificate stays EXPIRED (never revoked); only one still valid is replaced (rare: no retake then).
    await prisma.trainingCertificate.updateMany({
      where: { userId: p.id, courseId: course.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { revokedAt: now, revokedReason: 'Replaced by a new certificate' },
    });
    const hasQuiz = state.lessons.some((l) => l.kind === 'QUIZ');
    for (let i = 0; ; i++) {
      try {
        const c = await prisma.trainingCertificate.create({
          data: {
            code: newCertificateCode(),
            userId: p.id,
            courseId: course.id,
            learnerName: p.name.slice(0, 200),
            courseTitle: course.title.slice(0, 160),
            companyId,
            scorePct: hasQuiz ? state.bestScore : null,
            issuerName: issuer ? (`${issuer.firstName} ${issuer.lastName}`.trim() || issuer.username).slice(0, 200) : null,
            issuerTitle: course.issuerTitle,
            signatureFileId: course.signatureFileId,
            issuedAt: now,
            expiresAt: course.certificateMonths ? addMonths(now, course.certificateMonths) : null,
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
   * One person's course after their lessons (or the course's lessons) changed: R9 completion (once, even with
   * two requests at the same moment), R11 review done, else the saved % kept up to date (`touch`: and the last
   * activity, when the person did something). `person` is read only when a certificate is due.
   */
  async function settle(userId: string, course: CourseRow, state: PairState, o: { person?: PersonRecord | null; touch?: boolean } = {}): Promise<{ courseCompleted: boolean; certificateId: string | null }> {
    const person = o.person;
    const e = state.enrolment;
    const now = ctx.clock();
    let courseCompleted = state.state.status === 'COMPLETED';
    let certificateId: string | null = null;
    if (!e) return { courseCompleted, certificateId };
    if (state.state.status !== 'COMPLETED' && state.state.status !== 'REVIEW' && isCourseComplete(course.completionRule, state.lessons, state.doneIds)) {
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
    } else if (state.state.status === 'REVIEW' && reviewPending(state.lessons, e, state.done).length === 0) {
      await prisma.trainingEnrolment.updateMany({ where: { id: e.id, reviewDoneAt: null }, data: { reviewDoneAt: now, completedVersion: course.version, lastActivityAt: now } });
      courseCompleted = true;
    } else if (state.state.status !== 'COMPLETED' && state.state.status !== 'REVIEW' && (o.touch || e.progressPct !== state.state.progressPct)) {
      await prisma.trainingEnrolment.update({ where: { id: e.id }, data: { progressPct: state.state.progressPct, ...(o.touch ? { lastActivityAt: now } : {}) } });
    }
    return { courseCompleted, certificateId };
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

  return { issueCertificate, settle, recheck };
}

export type TrainingFinish = ReturnType<typeof createTrainingFinish>;
