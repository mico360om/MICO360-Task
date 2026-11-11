import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { STARTER_COURSES } from './starter-courses';
import type { StarterCourse, StarterQuestion, StarterStep } from './starter-types';
import { normalizeStarterCourse, pictureMimeOf } from '../training-starter';
import { checkTrainingUpload } from '../training-files';
import { LIMITS, MODULE_LABELS } from '../training-types';

/**
 * The shipped starter content (R17): the list of courses never changes by accident, every picture and
 * download is there (and nothing else is), quizzes are answerable, and nothing would be cut on loading.
 */

const ASSETS = resolve(__dirname, '../../../../assets/training/starter');

const KEYS = [
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
  'starter:video-tasks',
  'starter:video-meetings',
  'starter:video-minutes',
];

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
  it('has the 13 starter courses, with stable unique keys, in this order', () => {
    expect(STARTER_COURSES.map((c) => c.key)).toEqual(KEYS);
    expect(new Set(STARTER_COURSES.map((c) => c.key)).size).toBe(KEYS.length);
  });

  it('publishes the 10 module courses and keeps the 3 video courses as drafts', () => {
    const published = STARTER_COURSES.filter((c) => c.status === 'PUBLISHED').map((c) => c.key);
    const drafts = STARTER_COURSES.filter((c) => c.status === 'DRAFT').map((c) => c.key);
    expect(published).toEqual(KEYS.slice(0, 10));
    expect(drafts).toEqual(['starter:video-tasks', 'starter:video-meetings', 'starter:video-minutes']);
  });

  it('matches each module course to its module; beginner level, all lessons to finish, certificates off', () => {
    for (const c of STARTER_COURSES) {
      expect(c.key.startsWith('starter:video-') ? ['tasks', 'meetings'] : [c.key.slice('starter:'.length)]).toContain(c.moduleKey);
      expect(MODULE_LABELS[c.moduleKey]).toBeTruthy();
      expect(c.difficulty).toBe('BEGINNER');
      expect(c.completionRule).toBe('ALL_LESSONS');
      expect(c.certificateOn).toBe(false);
      expect(c.certificateMonths).toBeNull();
    }
  });

  it('the Client portal course is for clients only; every other course is for staff', () => {
    expect(byKey('starter:portal').audience).toBe('CLIENTS');
    expect(byKey('starter:portal').moduleKey).toBe('portal');
    for (const c of STARTER_COURSES.filter((x) => x.key !== 'starter:portal')) expect(c.audience).toBe('STAFF');
  });

  it('Reports and Admin settings are for administrators; the others for everyone in their audience', () => {
    expect(byKey('starter:reports').roleKeys).toEqual(['admins']);
    expect(byKey('starter:admin').roleKeys).toEqual(['admins']);
    for (const c of STARTER_COURSES.filter((x) => !['starter:reports', 'starter:admin'].includes(x.key))) expect(c.roleKeys ?? []).toEqual([]);
  });

  it('module courses: 1–2 guides of 4–6 steps (most with a picture), then one quiz; realistic minutes', () => {
    for (const c of STARTER_COURSES.filter((x) => x.status === 'PUBLISHED')) {
      const kinds = c.lessons.map((l) => l.kind);
      expect(kinds[kinds.length - 1], c.key).toBe('QUIZ');
      const guides = c.lessons.filter((l) => l.kind === 'GUIDE');
      expect(guides.length, c.key).toBeGreaterThanOrEqual(1);
      expect(guides.length, c.key).toBeLessThanOrEqual(2);
      expect(kinds.length, c.key).toBe(guides.length + 1);
      for (const g of guides) {
        if (g.kind !== 'GUIDE') continue;
        expect(g.steps.length, `${c.key} ${g.title}`).toBeGreaterThanOrEqual(4);
        expect(g.steps.length, `${c.key} ${g.title}`).toBeLessThanOrEqual(6);
        expect(g.minutes, `${c.key} ${g.title}`).toBeGreaterThanOrEqual(3);
        expect(g.minutes, `${c.key} ${g.title}`).toBeLessThanOrEqual(8);
      }
      const quiz = c.lessons[c.lessons.length - 1]!;
      expect(quiz.minutes).toBe(3);
      // At least a picture in each guide, and pictures in about half of the steps of a course or more.
      for (const g of guides) if (g.kind === 'GUIDE') expect(g.steps.some((s) => s.image), `${c.key} ${g.title}`).toBe(true);
      expect(pictures(c).length * 2, c.key).toBeGreaterThanOrEqual(steps(c).length - 2);
    }
  });

  it('video courses: one video lesson waiting for its link, with an introduction saying who adds it', () => {
    for (const key of ['starter:video-tasks', 'starter:video-meetings', 'starter:video-minutes']) {
      const c = byKey(key);
      expect(c.lessons).toHaveLength(1);
      const l = c.lessons[0]!;
      expect(l.kind).toBe('VIDEO');
      if (l.kind !== 'VIDEO') continue;
      expect(l.videoUrl).toBeNull();
      expect(l.body).toMatch(/administrator adds the video link/);
      expect(c.summary.length).toBeGreaterThan(20);
    }
  });

  it('the Tasks and Meetings courses carry the owner’s how-to slides', () => {
    expect(byKey('starter:tasks').resources).toEqual([{ file: 'tasks-how-to.pdf', name: 'Tasks how-to slides (PDF)', mimeType: 'application/pdf' }]);
    expect(byKey('starter:meetings').resources).toEqual([{ file: 'meetings-how-to.pdf', name: 'Meetings how-to slides (PDF)', mimeType: 'application/pdf' }]);
    for (const c of STARTER_COURSES.filter((x) => !['starter:tasks', 'starter:meetings'].includes(x.key))) expect(c.resources ?? []).toEqual([]);
  });
});

describe('starter courses: quizzes', () => {
  const quizzes = STARTER_COURSES.flatMap((c) => c.lessons.flatMap((l) => (l.kind === 'QUIZ' ? [{ key: c.key, quiz: l.quiz }] : [])));

  it('every module course has one quiz of 4–5 questions: pass mark 70, unlimited tries, shuffled, no time limit, no draw', () => {
    expect(quizzes).toHaveLength(10);
    for (const { key, quiz } of quizzes) {
      expect(quiz.questions.length, key).toBeGreaterThanOrEqual(4);
      expect(quiz.questions.length, key).toBeLessThanOrEqual(5);
      expect(quiz).toMatchObject({ passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null });
    }
  });

  it('mixes the question kinds: each quiz has a single, a true/false and an order question; most have a multiple', () => {
    for (const { key, quiz } of quizzes) {
      const kinds = new Set(quiz.questions.map((q) => q.kind));
      for (const k of ['SINGLE', 'TRUE_FALSE', 'ORDER'] as const) expect(kinds.has(k), `${key} ${k}`).toBe(true);
    }
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

  it('the folder holds nothing else: only referenced WebP pictures and the two PDFs (no videos, audio or slides)', () => {
    for (const f of filesInFolder) {
      expect(referenced.has(f), `${f} is not used by any starter course`).toBe(true);
      expect(['.webp', '.pdf'], f).toContain(extname(f));
    }
    expect(filesInFolder.filter((f) => f.endsWith('.pdf')).sort()).toEqual(['meetings-how-to.pdf', 'tasks-how-to.pdf']);
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

  it('the two PDFs are real PDFs within the 25 MB document limit', () => {
    for (const f of ['tasks-how-to.pdf', 'meetings-how-to.pdf']) {
      const content = readFileSync(join(ASSETS, f));
      expect(statSync(join(ASSETS, f)).size).toBeGreaterThan(1024 * 1024);
      expect(checkTrainingUpload({ filename: f, mimeType: 'application/pdf', content }, 'RESOURCE').mimeType).toBe('application/pdf');
    }
  });
});
