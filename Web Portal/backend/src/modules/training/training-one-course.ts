import { Prisma, type PrismaClient, type TrainingAssignee, type TrainingEnrolment, type TrainingRule } from '@prisma/client';
import { withRowLock, withSentinelLock } from '../../lib/sentinel-lock';
import { daysBetween, shiftDay } from '../../lib/working-days';
import { LEGACY_STARTER_KEYS, SHORT_COURSE_MODULES, STARTER_COURSES, USER_TRAINING_KEY } from './starter/starter-courses';
import type { StarterCourse } from './starter/starter-types';
import { courseFacts, type TrainingContext } from './training-context';
import { COURSE, type CourseRow, type TrainingFinish } from './training-finish';
import type { TrainingFileStore } from './training-files';
import { allUnitsDone } from './training-modules';
import { readSetting, stringList, type PersonRecord } from './prisma-training-store';
import { loadStates, pairKey } from './training-read';
import { retakeActive } from './training-state';
import { createTrainingSync, type TrainingSync } from './training-sync';
import { assigneeDueDay, reaches, type AssignmentFacts } from './training-targets';
import { applyStarterLessons, normalizeStarterCourse, pictureMimeOf, readStarterAsset, starterAssetsDir, STARTER_REVISION_KEY, untouchedStarter } from './training-starter';

/**
 * Learning Hub as one course (1.23.31): the one-time conversion of a site that has the built-in short courses of
 * 1.23.27 into "MICO360 Tasks User Training", run first in the starter update to revision 3 (training-starter.ts
 * `convert`, under the "training-starter" job lock at boot). Its record `training.oneCourse` (system settings) is
 * written after each phase, so a start that stops half-way goes on from there at the next one, and a done record
 * makes it a no-op. Owner's anti-goals: nobody loses a completed lesson, module, quiz pass or certificate; no burst of
 * emails or reminders on the day; a half-way stop leaves the site usable.
 *
 *   content      one transaction (the sentinel lock "training-one-course" first): the course and its modules; each
 *                untouched, published short course's lessons (same ids), pictures, progress, attempts and questions
 *                move in, the content is written over them (applyStarterLessons, once, with the whole course), and
 *                the short course is archived; an edited one stays (C1: its module gets the built-in lessons); a
 *                removed one (deleted, archived, unpublished) gives a module switched off (C2). Pictures the moved
 *                lessons don't bring are copied in before the transaction (removed again if it fails).
 *   people       one enrolment on the course per person who had one on a short course (or progress on a moved
 *                lesson); each short course finished (before the change) is its module done (CONVERTED); the merged
 *                courses' enrolments are hidden (rows kept).
 *   assignments  each target's assignments of the published short courses become one (D2 dates), with its people
 *                (and anyone else it reaches today) written straight away, so the sync sends no notice; the old ones
 *                withdrawn in the same transaction; rules name the course.
 *   finish       anyone with every module they see done is finished on the day of their last one, quietly, with the
 *                certificate; the client guide's certificate is switched on (C3) and its finished clients get theirs.
 *   done         one bell-only line per enrolled staff member, written straight into notifications (never through
 *                the notification service, which may also push and email), once.
 *
 * Writes a learner's request can race (enrolments, module records, progress) are single statements (updateMany /
 * createMany skipping duplicates), never update()/upsert(); no isolation level is ever set.
 */

export const ONE_COURSE_KEY = 'training.oneCourse';
const LOCK = 'training-one-course';
/** The content transaction writes the whole course: more time than the sentinel lock's default. */
const CONTENT_TIMEOUT_MS = 120_000;
/** D2: converted assignments are due no sooner than this many days after the change. */
const MIN_DAYS = 30;

const PHASES = ['content', 'people', 'assignments', 'finish', 'done'] as const;
export type OneCoursePhase = (typeof PHASES)[number];

/** Where an old course or lesson lives now. */
export interface OneCourseTarget {
  courseId: string;
  moduleId: string | null;
}

export interface OneCourseRecord {
  /** The last phase finished. */
  phase: OneCoursePhase;
  /** The change (ISO): every stamp the conversion writes, and the day D2 counts from. */
  at: string;
  courseId: string;
  /** Merged short course id → the course and its module (old links: COURSE_MOVED). */
  moved: Record<string, OneCourseTarget>;
  /** Lessons removed as duplicates → where their module is. */
  removedLessons: Record<string, OneCourseTarget>;
  /** Edited short courses left as they are (C1; Manage shows the notice). */
  notMerged: string[];
  /** When the bell lines were written; null: not yet. */
  noticesAt: string | null;
}

export interface OneCourseDeps {
  prisma: PrismaClient;
  files: TrainingFileStore;
  ctx: TrainingContext;
  finish: TrainingFinish;
  /** The membership sync (its enrolment settling); default: made from `ctx`. */
  sync?: TrainingSync;
  /** The combined course's content (default: the shipped "MICO360 Tasks User Training"). */
  content?: StarterCourse;
  /** The client guide's starter key (C3). */
  portalKey?: string;
  /** Each short course's starter key → the module (a StarterModule key) it becomes. */
  shortCourses?: readonly { courseKey: string; module: string }[];
  assetsDir?: string | null;
  /** The record's settings key (tests use their own). */
  recordKey?: string;
  /** The starter keys this site has loaded (default: its noted revision's; before any was noted, revision 1's). */
  loadedKeys?: () => Promise<readonly string[]>;
  /** Tests: stop (throw) after this phase. */
  failAfter?: OneCoursePhase;
}

// ── The date rules (pure) ─────────────────────────────────────────────────────────────────────────

type Due = { dueDay: string | null; dueDays: number | null };

/**
 * D2 (lane ruling): one target's assignments merged — no due date only when none had one; a fixed day: the later of
 * the change day + 30 and the latest old day; relative days: the largest, at least 30. Fixed and relative together
 * (builder's call): relative days, no fewer than the days left to the latest fixed day (each later joiner gets the
 * longest of them).
 */
export function mergedDue(rows: readonly Due[], changeDay: string): Due {
  const fixed = rows.map((r) => r.dueDay).filter((d): d is string => !!d).sort();
  const relative = rows.map((r) => r.dueDays).filter((n): n is number => n !== null && n > 0);
  const latest = fixed[fixed.length - 1];
  if (relative.length > 0) return { dueDay: null, dueDays: Math.max(MIN_DAYS, ...relative, latest ? daysBetween(changeDay, latest) : 0) };
  if (latest) {
    const floor = shiftDay(changeDay, MIN_DAYS);
    return { dueDay: latest > floor ? latest : floor, dueDays: null };
  }
  return { dueDay: null, dueDays: null };
}

/** A person the old assignments reached: the latest of their own days and `floorDay` (change + 30); none when none of theirs had one and the assignment has none. */
export function assigneeDueOf(theirs: readonly (string | null)[], merged: Due, floorDay: string): string | null {
  const days = theirs.filter((d): d is string => !!d);
  if (days.length === 0 && merged.dueDay === null && merged.dueDays === null) return null;
  return [...days, floorDay].sort()[days.length]!;
}

/** A rule's courses with the short courses replaced by the one course (once, in place); null when it names none of them. */
export function mergedRuleCourses(courseIds: readonly string[], shortIds: ReadonlySet<string>, courseId: string): string[] | null {
  if (!courseIds.some((id) => shortIds.has(id))) return null;
  const out: string[] = [];
  for (const id of courseIds) {
    const next = shortIds.has(id) ? courseId : id;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────

type Db = PrismaClient | Prisma.TransactionClient;
const WITH_QUIZ = { quiz: { include: { questions: { include: { options: true } } } } } as const;

function chunks<T>(list: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

const earliest = (list: readonly (Date | null | undefined)[]): Date | null => list.reduce<Date | null>((a, d) => (d && (!a || d.getTime() < a.getTime()) ? d : a), null);
const latestOf = (list: readonly (Date | null | undefined)[]): Date | null => list.reduce<Date | null>((a, d) => (d && (!a || d.getTime() > a.getTime()) ? d : a), null);

/** What happened to a short course: moved in (untouched, published), kept (edited, C1), removed (C2), or never on this site. */
type ShortKind = 'merged' | 'edited' | 'removed' | 'new';
interface ShortCourse {
  courseKey: string;
  module: string;
  id: string | null;
  kind: ShortKind;
}

/** A picture copied into the private folder before the content transaction. */
interface CopiedPicture {
  image: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

/** The enrolment a person gets on the course, from their short courses' ones. */
interface WantedEnrolment {
  createdAt: Date;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  lastLessonId: string | null;
  selfStarted: boolean;
  withdrawnAt: Date | null;
}

export function createOneCourseConversion(d: OneCourseDeps): { run(): Promise<{ courseId: string } | null> } {
  const { prisma, files, ctx, finish } = d;
  const sync = d.sync ?? createTrainingSync(ctx);
  const raw = d.content ?? STARTER_COURSES.find((c) => c.key === USER_TRAINING_KEY)!;
  const portalKey = d.portalKey ?? 'starter:portal';
  const shortCourses = d.shortCourses ?? SHORT_COURSE_MODULES;
  const shortKeys = shortCourses.map((s) => s.courseKey);
  const assetsDir = d.assetsDir === undefined ? starterAssetsDir() : d.assetsDir;
  const recordKey = d.recordKey ?? ONE_COURSE_KEY;
  const warn = (message: string, meta?: Record<string, unknown>) => ctx.logger?.warn(message, meta);
  const loadedKeys =
    d.loadedKeys ??
    (async (): Promise<readonly string[]> => {
      const noted = await readSetting<{ keys?: unknown }>(prisma, STARTER_REVISION_KEY);
      return noted && Array.isArray(noted.keys) ? stringList(noted.keys) : LEGACY_STARTER_KEYS;
    });

  // ── The record ──

  async function readRecord(db: Db = prisma): Promise<OneCourseRecord | null> {
    const row = await db.systemSetting.findUnique({ where: { key: recordKey } });
    const v = row?.value as Partial<OneCourseRecord> | null | undefined;
    if (!v || typeof v !== 'object' || typeof v.courseId !== 'string' || typeof v.at !== 'string' || !PHASES.includes(v.phase as OneCoursePhase)) return null;
    return {
      phase: v.phase as OneCoursePhase,
      at: v.at,
      courseId: v.courseId,
      moved: v.moved && typeof v.moved === 'object' ? v.moved : {},
      removedLessons: v.removedLessons && typeof v.removedLessons === 'object' ? v.removedLessons : {},
      notMerged: stringList(v.notMerged),
      noticesAt: typeof v.noticesAt === 'string' ? v.noticesAt : null,
    };
  }

  async function writeRecord(r: OneCourseRecord, db: Db = prisma): Promise<void> {
    const value = JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue;
    await db.systemSetting.upsert({ where: { key: recordKey }, create: { key: recordKey, value }, update: { value } });
  }

  /** Did this site ever load a short course (one is there, or its noted keys name one)? */
  async function everLoaded(loaded: ReadonlySet<string>): Promise<boolean> {
    if ((await prisma.trainingCourse.count({ where: { starterKey: { in: shortKeys } } })) > 0) return true;
    return shortKeys.some((k) => loaded.has(k));
  }

  async function classify(db: Db, loaded: ReadonlySet<string>): Promise<ShortCourse[]> {
    const rows = await db.trainingCourse.findMany({
      where: { starterKey: { in: shortKeys } },
      select: { id: true, starterKey: true, status: true, version: true, updatedById: true, publishedAt: true, lessons: { select: { updatedAt: true } } },
    });
    return shortCourses.map((s): ShortCourse => {
      const row = rows.find((r) => r.starterKey === s.courseKey);
      // Not on the site: an administrator deleted it (C2), or it came in a revision this site never had.
      if (!row) return { courseKey: s.courseKey, module: s.module, id: null, kind: loaded.has(s.courseKey) ? 'removed' : 'new' };
      if (row.status !== 'PUBLISHED') return { courseKey: s.courseKey, module: s.module, id: row.id, kind: 'removed' };
      return { courseKey: s.courseKey, module: s.module, id: row.id, kind: untouchedStarter(row, row.lessons) ? 'merged' : 'edited' };
    });
  }

  const sameBytes = async (storageKey: string, content: Buffer) => {
    try {
      return (await files.read(storageKey)).equals(content);
    } catch {
      return false;
    }
  };

  /** The content's pictures: the moved courses' own copy when it is the same bytes, else a new copy in the private folder. */
  async function preparePictures(content: StarterCourse, mergedIds: readonly string[], saved: string[]): Promise<{ reuse: Map<string, string>; copied: CopiedPicture[] }> {
    const wanted: string[] = [];
    for (const l of content.lessons) if (l.kind === 'GUIDE') for (const st of l.steps) if (st.image && !wanted.includes(st.image)) wanted.push(st.image);
    const candidates = mergedIds.length
      ? await prisma.trainingFile.findMany({ where: { courseId: { in: [...mergedIds] }, starter: true, kind: 'IMAGE' }, orderBy: [{ position: 'asc' }, { id: 'asc' }] })
      : [];
    const reuse = new Map<string, string>();
    const copied: CopiedPicture[] = [];
    for (const image of wanted) {
      const a = await readStarterAsset(assetsDir, content.key, image, pictureMimeOf(image), 'IMAGE', image, warn);
      if (!a) continue; // warned: the step is text-only
      let kept: string | null = null;
      for (const f of candidates.filter((x) => x.name === a.name && x.sizeBytes === a.content.length)) {
        if (await sameBytes(f.storageKey, a.content)) {
          kept = f.id;
          break;
        }
      }
      if (kept) {
        reuse.set(image, kept);
        continue;
      }
      const storageKey = await files.save(a.content, a.mimeType);
      saved.push(storageKey);
      copied.push({ image, name: a.name, mimeType: a.mimeType, sizeBytes: a.content.length, storageKey });
    }
    return { reuse, copied };
  }

  // ── Phase 1: content ──

  /** Inside the content transaction: the course, its modules, the moved short courses, the content over them, the record. */
  async function writeContent(tx: Prisma.TransactionClient, content: StarterCourse, plan: readonly ShortCourse[], pictures: { reuse: Map<string, string>; copied: CopiedPicture[] }, at: Date) {
    const courseId = (
      await tx.trainingCourse.create({
        data: {
          title: content.title,
          summary: content.summary || null,
          moduleKey: content.moduleKey,
          audience: content.audience,
          ...(content.roleKeys && content.roleKeys.length ? { roleKeys: [...content.roleKeys] } : {}),
          difficulty: content.difficulty,
          status: 'PUBLISHED',
          completionRule: content.completionRule,
          inOrder: false,
          certificateOn: content.certificateOn,
          certificateMonths: content.certificateMonths,
          version: 1,
          starterKey: content.key,
          position: content.position ?? 0,
          createdById: null,
          publishedAt: at,
          updatedAt: at,
        },
        select: { id: true },
      })
    ).id;

    // The modules first, each switched on or off by what happened to its short course (applyStarterLessons never
    // changes that, nor where a module came from).
    const shortOf = new Map(plan.map((s) => [s.module, s]));
    const moduleIds = new Map<string, string>();
    for (const [i, m] of (content.modules ?? []).entries()) {
      const s = shortOf.get(m.key);
      const off = s?.kind === 'removed';
      const row = await tx.trainingModule.create({
        data: {
          courseId,
          starterKey: m.key,
          position: i,
          title: m.title,
          moduleKey: m.moduleKey,
          ...(m.roleKeys && m.roleKeys.length ? { roleKeys: [...m.roleKeys] } : {}),
          enabled: !off,
          offReason: off ? 'REMOVED' : null,
          fromCourseId: s?.id ?? null,
          updatedAt: at,
        },
        select: { id: true },
      });
      moduleIds.set(m.key, row.id);
    }

    // Untouched short courses move in: their lessons keep their ids, so progress, attempts and links keep working.
    const moved: Record<string, OneCourseTarget> = {};
    const originOf = new Map<string, string | null>();
    for (const s of plan.filter((x) => x.kind === 'merged')) {
      const shortId = s.id!;
      const moduleId = moduleIds.get(s.module) ?? null;
      for (const l of await tx.trainingLesson.findMany({ where: { courseId: shortId }, select: { id: true } })) originOf.set(l.id, moduleId);
      await tx.trainingLesson.updateMany({ where: { courseId: shortId }, data: { courseId, moduleId, updatedAt: at } });
      await tx.trainingProgress.updateMany({ where: { courseId: shortId }, data: { courseId } });
      await tx.trainingAttempt.updateMany({ where: { courseId: shortId }, data: { courseId } });
      await tx.trainingFile.updateMany({ where: { courseId: shortId }, data: { courseId } });
      // Questions and "outdated" reports are about lessons (now here); ratings stay with the course they rated.
      await tx.trainingFeedback.updateMany({ where: { courseId: shortId, kind: { in: ['QUESTION', 'OUTDATED'] } }, data: { courseId } });
      await tx.trainingCourse.updateMany({ where: { id: shortId }, data: { status: 'ARCHIVED' } });
      moved[shortId] = { courseId, moduleId };
    }

    const fileIds = new Map(pictures.reuse);
    let position = ((await tx.trainingFile.findFirst({ where: { courseId }, orderBy: [{ position: 'desc' }], select: { position: true } }))?.position ?? -1) + 1;
    for (const f of pictures.copied) {
      const row = await tx.trainingFile.create({ data: { courseId, kind: 'IMAGE', name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, storageKey: f.storageKey, position: position++, starter: true }, select: { id: true } });
      fileIds.set(f.image, row.id);
    }

    // The whole content at once, over every moved lesson: a lesson kept keeps its id and goes into its module; a
    // module whose short course wasn't moved gets the built-in lessons fresh (C1a, C2); duplicates go.
    const rows = await tx.trainingLesson.findMany({ where: { courseId }, include: WITH_QUIZ, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const { removedLessonIds } = await applyStarterLessons(tx, courseId, content, rows, fileIds, at);
    const removedLessons: Record<string, OneCourseTarget> = {};
    for (const id of removedLessonIds) removedLessons[id] = { courseId, moduleId: originOf.get(id) ?? null };

    // Starter pictures no step uses any more (a moved course's duplicate copy); an administrator's own uploads stay.
    const used = new Set([
      ...(await tx.trainingStep.findMany({ where: { lesson: { courseId }, imageFileId: { not: null } }, select: { imageFileId: true } })).map((x) => x.imageFileId!),
      ...(await tx.trainingLesson.findMany({ where: { courseId, fileId: { not: null } }, select: { fileId: true } })).map((x) => x.fileId!),
    ]);
    const stale = (await tx.trainingFile.findMany({ where: { courseId, starter: true }, select: { id: true, storageKey: true } })).filter((f) => !used.has(f.id));
    if (stale.length) await tx.trainingFile.deleteMany({ where: { id: { in: stale.map((f) => f.id) } } });

    // Published with nothing changed since (Manage's "Changes not published", the next built-in update).
    await tx.trainingCourse.update({ where: { id: courseId }, data: { updatedAt: at } });

    const record: OneCourseRecord = {
      phase: 'content',
      at: at.toISOString(),
      courseId,
      moved,
      removedLessons,
      notMerged: plan.filter((s) => s.kind === 'edited').map((s) => s.id!),
      noticesAt: null,
    };
    await writeRecord(record, tx);
    return { record, stale: stale.map((f) => f.storageKey) };
  }

  async function convertContent(at: Date, loaded: ReadonlySet<string>): Promise<OneCourseRecord> {
    const content = normalizeStarterCourse(raw, (w) => warn(`Learning Hub: ${w}`, { course: raw.key }));
    const plan = await classify(prisma, loaded);
    const saved: string[] = [];
    try {
      const pictures = await preparePictures(
        content,
        plan.filter((s) => s.kind === 'merged').map((s) => s.id!),
        saved,
      );
      const out = await withSentinelLock(
        prisma,
        LOCK,
        async (tx) => {
          // Another server got here first: its record stands.
          const already = await readRecord(tx);
          if (already) return { record: already, stale: [] as string[], made: false };
          if ((await tx.trainingCourse.count({ where: { starterKey: content.key } })) > 0) throw new Error('The one course is already on this site without its conversion record; nothing was changed.');
          // An administrator changed a short course since the pictures were got ready: tried again at the next start.
          if (JSON.stringify(await classify(tx, loaded)) !== JSON.stringify(plan)) throw new Error('A built-in course changed while the conversion was getting ready; it is tried again at the next start.');
          return { ...(await writeContent(tx, content, plan, pictures, at)), made: true };
        },
        { timeoutMs: CONTENT_TIMEOUT_MS },
      );
      if (!out.made) await Promise.all(saved.map((k) => files.remove(k).catch(() => {})));
      for (const k of out.stale) await files.remove(k).catch(() => {});
      return out.record;
    } catch (err) {
      await Promise.all(saved.map((k) => files.remove(k).catch(() => {})));
      throw err;
    }
  }

  // ── Phase 2: people ──

  function wantedEnrolment(sources: readonly TrainingEnrolment[], merged: ReadonlySet<string>, lessonIds: ReadonlySet<string>, at: Date): WantedEnrolment {
    // Where they stopped: the lesson of their latest merged course, when it is in the course now.
    const lastLessonId =
      [...sources]
        .filter((e) => merged.has(e.courseId) && e.lastLessonId && lessonIds.has(e.lastLessonId))
        .sort((x, y) => (y.lastActivityAt?.getTime() ?? 0) - (x.lastActivityAt?.getTime() ?? 0))[0]?.lastLessonId ?? null;
    // Withdrawn only when every one of theirs was (one the conversion hid itself, stamped `at`, wasn't).
    const withdrawn = sources.length > 0 && sources.every((e) => e.withdrawnAt && e.withdrawnAt.getTime() !== at.getTime());
    return {
      createdAt: earliest(sources.map((e) => e.createdAt)) ?? at,
      startedAt: earliest(sources.map((e) => e.startedAt)),
      lastActivityAt: latestOf(sources.map((e) => e.lastActivityAt)),
      lastLessonId,
      selfStarted: sources.some((e) => e.selfStarted),
      withdrawnAt: withdrawn ? latestOf(sources.map((e) => e.withdrawnAt)) : null,
    };
  }

  /** A row already there (an earlier try, or the person opened the course meanwhile): moved forward, never back — one guarded statement each. */
  async function mergeEnrolment(e: TrainingEnrolment, w: WantedEnrolment): Promise<void> {
    if (w.createdAt.getTime() < e.createdAt.getTime()) await prisma.trainingEnrolment.updateMany({ where: { id: e.id, createdAt: { gt: w.createdAt } }, data: { createdAt: w.createdAt } });
    if (w.startedAt && (!e.startedAt || w.startedAt.getTime() < e.startedAt.getTime())) {
      await prisma.trainingEnrolment.updateMany({ where: { id: e.id, OR: [{ startedAt: null }, { startedAt: { gt: w.startedAt } }] }, data: { startedAt: w.startedAt } });
    }
    if (w.lastActivityAt && (!e.lastActivityAt || w.lastActivityAt.getTime() > e.lastActivityAt.getTime())) {
      await prisma.trainingEnrolment.updateMany({
        where: { id: e.id, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: w.lastActivityAt } }] },
        data: { lastActivityAt: w.lastActivityAt, ...(w.lastLessonId ? { lastLessonId: w.lastLessonId } : {}) },
      });
    } else if (w.lastLessonId && !e.lastLessonId) {
      await prisma.trainingEnrolment.updateMany({ where: { id: e.id, lastLessonId: null }, data: { lastLessonId: w.lastLessonId } });
    }
    if (w.selfStarted && !e.selfStarted) await prisma.trainingEnrolment.updateMany({ where: { id: e.id, selfStarted: false }, data: { selfStarted: true } });
  }

  async function convertPeople(r: OneCourseRecord): Promise<{ people: number; modulesDone: number }> {
    const at = new Date(r.at);
    const courseId = r.courseId;
    const merged = new Set(Object.keys(r.moved));
    const moduleOf = new Map((await prisma.trainingModule.findMany({ where: { courseId, fromCourseId: { not: null } }, select: { id: true, fromCourseId: true } })).map((m) => [m.fromCourseId!, m.id]));
    const lessonIds = new Set((await prisma.trainingLesson.findMany({ where: { courseId }, select: { id: true } })).map((l) => l.id));
    // A learner's write that reached a merged course while its lessons were moving (that very moment) follows them.
    if (merged.size && lessonIds.size) {
      const where = { courseId: { in: [...merged] }, lessonId: { in: [...lessonIds] } };
      await prisma.trainingProgress.updateMany({ where, data: { courseId } });
      await prisma.trainingAttempt.updateMany({ where, data: { courseId } });
    }

    const sourceIds = [...moduleOf.keys()];
    const sources = sourceIds.length ? await prisma.trainingEnrolment.findMany({ where: { courseId: { in: sourceIds } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) : [];
    const byUser = new Map<string, TrainingEnrolment[]>();
    for (const e of sources) push(byUser, e.userId, e);
    for (const p of await prisma.trainingProgress.groupBy({ by: ['userId'], where: { courseId } })) if (!byUser.has(p.userId)) byUser.set(p.userId, []);

    const people = [...byUser.keys()];
    const wanted = new Map(people.map((u) => [u, wantedEnrolment(byUser.get(u)!, merged, lessonIds, at)]));
    for (const part of chunks(people)) {
      const have = new Set((await prisma.trainingEnrolment.findMany({ where: { courseId, userId: { in: part } }, select: { userId: true } })).map((e) => e.userId));
      const fresh = part.filter((u) => !have.has(u));
      if (fresh.length) await prisma.trainingEnrolment.createMany({ data: fresh.map((userId) => ({ userId, courseId, ...wanted.get(userId)! })), skipDuplicates: true });
      for (const e of await prisma.trainingEnrolment.findMany({ where: { courseId, userId: { in: part } } })) await mergeEnrolment(e, wanted.get(e.userId)!);
    }

    // Each short course finished before the change is its module done, on that day (the earlier day wins).
    const done: { userId: string; courseId: string; moduleId: string; doneAt: Date; via: string }[] = [];
    for (const e of sources) {
      const moduleId = moduleOf.get(e.courseId);
      if (!moduleId || !e.completedAt || retakeActive(e)) continue;
      // C1b: an edited course counts only up to the change (afterwards it is an ordinary course).
      if (e.completedAt.getTime() > at.getTime()) continue;
      done.push({ userId: e.userId, courseId, moduleId, doneAt: e.completedAt, via: 'CONVERTED' });
    }
    for (const part of chunks(done)) {
      await prisma.trainingModuleDone.createMany({ data: part, skipDuplicates: true });
      const rows = await prisma.trainingModuleDone.findMany({ where: { courseId, userId: { in: [...new Set(part.map((x) => x.userId))] } }, select: { userId: true, moduleId: true, doneAt: true } });
      for (const x of part) {
        const row = rows.find((y) => y.userId === x.userId && y.moduleId === x.moduleId);
        if (row && row.doneAt.getTime() > x.doneAt.getTime()) {
          await prisma.trainingModuleDone.updateMany({ where: { userId: x.userId, moduleId: x.moduleId, doneAt: { gt: x.doneAt } }, data: { doneAt: x.doneAt } });
        }
      }
    }

    // The merged courses are empty now: their enrolments are hidden (rows kept; the module shows "Done (date)").
    if (merged.size) await prisma.trainingEnrolment.updateMany({ where: { courseId: { in: [...merged] }, withdrawnAt: null }, data: { withdrawnAt: at } });
    return { people: people.length, modulesDone: done.length };
  }

  // ── Phase 3: assignments ──

  const groupKey = (a: { targetKind: string; targetId: string; ruleId: string | null; newAccountsOnly: boolean; scopeCompanyIds: unknown }) =>
    JSON.stringify([a.targetKind, a.targetId, a.ruleId, a.newAccountsOnly, a.scopeCompanyIds === null ? null : [...stringList(a.scopeCompanyIds)].sort()]);

  async function convertRule(db: Db, rule: TrainingRule, shortIds: ReadonlySet<string>, courseId: string): Promise<boolean> {
    const next = mergedRuleCourses(stringList(rule.courseIds), shortIds, courseId);
    if (!next) return false;
    await db.trainingRule.updateMany({ where: { id: rule.id }, data: { courseIds: next, ...(rule.dueDays !== null && rule.dueDays > 0 ? { dueDays: Math.max(MIN_DAYS, rule.dueDays) } : {}) } });
    return true;
  }

  /** One target's assignments → one on the course, its people written now (no notice), the old ones withdrawn — one transaction. */
  async function mergeGroup(tx: Prisma.TransactionClient, ids: readonly string[], course: CourseRow, people: readonly PersonRecord[], shortIds: ReadonlySet<string>, at: Date): Promise<boolean> {
    const live = await tx.trainingAssignment.findMany({ where: { id: { in: [...ids] }, withdrawnAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    if (live.length === 0) return false; // an earlier try did it
    const first = live[0]!;
    const liveIds = live.map((a) => a.id);
    const today = ctx.dayOf(at);
    const floor = shiftDay(today, MIN_DAYS);
    const rule = first.ruleId ? await tx.trainingRule.findUnique({ where: { id: first.ruleId } }) : null;
    const due = mergedDue(live, today);
    const mandatory = live.some((a) => a.mandatory);
    // "New staff only" counts from when it was set up (people who joined since keep it); others from the change.
    const createdAt = rule?.createdAt ?? (first.ruleId || first.newAccountsOnly ? first.createdAt : at);
    const frozenAt = live.every((a) => a.frozenAt) ? earliest(live.map((a) => a.frozenAt)) : null;
    const batches = new Set(live.map((a) => a.batchId));
    const scope = first.scopeCompanyIds === null ? null : stringList(first.scopeCompanyIds);
    const made = await tx.trainingAssignment.create({
      data: {
        courseId: course.id,
        targetKind: first.targetKind,
        targetId: first.targetId,
        mandatory,
        dueDay: due.dueDay,
        dueDays: due.dueDays,
        ruleId: first.ruleId,
        newAccountsOnly: first.newAccountsOnly,
        scopeCompanyIds: scope === null ? Prisma.DbNull : scope,
        frozenAt,
        batchId: batches.size === 1 ? [...batches][0]! : null,
        createdById: rule?.createdById ?? first.createdById,
        createdAt,
      },
      select: { id: true },
    });

    // Everyone the old ones reached, with their own terms (mandatory if any of theirs was; the latest day, at least
    // 30 days on), and everyone else it reaches today — so the next sync has nobody new to tell.
    const rows = await tx.trainingAssignee.findMany({ where: { assignmentId: { in: liveIds }, withdrawnAt: null } });
    const theirs = new Map<string, TrainingAssignee[]>();
    for (const x of rows) push(theirs, x.userId, x);
    const data: Prisma.TrainingAssigneeCreateManyInput[] = [];
    for (const [userId, list] of theirs) {
      data.push({ assignmentId: made.id, userId, courseId: course.id, mandatory: list.some((x) => x.mandatory), dueDay: assigneeDueOf(list.map((x) => x.dueDay), due, floor), assignedAt: earliest(list.map((x) => x.assignedAt)) ?? at });
    }
    if (!frozenAt) {
      const facts: AssignmentFacts = { id: made.id, courseId: course.id, targetKind: first.targetKind, targetId: first.targetId, mandatory, dueDay: due.dueDay, dueDays: due.dueDays, newAccountsOnly: first.newAccountsOnly, scopeCompanyIds: scope, createdAt, createdDay: ctx.dayOf(createdAt), frozen: false };
      const cf = courseFacts(course);
      for (const p of people) {
        if (!theirs.has(p.id) && reaches(facts, cf, p)) data.push({ assignmentId: made.id, userId: p.id, courseId: course.id, mandatory, dueDay: assigneeDueDay(facts, facts.createdDay!, today), assignedAt: at });
      }
    }
    for (const part of chunks(data)) await tx.trainingAssignee.createMany({ data: part, skipDuplicates: true });

    await tx.trainingAssignment.updateMany({ where: { id: { in: liveIds }, withdrawnAt: null }, data: { withdrawnAt: at } });
    await tx.trainingAssignee.updateMany({ where: { assignmentId: { in: liveIds }, withdrawnAt: null }, data: { withdrawnAt: at } });
    if (rule) await convertRule(tx, rule, shortIds, course.id);
    return true;
  }

  async function convertAssignments(r: OneCourseRecord, course: CourseRow): Promise<number> {
    const at = new Date(r.at);
    // Published short courses only (merged or edited); a removed one's assignments stay where they are (ruling).
    const shortIds = new Set([...Object.keys(r.moved), ...r.notMerged]);
    let made = 0;
    if (shortIds.size) {
      const old = await prisma.trainingAssignment.findMany({ where: { courseId: { in: [...shortIds] }, withdrawnAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const groups = new Map<string, string[]>();
      for (const a of old) push(groups, groupKey(a), a.id);
      const people = groups.size ? [...(await ctx.people()).values()] : [];
      for (const ids of groups.values()) {
        if (await withSentinelLock(prisma, LOCK, (tx) => mergeGroup(tx, ids, course, people, shortIds, at))) made++;
      }
      // Rules none of whose assignments was live (switched off long ago, say) name the course too.
      for (const rule of await prisma.trainingRule.findMany()) await convertRule(prisma, rule, shortIds, course.id);
    }
    // Enrolments follow (made for people reached for the first time, the old courses' unfinished ones hidden as when
    // any assignment is withdrawn) — from the rows, so a try after a stop settles the groups done before it too.
    const touched = await prisma.trainingAssignee.findMany({
      where: { OR: [{ courseId: course.id, withdrawnAt: null }, ...(shortIds.size ? [{ courseId: { in: [...shortIds] }, withdrawnAt: at }] : [])] },
      select: { userId: true, courseId: true },
    });
    if (touched.length) await sync.settleEnrolments(touched);
    return made;
  }

  // ── Phase 4: finish ──

  async function convertFinish(r: OneCourseRecord, course: CourseRow): Promise<{ finished: number; clientCertificates: number }> {
    const at = new Date(r.at);
    let finished = 0;
    const ids = (await prisma.trainingEnrolment.findMany({ where: { courseId: course.id }, select: { userId: true }, orderBy: { userId: 'asc' } })).map((e) => e.userId);
    for (const part of chunks(ids, 200)) {
      const people = await ctx.people(part);
      const states = await loadStates(ctx, part.map((userId) => ({ userId, courseId: course.id })), people);
      for (const userId of part) {
        const s = states.get(pairKey(userId, course.id));
        if (!s?.enrolment) continue;
        const p = people.get(userId) ?? null;
        try {
          const status = s.state.status;
          if (status !== 'COMPLETED' && status !== 'REVIEW' && allUnitsDone(s.units)) {
            if (!p) continue; // a deleted account: its modules stay recorded
            // Finished on the day of their last module, quietly (no notice), with the certificate.
            const day = latestOf(s.units.map((u) => u.doneAt)) ?? at;
            if ((await finish.completeAt(userId, course, s, day, p)).completed) finished++;
          } else {
            // Modules done by their lessons recorded, the saved % brought up to date.
            await finish.settle(userId, course, s, { person: p });
          }
        } catch (err) {
          warn('Learning Hub: finishing could not be checked for one person at the change; they finish as they learn.', { userId, err: String((err as Error)?.message ?? err) });
        }
      }
    }
    return { finished, clientCertificates: await clientGuide() };
  }

  /** C3: the untouched client guide gives its certificate (switched on without counting as an edit); clients who finished it get theirs. */
  async function clientGuide(): Promise<number> {
    const portal = await prisma.trainingCourse.findUnique({ where: { starterKey: portalKey }, select: { id: true, certificateOn: true, updatedAt: true, updatedById: true, version: true, status: true, publishedAt: true, lessons: { select: { updatedAt: true } } } });
    if (!portal || !untouchedStarter(portal, portal.lessons)) return 0;
    if (!portal.certificateOn) await prisma.trainingCourse.updateMany({ where: { id: portal.id, certificateOn: false }, data: { certificateOn: true, updatedAt: portal.updatedAt } });
    const row = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: portal.id }, select: COURSE });
    const done = (await prisma.trainingEnrolment.findMany({ where: { courseId: portal.id, completedAt: { not: null } }, orderBy: { userId: 'asc' } })).filter((e) => !retakeActive(e));
    let issued = 0;
    for (const part of chunks(done, 200)) {
      const have = new Set((await prisma.trainingCertificate.findMany({ where: { courseId: portal.id, userId: { in: part.map((e) => e.userId) } }, select: { userId: true } })).map((c) => c.userId));
      const need = part.filter((e) => !have.has(e.userId));
      if (need.length === 0) continue;
      const people = await ctx.people(need.map((e) => e.userId));
      const states = await loadStates(ctx, need.map((e) => ({ userId: e.userId, courseId: portal.id })), people);
      for (const e of need) {
        const p = people.get(e.userId);
        if (!p?.client) continue;
        // Once, even with a second server at the same step: their enrolment locked first, "none yet" read again behind it.
        const made = await withRowLock(
          prisma,
          (tx) => tx.$queryRaw`SELECT id FROM training_enrolments WHERE id = ${e.id} FOR UPDATE`,
          async (tx) => {
            if ((await tx.trainingCertificate.count({ where: { courseId: portal.id, userId: e.userId } })) > 0) return false;
            await finish.issueCertificate(p, row, states.get(pairKey(e.userId, portal.id))!, { completedAt: e.completedAt! }, tx);
            return true;
          },
        );
        if (made) issued++;
      }
    }
    return issued;
  }

  // ── Phase 5: the bell line, once ──

  /** The number written, or null when another run had written them (that run says the conversion is done). */
  async function convertNotices(course: CourseRow): Promise<number | null> {
    const enrolled = (await prisma.trainingEnrolment.findMany({ where: { courseId: course.id, withdrawnAt: null }, select: { userId: true }, orderBy: { userId: 'asc' } })).map((e) => e.userId);
    const people = await ctx.people(enrolled);
    const staff = enrolled.filter((id) => {
      const p = people.get(id);
      return !!p && p.active && !p.client;
    });
    const title = `Your training is now one course: ${course.title}`.slice(0, 191);
    return withSentinelLock(prisma, LOCK, async (tx) => {
      const r = await readRecord(tx);
      if (!r) return null;
      if (r.noticesAt) {
        if (r.phase !== 'done') await writeRecord({ ...r, phase: 'done' }, tx);
        return null;
      }
      for (const part of chunks(staff)) {
        await tx.notification.createMany({ data: part.map((userId) => ({ userId, type: 'TRAINING_ASSIGNED', title, body: 'Open it from My learning in the Learning Hub.', entityType: 'training-course', entityId: course.id, projectId: null })) });
      }
      await writeRecord({ ...r, phase: 'done', noticesAt: ctx.clock().toISOString() }, tx);
      return staff.length;
    });
  }

  // ── The run ──

  const stop = (phase: OneCoursePhase) => {
    if (d.failAfter === phase) throw new Error(`The one-course conversion stopped after its ${phase} phase (test).`);
  };
  const before = (phase: OneCoursePhase, next: OneCoursePhase) => PHASES.indexOf(phase) < PHASES.indexOf(next);

  /** The record moves on to `phase` — never back (a slower second server finishing an earlier phase leaves it as it is). */
  async function advance(r: OneCourseRecord, phase: OneCoursePhase): Promise<OneCourseRecord> {
    const next = await withSentinelLock(prisma, LOCK, async (tx) => {
      const now = (await readRecord(tx)) ?? r;
      if (!before(now.phase, phase)) return now;
      const moved = { ...now, phase };
      await writeRecord(moved, tx);
      return moved;
    });
    stop(phase);
    return next;
  }

  async function run(): Promise<{ courseId: string } | null> {
    let r = await readRecord();
    if (r?.phase === 'done') return { courseId: r.courseId };
    const counts: Record<string, number> = {};
    if (!r) {
      const loaded = new Set(await loadedKeys());
      // A site that never had the short courses: nothing to convert (the combined course is loaded like any other).
      if (!(await everLoaded(loaded))) return null;
      r = await convertContent(ctx.clock(), loaded);
      stop('content');
    }
    const course = await prisma.trainingCourse.findUnique({ where: { id: r.courseId }, select: COURSE });
    if (!course) {
      // Deleted by an administrator half-way: like any built-in course, it never comes back.
      warn('Learning Hub: the one course was deleted before its conversion finished; the conversion ends here.', { courseId: r.courseId });
      await writeRecord({ ...r, phase: 'done' });
      return { courseId: r.courseId };
    }
    if (before(r.phase, 'people')) {
      Object.assign(counts, await convertPeople(r));
      r = await advance(r, 'people');
    }
    if (before(r.phase, 'assignments')) {
      counts.assignments = await convertAssignments(r, course);
      r = await advance(r, 'assignments');
    }
    if (before(r.phase, 'finish')) {
      Object.assign(counts, await convertFinish(r, course));
      r = await advance(r, 'finish');
    }
    const notices = await convertNotices(course);
    stop('done');
    if (notices === null) return { courseId: r.courseId };
    counts.notices = notices;
    ctx.logger?.info('Learning Hub: the built-in courses are now one course', {
      courseId: r.courseId,
      merged: Object.keys(r.moved).length,
      notMerged: r.notMerged.length,
      removedLessons: Object.keys(r.removedLessons).length,
      ...counts,
    });
    return { courseId: r.courseId };
  }

  let running: Promise<{ courseId: string } | null> | null = null;
  return {
    run() {
      if (!running) running = run().finally(() => (running = null));
      return running;
    },
  };
}
