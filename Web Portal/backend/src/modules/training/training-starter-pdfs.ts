import type { PrismaClient } from '@prisma/client';
import type { TrainingFileStore } from './training-files';

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
 * anything re-stamp a course or lesson while the rows go, its stamps are put back in the same transaction.
 * A document lesson an administrator pointed at one of the PDFs keeps everything but that link.
 *
 * Done once: `training.removedStarterPdfs` (the moment it ran) is written with the removal. Safe to run
 * again (a site without the PDFs only writes the record). Stored files already missing are fine; one that
 * cannot be deleted is warned about with its key, and its download row still goes.
 */

export const REMOVED_STARTER_PDFS_KEY = 'training.removedStarterPdfs';

/** The two downloads as 1.23.22–1.23.24 loaded them: the starter course and the name people saw. */
export const OLD_STARTER_PDFS: readonly { courseKey: string; name: string }[] = [
  { courseKey: 'starter:tasks', name: 'Tasks how-to slides (PDF)' },
  { courseKey: 'starter:meetings', name: 'Meetings how-to slides (PDF)' },
];

export interface StarterPdfRemoval {
  /** The record was already there: nothing was looked at. */
  already: boolean;
  /** Download rows removed. */
  removed: number;
  /** Stored files that could not be deleted (warned about with their keys). */
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
}

const COURSE_STAMPS = { id: true, updatedAt: true, updatedById: true, version: true, publishedAt: true, majorAt: true, status: true } as const;
type CourseStamps = { id: string; updatedAt: Date; updatedById: string | null; version: number; publishedAt: Date | null; majorAt: Date | null; status: string };

const sameTime = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());
const sameCourseStamps = (a: CourseStamps, b: CourseStamps) =>
  sameTime(a.updatedAt, b.updatedAt) && a.updatedById === b.updatedById && a.version === b.version && sameTime(a.publishedAt, b.publishedAt) && sameTime(a.majorAt, b.majorAt) && a.status === b.status;

const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';

export function createStarterPdfRemoval(deps: StarterPdfRemovalDeps): { run(): Promise<StarterPdfRemoval> } {
  const { prisma, files } = deps;
  const now = deps.now ?? (() => new Date());

  async function remove(): Promise<StarterPdfRemoval> {
    const nothing = { removed: 0, filesLeft: 0, lessonsUnlinked: 0, restored: 0 };
    if ((await prisma.systemSetting.count({ where: { key: REMOVED_STARTER_PDFS_KEY } })) > 0) return { already: true, ...nothing };

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
    let filesLeft = 0;
    for (const f of targets) {
      try {
        await files.remove(f.storageKey);
      } catch (err) {
        filesLeft++;
        deps.logger?.warn('Learning Hub: an old starter how-to PDF file could not be deleted; its download is removed anyway.', { storageKey: f.storageKey, err: (err as Error)?.message ?? String(err) });
      }
    }

    const ids = targets.map((f) => f.id);
    const courseIds = [...new Set(targets.map((f) => f.courseId).filter((c): c is string => !!c))];
    const out = await prisma.$transaction(
      async (tx) => {
        const coursesBefore: CourseStamps[] = courseIds.length ? await tx.trainingCourse.findMany({ where: { id: { in: courseIds } }, select: COURSE_STAMPS }) : [];
        const lessonsBefore = courseIds.length ? await tx.trainingLesson.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, updatedAt: true, fileId: true } }) : [];

        let lessonsUnlinked = 0;
        for (const l of lessonsBefore) {
          if (!l.fileId || !ids.includes(l.fileId)) continue;
          await tx.trainingLesson.update({ where: { id: l.id }, data: { fileId: null, updatedAt: l.updatedAt } });
          lessonsUnlinked++;
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

        await tx.systemSetting.upsert({ where: { key: REMOVED_STARTER_PDFS_KEY }, create: { key: REMOVED_STARTER_PDFS_KEY, value: now().toISOString() }, update: { value: now().toISOString() } });
        return { removed, lessonsUnlinked, restored };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    if (out.removed || filesLeft || out.lessonsUnlinked || out.restored) {
      deps.logger?.info('Learning Hub: the old Tasks and Meetings how-to slide PDFs were removed', { ...out, filesLeft, names: targets.map((f) => f.name) });
    }
    return { already: false, filesLeft, ...out };
  }

  let running: Promise<StarterPdfRemoval> | null = null;
  return {
    run() {
      if (!running) {
        running = remove()
          .catch(async (err) => {
            // Another server wrote the record at the same moment: it did the work.
            if (isUniqueClash(err) && (await prisma.systemSetting.count({ where: { key: REMOVED_STARTER_PDFS_KEY } })) > 0) return { already: true, removed: 0, filesLeft: 0, lessonsUnlinked: 0, restored: 0 };
            throw err;
          })
          .finally(() => (running = null));
      }
      return running;
    },
  };
}
