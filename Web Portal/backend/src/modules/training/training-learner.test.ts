import { describe, expect, it } from 'vitest';
import { movedTarget, offersBuiltIn, orderAssigned, progressBody, resumeLesson, tourShows, watchFallbackSeconds } from './training-learner';
import type { PairState } from './training-read';

const launched = new Date('2026-11-15T00:00:00Z');
const later = new Date('2026-11-20T00:00:00Z');
const earlier = new Date('2026-11-01T00:00:00Z');

describe('R15 the first-time tour', () => {
  const staff = { client: false, createdAt: later, tourDoneAt: null, primaryCompanyId: 'A', companyIds: ['A', 'B'] };
  it('only for accounts made after the Training Center launched, until they finish or skip it', () => {
    expect(tourShows({ ...staff, launchedAt: launched, off: [] })).toBe(true);
    expect(tourShows({ ...staff, launchedAt: null, off: [] })).toBe(false);
    // R20: TRAINING_TOUR_AUTO=off (test servers): never on its own; the person can still replay it.
    expect(tourShows({ ...staff, launchedAt: launched, off: [], auto: false })).toBe(false);
    expect(tourShows({ ...staff, launchedAt: launched, off: [], auto: true })).toBe(true);
    expect(tourShows({ ...staff, createdAt: earlier, launchedAt: launched, off: [] })).toBe(false);
    expect(tourShows({ ...staff, tourDoneAt: later, launchedAt: launched, off: [] })).toBe(false);
  });
  it('staff: their primary company (else their first) switched it off', () => {
    expect(tourShows({ ...staff, launchedAt: launched, off: ['A'] })).toBe(false);
    expect(tourShows({ ...staff, launchedAt: launched, off: ['B'] })).toBe(true);
    expect(tourShows({ ...staff, primaryCompanyId: null, launchedAt: launched, off: ['A'] })).toBe(false);
  });
  it('clients: off only when every company of their projects switched it off', () => {
    const client = { ...staff, client: true, primaryCompanyId: null };
    expect(tourShows({ ...client, launchedAt: launched, off: ['A'] })).toBe(true);
    expect(tourShows({ ...client, launchedAt: launched, off: ['A', 'B'] })).toBe(false);
    expect(tourShows({ ...client, companyIds: [], launchedAt: launched, off: ['A'] })).toBe(true);
  });
});

describe('My training lists', () => {
  it('assigned: mandatory first, then the due day (none last), then the title', () => {
    const card = (title: string, mandatory: boolean, dueDay: string | null) => ({ title, mine: { mandatory, dueDay } });
    const out = orderAssigned([card('B', false, '2026-11-12'), card('C', true, null), card('A', true, '2026-11-20'), card('D', true, '2026-11-13'), card('A2', false, null)]);
    expect(out.map((c) => c.title)).toEqual(['D', 'A', 'C', 'B', 'A2']);
  });
});

describe('lesson details', () => {
  it('“Mark as watched” after half the lesson’s minutes, at least 30 s', () => {
    expect(watchFallbackSeconds(5)).toBe(150);
    expect(watchFallbackSeconds(0)).toBe(30);
    expect(watchFallbackSeconds(1)).toBe(30);
  });
  it('progress saves: whole numbers in range only', () => {
    expect(progressBody.parse({ videoSeconds: 12, videoDuration: 300, watchedPct: 4, stepIndex: 2 })).toEqual({ videoSeconds: 12, videoDuration: 300, watchedPct: 4, stepIndex: 2 });
    expect(progressBody.parse({})).toEqual({});
    for (const bad of [{ videoSeconds: -1 }, { watchedPct: 101 }, { videoSeconds: 1.5 }, { stepIndex: 'x' }, { videoDuration: 0 }, { videoSeconds: 86_401 }]) expect(() => progressBody.parse(bad)).toThrow();
  });
});

describe('1.23.30: old links and Continue', () => {
  it('the conversion record: where an old course or a removed lesson lives now; anything else says nothing', () => {
    const record = { moved: { old1: { courseId: 'one', moduleId: 'tasks' }, old2: { courseId: 'one', moduleId: null }, bad: { moduleId: 'x' }, self: { courseId: 'self', moduleId: null } }, removedLessons: { l1: { courseId: 'one', moduleId: '' } } };
    expect(movedTarget(record, 'moved', 'old1')).toEqual({ courseId: 'one', moduleId: 'tasks' });
    expect(movedTarget(record, 'moved', 'old2')).toEqual({ courseId: 'one', moduleId: null });
    expect(movedTarget(record, 'removedLessons', 'l1')).toEqual({ courseId: 'one', moduleId: null });
    expect(movedTarget(record, 'moved', 'l1')).toBeNull();
    expect(movedTarget(record, 'moved', 'bad')).toBeNull();
    // A course never points at itself (no redirect loop); inherited names aren't entries.
    expect(movedTarget(record, 'moved', 'self')).toBeNull();
    expect(movedTarget(record, 'moved', 'constructor')).toBeNull();
    expect(movedTarget(record, 'moved', 'toString')).toBeNull();
    for (const nothing of [null, undefined, 'x', 3, [], { moved: null }, { moved: 'x' }]) expect(movedTarget(nothing, 'moved', 'old1')).toBeNull();
  });

  it('Continue: a plain course as before; a course with modules: a review first, then where they stopped, then the first lesson', () => {
    const outline = (items: { id: string; review?: boolean }[], resumeLessonId: string | null) => ({ items: items.map((i) => ({ done: false, locked: false, review: false, ...i })), resumeLessonId });
    const state = (o: { modules: boolean; continueAt?: { unitId: string; lessonId: string } | null; lessons?: string[] }) =>
      ({ modules: o.modules ? [{ id: 'm1' }] : [], continueAt: o.continueAt ?? null, lessons: (o.lessons ?? ['a', 'b', 'c']).map((id) => ({ id })) }) as unknown as PairState;
    expect(resumeLesson(state({ modules: false }), outline([{ id: 'a' }, { id: 'b' }], 'b'))).toBe('b');
    expect(resumeLesson(state({ modules: true, continueAt: { unitId: 'm1', lessonId: 'c' } }), outline([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a'))).toBe('c');
    expect(resumeLesson(state({ modules: true, continueAt: { unitId: 'm1', lessonId: 'c' } }), outline([{ id: 'a' }, { id: 'b', review: true }, { id: 'c' }], 'b'))).toBe('b');
    expect(resumeLesson(state({ modules: true, continueAt: null }), outline([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a'))).toBe('a');
    expect(resumeLesson(state({ modules: true, continueAt: null, lessons: [] }), outline([], null))).toBeNull();
  });
});

describe('1.23.34 the built-in course as an optional Up next (offersBuiltIn)', () => {
  const ok = { published: true, learnable: true, listed: false, assigned: false, lessonCount: 20, status: 'NOT_STARTED' as const };
  it('offered to someone with nothing of it yet: published, theirs to take, lessons of theirs', () => {
    expect(offersBuiltIn(ok)).toBe(true);
    // Their progress from before an assignment was withdrawn still counts: offered, part done.
    expect(offersBuiltIn({ ...ok, status: 'IN_PROGRESS' })).toBe(true);
  });
  it('never when it is on their lists already (started, assigned or finished: it is there as it is today)', () => {
    expect(offersBuiltIn({ ...ok, listed: true })).toBe(false);
  });
  it('never as an assignment (it is optional: no Mandatory, no due day)', () => {
    expect(offersBuiltIn({ ...ok, assigned: true })).toBe(false);
  });
  it('finished (or reviewing / retaking a finished course): not offered', () => {
    for (const status of ['COMPLETED', 'REVIEW', 'RETAKE'] as const) expect(offersBuiltIn({ ...ok, status })).toBe(false);
  });
  it('archived, unpublished or not theirs (course or every module hidden): not offered', () => {
    expect(offersBuiltIn({ ...ok, published: false })).toBe(false);
    expect(offersBuiltIn({ ...ok, learnable: false })).toBe(false);
    expect(offersBuiltIn({ ...ok, lessonCount: 0 })).toBe(false);
  });
});
