import { describe, expect, it } from 'vitest';
import { lessonOutline, nextWay, outlineButtonText, outlineHeading, quizCovers } from './lesson-nav';
import { detail, moduleDetail } from './training-fixtures';

describe('the lesson’s outline beside it (1.23.36: “In this module”)', () => {
  it('a module’s lessons in order: done (tick), the open one current, the rest not started; “1 of 3 done”', () => {
    const o = lessonOutline(moduleDetail(), 't2')!;
    expect(o.scope).toBe('module');
    expect(o.title).toBe('Tasks');
    expect(o.moduleKey).toBe('tasks');
    expect(o.number).toBe(2);
    expect(o.items.map((l) => [l.id, l.done, l.current, l.locked])).toEqual([
      ['t1', true, false, false],
      ['t2', false, true, false],
      ['t3', false, false, false],
    ]);
    expect([o.done, o.total, o.at]).toEqual([1, 3, 1]);
  });

  it('an in-order course: lessons after an unfinished one are locked (never the open one)', () => {
    const o = lessonOutline(detail(), 'l2')!;
    expect(o.items.map((l) => [l.id, l.done, l.current, l.locked])).toEqual([
      ['l1', true, false, false],
      ['l2', false, true, false],
      ['l3', false, false, true],
      ['l4', false, false, true],
    ]);
  });

  it('a course without modules lists the course’s lessons: “In this course”', () => {
    const o = lessonOutline(detail(), 'l2')!;
    expect(o.scope).toBe('course');
    expect(o.title).toBe('Tasks basics');
    expect(o.number).toBe(0);
    expect([o.done, o.total, o.at]).toEqual([1, 4, 1]);
    expect(outlineHeading(o)).toBe('In this course');
    expect(outlineButtonText(o)).toBe('Lessons in this course · 2 of 4');
    expect(outlineHeading(lessonOutline(moduleDetail(), 't2')!)).toBe('In this module');
    expect(outlineButtonText(lessonOutline(moduleDetail(), 't3')!)).toBe('Lessons in this module · 3 of 3');
  });

  it('hidden lessons and modules never appear or count', () => {
    const c = moduleDetail();
    // The server leaves a hidden lesson (a video waiting for its link) out of `lessons`; an id left in a module's list
    // is skipped, never shown as a blank row, and not counted.
    const withHidden = { ...c, modules: c.modules.map((m) => (m.id === 'tk' ? { ...m, lessonIds: ['tk-video', ...m.lessonIds] } : m)) };
    const o = lessonOutline(withHidden, 't2')!;
    expect(o.items.map((l) => l.id)).toEqual(['t1', 't2', 't3']);
    expect([o.done, o.total, o.at]).toEqual([1, 3, 1]);
    // A lesson whose module isn't the person's is never in another module's list.
    const stray = { ...c, lessons: [...c.lessons, { id: 'r1', position: 7, kind: 'GUIDE' as const, title: 'Read a report', minutes: 10, done: false, locked: false, review: false, moduleId: 'rp' }] };
    expect(lessonOutline(stray, 't2')!.items.map((l) => l.id)).toEqual(['t1', 't2', 't3']);
    expect(lessonOutline(stray, 'r1')).toBeNull();
  });

  it('what the quiz covers: the lessons before it in its module (not other quizzes)', () => {
    expect(quizCovers(lessonOutline(moduleDetail(), 't3')!)).toEqual(['Make a task', 'Work on a task']);
    expect(quizCovers(lessonOutline(detail(), 'l4')!)).toEqual(['Welcome', 'Make a task', 'The cheat sheet']);
    expect(quizCovers(lessonOutline(moduleDetail(), 'g1')!)).toEqual([]);
  });
});

describe('the Next button’s words (1.23.36)', () => {
  const c = moduleDetail();
  it('mid-module: “Next: <the next lesson>”', () => {
    expect(nextWay({ course: c, lessonId: 't2', nextLessonId: 't3', doneAfter: false, finishesCourse: false })).toEqual({ kind: 'lesson', label: 'Next: Tasks quiz', lessonId: 't3' });
    expect(nextWay({ course: c, lessonId: 't2', nextLessonId: 't3', doneAfter: true, finishesCourse: false })).toEqual({ kind: 'lesson', label: 'Next: Tasks quiz', lessonId: 't3' });
  });

  it('the last lesson of a module, once done: “Next module: <name>” (before: the next lesson’s title)', () => {
    expect(nextWay({ course: c, lessonId: 't3', nextLessonId: 'k1', doneAfter: true, finishesCourse: false })).toEqual({ kind: 'module', label: 'Next module: Kanban board', lessonId: 'k1' });
    expect(nextWay({ course: c, lessonId: 't3', nextLessonId: 'k1', doneAfter: false, finishesCourse: false })).toEqual({ kind: 'lesson', label: 'Next: Video: the Kanban board', lessonId: 'k1' });
  });

  it('the course’s last lesson: “Back to the course”; the lesson that finishes it: “Finish course”', () => {
    expect(nextWay({ course: c, lessonId: 'k2', nextLessonId: null, doneAfter: true, finishesCourse: false })).toEqual({ kind: 'course', label: 'Back to the course' });
    expect(nextWay({ course: c, lessonId: 'k2', nextLessonId: null, doneAfter: true, finishesCourse: true })).toEqual({ kind: 'finish', label: 'Finish course' });
  });

  it('a course without modules: always the next lesson’s title', () => {
    expect(nextWay({ course: detail(), lessonId: 'l2', nextLessonId: 'l3', doneAfter: true, finishesCourse: false })).toEqual({ kind: 'lesson', label: 'Next: The cheat sheet', lessonId: 'l3' });
  });

  it('before the course has loaded (or a next lesson it doesn’t list): plain “Next lesson”', () => {
    expect(nextWay({ course: undefined, lessonId: 'l2', nextLessonId: 'l3', doneAfter: false, finishesCourse: false })).toEqual({ kind: 'lesson', label: 'Next lesson', lessonId: 'l3' });
    expect(nextWay({ course: c, lessonId: 't2', nextLessonId: 'zz', doneAfter: false, finishesCourse: false })).toEqual({ kind: 'lesson', label: 'Next lesson', lessonId: 'zz' });
  });
});
