import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isRichEmpty, parseRichHtml, sanitizeRichHtml } from '../../lib/rich-text';
import { STARTER_COURSES } from './starter/starter-courses';
import type { StarterCourse, StarterLesson, StarterQuestion, StarterStep } from './starter/starter-types';
import { checkTrainingUpload, type TrainingFileStore } from './training-files';
import { LIMITS } from './training-types';

/**
 * Starter content (R17): the shipped courses (starter/starter-courses.ts) loaded once by the server at
 * boot — a course per main module (published) and the video courses (drafts until the owner adds the
 * links). Each is marked with its starterKey, so an administrator can tell it apart, edit it, unpublish
 * it or delete it: once every starter course has been loaded the site-level flag
 * `training.starterLoadedAt` is set and nothing is ever loaded again (a deleted one never comes back).
 * The pictures and downloads are copied from assets/training/starter into the private training folder.
 * The first run also stamps `training.launchedAt` (R15: the first-time tour is only for accounts made
 * after the Training Center launched).
 */

export const STARTER_LOADED_KEY = 'training.starterLoadedAt';
export const LAUNCHED_KEY = 'training.launchedAt';

/** assets/training/starter next to the server (its working folder) or the source / compiled file; null: none. */
export function starterAssetsDir(): string | null {
  const candidates = [
    resolve(process.cwd(), 'assets', 'training', 'starter'),
    // src/modules/training (tsx, tests) → backend/assets
    resolve(__dirname, '../../../assets/training/starter'),
    // dist/src/modules/training (compiled) → backend/assets
    resolve(__dirname, '../../../../assets/training/starter'),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isDirectory()) ?? null;
}

const PICTURE_TYPES: Record<string, string> = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };

/** A starter picture's type from its file name's extension; null when it isn't a picture. */
export function pictureMimeOf(file: string): string | null {
  return PICTURE_TYPES[extname(file).toLowerCase()] ?? null;
}

type Warn = (message: string) => void;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/**
 * A starter course as it will be stored: rich text cleaned, words cut to the API's limits and numbers
 * kept in range (the live database is MariaDB in non-strict mode and would cut silently) — each cut
 * said in a warning. ORDER questions: every option is part of the answer (positions are the order).
 */
export function normalizeStarterCourse(course: StarterCourse, warn: Warn): StarterCourse {
  const at = (where: string) => `${course.key}: ${where}`;
  const cut = (s: string, max: number, where: string): string => {
    const chars = [...s];
    if (chars.length <= max) return s;
    warn(`${at(where)} is longer than ${max} characters and was cut.`);
    return chars.slice(0, max).join('');
  };
  const cutOpt = (s: string | undefined, max: number, where: string): string | undefined => (s === undefined ? undefined : cut(s, max, where));
  const rich = (html: string | undefined, max: number, where: string): string => {
    if (html === undefined) return '';
    let clean = sanitizeRichHtml(html);
    if (isRichEmpty(parseRichHtml(clean))) return '';
    if (clean.length > max) {
      warn(`${at(where)} is longer than ${max} characters and was cut.`);
      for (let i = 0; i < 5 && clean.length > max; i++) clean = sanitizeRichHtml(clean.slice(0, Math.floor(max * 0.9)));
      if (clean.length > max) clean = '';
    }
    return clean;
  };
  const range = (n: number, min: number, max: number, where: string): number => {
    const v = clamp(Number.isFinite(n) ? n : min, min, max);
    if (v !== n) warn(`${at(where)} (${n}) was set to ${v}.`);
    return v;
  };
  const few = <T,>(items: readonly T[], max: number, where: string): T[] => {
    if (items.length <= max) return [...items];
    warn(`${at(where)}: only the first ${max} of ${items.length} are loaded.`);
    return items.slice(0, max);
  };

  const step = (s: StarterStep, where: string): StarterStep => ({
    title: cut(s.title, LIMITS.stepTitle, `${where} title`),
    body: rich(s.body, LIMITS.stepBody, `${where} text`),
    ...(s.image ? { image: s.image } : {}),
    ...(s.alt !== undefined ? { alt: cut(s.alt, LIMITS.imageAlt, `${where} picture description`) } : {}),
  });
  const question = (q: StarterQuestion, where: string): StarterQuestion => {
    const explanation = cutOpt(q.explanation, LIMITS.questionExplanation, `${where} explanation`);
    return {
      kind: q.kind,
      prompt: cut(q.prompt, LIMITS.questionPrompt, `${where} question`),
      ...(explanation !== undefined ? { explanation } : {}),
      options: few(q.options, LIMITS.optionsPerQuestion, `${where} options`).map((o, i) => {
        const feedback = cutOpt(o.feedback, LIMITS.optionFeedback, `${where} option ${i + 1} feedback`);
        return { text: cut(o.text, LIMITS.optionText, `${where} option ${i + 1}`), correct: q.kind === 'ORDER' ? true : o.correct, ...(feedback !== undefined ? { feedback } : {}) };
      }),
    };
  };
  const lesson = (l: StarterLesson, i: number): StarterLesson => {
    const where = `lesson ${i + 1}`;
    const common = {
      title: cut(l.title, LIMITS.lessonTitle, `${where} title`),
      minutes: range(l.minutes, 1, LIMITS.minutesMax, `${where} minutes`),
      ...(l.body !== undefined ? { body: rich(l.body, LIMITS.lessonBody, `${where} introduction`) } : {}),
    };
    if (l.kind === 'GUIDE') return { kind: 'GUIDE', ...common, steps: few(l.steps, LIMITS.stepsPerLesson, `${where} steps`).map((s, j) => step(s, `${where} step ${j + 1}`)) };
    if (l.kind === 'VIDEO') return { kind: 'VIDEO', ...common, videoUrl: null };
    const questions = few(l.quiz.questions, LIMITS.questionsPerQuiz, `${where} questions`).map((q, j) => question(q, `${where} question ${j + 1}`));
    const draw = l.quiz.drawCount;
    return {
      kind: 'QUIZ',
      ...common,
      quiz: {
        passMark: range(l.quiz.passMark, 0, 100, `${where} pass mark`),
        maxAttempts: l.quiz.maxAttempts === null ? null : range(l.quiz.maxAttempts, 1, LIMITS.maxAttemptsMax, `${where} attempts`),
        shuffle: l.quiz.shuffle,
        timeLimitMinutes: l.quiz.timeLimitMinutes === null ? null : range(l.quiz.timeLimitMinutes, 1, LIMITS.timeLimitMax, `${where} time limit`),
        // A draw of the whole bank (or more) is every question.
        drawCount: draw === null || draw < 1 || draw >= questions.length ? null : Math.round(draw),
        questions,
      },
    };
  };

  return {
    ...course,
    title: cut(course.title, LIMITS.courseTitle, 'title'),
    summary: cut(course.summary, LIMITS.courseSummary, 'summary'),
    certificateMonths: course.certificateMonths === null ? null : range(course.certificateMonths, 1, LIMITS.certificateMonthsMax, 'certificate months'),
    ...(course.resources ? { resources: course.resources.map((r) => ({ ...r, name: cut(r.name, LIMITS.fileName, `download ${r.file} name`) })) } : {}),
    lessons: few(course.lessons, LIMITS.lessonsPerCourse, 'lessons').map(lesson),
  };
}

export interface TrainingStarterDeps {
  prisma: PrismaClient;
  files: TrainingFileStore;
  courses?: readonly StarterCourse[];
  assetsDir?: string | null;
  now?: () => Date;
  logger?: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void };
}

/** A file copied into the private folder for one course, ready for its training_files row. */
interface CopiedFile {
  kind: 'IMAGE' | 'RESOURCE';
  name: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

const retryable = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return e?.code === 'P2034' || e?.code === 'P2002' || /deadlock|write conflict/i.test(e?.message ?? '');
};
const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';

export function createTrainingStarter(deps: TrainingStarterDeps): { run(): Promise<{ loaded: number; skipped: number; already: boolean }> } {
  const { prisma, files } = deps;
  const now = deps.now ?? (() => new Date());
  const courses = deps.courses ?? STARTER_COURSES;
  const assetsDir = deps.assetsDir === undefined ? starterAssetsDir() : deps.assetsDir;
  const warn = (message: string, meta?: Record<string, unknown>) => deps.logger?.warn(message, meta);

  /** One asset's bytes, checked like an upload; null (with a warning) when missing or not what it says. */
  async function asset(courseKey: string, file: string, mimeType: string | null, kind: 'IMAGE' | 'RESOURCE', name: string): Promise<{ content: Buffer; mimeType: string; name: string } | null> {
    if (!assetsDir) {
      warn(`Training starter: no starter assets folder; ${file} is left out.`, { course: courseKey });
      return null;
    }
    if (!mimeType || basename(file) !== file) {
      warn(`Training starter: ${file} is not a file the starter content can use; it is left out.`, { course: courseKey });
      return null;
    }
    let content: Buffer;
    try {
      content = await readFile(join(assetsDir, file));
    } catch {
      warn(`Training starter: ${file} is missing from the starter assets; it is left out.`, { course: courseKey });
      return null;
    }
    try {
      const checked = checkTrainingUpload({ filename: name, mimeType, content }, kind);
      return { content, mimeType: checked.mimeType, name: checked.name };
    } catch (err) {
      warn(`Training starter: ${file} was refused (${(err as Error).message}); it is left out.`, { course: courseKey });
      return null;
    }
  }

  /** Copies the course's pictures and downloads into the private folder (files left out are warned about). */
  async function copyFiles(course: StarterCourse, saved: string[]): Promise<{ pictures: Map<string, CopiedFile>; resources: CopiedFile[] }> {
    const pictures = new Map<string, CopiedFile>();
    const resources: CopiedFile[] = [];
    for (const l of course.lessons) {
      if (l.kind !== 'GUIDE') continue;
      for (const s of l.steps) {
        if (!s.image || pictures.has(s.image)) continue;
        const a = await asset(course.key, s.image, pictureMimeOf(s.image), 'IMAGE', s.image);
        if (!a) continue;
        const storageKey = await files.save(a.content, a.mimeType);
        saved.push(storageKey);
        pictures.set(s.image, { kind: 'IMAGE', name: a.name, mimeType: a.mimeType, sizeBytes: a.content.length, storageKey });
      }
    }
    for (const r of course.resources ?? []) {
      const a = await asset(course.key, r.file, r.mimeType, 'RESOURCE', r.name);
      if (!a) continue;
      const storageKey = await files.save(a.content, a.mimeType);
      saved.push(storageKey);
      resources.push({ kind: 'RESOURCE', name: a.name, mimeType: a.mimeType, sizeBytes: a.content.length, storageKey });
    }
    return { pictures, resources };
  }

  async function create(tx: Prisma.TransactionClient, course: StarterCourse, position: number, copied: { pictures: Map<string, CopiedFile>; resources: CopiedFile[] }, at: Date): Promise<void> {
    const c = await tx.trainingCourse.create({
      data: {
        title: course.title,
        summary: course.summary || null,
        moduleKey: course.moduleKey,
        audience: course.audience,
        ...(course.roleKeys && course.roleKeys.length ? { roleKeys: [...course.roleKeys] } : {}),
        difficulty: course.difficulty,
        status: course.status,
        completionRule: course.completionRule,
        inOrder: false,
        certificateOn: course.certificateOn,
        certificateMonths: course.certificateMonths,
        version: 1,
        starterKey: course.key,
        position,
        createdById: null,
        publishedAt: course.status === 'PUBLISHED' ? at : null,
      },
      select: { id: true },
    });
    const fileIds = new Map<string, string>();
    let filePosition = 0;
    for (const [image, f] of copied.pictures) {
      const row = await tx.trainingFile.create({ data: { courseId: c.id, ...f, position: filePosition++, starter: true }, select: { id: true } });
      fileIds.set(image, row.id);
    }
    for (const f of copied.resources) await tx.trainingFile.create({ data: { courseId: c.id, ...f, position: filePosition++, starter: true } });

    for (const [i, l] of course.lessons.entries()) {
      const common = { courseId: c.id, position: i, kind: l.kind, title: l.title, minutes: l.minutes, body: l.body ? l.body : null, changedVersion: 1 };
      if (l.kind === 'GUIDE') {
        await tx.trainingLesson.create({
          data: {
            ...common,
            steps: {
              create: l.steps.map((s, j) => {
                const imageFileId = s.image ? (fileIds.get(s.image) ?? null) : null;
                return { position: j, title: s.title || null, body: s.body || null, imageFileId, imageAlt: imageFileId ? (s.alt ?? null) : null };
              }),
            },
          },
        });
      } else if (l.kind === 'QUIZ') {
        await tx.trainingLesson.create({
          data: {
            ...common,
            quiz: {
              create: {
                passMark: l.quiz.passMark,
                maxAttempts: l.quiz.maxAttempts,
                shuffle: l.quiz.shuffle,
                timeLimitMinutes: l.quiz.timeLimitMinutes,
                drawCount: l.quiz.drawCount,
                questions: {
                  create: l.quiz.questions.map((q, j) => ({
                    position: j,
                    kind: q.kind,
                    prompt: q.prompt,
                    explanation: q.explanation ?? null,
                    options: { create: q.options.map((o, k) => ({ position: k, text: o.text, correct: o.correct, feedback: o.feedback ?? null })) },
                  })),
                },
              },
            },
          },
        });
      } else {
        // A video waits for the owner's YouTube / Vimeo link (publish is refused until it has one).
        await tx.trainingLesson.create({ data: common });
      }
    }
  }

  /** One course: 'loaded', 'skipped' (already there) or 'failed' (warned; tried again at the next start). */
  async function loadOne(raw: StarterCourse, position: number): Promise<'loaded' | 'skipped' | 'failed'> {
    const course = normalizeStarterCourse(raw, (w) => warn(`Training starter: ${w}`, { course: raw.key }));
    for (let attempt = 0; ; attempt++) {
      if ((await prisma.trainingCourse.count({ where: { starterKey: course.key } })) > 0) return 'skipped';
      const saved: string[] = [];
      try {
        const copied = await copyFiles(course, saved);
        const at = now();
        await prisma.$transaction((tx) => create(tx, course, position, copied, at), { maxWait: 10_000, timeout: 60_000 });
        return 'loaded';
      } catch (err) {
        await Promise.all(saved.map((k) => files.remove(k).catch(() => {})));
        if (attempt < 2 && retryable(err)) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        warn('Training starter: a starter course could not be loaded; it is tried again at the next start.', { course: course.key, err: (err as Error)?.message ?? String(err) });
        return 'failed';
      }
    }
  }

  async function markOnce(key: string): Promise<void> {
    try {
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value: now().toISOString() }, update: {} });
    } catch (err) {
      if (!isUniqueClash(err)) throw err; // another server wrote it at the same moment
    }
  }

  async function load(): Promise<{ loaded: number; skipped: number; already: boolean }> {
    await markOnce(LAUNCHED_KEY);
    if ((await prisma.systemSetting.count({ where: { key: STARTER_LOADED_KEY } })) > 0) return { loaded: 0, skipped: 0, already: true };
    let loaded = 0;
    let skipped = 0;
    let failed = 0;
    for (const [i, course] of courses.entries()) {
      const out = await loadOne(course, i);
      if (out === 'loaded') loaded++;
      else {
        skipped++;
        if (out === 'failed') failed++;
      }
    }
    // Only once every starter course is there: a deleted one must never come back. A build without any
    // starter content (none written yet) leaves the flag for the release that has it.
    if (failed === 0 && courses.length > 0) await markOnce(STARTER_LOADED_KEY);
    if (loaded) deps.logger?.info('Training starter content loaded', { loaded, skipped });
    return { loaded, skipped, already: false };
  }

  let running: Promise<{ loaded: number; skipped: number; already: boolean }> | null = null;
  return {
    run() {
      if (!running) running = load().finally(() => (running = null));
      return running;
    },
  };
}
