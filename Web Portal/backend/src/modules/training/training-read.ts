import type { TrainingEnrolment } from '@prisma/client';
import type { TrainingContext } from './training-context';
import { assignmentTerms, courseState, cycleStart, doneInCycle, lessonSince, retakeActive, type CourseState, type LessonFacts, type Terms } from './training-state';
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

/** Lists split for `IN (…)` queries. */
function chunks<T>(list: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export async function loadStates(ctx: TrainingContext, pairs: readonly { userId: string; courseId: string }[]): Promise<Map<string, PairState>> {
  const out = new Map<string, PairState>();
  if (pairs.length === 0) return out;
  const { prisma } = ctx;
  const userIds = [...new Set(pairs.map((p) => p.userId))];
  const courseIds = [...new Set(pairs.map((p) => p.courseId))];
  const wanted = new Set(pairs.map((p) => pairKey(p.userId, p.courseId)));
  // I3: every row read once (people in pieces), then indexed by its person × course.
  const lessons = await prisma.trainingLesson.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, courseId: true, kind: true, changedVersion: true, position: true, title: true, minutes: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  const enrolmentOf = new Map<string, TrainingEnrolment>();
  const doneOf = new Map<string, Map<string, Date>>();
  const assigneesOf = new Map<string, { mandatory: boolean; dueDay: string | null; withdrawnAt: Date | null }[]>();
  const attemptsOf = new Map<string, { lessonId: string; scorePct: number | null; passed: boolean | null; submittedAt: Date | null }[]>();
  for (const part of chunks(userIds)) {
    const where = { userId: { in: part }, courseId: { in: courseIds } };
    const [enrolments, progress, assignees, attempts] = await Promise.all([
      prisma.trainingEnrolment.findMany({ where }),
      prisma.trainingProgress.findMany({ where: { ...where, doneAt: { not: null } }, select: { userId: true, courseId: true, lessonId: true, doneAt: true } }),
      prisma.trainingAssignee.findMany({ where: { ...where, withdrawnAt: null }, select: { userId: true, courseId: true, mandatory: true, dueDay: true, withdrawnAt: true } }),
      prisma.trainingAttempt.findMany({ where: { ...where, submittedAt: { not: null } }, select: { userId: true, courseId: true, lessonId: true, scorePct: true, passed: true, submittedAt: true } }),
    ]);
    for (const e of enrolments) enrolmentOf.set(pairKey(e.userId, e.courseId), e);
    for (const p of progress) {
      const k = pairKey(p.userId, p.courseId);
      const m = doneOf.get(k) ?? new Map<string, Date>();
      m.set(p.lessonId, p.doneAt!);
      doneOf.set(k, m);
    }
    for (const a of assignees) push(assigneesOf, pairKey(a.userId, a.courseId), a);
    for (const a of attempts) push(attemptsOf, pairKey(a.userId, a.courseId), a);
  }
  const lessonsOf = new Map<string, PairState['lessons']>();
  for (const l of lessons) push(lessonsOf, l.courseId, { id: l.id, kind: l.kind as LessonKind, changedVersion: l.changedVersion, position: l.position, title: l.title, minutes: l.minutes });
  const today = ctx.today();
  for (const key of wanted) {
    const [userId, courseId] = key.split('|') as [string, string];
    const enrolment = enrolmentOf.get(key) ?? null;
    const courseLessons = lessonsOf.get(courseId) ?? [];
    const byId = new Map(courseLessons.map((l) => [l.id, l]));
    const done = new Map([...(doneOf.get(key) ?? new Map<string, Date>())].filter(([lessonId]) => byId.has(lessonId)));
    const terms = assignmentTerms(assigneesOf.get(key) ?? []);
    const retakeDueDay = retakeActive(enrolment) && terms.mandatory ? ctx.dayOf(enrolment!.retakeFrom!) : null;
    const state = courseState({ enrolment, lessons: courseLessons, done, terms, today, retakeDueDay });
    const best = new Map<string, { scorePct: number; passed: boolean }>();
    const attemptsUsed = new Map<string, number>();
    for (const a of attemptsOf.get(key) ?? []) {
      const lesson = byId.get(a.lessonId);
      // I1: a retake counts from its start; a review counts the changed quiz from the review's start.
      const since = lesson ? lessonSince(lesson, enrolment) : cycleStart(enrolment);
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
