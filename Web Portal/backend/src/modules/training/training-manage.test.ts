import { describe, expect, it } from 'vitest';
import {
  assignmentInputSchema,
  checkCourseShape,
  courseInputSchema,
  fitsText,
  lessonInputSchema,
  normaliseQuestions,
  publishProblems,
  quizInputSchema,
  ruleInputSchema,
  type ProblemLesson,
} from './training-manage';

const guide = (o: Partial<ProblemLesson> = {}): ProblemLesson => ({ title: 'Guide', kind: 'GUIDE', videoId: null, fileId: null, stepCount: 2, quiz: null, ...o });
const quiz = (questions: NonNullable<ProblemLesson['quiz']>['questions'], o: Partial<NonNullable<ProblemLesson['quiz']>> = {}): ProblemLesson =>
  guide({ title: 'Check', kind: 'QUIZ', stepCount: 0, quiz: { passMark: 70, drawCount: null, questions, ...o } });
const opt = (correct: boolean) => ({ correct });

describe('course input', () => {
  it('takes the website’s CourseInput and refuses what doesn’t fit', () => {
    const ok = courseInputSchema.parse({ title: '  Tasks basics ', moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', roleKeys: ['employees'], companyIds: [] });
    expect(ok.title).toBe('Tasks basics');
    expect(() => courseInputSchema.parse({ title: '', moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER' })).toThrow();
    expect(() => courseInputSchema.parse({ title: 'x'.repeat(161), moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER' })).toThrow();
    expect(() => courseInputSchema.parse({ title: 'A', moduleKey: 'nope', audience: 'STAFF', difficulty: 'BEGINNER' })).toThrow();
    expect(() => courseInputSchema.parse({ title: 'A', moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', roleKeys: ['bosses'] })).toThrow();
    expect(() => courseInputSchema.parse({ title: 'A', moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', certificateMonths: 121 })).toThrow();
    expect(() => courseInputSchema.parse({ title: 'A', moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', summary: 'x'.repeat(2001) })).toThrow();
  });

  it('the Client portal module is for clients only', () => {
    expect(() => checkCourseShape({ moduleKey: 'portal', audience: 'STAFF' })).toThrow(/clients/);
    expect(() => checkCourseShape({ moduleKey: 'portal', audience: 'CLIENTS' })).not.toThrow();
    expect(() => checkCourseShape({ moduleKey: 'tasks', audience: 'CLIENTS' })).not.toThrow();
  });

  it('long text is measured in bytes too (MariaDB TEXT holds 65,535 bytes)', () => {
    expect(fitsText('a'.repeat(65_535))).toBe(true);
    expect(fitsText('€'.repeat(30_000))).toBe(false);
    expect(fitsText(null)).toBe(true);
  });
});

describe('lesson, quiz, assignment and rule input', () => {
  it('lessons: kind, title, minutes 1–600', () => {
    expect(lessonInputSchema.parse({ kind: 'VIDEO', title: 'Watch', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }).kind).toBe('VIDEO');
    expect(() => lessonInputSchema.parse({ kind: 'VIDEO', title: 'Watch', minutes: 0 })).toThrow();
    expect(() => lessonInputSchema.parse({ kind: 'SLIDES', title: 'Watch' })).toThrow();
  });

  it('quizzes: limits on marks, attempts, time, options', () => {
    const q = { kind: 'SINGLE', prompt: 'Which?', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] };
    expect(quizInputSchema.parse({ passMark: 70, maxAttempts: null, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [q] }).questions).toHaveLength(1);
    expect(() => quizInputSchema.parse({ passMark: 0, maxAttempts: null, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [] })).toThrow();
    expect(() => quizInputSchema.parse({ passMark: 70, maxAttempts: 51, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [] })).toThrow();
    expect(() => quizInputSchema.parse({ passMark: 70, maxAttempts: null, shuffle: false, timeLimitMinutes: 241, drawCount: null, questions: [] })).toThrow();
    expect(() => quizInputSchema.parse({ passMark: 70, maxAttempts: null, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [{ ...q, options: Array.from({ length: 11 }, () => ({ text: 'x', correct: false })) }] })).toThrow();
  });

  it('assignments: one to twenty courses, a fixed day or N days (not both)', () => {
    expect(assignmentInputSchema.parse({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDays: 14 }).dueDays).toBe(14);
    expect(() => assignmentInputSchema.parse({ courseIds: [], targetKind: 'GROUP', targetId: 'everyone', mandatory: true })).toThrow();
    expect(() => assignmentInputSchema.parse({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDay: '2026-12-01', dueDays: 3 })).toThrow(/either/);
    expect(() => assignmentInputSchema.parse({ courseIds: ['c1'], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDay: '1 Dec' })).toThrow();
    expect(() => assignmentInputSchema.parse({ courseIds: ['c1'], targetKind: 'TEAM', targetId: 'x', mandatory: true })).toThrow();
  });

  it('rules: group, department or company; one to twenty courses', () => {
    expect(ruleInputSchema.parse({ name: 'New staff', targetKind: 'GROUP', targetId: 'everyone', courseIds: ['c1'], mandatory: true, dueDays: 14 }).name).toBe('New staff');
    expect(() => ruleInputSchema.parse({ name: 'x', targetKind: 'USER', targetId: 'u', courseIds: ['c1'], mandatory: true, dueDays: null })).toThrow();
    expect(() => ruleInputSchema.parse({ name: '', targetKind: 'GROUP', targetId: 'everyone', courseIds: ['c1'], mandatory: true, dueDays: null })).toThrow();
  });
});

describe('quiz questions as stored', () => {
  it('True/False: exactly True and False, the chosen one right', () => {
    const [q] = normaliseQuestions([{ kind: 'TRUE_FALSE', prompt: 'Sky is blue?', options: [{ text: 'false', correct: true, feedback: 'Nope' }, { text: 'true', correct: false }] }]);
    expect(q!.options).toEqual([
      { text: 'True', correct: false, feedback: null },
      { text: 'False', correct: true, feedback: 'Nope' },
    ]);
    const [none] = normaliseQuestions([{ kind: 'TRUE_FALSE', prompt: '?', options: [] }]);
    expect(none!.options.map((o) => o.correct)).toEqual([false, false]);
  });

  it('put-in-order: the given order is the right one (every option marked right)', () => {
    const [q] = normaliseQuestions([{ kind: 'ORDER', prompt: 'Order', options: [{ text: 'One', correct: false }, { text: 'Two', correct: false }] }]);
    expect(q!.options.map((o) => [o.text, o.correct])).toEqual([
      ['One', true],
      ['Two', true],
    ]);
  });
});

describe('publish problems', () => {
  it('none for a ready course', () => {
    expect(publishProblems([guide(), quiz([{ kind: 'SINGLE', prompt: 'A?', options: [opt(true), opt(false)] }])])).toEqual([]);
  });

  it('says what is missing, lesson by lesson', () => {
    expect(publishProblems([])).toEqual(['Add at least one lesson.']);
    // R2 (12 Nov): a video without its link is hidden until it has one; it only matters when nothing else is there.
    expect(publishProblems([guide({ title: 'Watch', kind: 'VIDEO', stepCount: 0 })])).toEqual(['Add a lesson people can see: a video lesson shows only once it has its link.']);
    expect(publishProblems([guide({ title: 'Watch', kind: 'VIDEO', stepCount: 0 }), guide({})])).toEqual([]);
    expect(publishProblems([guide({ title: 'Read', kind: 'DOCUMENT', stepCount: 0 })])).toEqual(['Lesson “Read”: upload its document.']);
    expect(publishProblems([guide({ stepCount: 0 })])).toEqual(['Lesson “Guide”: add at least one step.']);
    expect(publishProblems([quiz([])])).toEqual(['Lesson “Check”: add at least one question.']);
  });

  it('answers that don’t fit the question’s kind; a draw bigger than the bank', () => {
    const problems = publishProblems([
      quiz(
        [
          { kind: 'SINGLE', prompt: 'One right', options: [opt(true), opt(true)] },
          { kind: 'MULTIPLE', prompt: 'Some right', options: [opt(false), opt(false)] },
          { kind: 'TRUE_FALSE', prompt: 'Yes?', options: [opt(false), opt(false)] },
          { kind: 'ORDER', prompt: 'Steps', options: [opt(true)] },
        ],
        { drawCount: 5 },
      ),
    ]);
    expect(problems).toEqual([
      'Lesson “Check”, question 1: mark exactly one right answer (of at least two).',
      'Lesson “Check”, question 2: mark at least one right answer (of at least two).',
      'Lesson “Check”, question 3: say whether True or False is right.',
      'Lesson “Check”, question 4: give at least two steps to put in order.',
      'Lesson “Check”: it draws 5 questions but has only 4.',
    ]);
  });
});
