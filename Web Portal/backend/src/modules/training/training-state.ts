import type { CompletionRule, EnrolmentStatus, LessonKind } from './training-types';

/**
 * A person's state on a course (rulings R6, R9, R10, R11), pure: status, progress, mandatory and due
 * day from the active assignments, overdue by the site's today, the completion rules, a review after a
 * Major change and a retake after a certificate expired.
 */

export interface AssigneeTerms {
  mandatory: boolean;
  dueDay: string | null;
  withdrawnAt: Date | null;
}

export interface Terms {
  assigned: boolean;
  mandatory: boolean;
  dueDay: string | null;
}

/** R6: mandatory if any active assignment is; due = the earliest active due day (mandatory ones first). */
export function assignmentTerms(rows: readonly AssigneeTerms[]): Terms {
  const active = rows.filter((r) => r.withdrawnAt === null);
  if (active.length === 0) return { assigned: false, mandatory: false, dueDay: null };
  const mandatory = active.some((r) => r.mandatory);
  const earliest = (list: readonly AssigneeTerms[]) =>
    list
      .map((r) => r.dueDay)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const dueDay = (mandatory ? earliest(active.filter((r) => r.mandatory)) : null) ?? earliest(active);
  return { assigned: true, mandatory, dueDay };
}

export interface LessonFacts {
  id: string;
  kind: LessonKind;
  /** The course version a Major change last changed it in. */
  changedVersion: number;
}

export interface EnrolmentFacts {
  startedAt: Date | null;
  completedAt: Date | null;
  completedVersion: number | null;
  reviewFrom: Date | null;
  reviewDueDay: string | null;
  reviewDoneAt: Date | null;
  retakeFrom: Date | null;
  withdrawnAt: Date | null;
}

/** R9: every lesson done (a quiz when passed); QUIZZES: every quiz passed (no quizzes: every lesson). */
export function isCourseComplete(rule: CompletionRule | string, lessons: readonly LessonFacts[], doneIds: ReadonlySet<string>): boolean {
  if (lessons.length === 0) return false;
  const quizzes = lessons.filter((l) => l.kind === 'QUIZ');
  const needed = rule === 'QUIZZES' && quizzes.length > 0 ? quizzes : lessons;
  return needed.every((l) => doneIds.has(l.id));
}

/** R10: the certificate expired and the course isn't finished again since: lessons count only from then. */
export function retakeActive(e: EnrolmentFacts | null): boolean {
  return !!e?.retakeFrom && (!e.completedAt || e.completedAt.getTime() < e.retakeFrom.getTime());
}

/** The moment lessons count from (the retake's), or null (every time they were done). */
export function cycleStart(e: EnrolmentFacts | null): Date | null {
  return retakeActive(e) ? e!.retakeFrom : null;
}

/** Lessons done in the current cycle: `done` maps a lesson to when it was last done. */
export function doneInCycle(lessons: readonly LessonFacts[], done: ReadonlyMap<string, Date>, e: EnrolmentFacts | null): Set<string> {
  const since = cycleStart(e);
  return new Set(lessons.filter((l) => {
    const at = done.get(l.id);
    return !!at && (!since || at.getTime() >= since.getTime());
  }).map((l) => l.id));
}

/** R11: the lessons changed by a Major change since they finished, not done again since the review began. */
export function reviewPending(lessons: readonly LessonFacts[], e: EnrolmentFacts | null, done: ReadonlyMap<string, Date>): string[] {
  if (!e?.reviewFrom || e.reviewDoneAt || !e.completedAt) return [];
  const from = e.reviewFrom.getTime();
  return lessons
    .filter((l) => l.changedVersion > (e.completedVersion ?? 0))
    .filter((l) => {
      const at = done.get(l.id);
      return !at || at.getTime() < from;
    })
    .map((l) => l.id);
}

export interface CourseStateInput {
  enrolment: EnrolmentFacts | null;
  lessons: readonly LessonFacts[];
  done: ReadonlyMap<string, Date>;
  terms: Terms;
  /** The site's today ('YYYY-MM-DD'). */
  today: string;
  /** R10: a mandatory retake's due day (the expiry day); null otherwise. */
  retakeDueDay: string | null;
}

export interface CourseState extends Terms {
  status: EnrolmentStatus;
  progressPct: number;
  overdue: boolean;
}

export function courseState(i: CourseStateInput): CourseState {
  const e = i.enrolment;
  const doneIds = doneInCycle(i.lessons, i.done, e);
  const pct = i.lessons.length ? Math.floor((doneIds.size / i.lessons.length) * 100) : 0;
  let status: EnrolmentStatus;
  let dueDay: string | null;
  let progressPct = pct;
  if (retakeActive(e)) {
    status = 'RETAKE';
    dueDay = i.retakeDueDay ?? i.terms.dueDay;
  } else if (e?.completedAt) {
    progressPct = 100;
    if (e.reviewFrom && !e.reviewDoneAt) {
      status = 'REVIEW';
      dueDay = e.reviewDueDay;
    } else {
      status = 'COMPLETED';
      dueDay = null;
    }
  } else {
    status = e?.startedAt || doneIds.size > 0 ? 'IN_PROGRESS' : 'NOT_STARTED';
    dueDay = i.terms.dueDay;
  }
  const overdue = status !== 'COMPLETED' && !!dueDay && dueDay < i.today;
  return { status, progressPct, assigned: i.terms.assigned, mandatory: i.terms.mandatory, dueDay, overdue };
}

export interface OutlineItem {
  id: string;
  done: boolean;
  locked: boolean;
  review: boolean;
}

/** The lessons as the person sees them: done, locked (in order), to review; and the lesson Resume opens. */
export function lessonOutline(i: { lessons: readonly LessonFacts[]; inOrder: boolean; enrolment: EnrolmentFacts | null; done: ReadonlyMap<string, Date> }): { items: OutlineItem[]; resumeLessonId: string | null } {
  const doneIds = doneInCycle(i.lessons, i.done, i.enrolment);
  const review = new Set(reviewPending(i.lessons, i.enrolment, i.done));
  const completed = !!i.enrolment?.completedAt && !retakeActive(i.enrolment);
  let blocked = false;
  const items = i.lessons.map((l) => {
    const item = { id: l.id, done: doneIds.has(l.id), locked: i.inOrder && blocked && !completed, review: review.has(l.id) };
    if (!item.done) blocked = true;
    return item;
  });
  const next = items.find((x) => x.review) ?? items.find((x) => !x.done && !x.locked);
  return { items, resumeLessonId: next?.id ?? items[0]?.id ?? null };
}
