import { describe, expect, it } from 'vitest';
import { assignmentTerms, courseState, isCourseComplete, lessonOutline, lessonSince, reviewPending, type EnrolmentFacts, type LessonFacts } from './training-state';

const t = (iso: string) => new Date(`${iso}T10:00:00.000Z`);
const L = (id: string, kind: LessonFacts['kind'] = 'GUIDE', changedVersion = 1): LessonFacts => ({ id, kind, changedVersion });
const lessons = [L('a'), L('b', 'VIDEO'), L('q', 'QUIZ')];
const enr = (o: Partial<EnrolmentFacts> = {}): EnrolmentFacts => ({
  startedAt: null,
  completedAt: null,
  completedVersion: null,
  reviewFrom: null,
  reviewDueDay: null,
  reviewDoneAt: null,
  retakeFrom: null,
  withdrawnAt: null,
  ...o,
});
const done = (pairs: Record<string, string>) => new Map(Object.entries(pairs).map(([k, v]) => [k, t(v)]));
const today = '2026-11-11';
const none = { assigned: false, mandatory: false, dueDay: null };

describe('R6 mandatory and due day from the active assignments', () => {
  it('mandatory when any active one is; the earliest mandatory due day first', () => {
    expect(assignmentTerms([])).toEqual({ assigned: false, mandatory: false, dueDay: null });
    expect(
      assignmentTerms([
        { mandatory: false, dueDay: '2026-11-12', withdrawnAt: null },
        { mandatory: true, dueDay: '2026-11-20', withdrawnAt: null },
        { mandatory: true, dueDay: '2026-11-15', withdrawnAt: null },
        { mandatory: true, dueDay: '2026-11-01', withdrawnAt: t('2026-11-02') },
      ]),
    ).toEqual({ assigned: true, mandatory: true, dueDay: '2026-11-15' });
    expect(assignmentTerms([{ mandatory: false, dueDay: '2026-11-12', withdrawnAt: null }, { mandatory: false, dueDay: null, withdrawnAt: null }])).toEqual({ assigned: true, mandatory: false, dueDay: '2026-11-12' });
    expect(assignmentTerms([{ mandatory: true, dueDay: null, withdrawnAt: null }, { mandatory: false, dueDay: '2026-11-12', withdrawnAt: null }])).toEqual({ assigned: true, mandatory: true, dueDay: '2026-11-12' });
    expect(assignmentTerms([{ mandatory: true, dueDay: '2026-11-12', withdrawnAt: t('2026-11-01') }])).toEqual({ assigned: false, mandatory: false, dueDay: null });
  });
});

describe('R9 completion rules', () => {
  it('ALL_LESSONS: every lesson done (a quiz when passed)', () => {
    expect(isCourseComplete('ALL_LESSONS', lessons, new Set(['a', 'b']))).toBe(false);
    expect(isCourseComplete('ALL_LESSONS', lessons, new Set(['a', 'b', 'q']))).toBe(true);
  });
  it('QUIZZES: every quiz passed is enough; without quizzes it falls back to every lesson', () => {
    expect(isCourseComplete('QUIZZES', lessons, new Set(['q']))).toBe(true);
    expect(isCourseComplete('QUIZZES', [L('a'), L('q1', 'QUIZ'), L('q2', 'QUIZ')], new Set(['q1']))).toBe(false);
    expect(isCourseComplete('QUIZZES', [L('a'), L('b')], new Set(['a']))).toBe(false);
    expect(isCourseComplete('QUIZZES', [L('a'), L('b')], new Set(['a', 'b']))).toBe(true);
  });
  it('a course without lessons is never complete', () => {
    expect(isCourseComplete('ALL_LESSONS', [], new Set())).toBe(false);
  });
});

describe('the person’s state on a course', () => {
  it('no enrolment: not started; assigned with a due day in the past is overdue', () => {
    const s = courseState({ enrolment: null, lessons, done: new Map(), terms: { assigned: true, mandatory: true, dueDay: '2026-11-10' }, today, retakeDueDay: null });
    expect(s).toMatchObject({ status: 'NOT_STARTED', progressPct: 0, assigned: true, mandatory: true, dueDay: '2026-11-10', overdue: true });
    expect(courseState({ enrolment: null, lessons, done: new Map(), terms: { assigned: true, mandatory: true, dueDay: today }, today, retakeDueDay: null }).overdue).toBe(false);
  });

  it('in progress: the share of lessons done (rounded down)', () => {
    const s = courseState({ enrolment: enr({ startedAt: t('2026-11-01') }), lessons, done: done({ a: '2026-11-02' }), terms: none, today, retakeDueDay: null });
    expect(s).toMatchObject({ status: 'IN_PROGRESS', progressPct: 33, overdue: false });
    // A lesson done counts as started even before the start was saved.
    expect(courseState({ enrolment: enr(), lessons, done: done({ a: '2026-11-02' }), terms: none, today, retakeDueDay: null }).status).toBe('IN_PROGRESS');
  });

  it('completed: 100%, never overdue', () => {
    const s = courseState({ enrolment: enr({ startedAt: t('2026-11-01'), completedAt: t('2026-11-03'), completedVersion: 1 }), lessons, done: done({ a: '2026-11-02', b: '2026-11-02', q: '2026-11-03' }), terms: { assigned: true, mandatory: true, dueDay: '2026-11-02' }, today, retakeDueDay: null });
    expect(s).toMatchObject({ status: 'COMPLETED', progressPct: 100, overdue: false, dueDay: null });
  });

  it('R11 review after a Major change: its own due day; done once the changed lessons are done again', () => {
    const e = enr({ startedAt: t('2026-11-01'), completedAt: t('2026-11-03'), completedVersion: 1, reviewFrom: t('2026-11-05'), reviewDueDay: '2026-11-08' });
    const changed = [L('a'), L('b', 'VIDEO', 2), L('q', 'QUIZ')];
    const s = courseState({ enrolment: e, lessons: changed, done: done({ a: '2026-11-02', b: '2026-11-02', q: '2026-11-03' }), terms: none, today, retakeDueDay: null });
    expect(s).toMatchObject({ status: 'REVIEW', dueDay: '2026-11-08', overdue: true, progressPct: 100 });
    expect(reviewPending(changed, e, done({ b: '2026-11-02' }))).toEqual(['b']);
    expect(reviewPending(changed, e, done({ b: '2026-11-06' }))).toEqual([]);
    expect(courseState({ enrolment: { ...e, reviewDoneAt: t('2026-11-06') }, lessons: changed, done: done({ b: '2026-11-06' }), terms: none, today, retakeDueDay: null }).status).toBe('COMPLETED');
  });

  it('R10 retake after the certificate expired: lessons count again only from then', () => {
    const e = enr({ startedAt: t('2026-01-01'), completedAt: t('2026-01-03'), completedVersion: 1, retakeFrom: t('2026-11-01') });
    const before = done({ a: '2026-01-02', b: '2026-01-02', q: '2026-01-03' });
    const s = courseState({ enrolment: e, lessons, done: before, terms: { assigned: true, mandatory: true, dueDay: null }, today, retakeDueDay: '2026-11-01' });
    expect(s).toMatchObject({ status: 'RETAKE', progressPct: 0, dueDay: '2026-11-01', overdue: true });
    const again = done({ a: '2026-11-05', b: '2026-01-02', q: '2026-01-03' });
    expect(courseState({ enrolment: e, lessons, done: again, terms: none, today, retakeDueDay: null })).toMatchObject({ status: 'RETAKE', progressPct: 33, dueDay: null, overdue: false });
    // Completed again after the retake moment: completed.
    expect(courseState({ enrolment: { ...e, completedAt: t('2026-11-07') }, lessons, done: again, terms: none, today, retakeDueDay: null }).status).toBe('COMPLETED');
  });

  it('I2: an optional retake has no due day (never the old assignment’s), so it is never overdue at once', () => {
    const e = enr({ startedAt: t('2026-01-01'), completedAt: t('2026-01-03'), completedVersion: 1, retakeFrom: t('2026-11-01') });
    const s = courseState({ enrolment: e, lessons, done: new Map(), terms: { assigned: true, mandatory: false, dueDay: '2026-01-10' }, today, retakeDueDay: null });
    expect(s).toMatchObject({ status: 'RETAKE', dueDay: null, overdue: false });
  });

  it('I1: a review is its own cycle for the changed lessons — attempts and lessons count from the review’s start', () => {
    const e = enr({ completedAt: t('2026-11-03'), completedVersion: 1, reviewFrom: t('2026-11-05'), reviewDueDay: '2026-11-19' });
    expect(lessonSince(L('q', 'QUIZ', 2), e)).toEqual(t('2026-11-05'));
    expect(lessonSince(L('a', 'GUIDE', 1), e)).toBeNull();
    expect(lessonSince(L('q', 'QUIZ', 2), { ...e, reviewDoneAt: t('2026-11-06') })).toBeNull();
    // A retake counts every lesson from its start.
    const r = enr({ completedAt: t('2026-01-03'), completedVersion: 1, retakeFrom: t('2026-11-01') });
    expect(lessonSince(L('a'), r)).toEqual(t('2026-11-01'));
    expect(lessonSince(L('a'), null)).toBeNull();
  });

  it('a withdrawn enrolment keeps its progress (it is only hidden from My training)', () => {
    expect(courseState({ enrolment: enr({ startedAt: t('2026-11-01'), withdrawnAt: t('2026-11-02') }), lessons, done: done({ a: '2026-11-02' }), terms: none, today, retakeDueDay: null }).status).toBe('IN_PROGRESS');
  });
});

describe('the lesson list', () => {
  it('in order: a lesson opens only when every lesson before it is done; resume = the first not done', () => {
    const out = lessonOutline({ lessons, inOrder: true, enrolment: enr({ startedAt: t('2026-11-01') }), done: done({ a: '2026-11-02' }) });
    expect(out.items.map((i) => [i.id, i.done, i.locked])).toEqual([
      ['a', true, false],
      ['b', false, false],
      ['q', false, true],
    ]);
    expect(out.resumeLessonId).toBe('b');
    const free = lessonOutline({ lessons, inOrder: false, enrolment: null, done: new Map() });
    expect(free.items.every((i) => !i.locked)).toBe(true);
    expect(free.resumeLessonId).toBe('a');
    const all = lessonOutline({ lessons, inOrder: true, enrolment: null, done: done({ a: '2026-11-02', b: '2026-11-02', q: '2026-11-02' }) });
    expect(all.resumeLessonId).toBe('a');
  });

  it('marks the lessons to review after a Major change', () => {
    const e = enr({ completedAt: t('2026-11-03'), completedVersion: 1, reviewFrom: t('2026-11-05'), reviewDueDay: '2026-11-08' });
    const out = lessonOutline({ lessons: [L('a'), L('b', 'VIDEO', 2)], inOrder: true, enrolment: e, done: done({ a: '2026-11-02', b: '2026-11-02' }) });
    expect(out.items.map((i) => [i.id, i.done, i.review, i.locked])).toEqual([
      ['a', true, false, false],
      ['b', true, true, false],
    ]);
    expect(out.resumeLessonId).toBe('b');
  });
});
