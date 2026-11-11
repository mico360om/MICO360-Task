import type { TrainingEnrolment } from '@prisma/client';
import type { TrainingContext } from './training-context';
import { assignmentTerms, courseState, cycleStart, doneInCycle, retakeActive, type CourseState, type LessonFacts, type Terms } from './training-state';
import type { LessonKind } from './training-types';

/**
 * Reading people's state on courses in a few queries (My training, the catalogue's cards, a course,
 * reports, reminders): the enrolment, the lessons, when each lesson was last done, the active
 * assignments' terms (R6), the state (R9–R11) and the best quiz scores of the current cycle.
 */

export interface PairState {
  userId: string;
  courseId: string;
  enrolment: TrainingEnrolment | null;
  lessons: (LessonFacts & { position: number; title: string; minutes: number })[];
  /** When each lesson was last done (any cycle). */
  done: Map<string, Date>;
  /** Lessons done in the current cycle (a retake counts from its start). */
  doneIds: Set<string>;
  terms: Terms;
  state: CourseState;
  /** The average of the best score on each quiz tried in this cycle; null: none tried. */
  bestScore: number | null;
  /** Best attempt per quiz lesson in this cycle. */
  best: Map<string, { scorePct: number; passed: boolean }>;
  /** Handed-in attempts per quiz lesson in this cycle. */
  attemptsUsed: Map<string, number>;
}

export const pairKey = (userId: string, courseId: string) => `${userId}|${courseId}`;

export async function loadStates(ctx: TrainingContext, pairs: readonly { userId: string; courseId: string }[]): Promise<Map<string, PairState>> {
  const out = new Map<string, PairState>();
  if (pairs.length === 0) return out;
  const { prisma } = ctx;
  const userIds = [...new Set(pairs.map((p) => p.userId))];
  const courseIds = [...new Set(pairs.map((p) => p.courseId))];
  const wanted = new Set(pairs.map((p) => pairKey(p.userId, p.courseId)));
  const [enrolments, lessons, progress, assignees, attempts] = await Promise.all([
    prisma.trainingEnrolment.findMany({ where: { userId: { in: userIds }, courseId: { in: courseIds } } }),
    prisma.trainingLesson.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, courseId: true, kind: true, changedVersion: true, position: true, title: true, minutes: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.trainingProgress.findMany({ where: { userId: { in: userIds }, courseId: { in: courseIds }, doneAt: { not: null } }, select: { userId: true, lessonId: true, doneAt: true } }),
    prisma.trainingAssignee.findMany({ where: { userId: { in: userIds }, courseId: { in: courseIds }, withdrawnAt: null }, select: { userId: true, courseId: true, mandatory: true, dueDay: true, withdrawnAt: true } }),
    prisma.trainingAttempt.findMany({ where: { userId: { in: userIds }, courseId: { in: courseIds }, submittedAt: { not: null } }, select: { userId: true, courseId: true, lessonId: true, scorePct: true, passed: true, submittedAt: true } }),
  ]);
  const enrolmentOf = new Map(enrolments.map((e) => [pairKey(e.userId, e.courseId), e]));
  const lessonsOf = new Map<string, PairState['lessons']>();
  for (const l of lessons) {
    const list = lessonsOf.get(l.courseId) ?? [];
    list.push({ id: l.id, kind: l.kind as LessonKind, changedVersion: l.changedVersion, position: l.position, title: l.title, minutes: l.minutes });
    lessonsOf.set(l.courseId, list);
  }
  const doneOf = new Map<string, Map<string, Date>>();
  for (const p of progress) {
    const m = doneOf.get(p.userId) ?? new Map<string, Date>();
    m.set(p.lessonId, p.doneAt!);
    doneOf.set(p.userId, m);
  }
  const today = ctx.today();
  for (const key of wanted) {
    const [userId, courseId] = key.split('|') as [string, string];
    const enrolment = enrolmentOf.get(key) ?? null;
    const courseLessons = lessonsOf.get(courseId) ?? [];
    const allDone = doneOf.get(userId) ?? new Map<string, Date>();
    const done = new Map([...allDone].filter(([lessonId]) => courseLessons.some((l) => l.id === lessonId)));
    const terms = assignmentTerms(assignees.filter((a) => a.userId === userId && a.courseId === courseId));
    const retakeDueDay = retakeActive(enrolment) && terms.mandatory ? ctx.dayOf(enrolment!.retakeFrom!) : null;
    const state = courseState({ enrolment, lessons: courseLessons, done, terms, today, retakeDueDay });
    const since = cycleStart(enrolment);
    const best = new Map<string, { scorePct: number; passed: boolean }>();
    const attemptsUsed = new Map<string, number>();
    for (const a of attempts) {
      if (a.userId !== userId || a.courseId !== courseId) continue;
      if (since && a.submittedAt!.getTime() < since.getTime()) continue;
      attemptsUsed.set(a.lessonId, (attemptsUsed.get(a.lessonId) ?? 0) + 1);
      const b = best.get(a.lessonId);
      const score = a.scorePct ?? 0;
      if (!b || score > b.scorePct) best.set(a.lessonId, { scorePct: score, passed: !!a.passed || !!b?.passed });
      else if (a.passed) b.passed = true;
    }
    const scores = [...best.values()].map((b) => b.scorePct);
    out.set(key, {
      userId,
      courseId,
      enrolment,
      lessons: courseLessons,
      done,
      doneIds: doneInCycle(courseLessons, done, enrolment),
      terms,
      state,
      bestScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null,
      best,
      attemptsUsed,
    });
  }
  return out;
}

/** One person on one course. */
export async function loadState(ctx: TrainingContext, userId: string, courseId: string): Promise<PairState> {
  return (await loadStates(ctx, [{ userId, courseId }])).get(pairKey(userId, courseId))!;
}
