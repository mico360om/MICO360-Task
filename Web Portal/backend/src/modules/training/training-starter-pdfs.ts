import { Prisma, type PrismaClient } from '@prisma/client';
import type { TrainingFileStore } from './training-files';
import { withoutSaveRetry } from '../../lib/save-retry';

/**
 * 1.23.25: the Tasks and Meetings starter courses of 1.23.22–1.23.24 carried two how-to slide PDFs as
 * downloads, made from old videos whose screenshots show sample data that must not be used any more (owner).
 * New sites never get them (starter-courses.ts no longer lists them); this step removes them, once, from a
 * site that has them: the two download rows and their stored files in the private training folder.
 *
 * Found by their starter identity — a starter file (`starter`, only the starter loader sets it), a download
 * (`RESOURCE`), with the name the loader gave it or in the Tasks / Meetings starter course — so it works
 * whether or not an administrator edited the course; an administrator's own uploads (never `starter`) stay,
 * even one with the same name. Nothing else changes: no course or lesson is re-stamped (updatedAt,
 * updatedById, version, publishedAt — whether a course was edited is read from them later), learners'
 * progress, enrolments and certificates are not touched, and nothing is written to the audit log. Should
 * anything re-stamp a course or lesson while the rows go, its stamps are put back in the same transaction
 * (the server's own level, repeatable read: it only ever sees its own changes; no isolation statement is
 * sent, which the live statement-based binary log would refuse). A document lesson an administrator pointed
 * at one of the PDFs keeps everything but that link (and is named in a warning, so an administrator can fix it).
 *
 * Done once: `training.removedStarterPdfs` = { at, removed, leftKeys } is written with the removal. Safe to
 * run again (a site without the PDFs only writes the record). The stored files go first (a stop half-way
 * leaves rows the next run finds again); missing ones are fine; one that still cannot be deleted after a few
 * tries is warned about and kept in `leftKeys`, and every later run tries it again until it is gone.
 */

export const REMOVED_STARTER_PDFS_KEY = 'training.removedStarterPdfs';

/** The two downloads as 1.23.22–1.23.24 loaded them: the starter course and the name people saw. */
export const OLD_STARTER_PDFS: readonly { courseKey: string; name: string }[] = [
  { courseKey: 'starter:tasks', name: 'Tasks how-to slides (PDF)' },
  { courseKey: 'starter:meetings', name: 'Meetings how-to slides (PDF)' },
];

/** What `training.removedStarterPdfs` holds. */
export interface RemovedStarterPdfsRecord {
  /** When the step ran. */
  at: string;
  /** Download rows removed. */
  removed: number;
  /** Stored files that could not be deleted yet (tried again at every run). */
  leftKeys: string[];
}

export interface StarterPdfRemoval {
  /** The record was already there: only files still left over were tried again. */
  already: boolean;
  /** Download rows removed. */
  removed: number;
  /** Stored files that could not be deleted (warned about with their keys; tried again at the next run). */
  filesLeft: number;
  /** Document lessons whose file was one of the PDFs (the link cleared, nothing else). */
  lessonsUnlinked: number;
  /** Courses and lessons whose edit stamps had to be put back. */
  restored: number;
}

export interface StarterPdfRemovalDeps {
  prisma: PrismaClient;
  files: TrainingFileStore;
  now?: () => Date;
  logger?: { info(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void };
  /** Pause between tries (tests: none). */
  sleep?: (ms: number) => Promise<void>;
}

const COURSE_STAMPS = { id: true, updatedAt: true, updatedById: true, version: true, publishedAt: true, majorAt: true, status: true } as const;
type CourseStamps = { id: string; updatedAt: Date; updatedById: string | null; version: number; publishedAt: Date | null; majorAt: Date | null; status: string };

const sameTime = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());
const sameCourseStamps = (a: CourseStamps, b: CourseStamps) =>
  sameTime(a.updatedAt, b.updatedAt) && a.updatedById === b.updatedById && a.version === b.version && sameTime(a.publishedAt, b.publishedAt) && sameTime(a.majorAt, b.majorAt) && a.status === b.status;

const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';
/** A deadlock, a write conflict or a lock wait that ran out: worth trying the transaction again. */
const retryable = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return e?.code === 'P2034' || e?.code === 'P2028' || /deadlock|write conflict|lock wait timeout|record has changed since last read/i.test(e?.message ?? '');
};
const NOTHING = { removed: 0, filesLeft: 0, lessonsUnlinked: 0, restored: 0 };

/** The record as stored (an older or odd value reads as "ran, nothing left over"). */
function recordOf(value: unknown): RemovedStarterPdfsRecord {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Partial<RemovedStarterPdfsRecord>;
  return {
    at: typeof v.at === 'string' ? v.at : typeof value === 'string' ? value : '',
    removed: typeof v.removed === 'number' ? v.removed : 0,
    leftKeys: Array.isArray(v.leftKeys) ? v.leftKeys.filter((k): k is string => typeof k === 'string') : [],
  };
}

export function createStarterPdfRemoval(deps: StarterPdfRemovalDeps): { run(): Promise<StarterPdfRemoval> } {
  const { prisma, files } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const warn = (msg: string, meta?: Record<string, unknown>) => deps.logger?.warn(msg, meta);

  /** Deletes stored files (three tries each; a missing file is fine); returns the keys still there. */
  async function removeFiles(keys: readonly string[]): Promise<string[]> {
    const left: string[] = [];
    for (const key of keys) {
      for (let attempt = 1; ; attempt++) {
        try {
          await files.remove(key);
          break;
        } catch (err) {
          if (attempt < 3) {
            await sleep(200 * attempt);
            continue;
          }
          left.push(key);
          warn('Learning Hub: an old starter how-to PDF file could not be deleted; it is tried again at the next start.', { storageKey: key, err: (err as Error)?.message ?? String(err) });
          break;
        }
      }
    }
    return left;
  }

  /** The step already ran: only stored files it could not delete are tried again. */
  async function retryLeftovers(value: unknown): Promise<StarterPdfRemoval> {
    const record = recordOf(value);
    if (record.leftKeys.length === 0) return { already: true, ...NOTHING };
    const left = await removeFiles(record.leftKeys);
    if (left.length !== record.leftKeys.length) {
      await prisma.systemSetting.update({ where: { key: REMOVED_STARTER_PDFS_KEY }, data: { value: { ...record, leftKeys: left } as unknown as Prisma.InputJsonValue } });
    }
    return { already: true, ...NOTHING, filesLeft: left.length };
  }

  async function remove(): Promise<StarterPdfRemoval> {
    const existing = await prisma.systemSetting.findUnique({ where: { key: REMOVED_STARTER_PDFS_KEY }, select: { value: true } });
    if (existing) return retryLeftovers(existing.value);

    const starterCourses = await prisma.trainingCourse.findMany({ where: { starterKey: { in: OLD_STARTER_PDFS.map((p) => p.courseKey) } }, select: { id: true } });
    const targets = await prisma.trainingFile.findMany({
      where: {
        starter: true,
        kind: 'RESOURCE',
        OR: [{ name: { in: OLD_STARTER_PDFS.map((p) => p.name) } }, ...(starterCourses.length ? [{ courseId: { in: starterCourses.map((c) => c.id) }, mimeType: 'application/pdf' }] : [])],
      },
      select: { id: true, courseId: true, name: true, storageKey: true },
    });

    // The stored files first: a stop half-way leaves the rows, and the next run finds them again.
    const leftKeys = await removeFiles(targets.map((f) => f.storageKey));

    const ids = targets.map((f) => f.id);
    const courseIds = [...new Set(targets.map((f) => f.courseId).filter((c): c is string => !!c))];
    const unlinked: { id: string; title: string; courseId: string }[] = [];
    const work = async (tx: Prisma.TransactionClient) => {
      unlinked.length = 0;
      const coursesBefore: CourseStamps[] = courseIds.length ? await tx.trainingCourse.findMany({ where: { id: { in: courseIds } }, select: COURSE_STAMPS }) : [];
      const lessonsBefore = courseIds.length ? await tx.trainingLesson.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, updatedAt: true } }) : [];

      // A document lesson pointed at one of the PDFs loses only that link (compare-and-set: its own stamp kept).
      const linked = ids.length ? await tx.trainingLesson.findMany({ where: { fileId: { in: ids } }, select: { id: true, title: true, courseId: true, updatedAt: true } }) : [];
      for (const l of linked) {
        const n = await tx.trainingLesson.updateMany({ where: { id: l.id, fileId: { in: ids }, updatedAt: l.updatedAt }, data: { fileId: null, updatedAt: l.updatedAt } });
        if (n.count) unlinked.push({ id: l.id, title: l.title, courseId: l.courseId });
      }
      const removed = ids.length ? (await tx.trainingFile.deleteMany({ where: { id: { in: ids } } })).count : 0;

      // Put back any stamp that moved: whether a course was edited is read from these.
      let restored = 0;
      if (courseIds.length) {
        const coursesAfter = new Map((await tx.trainingCourse.findMany({ where: { id: { in: courseIds } }, select: COURSE_STAMPS })).map((c) => [c.id, c]));
        for (const b of coursesBefore) {
          const a = coursesAfter.get(b.id);
          if (!a || sameCourseStamps(a, b)) continue;
          await tx.trainingCourse.update({ where: { id: b.id }, data: { updatedAt: b.updatedAt, updatedById: b.updatedById, version: b.version, publishedAt: b.publishedAt, majorAt: b.majorAt, status: b.status } });
          restored++;
        }
        const lessonsAfter = new Map((await tx.trainingLesson.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, updatedAt: true } })).map((l) => [l.id, l]));
        for (const b of lessonsBefore) {
          const a = lessonsAfter.get(b.id);
          if (!a || sameTime(a.updatedAt, b.updatedAt)) continue;
          await tx.trainingLesson.update({ where: { id: b.id }, data: { updatedAt: b.updatedAt } });
          restored++;
        }
      }

      const record: RemovedStarterPdfsRecord = { at: now().toISOString(), removed, leftKeys };
      const value = record as unknown as Prisma.InputJsonValue;
      await tx.systemSetting.upsert({ where: { key: REMOVED_STARTER_PDFS_KEY }, create: { key: REMOVED_STARTER_PDFS_KEY, value }, update: { value } });
      return { removed, lessonsUnlinked: unlinked.length, restored };
    };

    let out: { removed: number; lessonsUnlinked: number; restored: number };
    for (let attempt = 1; ; attempt++) {
      try {
        // 1.23.29: its tries are its own: the server's retry layer stays out (lib/save-retry; never 3 × 3).
        out = await withoutSaveRetry(() => prisma.$transaction(work, { maxWait: 10_000, timeout: 60_000 }));
        break;
      } catch (err) {
        if (attempt < 3 && retryable(err)) {
          await sleep(250 * attempt);
          continue;
        }
        throw err;
      }
    }

    for (const l of unlinked) {
      warn('Learning Hub: a document lesson used one of the old starter how-to PDFs; it now has no document — choose another one for it.', { lessonId: l.id, lesson: l.title, courseId: l.courseId });
    }
    if (out.removed || leftKeys.length || out.lessonsUnlinked || out.restored) {
      deps.logger?.info('Learning Hub: the old Tasks and Meetings how-to slide PDFs were removed', { ...out, filesLeft: leftKeys.length, names: targets.map((f) => f.name) });
    }
    return { already: false, filesLeft: leftKeys.length, ...out };
  }

  let running: Promise<StarterPdfRemoval> | null = null;
  return {
    run() {
      if (!running) {
        running = remove()
          .catch(async (err) => {
            // Another server wrote the record at the same moment: it did the work.
            if (isUniqueClash(err) && (await prisma.systemSetting.count({ where: { key: REMOVED_STARTER_PDFS_KEY } })) > 0) return { already: true, ...NOTHING };
            throw err;
          })
          .finally(() => (running = null));
      }
      return running;
    },
  };
}
