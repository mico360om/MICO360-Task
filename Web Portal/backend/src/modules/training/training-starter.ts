import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { isRichEmpty, parseRichHtml, sanitizeRichHtml } from '../../lib/rich-text';
import { LEGACY_STARTER_KEYS, RETIRED_VIDEO_COURSES, STARTER_COURSES, STARTER_REVISION } from './starter/starter-courses';
import type { StarterCourse, StarterLesson, StarterQuestion, StarterStep } from './starter/starter-types';
import { checkTrainingUpload, type TrainingFileStore } from './training-files';
import { LIMITS } from './training-types';
import { isRetryableTxError } from '../../lib/sentinel-lock';
import { withoutSaveRetry } from '../../lib/save-retry';

/**
 * Starter content (R17): the shipped courses (starter/starter-courses.ts) loaded once by the server at
 * boot — a course per main module (published) and the video courses (drafts until the owner adds the
 * links). Each is marked with its starterKey, so an administrator can tell it apart, edit it, unpublish
 * it or delete it: once every starter course has been loaded the site-level flag
 * `training.starterLoadedAt` is set and nothing is ever loaded again (a deleted one never comes back).
 * The pictures and downloads are copied from assets/training/starter into the private training folder.
 * The first run also stamps `training.launchedAt` (R15: the first-time tour is only for accounts made
 * after the Training Center launched).
 *
 * 12 Nov (R1, R4, R5): a later release brings new starter content (STARTER_REVISION). A site that loaded an
 * earlier revision gets it at boot, once, for the starter courses nobody has edited — written row by row (never
 * through Publish), as a small fix: the course and lesson rows keep their ids (so everyone's progress, attempts,
 * certificates and assignments stay as they are), new pictures are copied in and the old ones no step uses are
 * removed, and everything is stamped as published with no change since. Edited courses are left alone; a deleted
 * one never comes back; a new starter course is loaded. `training.starterRevision` notes the revision and every
 * key loaded so far. Afterwards anyone who has now done every lesson left is finished (R3).
 */

export const STARTER_LOADED_KEY = 'training.starterLoadedAt';
export const LAUNCHED_KEY = 'training.launchedAt';
export const STARTER_REVISION_KEY = 'training.starterRevision';

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
      ...(l.was ? { was: [...l.was] } : {}),
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
  /** The content's revision (STARTER_REVISION). */
  revision?: number;
  /** The keys a site that never noted a revision has loaded (revision 1: LEGACY_STARTER_KEYS). */
  legacyKeys?: readonly string[];
  /** R4: earlier courses folded into another course (RETIRED_VIDEO_COURSES). */
  retired?: readonly { key: string; into: string }[];
  /** R3: finish anyone who has now done every lesson of these courses (training-finish.ts). */
  recheck?: (courseIds: string[]) => Promise<unknown>;
}

/** What a run did: `updated` (starter courses brought to the new revision) only when there were some. */
export interface StarterRun {
  loaded: number;
  skipped: number;
  already: boolean;
  updated?: number;
}

/** R1: nobody has edited it since it was loaded — the only starter courses an update may change. */
export function untouchedStarter(c: { updatedById: string | null; version: number; status: string; publishedAt: Date | null }, lessons: readonly { updatedAt: Date }[]): boolean {
  if (c.updatedById !== null || c.version !== 1 || c.status !== 'PUBLISHED' || !c.publishedAt) return false;
  const at = c.publishedAt.getTime();
  return lessons.every((l) => l.updatedAt.getTime() <= at);
}

/** A lesson of the new content matching a lesson row: the same kind and its title (now or before). */
export function sameLesson(row: { kind: string; title: string }, l: Pick<StarterLesson, 'kind' | 'title' | 'was'>): boolean {
  return row.kind === l.kind && (row.title === l.title || (l.was ?? []).includes(row.title));
}

/** A file copied into the private folder for one course, ready for its training_files row. */
interface CopiedFile {
  kind: 'IMAGE' | 'RESOURCE';
  name: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

/** Review M1: an administrator edited the course between the check and the write — it is left alone. */
class EditedMeanwhile extends Error {}

// 1.23.29: a save conflict as lib/sentinel-lock reads it (MariaDB's 1020 too), or a unique clash.
const retryable = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return isRetryableTxError(err) || e?.code === 'P2034' || e?.code === 'P2002' || /deadlock|write conflict/i.test(e?.message ?? '');
};
const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';

export function createTrainingStarter(deps: TrainingStarterDeps): { run(): Promise<StarterRun> } {
  const { prisma, files } = deps;
  const now = deps.now ?? (() => new Date());
  const courses = deps.courses ?? STARTER_COURSES;
  const revision = deps.revision ?? STARTER_REVISION;
  const legacyKeys = deps.legacyKeys ?? LEGACY_STARTER_KEYS;
  const retired = deps.retired ?? RETIRED_VIDEO_COURSES;
  const positionOf = (c: StarterCourse, i: number) => c.position ?? i;
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
        // A video waits for the owner's YouTube / Vimeo link: hidden from learners until it has one (R2).
        await tx.trainingLesson.create({ data: common });
      }
    }
    // A published course reads as published with nothing changed since: its rows carry the publish moment
    // (the Learning Hub's "Changes not published" compares updatedAt with publishedAt).
    if (course.status === 'PUBLISHED') {
      await tx.trainingLesson.updateMany({ where: { courseId: c.id }, data: { updatedAt: at } });
      await tx.trainingCourse.update({ where: { id: c.id }, data: { updatedAt: at } });
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
        // 1.23.29: its tries are its own (each copies the files again): the server's retry layer stays out.
        await withoutSaveRetry(() => prisma.$transaction((tx) => create(tx, course, position, copied, at), { maxWait: 10_000, timeout: 60_000 }));
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
      const out = await loadOne(course, positionOf(course, i));
      if (out === 'loaded') loaded++;
      else {
        skipped++;
        if (out === 'failed') failed++;
      }
    }
    // Only once every starter course is there: a deleted one must never come back. A build without any
    // starter content (none written yet) leaves the flag for the release that has it.
    if (failed === 0 && courses.length > 0) {
      await markOnce(STARTER_LOADED_KEY);
      // Every course was loaded from this content just now: it is the newest revision (nothing to update).
      if (skipped === 0) await writeRevision(revision, courses.map((c) => c.key));
    }
    if (loaded) deps.logger?.info('Training starter content loaded', { loaded, skipped });
    return { loaded, skipped, already: false };
  }

  // ── R1: bringing an earlier revision up to date ─────────────────────────────────────────────────

  async function readRevision(): Promise<{ revision: number; keys: string[] } | null> {
    const row = await prisma.systemSetting.findUnique({ where: { key: STARTER_REVISION_KEY } });
    const v = row?.value as { revision?: unknown; keys?: unknown } | null | undefined;
    if (!v || typeof v.revision !== 'number') return null;
    return { revision: v.revision, keys: Array.isArray(v.keys) ? v.keys.filter((k): k is string => typeof k === 'string') : [] };
  }

  async function writeRevision(rev: number, keys: readonly string[]): Promise<void> {
    const value = { revision: rev, keys: [...new Set(keys)] };
    await prisma.systemSetting.upsert({ where: { key: STARTER_REVISION_KEY }, create: { key: STARTER_REVISION_KEY, value }, update: { value } });
  }

  const sameBytes = async (storageKey: string, content: Buffer) => {
    try {
      return (await files.read(storageKey)).equals(content);
    } catch {
      return false;
    }
  };

  /**
   * One untouched course brought to the new content (R1, R5), in one transaction: lessons matched by kind and title
   * keep their ids (and so everyone's progress); a guide's steps and a quiz's questions are rewritten (a question
   * that stays keeps its id); new lessons are added, old ones removed (their progress rows stay, ignored: R10);
   * a video lesson keeps its link. Pictures the same as before stay; new ones are copied in first, and starter
   * pictures no step uses any more are removed after. Every row is stamped as published with nothing changed since.
   */
  async function bringUpToDate(courseId: string, course: StarterCourse, position: number): Promise<void> {
    const saved: string[] = [];
    try {
      const existing = await prisma.trainingFile.findMany({ where: { courseId, starter: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
      // The files this content needs: the same bytes under the same name are kept; anything else is copied in.
      const keepIds = new Map<string, string>();
      const toCreate: { name: string; file: CopiedFile }[] = [];
      const want: { name: string; kind: 'IMAGE' | 'RESOURCE'; mimeType: string | null; shown: string }[] = [];
      for (const l of course.lessons) if (l.kind === 'GUIDE') for (const st of l.steps) if (st.image && !want.some((w) => w.name === st.image)) want.push({ name: st.image, kind: 'IMAGE', mimeType: pictureMimeOf(st.image), shown: st.image });
      for (const r of course.resources ?? []) want.push({ name: r.file, kind: 'RESOURCE', mimeType: r.mimeType, shown: r.name });
      for (const w of want) {
        const a = await asset(course.key, w.name, w.mimeType, w.kind, w.shown);
        if (!a) continue;
        let kept: string | null = null;
        for (const f of existing.filter((x) => x.kind === w.kind && x.name === a.name && x.sizeBytes === a.content.length)) {
          if (await sameBytes(f.storageKey, a.content)) {
            kept = f.id;
            break;
          }
        }
        if (kept) keepIds.set(w.name, kept);
        else {
          const storageKey = await files.save(a.content, a.mimeType);
          saved.push(storageKey);
          toCreate.push({ name: w.name, file: { kind: w.kind, name: a.name, mimeType: a.mimeType, sizeBytes: a.content.length, storageKey } });
        }
      }

      const removedKeys = await prisma.$transaction(
        async (tx) => {
          // Review M1: checked again inside the write (an edit since the first check leaves the course alone).
          const c = await tx.trainingCourse.findUniqueOrThrow({ where: { id: courseId }, select: { publishedAt: true, updatedById: true, version: true, status: true, lessons: { select: { updatedAt: true } } } });
          if (!untouchedStarter(c, c.lessons)) throw new EditedMeanwhile();
          const at = c.publishedAt ?? now();
          const fileIds = new Map(keepIds);
          let filePosition = ((await tx.trainingFile.findFirst({ where: { courseId }, orderBy: [{ position: 'desc' }], select: { position: true } }))?.position ?? -1) + 1;
          for (const f of toCreate) fileIds.set(f.name, (await tx.trainingFile.create({ data: { courseId, ...f.file, position: filePosition++, starter: true }, select: { id: true } })).id);

          const rows = await tx.trainingLesson.findMany({ where: { courseId }, include: { quiz: { include: { questions: { include: { options: true } } } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
          const taken = new Set<string>();
          for (const [i, l] of course.lessons.entries()) {
            const row = rows.find((r) => !taken.has(r.id) && sameLesson(r, l));
            const fields = { position: i, title: l.title, minutes: l.minutes, body: l.body ? l.body : null };
            let lessonId: string;
            if (row) {
              taken.add(row.id);
              lessonId = row.id;
              // A video lesson keeps its link (pasted by an administrator; never part of the starter content).
              await tx.trainingLesson.update({ where: { id: row.id }, data: { ...fields, updatedAt: at } });
            } else {
              lessonId = (await tx.trainingLesson.create({ data: { courseId, kind: l.kind, changedVersion: 1, ...fields, updatedAt: at }, select: { id: true } })).id;
            }
            if (l.kind === 'GUIDE') {
              await tx.trainingStep.deleteMany({ where: { lessonId } });
              await tx.trainingStep.createMany({
                data: l.steps.map((st, j) => {
                  const imageFileId = st.image ? (fileIds.get(st.image) ?? null) : null;
                  return { lessonId, position: j, title: st.title || null, body: st.body || null, imageFileId, imageAlt: imageFileId ? (st.alt ?? null) : null };
                }),
              });
              // R3: a saved place never past the guide's last step.
              const last = Math.max(0, l.steps.length - 1);
              await tx.trainingProgress.updateMany({ where: { lessonId, stepIndex: { gt: last } }, data: { stepIndex: last } });
            } else if (l.kind === 'QUIZ') {
              const settings = { passMark: l.quiz.passMark, maxAttempts: l.quiz.maxAttempts, shuffle: l.quiz.shuffle, timeLimitMinutes: l.quiz.timeLimitMinutes, drawCount: l.quiz.drawCount };
              const quiz = await tx.trainingQuiz.upsert({ where: { lessonId }, create: { lessonId, ...settings }, update: settings });
              // Attempts keep their own copy of the questions (R3): rewriting them never changes a mark.
              const free = new Map((row?.quiz?.questions ?? []).map((q) => [q.id, q]));
              for (const [j, q] of l.quiz.questions.entries()) {
                const match = [...free.values()].find((e) => e.kind === q.kind && e.prompt === q.prompt);
                if (match) free.delete(match.id);
                const qid = match
                  ? (await tx.trainingQuestion.update({ where: { id: match.id }, data: { position: j, explanation: q.explanation ?? null } })).id
                  : (await tx.trainingQuestion.create({ data: { quizId: quiz.id, position: j, kind: q.kind, prompt: q.prompt, explanation: q.explanation ?? null } })).id;
                const oldOptions = new Map((match?.options ?? []).map((o) => [o.id, o]));
                for (const [k, o] of q.options.entries()) {
                  const om = [...oldOptions.values()].find((e) => e.text === o.text);
                  if (om) {
                    oldOptions.delete(om.id);
                    await tx.trainingOption.update({ where: { id: om.id }, data: { position: k, correct: o.correct, feedback: o.feedback ?? null } });
                  } else await tx.trainingOption.create({ data: { questionId: qid, position: k, text: o.text, correct: o.correct, feedback: o.feedback ?? null } });
                }
                if (oldOptions.size) await tx.trainingOption.deleteMany({ where: { id: { in: [...oldOptions.keys()] } } });
              }
              if (free.size) await tx.trainingQuestion.deleteMany({ where: { id: { in: [...free.keys()] } } });
            }
          }
          // Lessons the new content no longer has (their progress rows stay and are ignored: R10). Review M3: a video
          // lesson with a pasted link is never removed (a later revision that forgot its title keeps it, at the end).
          const left = rows.filter((r) => !taken.has(r.id));
          const gone = left.filter((r) => !(r.kind === 'VIDEO' && r.videoId)).map((r) => r.id);
          if (gone.length) await tx.trainingLesson.deleteMany({ where: { id: { in: gone } } });
          for (const [k, r] of left.filter((x) => x.kind === 'VIDEO' && x.videoId).entries()) {
            await tx.trainingLesson.update({ where: { id: r.id }, data: { position: course.lessons.length + k, updatedAt: at } });
          }

          // Starter files nothing uses any more (an administrator's own uploads are never touched).
          const used = new Set([
            ...(await tx.trainingStep.findMany({ where: { lesson: { courseId }, imageFileId: { not: null } }, select: { imageFileId: true } })).map((x) => x.imageFileId!),
            ...(await tx.trainingLesson.findMany({ where: { courseId, fileId: { not: null } }, select: { fileId: true } })).map((x) => x.fileId!),
          ]);
          const resources = new Set((course.resources ?? []).map((r) => fileIds.get(r.file)).filter((x): x is string => !!x));
          const stale = (await tx.trainingFile.findMany({ where: { courseId, starter: true }, select: { id: true, kind: true, storageKey: true } })).filter((f) => !used.has(f.id) && !(f.kind === 'RESOURCE' && resources.has(f.id)));
          if (stale.length) await tx.trainingFile.deleteMany({ where: { id: { in: stale.map((f) => f.id) } } });

          await tx.trainingCourse.update({
            where: { id: courseId },
            data: {
              title: course.title,
              summary: course.summary || null,
              moduleKey: course.moduleKey,
              audience: course.audience,
              roleKeys: course.roleKeys && course.roleKeys.length ? [...course.roleKeys] : Prisma.DbNull,
              difficulty: course.difficulty,
              completionRule: course.completionRule,
              certificateOn: course.certificateOn,
              certificateMonths: course.certificateMonths,
              position,
              updatedAt: at,
            },
          });
          return stale.map((f) => f.storageKey);
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
      for (const k of removedKeys) await files.remove(k).catch(() => {});
    } catch (err) {
      await Promise.all(saved.map((k) => files.remove(k).catch(() => {})));
      throw err;
    }
  }

  /** R4: an earlier draft video course — its link goes into the module course's video lesson; removed when it can go. */
  async function foldRetired(into: Map<string, string>): Promise<void> {
    for (const r of retired) {
      const v = await prisma.trainingCourse.findUnique({ where: { starterKey: r.key }, include: { lessons: true } });
      const target = into.get(r.into);
      // Its module course was edited (or deleted): the video has nowhere else to go, so the course stays.
      if (!v || !target) continue;
      const linked = v.lessons.find((l) => l.kind === 'VIDEO' && l.videoId);
      if (linked) {
        const lesson = await prisma.trainingLesson.findFirst({ where: { courseId: target, kind: 'VIDEO' }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
        // Shown at once, without counting as an edit (the lesson keeps its stamp).
        if (lesson && !lesson.videoId) {
          await prisma.trainingLesson.update({ where: { id: lesson.id }, data: { videoProvider: linked.videoProvider, videoId: linked.videoId, videoHash: linked.videoHash, videoUrl: linked.videoUrl, updatedAt: lesson.updatedAt } });
          deps.logger?.info('Learning Hub: a video link was moved into its course', { from: r.key, into: r.into });
        }
        continue; // kept: someone added a link to it (an administrator can remove it)
      }
      if (v.status !== 'DRAFT' || v.publishedAt || v.updatedById !== null) continue;
      // Review M2: a lesson an administrator changed (its stamp moved after it was made) counts as an edit too.
      if (v.lessons.some((l) => l.updatedAt.getTime() - l.createdAt.getTime() > 2_000)) continue;
      if ((await prisma.trainingEnrolment.count({ where: { courseId: v.id } })) > 0) continue;
      const own = await prisma.trainingFile.findMany({ where: { courseId: v.id }, select: { storageKey: true } });
      await prisma.$transaction([
        prisma.trainingFeedback.deleteMany({ where: { courseId: v.id } }),
        prisma.trainingAssignee.deleteMany({ where: { courseId: v.id } }),
        prisma.trainingAssignment.deleteMany({ where: { courseId: v.id } }),
        prisma.trainingFile.deleteMany({ where: { courseId: v.id } }),
        prisma.trainingCourse.delete({ where: { id: v.id } }),
      ]);
      for (const f of own) await files.remove(f.storageKey).catch(() => {});
      deps.logger?.info('Learning Hub: an unused draft video course was removed (its video is a lesson in its course now)', { key: r.key });
    }
  }

  async function update(): Promise<number> {
    if ((await prisma.systemSetting.count({ where: { key: STARTER_LOADED_KEY } })) === 0) return 0;
    const noted = await readRevision();
    const prev = noted ?? { revision: 1, keys: [...legacyKeys] };
    if (prev.revision >= revision) return 0;
    let updated = 0;
    let failed = 0;
    /** Starter key → course id, for the courses now on the new content (updated or new). */
    const current = new Map<string, string>();
    for (const [i, raw] of courses.entries()) {
      const course = normalizeStarterCourse(raw, (w) => warn(`Training starter: ${w}`, { course: raw.key }));
      const row = await prisma.trainingCourse.findUnique({ where: { starterKey: course.key }, include: { lessons: { select: { updatedAt: true } } } });
      if (!row) {
        // Deleted by an administrator: never comes back. A key never loaded before: a new starter course.
        if (prev.keys.includes(course.key)) continue;
        const out = await loadOne(raw, positionOf(raw, i));
        if (out === 'failed') failed++;
        else if (out === 'loaded') updated++;
        const made = await prisma.trainingCourse.findUnique({ where: { starterKey: course.key }, select: { id: true } });
        if (made) current.set(course.key, made.id);
        continue;
      }
      if (!untouchedStarter(row, row.lessons)) continue;
      try {
        await bringUpToDate(row.id, course, positionOf(raw, i));
        current.set(course.key, row.id);
        updated++;
      } catch (err) {
        if (err instanceof EditedMeanwhile) continue;
        failed++;
        warn('Training starter: a starter course could not be brought up to date; it is tried again at the next start.', { course: course.key, err: (err as Error)?.message ?? String(err) });
      }
    }
    try {
      await foldRetired(current);
    } catch (err) {
      failed++;
      warn('Training starter: an earlier video course could not be folded in; it is tried again at the next start.', { err: (err as Error)?.message ?? String(err) });
    }
    if (deps.recheck && current.size) {
      try {
        await deps.recheck([...current.values()]);
      } catch (err) {
        warn('Training starter: finishing could not be checked again after the update.', { err: (err as Error)?.message ?? String(err) });
      }
    }
    if (failed === 0) await writeRevision(revision, [...prev.keys, ...courses.map((c) => c.key)]);
    if (updated) deps.logger?.info('Learning Hub: starter courses brought up to date', { updated, revision });
    return updated;
  }

  async function run(): Promise<StarterRun> {
    const out: StarterRun = await load();
    const updated = await update();
    return updated ? { ...out, updated } : out;
  }

  let running: Promise<StarterRun> | null = null;
  return {
    run() {
      if (!running) running = run().finally(() => (running = null));
      return running;
    },
  };
}
