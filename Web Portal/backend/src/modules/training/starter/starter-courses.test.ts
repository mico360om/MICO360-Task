import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { LEGACY_STARTER_KEYS, RETIRED_VIDEO_COURSES, SHORT_COURSE_MODULES, STARTER_COURSES, STARTER_REVISION, USER_TRAINING_KEY } from './starter-courses';
import type { StarterCourse, StarterLesson, StarterQuestion, StarterStep } from './starter-types';
import { normalizeStarterCourse, pictureMimeOf } from '../training-starter';
import { checkTrainingUpload } from '../training-files';
import { LIMITS, MODULE_LABELS } from '../training-types';

/**
 * The shipped starter content, revision 3 (1.23.30): one staff course, "MICO360 Tasks User Training", with a module
 * for each part of the site (built from the eleven 1.23.27 short courses, duplicates removed), and the client guide,
 * which now gives a certificate. Each module opens with its video lesson (waiting for its link), every picture is
 * there (and nothing else is), quizzes are short single choice, and nothing would be cut on loading.
 */

const ASSETS = resolve(__dirname, '../../../../assets/training/starter');

const KEYS = ['starter:user-training', 'starter:portal'];

/** The ten modules in the owner's order: key, title, feature, staff groups, the 1.23.27 short course it replaces. */
const MODULES: [string, string, string, string[], string][] = [
  ['module:getting-started', 'Getting started', 'general', [], 'starter:getting-started'],
  ['module:tasks', 'Tasks', 'tasks', [], 'starter:tasks'],
  ['module:board', 'Kanban board', 'board', [], 'starter:board'],
  ['module:projects', 'Projects', 'projects', [], 'starter:projects'],
  ['module:calendar', 'Calendar', 'calendar', [], 'starter:calendar'],
  ['module:meetings', 'Meetings & minutes', 'meetings', [], 'starter:meetings'],
  ['module:chat', 'Chat', 'chat', [], 'starter:chat'],
  ['module:mico-ai', 'MICO AI', 'mico-ai', [], 'starter:mico-ai'],
  ['module:reports', 'Reports', 'reports', ['admins'], 'starter:reports'],
  ['module:admin', 'Admin settings', 'admin', ['admins'], 'starter:admin'],
];

/**
 * Revision 2 (1.23.27), frozen: each short course's lessons, in the old order. Every one keeps its title in its module,
 * so the conversion (and a starter update) finds it again and everyone's progress on it is kept.
 */
const REVISION_2: [string, string[]][] = [
  ['starter:getting-started', ['Video: Getting started', 'Find your way around', 'Quiz: Getting started']],
  ['starter:tasks', ['Video: Tasks', 'Find and add tasks', 'Work on a task', 'Quiz: Tasks']],
  ['starter:board', ['Video: Kanban board', 'Read the board', 'Move and add cards', 'Quiz: Kanban board']],
  ['starter:meetings', ['Video: Meetings start to finish', 'Plan a meeting', 'Run the meeting and send the minutes', 'Quiz: Meetings & minutes']],
  ['starter:calendar', ['Video: Calendar', 'Use the calendar', 'Quiz: Calendar']],
  ['starter:projects', ['Video: Projects', 'Find your projects', 'Start a new project', 'Quiz: Projects']],
  ['starter:reports', ['Video: Reports and KPIs', 'Read and export reports', 'Quiz: Reports']],
  ['starter:chat', ['Video: Chat', 'Talk with your team', 'Quiz: Chat']],
  ['starter:mico-ai', ['Video: MICO AI', 'Ask MICO AI', 'Quiz: MICO AI']],
  ['starter:admin', ['Video: Admin setup', 'Manage people', 'Company settings', 'Quiz: Admin settings']],
];

const words = (html: string) => html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;

const byKey = (key: string): StarterCourse => {
  const c = STARTER_COURSES.find((x) => x.key === key);
  if (!c) throw new Error(`no course ${key}`);
  return c;
};
const training = (): StarterCourse => byKey(USER_TRAINING_KEY);
const portal = (): StarterCourse => byKey('starter:portal');
const lessonsOf = (module: string): StarterLesson[] => training().lessons.filter((l) => l.module === module);
const guideSteps = (lessons: readonly StarterLesson[]): StarterStep[] => lessons.flatMap((l) => (l.kind === 'GUIDE' ? l.steps : []));
const steps = (c: StarterCourse): StarterStep[] => guideSteps(c.lessons);
const questions = (c: StarterCourse): StarterQuestion[] => c.lessons.flatMap((l) => (l.kind === 'QUIZ' ? l.quiz.questions : []));
const pictures = (c: StarterCourse): string[] => steps(c).flatMap((s) => (s.image ? [s.image] : []));
const referenced = new Set(STARTER_COURSES.flatMap((c) => [...pictures(c), ...(c.resources ?? []).map((r) => r.file)]));
const filesInFolder = readdirSync(ASSETS);

/** Every piece of rich text in a course (lesson introductions and step texts). */
const richTexts = (c: StarterCourse): { where: string; html: string }[] => [
  ...c.lessons.flatMap((l, i) => (l.body ? [{ where: `${c.key} lesson ${i + 1}`, html: l.body }] : [])),
  ...c.lessons.flatMap((l, i) => (l.kind === 'GUIDE' ? l.steps.map((s, j) => ({ where: `${c.key} lesson ${i + 1} step ${j + 1}`, html: s.body })) : [])),
];
/** All the words a learner can read in some lessons, as plain text (tags gone, &amp; read as &). */
const plain = (lessons: readonly StarterLesson[], extra: string[] = []): string =>
  [
    ...extra,
    ...lessons.flatMap((l) => [
      l.title,
      l.body ?? '',
      ...(l.kind === 'GUIDE' ? l.steps.flatMap((s) => [s.title, s.body, s.alt ?? '']) : []),
      ...(l.kind === 'QUIZ' ? l.quiz.questions.flatMap((q) => [q.prompt, q.explanation ?? '', ...q.options.flatMap((o) => [o.text, o.feedback ?? ''])]) : []),
    ]),
  ]
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&');
const courseText = (c: StarterCourse) => plain(c.lessons, [c.title, c.summary, ...(c.modules ?? []).map((m) => m.title)]);

describe('starter content revision 3: the two built-in courses', () => {
  it('revision 3: the combined staff course first (position -1), then the client guide; stable unique keys', () => {
    expect(STARTER_REVISION).toBe(4);
    expect(USER_TRAINING_KEY).toBe('starter:user-training');
    expect(STARTER_COURSES.map((c) => c.key)).toEqual(KEYS);
    expect(training().position).toBe(-1);
  });

  it('the 1.23.24 keys and the retired video courses stay as they are (older sites still have them)', () => {
    expect(LEGACY_STARTER_KEYS).toHaveLength(13);
    for (const [k] of REVISION_2.filter(([x]) => x !== 'starter:getting-started')) expect(LEGACY_STARTER_KEYS).toContain(k);
    expect(LEGACY_STARTER_KEYS).toContain('starter:portal');
    expect(RETIRED_VIDEO_COURSES).toEqual([
      { key: 'starter:video-tasks', into: 'starter:tasks' },
      { key: 'starter:video-meetings', into: 'starter:meetings' },
      { key: 'starter:video-minutes', into: 'starter:meetings' },
    ]);
  });

  it('MICO360 Tasks User Training: published, for staff, general, beginner, every lesson, a certificate that never expires', () => {
    expect(training()).toMatchObject({
      title: 'MICO360 Tasks User Training',
      summary: 'Everything you need to use MICO360 Tasks, one part at a time. You see the parts for your role; finish them all for your certificate.',
      moduleKey: 'general',
      audience: 'STAFF',
      difficulty: 'BEGINNER',
      status: 'PUBLISHED',
      completionRule: 'ALL_LESSONS',
      certificateOn: true,
      certificateMonths: null,
    });
    expect(training().roleKeys ?? []).toEqual([]);
  });

  it('the client guide (D1): for clients, the Client portal, its own certificate now (C3), no modules; nothing else changed', () => {
    expect(portal()).toMatchObject({ title: 'Client portal basics', audience: 'CLIENTS', moduleKey: 'portal', status: 'PUBLISHED', certificateOn: true, certificateMonths: null, completionRule: 'ALL_LESSONS' });
    expect(portal().modules ?? []).toEqual([]);
    expect(portal().lessons.every((l) => l.module === undefined)).toBe(true);
    expect(portal().lessons.map((l) => l.title)).toEqual(['Video: Client portal', 'Your project, tasks and minutes', 'Quiz: Client portal']);
    expect(portal().lessons[1]!.was).toEqual(['Tasks, sign-off and minutes']);
    expect(JSON.stringify(portal())).not.toMatch(/temporary password|6-digit code|Set my password/);
  });

  it('ten modules in the owner’s order, each with its feature, its staff groups and the short course it replaces', () => {
    expect((training().modules ?? []).map((m) => [m.key, m.title, m.moduleKey, m.roleKeys ?? [], m.from])).toEqual(MODULES);
    for (const m of training().modules ?? []) expect(MODULE_LABELS[m.moduleKey], m.key).toBeTruthy();
  });

  it('the conversion’s map: each 1.23.27 short course (in the old order) → its module', () => {
    expect(SHORT_COURSE_MODULES).toEqual(REVISION_2.map(([courseKey]) => ({ courseKey, module: MODULES.find((m) => m[4] === courseKey)![0] })));
  });

  it('every lesson belongs to a module of the course, module by module in the modules’ order', () => {
    const keys = (training().modules ?? []).map((m) => m.key);
    for (const l of training().lessons) expect(keys, l.title).toContain(l.module);
    // The modules' lessons are not interleaved: each module's lessons come together, in the modules' order.
    const runs = training().lessons.map((l) => l.module).filter((m, i, all) => i === 0 || all[i - 1] !== m);
    expect(runs).toEqual(keys);
  });

  it('every 1.23.27 lesson keeps its title, in its module (so a moved lesson keeps its id); titles are unique in the course', () => {
    for (const [courseKey, titles] of REVISION_2) {
      const module = SHORT_COURSE_MODULES.find((s) => s.courseKey === courseKey)!.module;
      expect(lessonsOf(module).map((l) => l.title), module).toEqual(titles);
    }
    const all = training().lessons.map((l) => l.title);
    expect(new Set(all).size).toBe(all.length);
  });

  it('each module: its video first (“Video: …”, no link yet, no words), one or two guides of 4–7 steps with pictures, then one quiz', () => {
    for (const [key] of MODULES) {
      const lessons = lessonsOf(key);
      const kinds = lessons.map((l) => l.kind);
      expect(kinds[0], key).toBe('VIDEO');
      expect(kinds.filter((k) => k === 'VIDEO'), key).toHaveLength(1);
      const v = lessons[0]!;
      if (v.kind === 'VIDEO') {
        expect(v.videoUrl).toBeNull();
        expect(v.body ?? '', key).toBe('');
        expect(v.title, key).toMatch(/^Video: /);
      }
      expect(kinds[kinds.length - 1], key).toBe('QUIZ');
      expect(kinds.filter((k) => k === 'QUIZ'), key).toHaveLength(1);
      const guides = lessons.filter((l) => l.kind === 'GUIDE');
      expect(guides.length, key).toBeGreaterThanOrEqual(1);
      expect(guides.length, key).toBeLessThanOrEqual(2);
      expect(kinds.length, key).toBe(guides.length + 2);
      for (const g of guides) {
        if (g.kind !== 'GUIDE') continue;
        expect(g.steps.length, `${key} ${g.title}`).toBeGreaterThanOrEqual(4);
        expect(g.steps.length, `${key} ${g.title}`).toBeLessThanOrEqual(7);
        expect(g.minutes, `${key} ${g.title}`).toBeGreaterThanOrEqual(3);
        expect(g.minutes, `${key} ${g.title}`).toBeLessThanOrEqual(8);
        expect(g.steps.some((s) => s.image), `${key} ${g.title}`).toBe(true);
      }
      const st = guideSteps(lessons);
      expect(st.filter((s) => s.image).length * 2, key).toBeGreaterThanOrEqual(st.length - 2);
    }
  });

  it('the owner’s ten module videos plus the client one; Meetings start to finish is the long one', () => {
    expect(STARTER_COURSES.flatMap((c) => c.lessons.filter((l) => l.kind === 'VIDEO').map((l) => l.title))).toEqual([
      'Video: Getting started',
      'Video: Tasks',
      'Video: Kanban board',
      'Video: Projects',
      'Video: Calendar',
      'Video: Meetings start to finish',
      'Video: Chat',
      'Video: MICO AI',
      'Video: Reports and KPIs',
      'Video: Admin setup',
      'Video: Client portal',
    ]);
    expect(lessonsOf('module:meetings')[0]!.minutes).toBe(12);
  });

  it('no step longer than 50 words (title included, give or take); no downloads', () => {
    for (const c of STARTER_COURSES) for (const s of steps(c)) expect(words(s.body) + words(s.title), `${c.key}: ${s.title}`).toBeLessThanOrEqual(56);
    for (const c of STARTER_COURSES) expect(c.resources ?? [], c.key).toEqual([]);
  });
});

describe('starter content revision 3: what the modules say', () => {
  it('Getting started: sign in, the Dashboard, the menu, search, notifications, settings and the Learning Hub', () => {
    expect(guideSteps(lessonsOf('module:getting-started')).map((s) => s.title)).toEqual(['Sign in', 'Your Dashboard', 'The side menu', 'Search', 'Notifications', 'Your settings', 'The Learning Hub']);
  });

  it('Getting started → The Learning Hub: the one course, the modules for your role, Continue, a certificate with a QR code; the tour', () => {
    const step = guideSteps(lessonsOf('module:getting-started')).find((s) => s.title === 'The Learning Hub')!;
    const text = plain([{ kind: 'GUIDE', title: '', minutes: 1, steps: [step] }]);
    for (const said of ['MICO360 Tasks User Training', 'your role', 'Continue', 'where you stopped', 'certificate', 'QR code', 'Tour of the site', 'account menu']) expect(text, said).toContain(said);
  });

  it('Getting started → Your settings names Calendar & dates (the week start and time zone, taken from Calendar)', () => {
    const step = guideSteps(lessonsOf('module:getting-started')).find((s) => s.title === 'Your settings')!;
    expect(step.body).toContain('<strong>Calendar &amp; dates</strong>');
    expect(step.body).toMatch(/week starts/);
    expect(step.body).toMatch(/time zone/);
  });

  it('removed as duplicates: Calendar’s week-and-time-zone step, the board’s “+ New task”, the Reports “for administrators” line', () => {
    expect(guideSteps(lessonsOf('module:calendar')).map((s) => s.title)).not.toContain('Your week and time zone');
    const column = guideSteps(lessonsOf('module:board')).find((s) => s.title === 'Add a task to a column')!;
    expect(column.body).not.toMatch(/New task/i);
    const reports = lessonsOf('module:reports').find((l) => l.title === 'Read and export reports')!;
    expect(reports.body ?? '').toBe('');
    expect(plain(lessonsOf('module:reports'))).not.toMatch(/Reports is for administrators/);
  });

  it('the week-start question moved from the Calendar quiz to the Getting started quiz', () => {
    const prompt = 'Where do you choose the day your week starts on?';
    expect(questions({ ...training(), lessons: lessonsOf('module:getting-started') }).map((q) => q.prompt)).toContain(prompt);
    expect(questions({ ...training(), lessons: lessonsOf('module:calendar') }).map((q) => q.prompt)).not.toContain(prompt);
  });

  it('Admin settings uses the 1.23.28 places: Third Party (Clients, Guest contacts), Companies in System Settings, the account menu', () => {
    const company = lessonsOf('module:admin').find((l) => l.title === 'Company settings')!;
    const text = plain([company]);
    for (const said of ['Third Party', 'Clients', 'Guest contacts', 'Companies', 'System Settings', 'Open Companies', 'AI Management', 'Audit Logs', 'Error Log', 'Recycle Bin', 'account menu']) expect(text, said).toContain(said);
    // The quiz names Audit Logs where it is now.
    const quiz = plain(lessonsOf('module:admin').filter((l) => l.kind === 'QUIZ'));
    expect(quiz).toMatch(/Audit Logs, in the account menu/);
  });

  it('the 1.23.28 labels appear: Third Party, Audit Logs, Error Log, Recycle Bin, Calendar & dates', () => {
    const text = courseText(training());
    for (const said of ['Third Party', 'Audit Logs', 'Error Log', 'Recycle Bin', 'Calendar & dates']) expect(text, said).toContain(said);
  });

  it('no real client name (never OXY) and never “short course”, in either course', () => {
    for (const c of STARTER_COURSES) {
      const text = courseText(c);
      expect(text, c.key).not.toMatch(/\bOXY\b/i);
      expect(text, c.key).not.toMatch(/short course/i);
    }
  });

  it('Meetings says what the site does (company time, Drafts, Create task from note, Save draft, the Sent log, Follow up)', () => {
    const text = JSON.stringify(lessonsOf('module:meetings'));
    for (const said of ['company time', 'Drafts', 'Create task from note', 'Save draft', 'Mark as final', '<strong>Sent</strong>', 'From meeting', 'completed by itself', 'Send to … people'])
      expect(text, said).toContain(said);
    expect(text).not.toMatch(/attach a file|time-zone picker|invited you in the bell/i);
  });

  it('Calendar, Chat and MICO AI say what the site shows (checked against the pictures)', () => {
    const calendar = JSON.stringify(lessonsOf('module:calendar'));
    for (const said of ['<strong>Day</strong>', '<strong>+ Task</strong>', 'Change dates']) expect(calendar, said).toContain(said);
    expect(calendar).not.toMatch(/Add a task on this day|Change date(?!s)/);
    expect(JSON.stringify(lessonsOf('module:chat'))).not.toMatch(/reaction, reply and more buttons/);
    expect(JSON.stringify(lessonsOf('module:mico-ai'))).not.toMatch(/How can I help, Omar/);
  });

  it('Chat uses the 1.23.29 words: + (New message) and its Search people… picker, in the step, its picture’s description and the quiz', () => {
    const step = guideSteps(lessonsOf('module:chat')).find((s) => s.title === 'Start a direct message')!;
    expect(step.body).toContain('<strong>+</strong> (<strong>New message</strong>)');
    expect(step.body).toContain('<strong>Search people…</strong>');
    expect(step.image).toBe('chat-direct.webp');
    expect(step.alt).toMatch(/New message/);
    expect(step.alt).toMatch(/Search people…/);
    const quiz = lessonsOf('module:chat').find((l) => l.kind === 'QUIZ')!;
    const q = quiz.kind === 'QUIZ' ? quiz.quiz.questions.find((x) => x.prompt === 'How do you start a direct message?')! : null;
    expect(q?.kind).toBe('SINGLE');
    expect(q?.options.filter((o) => o.correct).map((o) => o.text)).toEqual(['Click + (New message) next to Chat and pick the person']);
    expect(q?.explanation).toContain('Search people…');
    // The words the site used before 1.23.29 are gone from the whole course.
    expect(courseText(training())).not.toMatch(/Message a teammate|New direct message|Start one\b/);
  });

  it('Reports teaches who can open it where it is opened (the quiz asks “Who can open Reports?”)', () => {
    const open = guideSteps(lessonsOf('module:reports')).find((s) => s.title === 'Open Reports')!;
    expect(open.body).toMatch(/<strong>Reports<\/strong> in the side menu \(only administrators see it\)/);
    const prompts = questions({ ...training(), lessons: lessonsOf('module:reports') }).map((q) => q.prompt);
    expect(prompts).toContain('Who can open Reports?');
  });
});

describe('starter content revision 3: quizzes', () => {
  it('each module: one quiz of 3–5 single-choice questions (at most one put-in-order), pass mark 70, unlimited tries, shuffled, no time limit, no draw, no intro', () => {
    for (const [key] of MODULES) {
      const quizzes = lessonsOf(key).filter((l) => l.kind === 'QUIZ');
      expect(quizzes, key).toHaveLength(1);
      const l = quizzes[0]!;
      if (l.kind !== 'QUIZ') continue;
      expect(l.title, key).toMatch(/^Quiz: /);
      expect(l.body ?? '', key).toBe('');
      expect(l.quiz).toMatchObject({ passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null });
      expect(l.quiz.questions.length, key).toBeGreaterThanOrEqual(3);
      expect(l.quiz.questions.length, key).toBeLessThanOrEqual(5);
      for (const q of l.quiz.questions) expect(['SINGLE', 'ORDER'], `${key}: ${q.prompt}`).toContain(q.kind);
      expect(l.quiz.questions.filter((q) => q.kind === 'ORDER').length, key).toBeLessThanOrEqual(1);
    }
  });

  it('put-in-order is kept in two modules only (Meetings & minutes and Admin settings)', () => {
    const withOrder = MODULES.map(([key]) => key).filter((key) => questions({ ...training(), lessons: lessonsOf(key) }).some((q) => q.kind === 'ORDER'));
    expect(withOrder).toEqual(['module:meetings', 'module:admin']);
  });

  it('every question can be answered right: the right number of correct options for its kind', () => {
    for (const c of STARTER_COURSES) {
      for (const q of questions(c)) {
        const where = `${c.key}: ${q.prompt}`;
        const correct = q.options.filter((o) => o.correct).length;
        expect(new Set(q.options.map((o) => o.text)).size, where).toBe(q.options.length);
        expect(q.explanation, where).toBeTruthy();
        if (q.kind === 'TRUE_FALSE') {
          expect(q.options.map((o) => o.text), where).toEqual(['True', 'False']);
          expect(correct, where).toBe(1);
        } else if (q.kind === 'SINGLE') {
          expect(q.options.length, where).toBeGreaterThanOrEqual(3);
          expect(correct, where).toBe(1);
        } else if (q.kind === 'MULTIPLE') {
          expect(q.options.length, where).toBeGreaterThanOrEqual(3);
          expect(correct, where).toBeGreaterThanOrEqual(1);
          expect(correct, where).toBeLessThan(q.options.length);
        } else {
          expect(q.options.length, where).toBeGreaterThanOrEqual(2);
          expect(correct, where).toBe(q.options.length);
        }
      }
    }
  });

  it('wrong single-choice answers explain why (feedback on every wrong option)', () => {
    for (const c of STARTER_COURSES) {
      for (const q of questions(c).filter((x) => x.kind === 'SINGLE')) {
        for (const o of q.options.filter((x) => !x.correct)) expect(o.feedback, `${c.key}: ${q.prompt} / ${o.text}`).toBeTruthy();
      }
    }
  });

  it('question prompts are unique within each quiz', () => {
    for (const c of STARTER_COURSES) {
      for (const l of c.lessons) if (l.kind === 'QUIZ') expect(new Set(l.quiz.questions.map((q) => q.prompt)).size, l.title).toBe(l.quiz.questions.length);
    }
  });
});

describe('starter content revision 3: words', () => {
  it('fits every API limit, so loading cuts nothing (no warnings), and keeps every module and each lesson’s module', () => {
    for (const c of STARTER_COURSES) {
      expect([...c.title].length, c.key).toBeLessThanOrEqual(LIMITS.courseTitle);
      expect([...c.summary].length, c.key).toBeLessThanOrEqual(LIMITS.courseSummary);
      expect(c.lessons.length).toBeLessThanOrEqual(LIMITS.lessonsPerCourse);
      expect((c.modules ?? []).length).toBeLessThanOrEqual(LIMITS.modulesPerCourse);
      for (const m of c.modules ?? []) expect([...m.title].length, m.key).toBeLessThanOrEqual(LIMITS.moduleTitle);
      for (const l of c.lessons) {
        expect([...l.title].length, l.title).toBeLessThanOrEqual(LIMITS.lessonTitle);
        expect((l.body ?? '').length, l.title).toBeLessThanOrEqual(LIMITS.lessonBody);
        expect(l.minutes).toBeGreaterThanOrEqual(1);
        expect(l.minutes).toBeLessThanOrEqual(LIMITS.minutesMax);
      }
      for (const s of steps(c)) {
        expect([...s.title].length, s.title).toBeLessThanOrEqual(LIMITS.stepTitle);
        expect(s.body.length, s.title).toBeLessThanOrEqual(LIMITS.stepBody);
        if (s.alt !== undefined) expect([...s.alt].length, s.title).toBeLessThanOrEqual(LIMITS.imageAlt);
      }
      for (const q of questions(c)) {
        expect([...q.prompt].length, q.prompt).toBeLessThanOrEqual(LIMITS.questionPrompt);
        expect([...(q.explanation ?? '')].length, q.prompt).toBeLessThanOrEqual(LIMITS.questionExplanation);
        expect(q.options.length, q.prompt).toBeLessThanOrEqual(LIMITS.optionsPerQuestion);
        for (const o of q.options) {
          expect([...o.text].length, o.text).toBeLessThanOrEqual(LIMITS.optionText);
          expect([...(o.feedback ?? '')].length, o.text).toBeLessThanOrEqual(LIMITS.optionFeedback);
        }
      }
      const warnings: string[] = [];
      const normal = normalizeStarterCourse(c, (w) => warnings.push(w));
      expect(warnings, c.key).toEqual([]);
      expect(normal.modules ?? [], c.key).toEqual(c.modules ?? []);
      expect(normal.lessons.map((l) => l.module), c.key).toEqual(c.lessons.map((l) => l.module));
      // Cleaning keeps every word: nothing written here is dropped by the server's rich-text rules.
      for (const [i, l] of normal.lessons.entries()) {
        if (l.kind === 'GUIDE') l.steps.forEach((s, j) => expect(s.body, `${c.key} ${i}.${j}`).not.toBe(''));
      }
    }
  });

  it('rich text uses only <p>, <strong>, <em>, <ul>, <ol> and <li>, without attributes', () => {
    for (const c of STARTER_COURSES) {
      for (const { where, html } of richTexts(c)) {
        const tags = [...html.matchAll(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g)];
        expect(tags.length, where).toBeGreaterThan(0);
        for (const [whole, , name, rest] of tags) {
          expect(['p', 'strong', 'em', 'ul', 'ol', 'li'], `${where}: ${whole}`).toContain(name);
          expect(rest!.trim(), `${where}: ${whole}`).toBe('');
        }
        expect(html.startsWith('<p>') || html.startsWith('<ul>') || html.startsWith('<ol>'), where).toBe(true);
      }
    }
  });

  it('every picture has a description for screen readers, and steps without a picture have none', () => {
    for (const c of STARTER_COURSES) {
      for (const s of steps(c)) {
        if (s.image) expect((s.alt ?? '').trim().length, `${c.key}: ${s.title}`).toBeGreaterThan(15);
        else expect(s.alt, `${c.key}: ${s.title}`).toBeUndefined();
      }
    }
  });

  it('module titles are short and different; course titles are different', () => {
    const titles = (training().modules ?? []).map((m) => m.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(STARTER_COURSES.map((c) => c.title)).size).toBe(STARTER_COURSES.length);
  });
});

describe('starter content revision 3: files', () => {
  it('every picture is in assets/training/starter (no step names a missing file)', () => {
    for (const f of referenced) expect(filesInFolder, f).toContain(f);
  });

  it('the folder holds the same 48 pictures, every one used, and nothing else (no PDFs, videos, audio or slides)', () => {
    expect(filesInFolder).toHaveLength(48);
    for (const f of filesInFolder) {
      expect(referenced.has(f), `${f} is not used by any starter course`).toBe(true);
      expect(extname(f), f).toBe('.webp');
    }
  });

  it('pictures are WebP, at most 1280 px wide and 120 KB each, 3 MB together — and pass the upload checks', async () => {
    let total = 0;
    for (const f of filesInFolder.filter((x) => x.endsWith('.webp'))) {
      const content = readFileSync(join(ASSETS, f));
      total += content.length;
      expect(content.length, f).toBeLessThanOrEqual(120 * 1024);
      expect(pictureMimeOf(f)).toBe('image/webp');
      expect(checkTrainingUpload({ filename: f, mimeType: 'image/webp', content }, 'IMAGE').mimeType).toBe('image/webp');
      const meta = await sharp(content).metadata();
      expect(meta.format, f).toBe('webp');
      expect(meta.width ?? 0, f).toBeLessThanOrEqual(1280);
    }
    expect(total).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});

/**
 * 1.23.33 (revision 4): the pictures were retaken on 1.23.32 with sample names only (owner rule 13 Nov: Contoso
 * Engineering, Fabrikam Logistics, Northwind Trading — the 1.23.27 pictures showed a real company as the sample client).
 * Every picture was checked by eye (recipe: .superpowers/lhq/starter/capture-starter.mjs); this keeps the files clean
 * for the release's word checks too.
 */
describe('starter content revision 4: the pictures', () => {
  it('no picture’s bytes read as a retired name (a release check greps the files: a random byte run must not trip it)', () => {
    const retired = ['oxy', 'gulf', 'pdo', 'acme', 'prolens'];
    for (const f of filesInFolder) {
      const text = readFileSync(join(ASSETS, f)).toString('latin1');
      for (const w of retired) expect(new RegExp(`(^|[^A-Za-z0-9_])${w}([^A-Za-z0-9_]|$)`, 'i').test(text), `${f} holds “${w}”`).toBe(false);
    }
  });

  it('the descriptions say what the retaken pictures show', () => {
    const alt = (image: string) => steps(training()).find((s) => s.image === image)?.alt ?? '';
    expect(alt('admin-settings.webp')).toMatch(/Companies/);
    expect(alt('calendar-filters.webp')).not.toMatch(/Show meetings/);
    expect(alt('start-notifications.webp')).not.toMatch(/mention/);
    expect(alt('projects-list.webp')).toMatch(/three project cards/);
    expect(alt('admin-edit-user.webp')).toMatch(/Training/);
  });
});
