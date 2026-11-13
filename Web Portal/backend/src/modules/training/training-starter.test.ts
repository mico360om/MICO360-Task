import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { normalizeStarterCourse, pictureMimeOf, starterAssetsDir } from './training-starter';
import type { StarterCourse } from './starter/starter-types';
import { LIMITS } from './training-types';

const base = (over: Partial<StarterCourse> = {}): StarterCourse => ({
  key: 'starter:test',
  title: 'Tasks basics',
  summary: 'Make and finish tasks.',
  moduleKey: 'tasks',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [],
  ...over,
});

describe('starter pictures', () => {
  it('knows a picture’s type from its extension; anything else is not a picture', () => {
    expect(pictureMimeOf('tasks-01.webp')).toBe('image/webp');
    expect(pictureMimeOf('a.PNG')).toBe('image/png');
    expect(pictureMimeOf('a.jpg')).toBe('image/jpeg');
    expect(pictureMimeOf('a.jpeg')).toBe('image/jpeg');
    expect(pictureMimeOf('a.gif')).toBe('image/gif');
    expect(pictureMimeOf('a.svg')).toBeNull();
    expect(pictureMimeOf('a')).toBeNull();
  });

  it('finds the starter assets folder next to the source (or none)', () => {
    const dir = starterAssetsDir();
    if (dir) expect(existsSync(dir)).toBe(true);
    else expect(dir).toBeNull();
  });
});

describe('normalizeStarterCourse: the database never cuts anything silently', () => {
  it('cuts over-long words to the API limits, with a warning each', () => {
    const warnings: string[] = [];
    const c = normalizeStarterCourse(
      base({
        title: 'T'.repeat(200),
        summary: 's'.repeat(2500),
        lessons: [
          {
            kind: 'QUIZ',
            title: 'Q'.repeat(170),
            minutes: 5,
            quiz: {
              passMark: 70,
              maxAttempts: null,
              shuffle: false,
              timeLimitMinutes: null,
              drawCount: null,
              questions: [{ kind: 'SINGLE', prompt: 'p'.repeat(1100), explanation: 'e'.repeat(1100), options: [{ text: 'o'.repeat(400), correct: true, feedback: 'f'.repeat(600) }, { text: 'No', correct: false }] }],
            },
          },
        ],
      }),
      (w) => warnings.push(w),
    );
    expect([...c.title].length).toBe(LIMITS.courseTitle);
    expect(c.summary.length).toBe(LIMITS.courseSummary);
    const l = c.lessons[0]!;
    expect(l.title.length).toBe(LIMITS.lessonTitle);
    if (l.kind !== 'QUIZ') throw new Error('quiz expected');
    const q = l.quiz.questions[0]!;
    expect(q.prompt.length).toBe(LIMITS.questionPrompt);
    expect(q.explanation!.length).toBe(LIMITS.questionExplanation);
    expect(q.options[0]!.text.length).toBe(LIMITS.optionText);
    expect(q.options[0]!.feedback!.length).toBe(LIMITS.optionFeedback);
    expect(warnings.length).toBe(7);
    expect(warnings.every((w) => w.includes('starter:test'))).toBe(true);
  });

  it('cleans rich text (a script never survives) and keeps only what is written', () => {
    const c = normalizeStarterCourse(
      base({
        lessons: [
          {
            kind: 'GUIDE',
            title: 'Guide',
            minutes: 3,
            body: '<p>Hello <script>alert(1)</script><strong>there</strong></p>',
            steps: [
              { title: 'One', body: '<p>Open <em>My Tasks</em>.</p><img src=x onerror=alert(1)>' },
              { title: 'Two', body: '   ' },
            ],
          },
        ],
      }),
      () => {},
    );
    const l = c.lessons[0]!;
    if (l.kind !== 'GUIDE') throw new Error('guide expected');
    expect(l.body).toContain('<strong>there</strong>');
    expect(l.body).not.toContain('script');
    expect(l.steps[0]!.body).toContain('<em>My Tasks</em>');
    expect(l.steps[0]!.body).not.toContain('onerror');
    expect(l.steps[1]!.body).toBe('');
  });

  it('keeps numbers in range: minutes, months, pass mark, attempts, time limit and the draw count', () => {
    const warnings: string[] = [];
    const c = normalizeStarterCourse(
      base({
        certificateOn: true,
        certificateMonths: 500,
        lessons: [
          { kind: 'VIDEO', title: 'Video', minutes: 0, videoUrl: null },
          {
            kind: 'QUIZ',
            title: 'Quiz',
            minutes: 9999,
            quiz: { passMark: 140, maxAttempts: 0, shuffle: true, timeLimitMinutes: 999, drawCount: 9, questions: [{ kind: 'TRUE_FALSE', prompt: 'Sky is blue', options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] }] },
          },
        ],
      }),
      (w) => warnings.push(w),
    );
    expect(c.certificateMonths).toBe(LIMITS.certificateMonthsMax);
    expect(c.lessons[0]!.minutes).toBe(1);
    expect(c.lessons[1]!.minutes).toBe(LIMITS.minutesMax);
    const q = c.lessons[1]!;
    if (q.kind !== 'QUIZ') throw new Error('quiz expected');
    expect(q.quiz.passMark).toBe(100);
    expect(q.quiz.maxAttempts).toBe(1);
    expect(q.quiz.timeLimitMinutes).toBe(LIMITS.timeLimitMax);
    // A draw count larger than the bank means "every question".
    expect(q.quiz.drawCount).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('ORDER questions: every option is part of the answer (their positions are the right order)', () => {
    const c = normalizeStarterCourse(
      base({
        lessons: [
          {
            kind: 'QUIZ',
            title: 'Quiz',
            minutes: 2,
            quiz: { passMark: 70, maxAttempts: null, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [{ kind: 'ORDER', prompt: 'Order', options: [{ text: 'A', correct: false }, { text: 'B', correct: true }, { text: 'C', correct: false }] }] },
          },
        ],
      }),
      () => {},
    );
    const q = c.lessons[0]!;
    if (q.kind !== 'QUIZ') throw new Error('quiz expected');
    expect(q.quiz.questions[0]!.options.map((o) => [o.text, o.correct])).toEqual([
      ['A', true],
      ['B', true],
      ['C', true],
    ]);
  });

  it('too many lessons, steps, questions or options are cut to the limits', () => {
    const warnings: string[] = [];
    const steps = Array.from({ length: LIMITS.stepsPerLesson + 5 }, (_, i) => ({ title: `S${i}`, body: '<p>x</p>' }));
    const options = Array.from({ length: LIMITS.optionsPerQuestion + 2 }, (_, i) => ({ text: `O${i}`, correct: i === 0 }));
    const c = normalizeStarterCourse(
      base({
        lessons: [
          ...Array.from({ length: LIMITS.lessonsPerCourse }, () => ({ kind: 'GUIDE' as const, title: 'G', minutes: 1, steps })),
          { kind: 'QUIZ', title: 'Q', minutes: 1, quiz: { passMark: 70, maxAttempts: null, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [{ kind: 'SINGLE', prompt: 'P', options }] } },
        ],
      }),
      (w) => warnings.push(w),
    );
    expect(c.lessons.length).toBe(LIMITS.lessonsPerCourse);
    const g = c.lessons[0]!;
    if (g.kind !== 'GUIDE') throw new Error('guide expected');
    expect(g.steps.length).toBe(LIMITS.stepsPerLesson);
    expect(warnings.some((w) => /lessons/.test(w))).toBe(true);
  });

  it('1.23.30 modules: kept with each lesson’s module; a long module title is cut; a lesson naming no module of the course has none (warned)', () => {
    const warnings: string[] = [];
    const c = normalizeStarterCourse(
      base({
        modules: [
          { key: 'module:a', title: 'A', moduleKey: 'tasks', from: 'starter:a' },
          { key: 'module:b', title: 'B'.repeat(LIMITS.moduleTitle + 5), moduleKey: 'reports', roleKeys: ['admins'], from: 'starter:b' },
        ],
        lessons: [
          { kind: 'VIDEO', title: 'Video: A', minutes: 2, videoUrl: null, module: 'module:a' },
          { kind: 'GUIDE', title: 'Guide B', minutes: 3, module: 'module:b', steps: [{ title: 'One', body: '<p>One.</p>' }] },
          { kind: 'GUIDE', title: 'Lost', minutes: 3, module: 'module:nowhere', steps: [{ title: 'One', body: '<p>One.</p>' }] },
        ],
      }),
      (w) => warnings.push(w),
    );
    expect(c.modules?.map((m) => [m.key, [...m.title].length, m.moduleKey, m.roleKeys ?? [], m.from])).toEqual([
      ['module:a', 1, 'tasks', [], 'starter:a'],
      ['module:b', LIMITS.moduleTitle, 'reports', ['admins'], 'starter:b'],
    ]);
    expect(c.lessons.map((l) => l.module)).toEqual(['module:a', 'module:b', undefined]);
    expect(warnings.some((w) => /module 2 title/.test(w))).toBe(true);
    expect(warnings.some((w) => /lesson 3.*module:nowhere/.test(w))).toBe(true);
  });
});
