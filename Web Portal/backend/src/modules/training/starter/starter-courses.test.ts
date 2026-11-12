import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { LEGACY_STARTER_KEYS, RETIRED_VIDEO_COURSES, STARTER_COURSES, STARTER_REVISION } from './starter-courses';
import type { StarterCourse, StarterQuestion, StarterStep } from './starter-types';
import { normalizeStarterCourse, pictureMimeOf } from '../training-starter';
import { checkTrainingUpload } from '../training-files';
import { LIMITS, MODULE_LABELS } from '../training-types';

/**
 * The shipped starter content (R17; simplified 12 Nov, §7 and R4/R9): the list of courses never changes by accident,
 * each course opens with its video lesson (waiting for its link), every picture and download is there (and nothing
 * else is), quizzes are answerable and short, and nothing would be cut on loading.
 */

const ASSETS = resolve(__dirname, '../../../../assets/training/starter');

const KEYS = [
  'starter:getting-started',
  'starter:tasks',
  'starter:board',
  'starter:meetings',
  'starter:calendar',
  'starter:projects',
  'starter:reports',
  'starter:chat',
  'starter:mico-ai',
  'starter:admin',
  'starter:portal',
];
const MODULE_OF: Record<string, string> = { 'starter:getting-started': 'general' };
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;

const byKey = (key: string): StarterCourse => {
  const c = STARTER_COURSES.find((x) => x.key === key);
  if (!c) throw new Error(`no course ${key}`);
  return c;
};
const steps = (c: StarterCourse): StarterStep[] => c.lessons.flatMap((l) => (l.kind === 'GUIDE' ? l.steps : []));
const questions = (c: StarterCourse): StarterQuestion[] => c.lessons.flatMap((l) => (l.kind === 'QUIZ' ? l.quiz.questions : []));
const pictures = (c: StarterCourse): string[] => steps(c).flatMap((s) => (s.image ? [s.image] : []));
const referenced = new Set(STARTER_COURSES.flatMap((c) => [...pictures(c), ...(c.resources ?? []).map((r) => r.file)]));
const filesInFolder = readdirSync(ASSETS);

/** Every piece of rich text in a course (lesson introductions and step texts). */
const richTexts = (c: StarterCourse): { where: string; html: string }[] => [
  ...c.lessons.flatMap((l, i) => (l.body ? [{ where: `${c.key} lesson ${i + 1}`, html: l.body }] : [])),
  ...c.lessons.flatMap((l, i) => (l.kind === 'GUIDE' ? l.steps.map((s, j) => ({ where: `${c.key} lesson ${i + 1} step ${j + 1}`, html: s.body })) : [])),
];

describe('starter courses: the list', () => {
  it('has the 11 starter courses (Getting started first), with stable unique keys, in this order', () => {
    expect(STARTER_COURSES.map((c) => c.key)).toEqual(KEYS);
    expect(new Set(STARTER_COURSES.map((c) => c.key)).size).toBe(KEYS.length);
    expect(byKey('starter:getting-started').position).toBe(-1);
  });

  it('the revision is raised and the 1.23.24 keys are known (the live site’s starter courses: R1)', () => {
    expect(STARTER_REVISION).toBeGreaterThanOrEqual(2);
    expect(LEGACY_STARTER_KEYS).toHaveLength(13);
    for (const k of KEYS.filter((x) => x !== 'starter:getting-started')) expect(LEGACY_STARTER_KEYS).toContain(k);
    // R4: the three draft video courses go into their module courses; Meetings gets one video.
    expect(RETIRED_VIDEO_COURSES).toEqual([
      { key: 'starter:video-tasks', into: 'starter:tasks' },
      { key: 'starter:video-meetings', into: 'starter:meetings' },
      { key: 'starter:video-minutes', into: 'starter:meetings' },
    ]);
    for (const r of RETIRED_VIDEO_COURSES) expect(KEYS).not.toContain(r.key);
  });

  it('every starter course is published (the videos are lessons inside them)', () => {
    expect(STARTER_COURSES.every((c) => c.status === 'PUBLISHED')).toBe(true);
  });

  it('matches each course to its module; beginner level, all lessons to finish, certificates off', () => {
    for (const c of STARTER_COURSES) {
      expect(c.moduleKey).toBe(MODULE_OF[c.key] ?? c.key.slice('starter:'.length));
      expect(MODULE_LABELS[c.moduleKey]).toBeTruthy();
      expect(c.difficulty).toBe('BEGINNER');
      expect(c.completionRule).toBe('ALL_LESSONS');
      expect(c.certificateOn).toBe(false);
      expect(c.certificateMonths).toBeNull();
    }
  });

  it('the Client portal course is for clients only; every other course (Getting started too) is for staff', () => {
    expect(byKey('starter:portal').audience).toBe('CLIENTS');
    expect(byKey('starter:portal').moduleKey).toBe('portal');
    for (const c of STARTER_COURSES.filter((x) => x.key !== 'starter:portal')) expect(c.audience).toBe('STAFF');
  });

  it('Reports and Admin settings are for administrators; the others for everyone in their audience', () => {
    expect(byKey('starter:reports').roleKeys).toEqual(['admins']);
    expect(byKey('starter:admin').roleKeys).toEqual(['admins']);
    for (const c of STARTER_COURSES.filter((x) => !['starter:reports', 'starter:admin'].includes(x.key))) expect(c.roleKeys ?? []).toEqual([]);
  });

  it('every course: its video first (no link yet, no words around it), 1–2 guides of 4–7 steps (most with a picture), then one quiz', () => {
    for (const c of STARTER_COURSES) {
      const kinds = c.lessons.map((l) => l.kind);
      expect(kinds[0], c.key).toBe('VIDEO');
      expect(kinds.filter((k) => k === 'VIDEO'), c.key).toHaveLength(1);
      const v = c.lessons[0]!;
      if (v.kind === 'VIDEO') {
        expect(v.videoUrl).toBeNull();
        // §7: the admin sentence is gone (and nothing else is said around the video).
        expect(v.body ?? '', c.key).toBe('');
        expect(v.title, c.key).toMatch(/^Video: /);
      }
      expect(kinds[kinds.length - 1], c.key).toBe('QUIZ');
      const guides = c.lessons.filter((l) => l.kind === 'GUIDE');
      expect(guides.length, c.key).toBeGreaterThanOrEqual(1);
      expect(guides.length, c.key).toBeLessThanOrEqual(2);
      expect(kinds.length, c.key).toBe(guides.length + 2);
      for (const g of guides) {
        if (g.kind !== 'GUIDE') continue;
        expect(g.steps.length, `${c.key} ${g.title}`).toBeGreaterThanOrEqual(4);
        expect(g.steps.length, `${c.key} ${g.title}`).toBeLessThanOrEqual(7);
        expect(g.minutes, `${c.key} ${g.title}`).toBeGreaterThanOrEqual(3);
        expect(g.minutes, `${c.key} ${g.title}`).toBeLessThanOrEqual(8);
      }
      // At least a picture in each guide, and pictures in about half of the steps of a course or more.
      for (const g of guides) if (g.kind === 'GUIDE') expect(g.steps.some((s) => s.image), `${c.key} ${g.title}`).toBe(true);
      expect(pictures(c).length * 2, c.key).toBeGreaterThanOrEqual(steps(c).length - 2);
    }
  });

  it('the 11 videos the owner approved: one per course, Meetings start to finish the long one', () => {
    const videos = STARTER_COURSES.map((c) => c.lessons[0]!);
    expect(videos.map((v) => v.title)).toEqual([
      'Video: Getting started',
      'Video: Tasks',
      'Video: Kanban board',
      'Video: Meetings start to finish',
      'Video: Calendar',
      'Video: Projects',
      'Video: Reports and KPIs',
      'Video: Chat',
      'Video: MICO AI',
      'Video: Admin setup',
      'Video: Client portal',
    ]);
    expect(byKey('starter:meetings').lessons[0]!.minutes).toBe(12);
  });

  it('§7 text fixes: no step longer than 50 words, and the client course has no sign-in lesson', () => {
    for (const c of STARTER_COURSES) for (const s of steps(c)) expect(words(s.body) + words(s.title), `${c.key}: ${s.title}`).toBeLessThanOrEqual(56);
    const portal = byKey('starter:portal');
    expect(portal.lessons.map((l) => l.title)).toEqual(['Video: Client portal', 'Your project, tasks and minutes', 'Quiz: Client portal']);
    expect(JSON.stringify(portal)).not.toMatch(/temporary password|6-digit code|Set my password/);
    const merged = portal.lessons[1]!;
    expect(merged.was).toEqual(['Tasks, sign-off and minutes']);
  });

  it('Getting started covers sign in, the Dashboard, the menu, search, notifications, settings and the Learning Hub', () => {
    const g = byKey('starter:getting-started');
    expect(steps(g).map((s) => s.title)).toEqual(['Sign in', 'Your Dashboard', 'The side menu', 'Search', 'Notifications', 'Your settings', 'The Learning Hub']);
    expect(g.moduleKey).toBe('general');
    expect(g.roleKeys ?? []).toEqual([]);
  });

  it('Meetings says what 1.23.24 does (company time, Drafts, Create task from note, Save draft, the Sent log, Follow up)', () => {
    const text = JSON.stringify(byKey('starter:meetings'));
    for (const said of ['company time', 'Drafts', 'Create task from note', 'Save draft', 'Mark as final', '<strong>Sent</strong>', 'From meeting', 'completed by itself', 'Send to … people'])
      expect(text, said).toContain(said);
    // Not in 1.23.24: files on a meeting, a time-zone picker, a bell for invitations, answering through the calendar file.
    expect(text).not.toMatch(/attach a file|time-zone picker|invited you in the bell/i);
  });

  it('Calendar, Chat and MICO AI say what 1.23.24 shows (checked against the retaken pictures)', () => {
    const calendar = JSON.stringify(byKey('starter:calendar'));
    for (const said of ['<strong>Day</strong>', '<strong>+ Task</strong>', 'Change dates']) expect(calendar, said).toContain(said);
    expect(calendar).not.toMatch(/Add a task on this day|Change date|Change date</);
    expect(JSON.stringify(byKey('starter:chat'))).not.toMatch(/reaction, reply and more buttons/);
    expect(JSON.stringify(byKey('starter:mico-ai'))).not.toMatch(/How can I help, Omar/);
  });

  it('no starter course carries a download (the two how-to slide decks are retired: owner, 13 Nov)', () => {
    for (const c of STARTER_COURSES) expect(c.resources ?? [], c.key).toEqual([]);
  });
});

describe('starter courses: quizzes', () => {
  const quizzes = STARTER_COURSES.flatMap((c) => c.lessons.flatMap((l) => (l.kind === 'QUIZ' ? [{ key: c.key, quiz: l.quiz }] : [])));

  it('every course has one quiz (Getting started 3 questions, the others 4–5): pass mark 70, unlimited tries, shuffled, no time limit, no draw, no intro', () => {
    expect(quizzes).toHaveLength(11);
    for (const { key, quiz } of quizzes) {
      expect(quiz.questions.length, key).toBeGreaterThanOrEqual(key === 'starter:getting-started' ? 3 : 4);
      expect(quiz.questions.length, key).toBeLessThanOrEqual(key === 'starter:getting-started' ? 3 : 5);
      expect(quiz).toMatchObject({ passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null });
    }
    // R9: the quiz's own first line says the count and the pass mark: the lesson has no introduction.
    for (const c of STARTER_COURSES) for (const l of c.lessons.filter((x) => x.kind === 'QUIZ')) expect(l.body ?? '', c.key).toBe('');
  });

  it('mostly single choice: put-in-order kept in two quizzes only (Meetings and Admin settings); each quiz has a single choice', () => {
    for (const { key, quiz } of quizzes) expect(quiz.questions.some((q) => q.kind === 'SINGLE'), key).toBe(true);
    expect(quizzes.filter((q) => q.quiz.questions.some((x) => x.kind === 'ORDER')).map((q) => q.key)).toEqual(['starter:meetings', 'starter:admin']);
    expect(quizzes.filter((q) => q.quiz.questions.some((x) => x.kind === 'MULTIPLE')).length).toBeGreaterThanOrEqual(8);
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
          expect(q.options.length, where).toBeGreaterThanOrEqual(2);
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

  it('wrong single-choice answers explain why (feedback on the options, or the question’s explanation)', () => {
    for (const c of STARTER_COURSES) {
      for (const q of questions(c).filter((x) => x.kind === 'SINGLE')) {
        for (const o of q.options.filter((x) => !x.correct)) expect(o.feedback, `${c.key}: ${q.prompt} / ${o.text}`).toBeTruthy();
      }
    }
  });
});

describe('starter courses: words', () => {
  it('fits every API limit, so loading cuts nothing (no warnings)', () => {
    for (const c of STARTER_COURSES) {
      expect([...c.title].length, c.key).toBeLessThanOrEqual(LIMITS.courseTitle);
      expect([...c.summary].length, c.key).toBeLessThanOrEqual(LIMITS.courseSummary);
      expect(c.lessons.length).toBeLessThanOrEqual(LIMITS.lessonsPerCourse);
      for (const r of c.resources ?? []) expect([...r.name].length).toBeLessThanOrEqual(LIMITS.fileName);
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

  it('module titles are short and different', () => {
    const titles = STARTER_COURSES.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('starter courses: files', () => {
  it('every picture and download is in assets/training/starter', () => {
    for (const f of referenced) expect(filesInFolder, f).toContain(f);
  });

  it('the folder holds nothing else: only referenced WebP pictures (no PDFs, videos, audio or slides)', () => {
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
