import { Prisma } from '@prisma/client';
import { idOf, managerOf, notFound, type TrainingContext } from './training-context';
import { stringList, type PersonRecord } from './prisma-training-store';
import { LIMITS, type ManageCourse } from './training-types';

/**
 * Duplicate (13 Nov, review R3; owner D6): a copy of a course as an unpublished draft "Copy of …" — its details
 * (audience, feature, groups, companies, completion, certificate and issuer), its modules, and its lessons with their
 * guide steps, quizzes (questions and answers), video links, documents, step pictures and downloads. Every stored
 * file is copied under a new key (the copy can be edited or deleted without touching the original's files). Nothing
 * of people is copied: no progress, enrolments, assignments, certificates or feedback. A copy is never built-in (no
 * starter key on the course or its modules), so built-in updates never reach it; it keeps the course's place in the
 * list, and a module switched off because its old course was removed stays off without that reason (the copy's own
 * module was never removed). Audited `training.course.duplicate`.
 * The database rows are written in one transaction; if it fails, the files copied for it are removed again.
 */

/** "Copy of <title>", at most LIMITS.courseTitle characters, never cutting a character in two. */
export function copyTitle(title: string): string {
  let out = `Copy of ${title.trim()}`;
  if (out.length > LIMITS.courseTitle) {
    out = out.slice(0, LIMITS.courseTitle);
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  }
  return out.trimEnd();
}

type Meta = { ip: string | null } | undefined;

export interface DuplicateDeps {
  manageCourse(courseId: string): Promise<ManageCourse>;
  audit(actor: PersonRecord, meta: Meta, action: string, entityId: string | null, values?: { oldValue?: unknown; newValue?: unknown }): Promise<void>;
}

const BY_POSITION = [{ position: 'asc' as const }, { id: 'asc' as const }];
const ORIGINAL = {
  modules: { orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }] },
  lessons: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: { steps: { orderBy: BY_POSITION }, quiz: { include: { questions: { orderBy: BY_POSITION, include: { options: { orderBy: BY_POSITION } } } } } },
  },
} satisfies Prisma.TrainingCourseInclude;

const jsonList = (v: unknown) => {
  const list = stringList(v);
  return list.length ? list : Prisma.DbNull;
};

export function createTrainingDuplicate(ctx: TrainingContext, d: DuplicateDeps) {
  const { prisma } = ctx;

  async function duplicate(actorId: string, courseId: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const c = await prisma.trainingCourse.findUnique({ where: { id: idOf(courseId) }, include: ORIGINAL });
    if (!c) throw notFound();
    // The files the copy needs: the course's downloads, and the documents and pictures its lessons use (wherever they are kept).
    const used = new Set<string>();
    for (const l of c.lessons) {
      if (l.fileId) used.add(l.fileId);
      for (const s of l.steps) if (s.imageFileId) used.add(s.imageFileId);
    }
    const originals = await prisma.trainingFile.findMany({ where: { OR: [{ courseId: c.id, kind: 'RESOURCE' }, { id: { in: [...used] } }] }, orderBy: BY_POSITION });

    // New stored copies first (a file that can't be read is left out: its step shows no picture, its lesson asks for its document).
    const copies: { from: (typeof originals)[number]; storageKey: string; sizeBytes: number }[] = [];
    const removeCopies = async () => {
      for (const f of copies) await ctx.files.remove(f.storageKey).catch(() => {});
    };
    try {
      for (const f of originals) {
        let content: Buffer;
        try {
          content = await ctx.files.read(f.storageKey);
        } catch (err) {
          ctx.logger?.warn('training: a file could not be read for a copy of its course (left out)', { courseId: c.id, fileId: f.id, err: String((err as Error)?.message ?? err) });
          continue;
        }
        copies.push({ from: f, storageKey: await ctx.files.save(content, f.mimeType), sizeBytes: content.length });
      }
    } catch (err) {
      await removeCopies();
      throw err;
    }

    let copyId: string;
    try {
      copyId = await prisma.$transaction(
        async (tx) => {
          const now = ctx.clock();
          const course = await tx.trainingCourse.create({
            data: {
              title: copyTitle(c.title),
              summary: c.summary,
              moduleKey: c.moduleKey,
              audience: c.audience,
              roleKeys: jsonList(c.roleKeys),
              difficulty: c.difficulty,
              status: 'DRAFT',
              completionRule: c.completionRule,
              inOrder: c.inOrder,
              certificateOn: c.certificateOn,
              certificateMonths: c.certificateMonths,
              issuerUserId: c.issuerUserId,
              issuerTitle: c.issuerTitle,
              // A signature picture belongs to its issuer (no course): the copy uses the same one.
              signatureFileId: c.signatureFileId,
              companyIds: jsonList(c.companyIds),
              position: c.position,
              createdById: actor.id,
              updatedById: actor.id,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          const moduleOf = new Map<string, string>();
          for (const m of c.modules) {
            const made = await tx.trainingModule.create({
              data: { courseId: course.id, position: m.position, title: m.title, moduleKey: m.moduleKey, roleKeys: jsonList(m.roleKeys), companyIds: jsonList(m.companyIds), enabled: m.enabled, offReason: m.offReason === 'REMOVED' ? null : m.offReason },
              select: { id: true },
            });
            moduleOf.set(m.id, made.id);
          }
          const fileOf = new Map<string, string>();
          for (const f of copies) {
            const made = await tx.trainingFile.create({
              data: { courseId: course.id, kind: f.from.kind, name: f.from.name, mimeType: f.from.mimeType, sizeBytes: f.sizeBytes, storageKey: f.storageKey, position: f.from.position, starter: false, uploadedById: actor.id },
              select: { id: true },
            });
            fileOf.set(f.from.id, made.id);
          }
          for (const l of c.lessons) {
            const lesson = await tx.trainingLesson.create({
              data: {
                courseId: course.id,
                moduleId: l.moduleId ? (moduleOf.get(l.moduleId) ?? null) : null,
                position: l.position,
                kind: l.kind,
                title: l.title,
                minutes: l.minutes,
                body: l.body,
                videoProvider: l.videoProvider,
                videoId: l.videoId,
                videoHash: l.videoHash,
                videoUrl: l.videoUrl,
                fileId: l.fileId ? (fileOf.get(l.fileId) ?? null) : null,
                changedVersion: 1,
                createdAt: now,
                updatedAt: now,
              },
              select: { id: true },
            });
            if (l.steps.length) {
              await tx.trainingStep.createMany({
                data: l.steps.map((s) => {
                  const picture = s.imageFileId ? (fileOf.get(s.imageFileId) ?? null) : null;
                  return { lessonId: lesson.id, position: s.position, title: s.title, body: s.body, imageFileId: picture, imageAlt: picture ? s.imageAlt : null };
                }),
              });
            }
            if (l.quiz) {
              const q = l.quiz;
              const quiz = await tx.trainingQuiz.create({
                data: { lessonId: lesson.id, passMark: q.passMark, maxAttempts: q.maxAttempts, shuffle: q.shuffle, timeLimitMinutes: q.timeLimitMinutes, drawCount: q.drawCount },
                select: { id: true },
              });
              for (const question of q.questions) {
                await tx.trainingQuestion.create({
                  data: {
                    quizId: quiz.id,
                    position: question.position,
                    kind: question.kind,
                    prompt: question.prompt,
                    explanation: question.explanation,
                    options: { create: question.options.map((o) => ({ position: o.position, text: o.text, correct: o.correct, feedback: o.feedback })) },
                  },
                  select: { id: true },
                });
              }
            }
          }
          return course.id;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (err) {
      await removeCopies();
      throw err;
    }
    await d.audit(actor, meta, 'training.course.duplicate', copyId, {
      newValue: { fromCourseId: c.id, title: copyTitle(c.title), modules: c.modules.length, lessons: c.lessons.length, files: copies.length, filesLeftOut: originals.length - copies.length },
    });
    return d.manageCourse(copyId);
  }

  return { duplicate };
}
