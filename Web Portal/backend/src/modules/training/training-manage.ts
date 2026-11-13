import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError, ValidationError } from '../../lib/http-errors';
import { newRowId } from '../../lib/row-id';
import { withRowLock } from '../../lib/sentinel-lock';
import { sanitizeRichHtml, isRichEmpty, parseRichHtml } from '../../lib/rich-text';
import { LIVE_PROJECT_WHERE } from '../companies/company-access';
import { inScope } from './training-access';
import { certificateStatus, verifyLink } from './training-certificates';
import { conflict, courseFacts, forbidden, idOf, managerOf, notFound, scopeOf, type TrainingContext } from './training-context';
import { checkTrainingUpload, type TrainingUpload } from './training-files';
import { createTrainingDuplicate } from './training-duplicate';
import { createTrainingFinish } from './training-finish';
import { courseLimitedTo, courseNotice, createModuleOps, readNotMerged, type ModuleAfter } from './training-manage-modules';
import { readSetting, stringList, writeSetting, type PersonRecord } from './prisma-training-store';
import { reaches, targetMatches, type AssignmentFacts } from './training-targets';
import type { TrainingSync } from './training-sync';
import { normaliseVideoLink, videoInfo } from './training-video';
import {
  ASSIGN_TARGET_KINDS,
  AUDIENCES,
  COMPLETION_RULES,
  COURSE_STATUSES,
  DIFFICULTIES,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  GROUP_KEYS,
  GROUP_LABELS,
  LESSON_KINDS,
  LIMITS,
  ONE_COURSE_KEY,
  QUESTION_KINDS,
  ROLE_KEYS,
  RULE_TARGET_KINDS,
  TRAINING_MODULES,
  type AssignmentRow,
  type CertificateRef,
  type FeedbackItem,
  type FileKind,
  type FileRef,
  type LessonDeleteImpact,
  type LessonStep,
  type ManageCourse,
  type ManageCourseRow,
  type ManageLesson,
  type ManageQuiz,
  type QuestionKind,
  type RuleRow,
  type TargetOptions,
  type TrainingSettings,
} from './training-types';

/**
 * The Training Center (owner answers 4, 7, 11–16; rulings R4–R14): authoring courses, lessons, guide steps,
 * quizzes and files; assignments and onboarding rules; feedback; certificates; the tour setting. Training
 * managers and administrators only (managerOf, every method first, before anything is read); a Training
 * manager assigns, answers and revokes only for people sharing a company with them (R5). Authoring is
 * site-wide (courses are like Templates). Every write is audited.
 */

// ── Input shapes (the website's api/training.ts sends these) ────────────────────────────────────────────

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const id = z.string().regex(ID, 'Not a valid id.');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const words = (max: number) => z.string().trim().max(max, `Use at most ${max.toLocaleString('en-US')} characters.`);
const required = (max: number, what: string) => z.string().trim().min(1, `Give it ${what}.`).max(max, `Use at most ${max.toLocaleString('en-US')} characters.`);

export const courseInputSchema = z.object({
  title: required(LIMITS.courseTitle, 'a title'),
  summary: z.string().max(LIMITS.courseSummary, `Use at most ${LIMITS.courseSummary.toLocaleString('en-US')} characters.`).nullable().optional(),
  moduleKey: z.enum(TRAINING_MODULES),
  audience: z.enum(AUDIENCES),
  roleKeys: z.array(z.enum(ROLE_KEYS)).max(ROLE_KEYS.length * 2).optional(),
  difficulty: z.enum(DIFFICULTIES),
  completionRule: z.enum(COMPLETION_RULES).optional(),
  inOrder: z.boolean().optional(),
  certificateOn: z.boolean().optional(),
  certificateMonths: z.number().int().min(1).max(LIMITS.certificateMonthsMax).nullable().optional(),
  issuerUserId: id.nullable().optional(),
  issuerTitle: words(LIMITS.issuerTitle).nullable().optional(),
  signatureFileId: id.nullable().optional(),
  companyIds: z.array(id).max(50).optional(),
});
export type CourseInputParsed = z.infer<typeof courseInputSchema>;
const coursePatchSchema = courseInputSchema.partial();

export const lessonInputSchema = z.object({
  kind: z.enum(LESSON_KINDS),
  title: required(LIMITS.lessonTitle, 'a title'),
  minutes: z.number().int().min(1).max(LIMITS.minutesMax).optional(),
  body: z.string().max(LIMITS.lessonBody, `Use at most ${LIMITS.lessonBody.toLocaleString('en-US')} characters.`).nullable().optional(),
  videoUrl: z.string().max(LIMITS.videoUrl).nullable().optional(),
  fileId: id.nullable().optional(),
});
/** 1.23.31: `moduleId` moves the lesson to a module of its course (last in it); null: no module. */
const lessonPatchSchema = lessonInputSchema.partial().extend({ moduleId: id.nullable().optional() });

const stepSchema = z.object({
  title: words(LIMITS.stepTitle).nullable().optional(),
  body: z.string().max(LIMITS.stepBody, `Use at most ${LIMITS.stepBody.toLocaleString('en-US')} characters.`).nullable().optional(),
  imageFileId: id.nullable().optional(),
  imageAlt: words(LIMITS.imageAlt).nullable().optional(),
});
const stepsSchema = z.object({ steps: z.array(stepSchema).max(LIMITS.stepsPerLesson, `A guide has at most ${LIMITS.stepsPerLesson} steps.`) });

const optionSchema = z.object({
  id: id.optional(),
  text: required(LIMITS.optionText, 'some text'),
  correct: z.boolean(),
  feedback: words(LIMITS.optionFeedback).nullable().optional(),
});
const questionSchema = z.object({
  id: id.optional(),
  kind: z.enum(QUESTION_KINDS),
  prompt: required(LIMITS.questionPrompt, 'a question'),
  explanation: words(LIMITS.questionExplanation).nullable().optional(),
  options: z.array(optionSchema).max(LIMITS.optionsPerQuestion, `A question has at most ${LIMITS.optionsPerQuestion} answers.`),
});
export const quizInputSchema = z.object({
  passMark: z.number().int().min(1, 'The pass mark is 1–100%.').max(100, 'The pass mark is 1–100%.'),
  maxAttempts: z.number().int().min(1).max(LIMITS.maxAttemptsMax).nullable().optional(),
  shuffle: z.boolean().optional(),
  timeLimitMinutes: z.number().int().min(1).max(LIMITS.timeLimitMax).nullable().optional(),
  drawCount: z.number().int().min(1).max(LIMITS.questionsPerQuiz).nullable().optional(),
  questions: z.array(questionSchema).max(LIMITS.questionsPerQuiz, `A quiz has at most ${LIMITS.questionsPerQuiz} questions.`),
});
export type QuizInputParsed = z.infer<typeof quizInputSchema>;

const dueFields = {
  dueDay: z.string().regex(DAY, 'Choose a day.').nullable().optional(),
  dueDays: z.number().int().min(1).max(LIMITS.dueDaysMax).nullable().optional(),
};
export const assignmentInputSchema = z
  .object({
    courseIds: z.array(id).min(1, 'Choose a course.').max(20, 'Choose at most 20 courses at a time.'),
    targetKind: z.enum(ASSIGN_TARGET_KINDS),
    /** Not sent for PEOPLE (13 Nov, R4: several ticked people, one USER assignment each sharing a batchId). */
    targetId: id.optional(),
    userIds: z.array(id).max(LIMITS.peoplePerAssignment, `Choose at most ${LIMITS.peoplePerAssignment} people at a time.`).optional(),
    mandatory: z.boolean(),
    ...dueFields,
    /** 12 Nov (owner answer 2): only people who join from now on — an onboarding rule underneath. */
    newStaffOnly: z.boolean().optional(),
  })
  .refine((a) => !(a.dueDay && a.dueDays), { message: 'Choose either a due day or a number of days, not both.', path: ['dueDays'] })
  .superRefine((a, c) => {
    if (a.targetKind !== 'PEOPLE') {
      if (!a.targetId) c.addIssue({ code: 'custom', message: 'Choose who it is for.', path: ['targetId'] });
      return;
    }
    if (!a.userIds || a.userIds.length === 0) c.addIssue({ code: 'custom', message: 'Choose at least one person.', path: ['userIds'] });
    else if (new Set(a.userIds).size !== a.userIds.length) c.addIssue({ code: 'custom', message: 'Each person can be chosen only once.', path: ['userIds'] });
    if (a.newStaffOnly) c.addIssue({ code: 'custom', message: '“New staff only” is for a group, a department or a company.', path: ['newStaffOnly'] });
  });
export type AssignmentInputParsed = z.infer<typeof assignmentInputSchema>;

export const ruleInputSchema = z.object({
  name: required(LIMITS.ruleName, 'a name'),
  targetKind: z.enum(RULE_TARGET_KINDS),
  targetId: id,
  courseIds: z.array(id).min(1, 'Choose a course.').max(20, 'Choose at most 20 courses.'),
  mandatory: z.boolean(),
  dueDays: z.number().int().min(1).max(LIMITS.dueDaysMax).nullable().optional(),
  active: z.boolean().optional(),
});
const rulePatchSchema = ruleInputSchema.partial();

const publishSchema = z.object({ change: z.enum(['MINOR', 'MAJOR']).optional(), reviewDays: z.number().int().min(1).max(LIMITS.reviewDaysMax).optional() });
const orderSchema = z.object({ lessonIds: z.array(id).max(LIMITS.lessonsPerCourse) });
const answerSchema = z.object({ answer: required(LIMITS.feedbackAnswer, 'an answer') });
const revokeSchema = z.object({ reason: required(LIMITS.revokeReason, 'a reason') });
const settingsSchema = z.object({ tourOff: z.array(id).max(500) });
const courseListQuery = z.object({
  status: z.enum(COURSE_STATUSES).or(z.literal('')).optional(),
  module: z.enum(TRAINING_MODULES).or(z.literal('')).optional(),
  audience: z.enum(AUDIENCES).or(z.literal('')).optional(),
  q: z.string().max(LIMITS.search).optional(),
});
const feedbackListQuery = z.object({ kind: z.enum(FEEDBACK_KINDS).or(z.literal('')).optional(), status: z.enum(FEEDBACK_STATUSES).or(z.literal('')).optional() });
const certificateListQuery = z.object({ courseId: id.or(z.literal('')).optional(), q: z.string().max(LIMITS.search).optional() });
const assignmentListQuery = z.object({ courseId: id.or(z.literal('')).optional() });

// ── Pure checks ─────────────────────────────────────────────────────────────────────────────────────

/** The Client portal module's courses are for clients (ruling, B notes). */
export function checkCourseShape(c: { moduleKey: string; audience: string }): void {
  if (c.moduleKey === 'portal' && c.audience !== 'CLIENTS') throw new ValidationError('Client portal courses are for clients: choose “Clients” as the audience.', { field: 'audience' });
}

/** MariaDB TEXT holds 65,535 bytes (non-strict mode would cut the rest silently). */
export function fitsText(s: string | null | undefined): boolean {
  return !s || Buffer.byteLength(s, 'utf8') <= 65_535;
}

/** Rich text as stored: cleaned by the server, null when empty; refused when it can't fit. */
function richOrNull(raw: string | null | undefined, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  const blocks = parseRichHtml(raw);
  if (isRichEmpty(blocks)) return null;
  const clean = sanitizeRichHtml(raw);
  if (!fitsText(clean)) throw new ValidationError('That text is too long.', { field });
  return clean;
}

export interface QuestionIn {
  id?: string;
  kind: QuestionKind;
  prompt: string;
  explanation?: string | null;
  options: { id?: string; text: string; correct: boolean; feedback?: string | null }[];
}
export interface QuestionOut {
  id?: string;
  kind: QuestionKind;
  prompt: string;
  explanation: string | null;
  options: { id?: string; text: string; correct: boolean; feedback: string | null }[];
}

/** TRUE_FALSE: exactly True and False with the chosen one right; ORDER: the given order is right (all marked right). */
export function normaliseQuestions(questions: readonly QuestionIn[]): QuestionOut[] {
  return questions.map((q) => {
    const base = { ...(q.id ? { id: q.id } : {}), kind: q.kind, prompt: q.prompt.trim(), explanation: q.explanation?.trim() || null };
    const opts = q.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), text: o.text.trim(), correct: o.correct, feedback: o.feedback?.trim() || null }));
    if (q.kind === 'TRUE_FALSE') {
      const right = opts.find((o) => o.correct);
      const isFalse = (o: { text: string }) => o.text.toLowerCase() === 'false';
      const falseRight = right ? (isFalse(right) ? true : right.text.toLowerCase() === 'true' ? false : opts.indexOf(right) === 1) : null;
      const fbTrue = opts.find((o) => o.text.toLowerCase() === 'true') ?? opts[0];
      const fbFalse = opts.find(isFalse) ?? opts[1];
      return {
        ...base,
        options: [
          { ...(fbTrue?.id ? { id: fbTrue.id } : {}), text: 'True', correct: falseRight === false, feedback: fbTrue?.feedback ?? null },
          { ...(fbFalse?.id ? { id: fbFalse.id } : {}), text: 'False', correct: falseRight === true, feedback: fbFalse?.feedback ?? null },
        ],
      };
    }
    if (q.kind === 'ORDER') return { ...base, options: opts.map((o) => ({ ...o, correct: true })) };
    return { ...base, options: opts };
  });
}

export interface ProblemLesson {
  title: string;
  kind: string;
  videoId: string | null;
  fileId: string | null;
  stepCount: number;
  quiz: { passMark: number; drawCount: number | null; questions: { kind: string; prompt: string; options: { correct: boolean }[] }[] } | null;
  /** False: in a module that's switched off (nobody sees it). Not given: shown. */
  shown?: boolean;
}

/** Why Publish is refused today (empty: ready). */
export function publishProblems(lessons: readonly ProblemLesson[]): string[] {
  if (lessons.length === 0) return ['Add at least one lesson.'];
  // A lesson in a module that's switched off is nobody's lesson (it still has to be finished: it may be switched on).
  const seen = lessons.filter((l) => l.shown !== false);
  if (seen.length === 0) return ['Add a lesson people can see: lessons in a module that’s switched off aren’t shown.'];
  // R2: a video lesson without its link is simply hidden until the link is pasted; a course needs one lesson people see.
  if (seen.every((l) => l.kind === 'VIDEO' && !l.videoId)) return ['Add a lesson people can see: a video lesson shows only once it has its link.'];
  const out: string[] = [];
  for (const l of lessons) {
    const at = `Lesson “${l.title}”`;
    if (l.kind === 'DOCUMENT' && !l.fileId) out.push(`${at}: upload its document.`);
    if (l.kind === 'GUIDE' && l.stepCount === 0) out.push(`${at}: add at least one step.`);
    if (l.kind !== 'QUIZ') continue;
    const qs = l.quiz?.questions ?? [];
    if (qs.length === 0) {
      out.push(`${at}: add at least one question.`);
      continue;
    }
    qs.forEach((q, i) => {
      const n = q.options.length;
      const right = q.options.filter((o) => o.correct).length;
      const where = `${at}, question ${i + 1}`;
      if (q.kind === 'SINGLE' && (n < 2 || right !== 1)) out.push(`${where}: mark exactly one right answer (of at least two).`);
      if (q.kind === 'MULTIPLE' && (n < 2 || right < 1)) out.push(`${where}: mark at least one right answer (of at least two).`);
      if (q.kind === 'TRUE_FALSE' && (n !== 2 || right !== 1)) out.push(`${where}: say whether True or False is right.`);
      if (q.kind === 'ORDER' && n < 2) out.push(`${where}: give at least two steps to put in order.`);
    });
    if (l.quiz && l.quiz.drawCount !== null && l.quiz.drawCount > qs.length) out.push(`${at}: it draws ${l.quiz.drawCount} questions but has only ${qs.length}.`);
    if (l.quiz && (l.quiz.passMark < 1 || l.quiz.passMark > 100)) out.push(`${at}: set a pass mark from 1 to 100%.`);
  }
  return out;
}

// ── The service ─────────────────────────────────────────────────────────────────────────────────────

type Meta = { ip: string | null } | undefined;
const LESSON_INCLUDE = {
  steps: { orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }] },
  quiz: { include: { questions: { orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }], include: { options: { orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }] } } } } },
} satisfies Prisma.TrainingLessonInclude;
type LessonRow = Prisma.TrainingLessonGetPayload<{ include: typeof LESSON_INCLUDE }>;
type FileRow = { id: string; name: string; mimeType: string; sizeBytes: number; kind: string };
const fileRef = (f: FileRow): FileRef => ({ id: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind as FileKind });
const jsonList = (list: readonly string[] | null | undefined) => (list && list.length ? [...list] : Prisma.DbNull);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
function chunks<T>(list: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * R3: a guide's saved step is never past its last step (`count` steps now), in the caller's transaction. Progress has
 * no index that starts with the lesson, so an UPDATE by lesson would scan and lock every row (every learner's save
 * waits): the places past it are read without a lock and brought back by id, `stepIndex > last` checked again
 * (as applyStarterLessons does).
 */
export async function clampSavedSteps(tx: Prisma.TransactionClient, lessonId: string, count: number): Promise<void> {
  const last = Math.max(0, count - 1);
  const past = (await tx.trainingProgress.findMany({ where: { lessonId, stepIndex: { gt: last } }, select: { id: true } })).map((p) => p.id);
  for (const part of chunks(past)) await tx.trainingProgress.updateMany({ where: { id: { in: part }, stepIndex: { gt: last } }, data: { stepIndex: last } });
}

/** `oneCourseKey`: the conversion record's settings key (tests use their own). */
export function createTrainingManage(ctx: TrainingContext, sync: TrainingSync, o: { oneCourseKey?: string } = {}) {
  const { prisma } = ctx;
  const finish = createTrainingFinish(ctx);
  const oneCourseKey = o.oneCourseKey ?? ONE_COURSE_KEY;

  /** R3: after lessons went from under people (a link cleared, a lesson removed), finish anyone now done. */
  async function recheck(courseId: string): Promise<void> {
    try {
      await finish.recheck([courseId]);
    } catch (err) {
      ctx.logger?.warn('training: finishing could not be checked again', { courseId, err: String((err as Error)?.message ?? err) });
    }
  }

  async function audit(actor: PersonRecord, meta: Meta, action: string, entityId: string | null, values: { oldValue?: unknown; newValue?: unknown } = {}): Promise<void> {
    if (!ctx.audit) return;
    try {
      await ctx.audit({ userId: actor.id, ip: meta?.ip ?? null, action, entityId, ...values });
    } catch (err) {
      ctx.logger?.warn('training: an audit entry could not be written', { action, err: String((err as Error)?.message ?? err) });
    }
  }

  async function courseRow(courseId: unknown) {
    const cid = idOf(courseId);
    const c = await prisma.trainingCourse.findUnique({ where: { id: cid } });
    if (!c) throw notFound();
    return c;
  }

  async function lessonRow(lessonId: unknown) {
    const lid = idOf(lessonId, 'Lesson');
    const l = await prisma.trainingLesson.findUnique({ where: { id: lid }, include: { course: { select: { id: true } } } });
    if (!l) throw notFound('Lesson');
    return l;
  }

  /**
   * A content change to the course itself (Publish then asks Minor fix / Major change). One statement each (never
   * update(), which reads first): a double click, or two managers saving at once, never meet MariaDB's error 1020.
   */
  const touchCourse = (courseId: string, actor: PersonRecord) => prisma.trainingCourse.updateMany({ where: { id: courseId }, data: { updatedById: actor.id, updatedAt: ctx.clock() } });
  const touchLesson = (lessonId: string, db: Prisma.TransactionClient = prisma) => db.trainingLesson.updateMany({ where: { id: lessonId }, data: { updatedAt: ctx.clock() } });
  /** 1.23.31 (D6): modules in any course, and Duplicate (R3). */
  const modules = createModuleOps(ctx, { manageCourse, touchCourse, audit, recheck, assertShownPublishable });
  const copies = createTrainingDuplicate(ctx, { manageCourse, audit });

  function toLesson(l: LessonRow, files: Map<string, FileRow>): ManageLesson {
    const steps: LessonStep[] = l.steps.map((s) => ({ id: s.id, position: s.position, title: s.title, body: s.body, image: s.imageFileId ? { fileId: s.imageFileId, alt: s.imageAlt } : null }));
    const quiz: ManageQuiz | null = l.quiz
      ? {
          passMark: l.quiz.passMark,
          maxAttempts: l.quiz.maxAttempts,
          shuffle: l.quiz.shuffle,
          timeLimitMinutes: l.quiz.timeLimitMinutes,
          drawCount: l.quiz.drawCount,
          questions: l.quiz.questions.map((q) => ({
            id: q.id,
            kind: q.kind as QuestionKind,
            prompt: q.prompt,
            explanation: q.explanation,
            options: q.options.map((o) => ({ id: o.id, text: o.text, correct: o.correct, feedback: o.feedback })),
          })),
        }
      : null;
    const doc = l.fileId ? files.get(l.fileId) : undefined;
    return {
      id: l.id,
      position: l.position,
      kind: l.kind as ManageLesson['kind'],
      title: l.title,
      minutes: l.minutes,
      body: l.body,
      videoUrl: l.videoUrl,
      video: videoInfo(l),
      document: doc ? fileRef(doc) : null,
      steps,
      quiz,
      changedVersion: l.changedVersion,
      moduleId: l.moduleId,
    };
  }

  async function lessonsOf(courseId: string): Promise<LessonRow[]> {
    return prisma.trainingLesson.findMany({ where: { courseId }, include: LESSON_INCLUDE, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  }

  /** The course's modules, switched on or off. */
  async function moduleSwitches(courseId: string): Promise<Map<string, boolean>> {
    return new Map((await prisma.trainingModule.findMany({ where: { courseId }, select: { id: true, enabled: true } })).map((m) => [m.id, m.enabled]));
  }

  const problemsOf = (lessons: readonly LessonRow[], switches: ReadonlyMap<string, boolean>) => publishProblems(lessons.map((l) => toProblem(l, switches)));

  const changedSincePublish = (c: { status: string; publishedAt: Date | null; updatedAt: Date }, lessonTimes: readonly Date[]) =>
    c.status === 'PUBLISHED' && !!c.publishedAt && (c.updatedAt.getTime() > c.publishedAt.getTime() || lessonTimes.some((t) => t.getTime() > c.publishedAt!.getTime()));

  async function manageCourse(courseId: string): Promise<ManageCourse> {
    const c = await prisma.trainingCourse.findUnique({ where: { id: courseId } });
    if (!c) throw notFound();
    const lessons = await lessonsOf(c.id);
    const files = await prisma.trainingFile.findMany({
      where: { OR: [{ courseId: c.id }, ...(c.signatureFileId ? [{ id: c.signatureFileId }] : [])] },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, kind: true, position: true, courseId: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const byId = new Map(files.map((f) => [f.id, f]));
    const [enrolled, completed] = await Promise.all([
      prisma.trainingEnrolment.count({ where: { courseId: c.id, withdrawnAt: null } }),
      prisma.trainingEnrolment.count({ where: { courseId: c.id, withdrawnAt: null, completedAt: { not: null } } }),
    ]);
    const signature = c.signatureFileId ? byId.get(c.signatureFileId) : undefined;
    const [courseModules, notMerged] = await Promise.all([modules.manageModules(c), readNotMerged(prisma, oneCourseKey)]);
    return {
      id: c.id,
      title: c.title,
      summary: c.summary,
      moduleKey: c.moduleKey as ManageCourse['moduleKey'],
      audience: c.audience as ManageCourse['audience'],
      roleKeys: stringList(c.roleKeys) as ManageCourse['roleKeys'],
      difficulty: c.difficulty as ManageCourse['difficulty'],
      status: c.status as ManageCourse['status'],
      completionRule: c.completionRule as ManageCourse['completionRule'],
      inOrder: c.inOrder,
      certificateOn: c.certificateOn,
      certificateMonths: c.certificateMonths,
      issuerUserId: c.issuerUserId,
      issuerTitle: c.issuerTitle,
      signature: signature ? fileRef(signature) : null,
      companyIds: stringList(c.companyIds),
      version: c.version,
      starter: c.starterKey !== null,
      publishedAt: iso(c.publishedAt),
      unpublishedChanges: changedSincePublish(c, lessons.map((l) => l.updatedAt)),
      lessons: lessons.map((l) => toLesson(l, byId)),
      modules: courseModules,
      notice: courseNotice(c, notMerged),
      resources: files.filter((f) => f.courseId === c.id && f.kind === 'RESOURCE').map(fileRef),
      publishProblems: problemsOf(lessons, new Map(courseModules.map((m) => [m.id, m.enabled]))),
      enrolled,
      completed,
    };
  }

  async function manageLesson(lessonId: string): Promise<ManageLesson> {
    const l = await prisma.trainingLesson.findUnique({ where: { id: lessonId }, include: LESSON_INCLUDE });
    if (!l) throw notFound('Lesson');
    const files = l.fileId ? await prisma.trainingFile.findMany({ where: { id: l.fileId }, select: { id: true, name: true, mimeType: true, sizeBytes: true, kind: true } }) : [];
    return toLesson(l, new Map(files.map((f) => [f.id, f])));
  }

  /** The course fields from an input (create: every field; patch: only what was sent), checked. */
  async function courseData(
    input: Partial<CourseInputParsed>,
    current: { moduleKey: string; audience: string; issuerUserId: string | null; signatureFileId: string | null } | null,
    actor: PersonRecord,
  ): Promise<Prisma.TrainingCourseUncheckedUpdateInput> {
    const shape = { moduleKey: input.moduleKey ?? current?.moduleKey ?? 'general', audience: input.audience ?? current?.audience ?? 'STAFF' };
    checkCourseShape(shape);
    const issuerAfter = input.issuerUserId !== undefined ? input.issuerUserId : (current?.issuerUserId ?? null);
    if (input.issuerUserId) {
      const issuer = await ctx.person(input.issuerUserId);
      if (!issuer || !issuer.active || issuer.client || !(issuer.trainingManager || issuer.admin)) throw new ValidationError('“Issued by” must be a Training manager or an administrator.', { field: 'issuerUserId' });
      // M6: a Training manager picks an administrator, herself or a Training manager of her companies.
      if (!actor.admin && !issuer.admin && issuer.id !== actor.id && !issuer.companyIds.some((c) => actor.companyIds.includes(c))) {
        throw new ValidationError('Choose an administrator or a Training manager of your companies for “Issued by”.', { field: 'issuerUserId' });
      }
    }
    if (input.signatureFileId) {
      const f = await prisma.trainingFile.findUnique({ where: { id: input.signatureFileId }, select: { kind: true, uploadedById: true } });
      if (!f || f.kind !== 'SIGNATURE') throw new ValidationError('Upload the signature picture first.', { field: 'signatureFileId' });
      // M18: the signature is the "Issued by" person's own (nobody attaches one for someone else).
      if (!issuerAfter || f.uploadedById !== issuerAfter) throw new ValidationError('The signature must be uploaded by the person who issues the certificates (“Issued by”).', { field: 'signatureFileId' });
    }
    if (input.companyIds && input.companyIds.length) {
      const unique = [...new Set(input.companyIds)];
      if ((await prisma.company.count({ where: { id: { in: unique } } })) !== unique.length) throw new ValidationError('One of those companies doesn’t exist.', { field: 'companyIds' });
    }
    if (input.summary !== undefined && input.summary !== null && !fitsText(input.summary)) throw new ValidationError('That summary is too long.', { field: 'summary' });
    const data: Prisma.TrainingCourseUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.summary !== undefined) data.summary = input.summary?.trim() || null;
    if (input.moduleKey !== undefined) data.moduleKey = input.moduleKey;
    if (input.audience !== undefined) data.audience = input.audience;
    if (input.roleKeys !== undefined) data.roleKeys = jsonList([...new Set(input.roleKeys)]);
    if (input.difficulty !== undefined) data.difficulty = input.difficulty;
    if (input.completionRule !== undefined) data.completionRule = input.completionRule;
    if (input.inOrder !== undefined) data.inOrder = input.inOrder;
    if (input.certificateOn !== undefined) data.certificateOn = input.certificateOn;
    if (input.certificateMonths !== undefined) data.certificateMonths = input.certificateMonths;
    if (input.issuerUserId !== undefined) data.issuerUserId = input.issuerUserId;
    if (input.issuerTitle !== undefined) data.issuerTitle = input.issuerTitle?.trim() || null;
    if (input.signatureFileId !== undefined) data.signatureFileId = input.signatureFileId;
    // M18: a new "Issued by" doesn't keep someone else's signature.
    if (input.issuerUserId !== undefined && input.signatureFileId === undefined && current?.signatureFileId) {
      const f = await prisma.trainingFile.findUnique({ where: { id: current.signatureFileId }, select: { uploadedById: true } });
      if (!f || !issuerAfter || f.uploadedById !== issuerAfter) data.signatureFileId = null;
    }
    if (input.companyIds !== undefined) data.companyIds = jsonList([...new Set(input.companyIds)]);
    return data;
  }

  // ── Courses ─────────────────────────────────────────────────────────────────────────────────────

  async function listCourses(actorId: string, rawQuery: unknown): Promise<{ courses: ManageCourseRow[] }> {
    await managerOf(ctx, actorId);
    const q = courseListQuery.parse(rawQuery ?? {});
    const text = q.q?.trim();
    const courses = await prisma.trainingCourse.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.module ? { moduleKey: q.module } : {}), ...(q.audience ? { audience: q.audience } : {}), ...(text ? { title: { contains: text } } : {}) },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    const ids = courses.map((c) => c.id);
    if (ids.length === 0) return { courses: [] };
    const [lessons, enrolled, completed, moduleCounts, notMerged, names] = await Promise.all([
      prisma.trainingLesson.findMany({ where: { courseId: { in: ids } }, select: { courseId: true, minutes: true, updatedAt: true } }),
      prisma.trainingEnrolment.groupBy({ by: ['courseId'], where: { courseId: { in: ids }, withdrawnAt: null }, _count: { _all: true } }),
      prisma.trainingEnrolment.groupBy({ by: ['courseId'], where: { courseId: { in: ids }, withdrawnAt: null, completedAt: { not: null } }, _count: { _all: true } }),
      modules.moduleCounts(ids),
      readNotMerged(prisma, oneCourseKey),
      modules.companyNames(courses.flatMap((c) => stringList(c.companyIds))),
    ]);
    const countOf = (rows: { courseId: string; _count: { _all: number } }[], cid: string) => rows.find((r) => r.courseId === cid)?._count._all ?? 0;
    return {
      courses: courses.map((c) => {
        const mine = lessons.filter((l) => l.courseId === c.id);
        return {
          id: c.id,
          title: c.title,
          moduleKey: c.moduleKey as ManageCourseRow['moduleKey'],
          audience: c.audience as ManageCourseRow['audience'],
          difficulty: c.difficulty as ManageCourseRow['difficulty'],
          status: c.status as ManageCourseRow['status'],
          starter: c.starterKey !== null,
          version: c.version,
          lessonCount: mine.length,
          minutes: mine.reduce((n, l) => n + l.minutes, 0),
          enrolled: countOf(enrolled, c.id),
          completed: countOf(completed, c.id),
          unpublishedChanges: changedSincePublish(c, mine.map((l) => l.updatedAt)),
          updatedAt: c.updatedAt.toISOString(),
          notice: courseNotice(c, notMerged),
          limitedTo: courseLimitedTo({ audience: c.audience, moduleKey: c.moduleKey, roleKeys: stringList(c.roleKeys), companyIds: stringList(c.companyIds) }, names),
          everPublished: c.publishedAt !== null,
          moduleCount: moduleCounts.get(c.id) ?? 0,
        };
      }),
    };
  }

  async function getCourse(actorId: string, courseId: unknown): Promise<ManageCourse> {
    await managerOf(ctx, actorId);
    return manageCourse((await courseRow(courseId)).id);
  }

  async function createCourse(actorId: string, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const input = courseInputSchema.parse(body ?? {});
    const data = await courseData(input, null, actor);
    const created = await prisma.trainingCourse.create({
      data: { ...(data as Prisma.TrainingCourseUncheckedCreateInput), title: input.title, moduleKey: input.moduleKey, audience: input.audience, status: 'DRAFT', createdById: actor.id, updatedById: actor.id },
    });
    await audit(actor, meta, 'training.course.create', created.id, { newValue: { title: created.title, moduleKey: created.moduleKey, audience: created.audience } });
    return manageCourse(created.id);
  }

  async function updateCourse(actorId: string, courseId: unknown, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseRow(courseId);
    const input = coursePatchSchema.parse(body ?? {});
    const data = await courseData(input, c, actor);
    await prisma.trainingCourse.update({ where: { id: c.id }, data: { ...data, updatedById: actor.id } });
    await audit(actor, meta, 'training.course.update', c.id, { newValue: input });
    return manageCourse(c.id);
  }

  async function deleteCourse(actorId: string, courseId: unknown, meta?: Meta): Promise<void> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseRow(courseId);
    const enrolments = await prisma.trainingEnrolment.count({ where: { courseId: c.id } });
    if (c.publishedAt || c.status !== 'DRAFT' || enrolments > 0) throw conflict('This course has been published or taken. Archive it instead.', 'ARCHIVE_INSTEAD');
    const files = await prisma.trainingFile.findMany({ where: { courseId: c.id }, select: { id: true, storageKey: true } });
    await prisma.$transaction([
      prisma.trainingFeedback.deleteMany({ where: { courseId: c.id } }),
      prisma.trainingAssignee.deleteMany({ where: { courseId: c.id } }),
      prisma.trainingAssignment.deleteMany({ where: { courseId: c.id } }),
      prisma.trainingFile.deleteMany({ where: { courseId: c.id } }),
      prisma.trainingCourse.delete({ where: { id: c.id } }),
    ]);
    for (const f of files) await ctx.files.remove(f.storageKey).catch(() => {});
    await audit(actor, meta, 'training.course.delete', c.id, { oldValue: { title: c.title } });
  }

  async function publish(actorId: string, courseId: unknown, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseRow(courseId);
    const input = publishSchema.parse(body ?? {});
    const lessons = await lessonsOf(c.id);
    const problems = problemsOf(lessons, await moduleSwitches(c.id));
    if (problems.length) throw new HttpError(`This course can’t be published yet: ${problems[0]}`, 'PUBLISH_PROBLEMS', 409, { problems });
    const now = ctx.clock();
    if (!c.publishedAt) {
      await prisma.trainingCourse.update({ where: { id: c.id }, data: { status: 'PUBLISHED', publishedAt: now, updatedAt: now, updatedById: actor.id } });
      await audit(actor, meta, 'training.course.publish', c.id, { newValue: { version: c.version } });
      await recheck(c.id);
      return manageCourse(c.id);
    }
    if (!input.change) throw new HttpError('Say whether this is a minor fix or a major change.', 'CHANGE_KIND_NEEDED', 400);
    const version = c.version + 1;
    const previous = c.publishedAt;
    const changed = input.change === 'MAJOR' ? lessons.filter((l) => l.updatedAt.getTime() > previous.getTime()).map((l) => l.id) : [];
    await prisma.$transaction(async (tx) => {
      if (changed.length) {
        await tx.trainingLesson.updateMany({ where: { id: { in: changed } }, data: { changedVersion: version, updatedAt: now } });
        await tx.trainingEnrolment.updateMany({
          where: { courseId: c.id, completedAt: { not: null }, withdrawnAt: null },
          data: { reviewFrom: now, reviewDueDay: shiftDayKey(ctx.today(), input.reviewDays ?? 14), reviewDoneAt: null },
        });
      }
      await tx.trainingCourse.update({
        where: { id: c.id },
        data: { status: 'PUBLISHED', version, publishedAt: now, updatedAt: now, updatedById: actor.id, ...(input.change === 'MAJOR' ? { majorAt: now } : {}) },
      });
    });
    await audit(actor, meta, 'training.course.publish', c.id, { newValue: { version, change: input.change, changedLessons: changed.length } });
    // R3 / review I1: lessons removed while it was unpublished finish anyone who has done every lesson left.
    await recheck(c.id);
    return manageCourse(c.id);
  }

  async function setStatus(actorId: string, courseId: unknown, status: 'DRAFT' | 'ARCHIVED', meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseRow(courseId);
    await prisma.trainingCourse.update({ where: { id: c.id }, data: { status, updatedById: actor.id } });
    await audit(actor, meta, status === 'DRAFT' ? 'training.course.unpublish' : 'training.course.archive', c.id, { oldValue: { status: c.status }, newValue: { status } });
    return manageCourse(c.id);
  }

  // ── Lessons, steps, quizzes ─────────────────────────────────────────────────────────────────────

  /** A lesson with no module (or a module that is gone) shows under "Other lessons"; in a module, while it is on. */
  const shownIn = (moduleId: string | null, switches: ReadonlyMap<string, boolean>) => moduleId === null || !switches.has(moduleId) || switches.get(moduleId) === true;

  const toProblem = (l: LessonRow, switches: ReadonlyMap<string, boolean>): ProblemLesson => ({
    shown: shownIn(l.moduleId, switches),
    title: l.title,
    kind: l.kind,
    videoId: l.videoId,
    fileId: l.fileId,
    stepCount: l.steps.length,
    quiz: l.quiz ? { passMark: l.quiz.passMark, drawCount: l.quiz.drawCount, questions: l.quiz.questions.map((q) => ({ kind: q.kind, prompt: q.prompt, options: q.options.map((o) => ({ correct: o.correct })) })) } : null,
  });

  /**
   * M8: an edit to a PUBLISHED course that would leave it unfinished (a quiz without questions or a right
   * answer, a guide without steps, a video without its link, no lessons) is refused before it is written.
   * `change` gives the course's lessons as they would be after the edit.
   */
  async function assertStillPublishable(courseId: string, change: (lessons: ProblemLesson[], rows: LessonRow[]) => ProblemLesson[]): Promise<void> {
    const course = await prisma.trainingCourse.findUnique({ where: { id: courseId }, select: { status: true } });
    if (course?.status !== 'PUBLISHED') return;
    const [rows, switches] = await Promise.all([lessonsOf(courseId), moduleSwitches(courseId)]);
    const now = rows.map((l) => toProblem(l, switches));
    const before = new Set(publishProblems(now));
    const fresh = publishProblems(change(now, rows)).filter((x) => !before.has(x));
    if (fresh.length) throw new HttpError(`This course is published, and this change would leave it unfinished: ${fresh[0]} Unpublish it first to rework it.`, 'WOULD_BREAK_PUBLISHED', 409, { problems: fresh });
  }

  /**
   * M8 for modules (1.23.31): a module switched off, removed or a lesson moved must leave a PUBLISHED course's lessons
   * people can see (those in a module switched on, or in none) as finished as they were — never no lesson at all, a
   * quiz without questions now shown, and so on. A course without modules is never asked.
   */
  async function assertShownPublishable(courseId: string, after: ModuleAfter): Promise<void> {
    const course = await prisma.trainingCourse.findUnique({ where: { id: courseId }, select: { status: true } });
    if (course?.status !== 'PUBLISHED') return;
    const [rows, now] = await Promise.all([lessonsOf(courseId), moduleSwitches(courseId)]);
    if (now.size === 0) return;
    const next = new Map([...now, ...(after.enabled ?? new Map<string, boolean>())]);
    if (after.removed) next.delete(after.removed);
    // Only the lessons people see are asked about (one in a module switched off is asked when it is switched on). With
    // none shown, every lesson goes in marked hidden, so the words are Publish's ("Add a lesson people can see: …").
    const problemsShown = (isShown: (l: LessonRow) => boolean) => {
      const seen = rows.filter(isShown);
      return publishProblems(seen.length ? seen.map((l) => ({ ...toProblem(l, now), shown: true })) : rows.map((l) => ({ ...toProblem(l, now), shown: false })));
    };
    const before = new Set(problemsShown((l) => shownIn(l.moduleId, now)));
    const moduleAfter = (l: LessonRow) => (after.moduleOf?.has(l.id) ? after.moduleOf.get(l.id)! : l.moduleId);
    const fresh = problemsShown((l) => shownIn(moduleAfter(l), next)).filter((x) => !before.has(x));
    if (fresh.length) throw new HttpError(`This course is published, and this change would leave it unfinished: ${fresh[0]} Unpublish it first to rework it.`, 'WOULD_BREAK_PUBLISHED', 409, { problems: fresh });
  }

  async function lessonFields(courseId: string, kind: string, input: z.infer<typeof lessonPatchSchema>): Promise<Prisma.TrainingLessonUncheckedUpdateInput> {
    const data: Prisma.TrainingLessonUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.minutes !== undefined) data.minutes = input.minutes;
    if (input.body !== undefined) data.body = richOrNull(input.body, 'body');
    if (input.videoUrl !== undefined) {
      if (kind !== 'VIDEO') {
        if (input.videoUrl) throw new ValidationError('Only a video lesson has a video link.', { field: 'videoUrl' });
      } else if (!input.videoUrl || !input.videoUrl.trim()) {
        Object.assign(data, { videoProvider: null, videoId: null, videoHash: null, videoUrl: null });
      } else {
        const v = normaliseVideoLink(input.videoUrl);
        Object.assign(data, { videoProvider: v.provider, videoId: v.videoId, videoHash: v.hash, videoUrl: input.videoUrl.trim() });
      }
    }
    if (input.fileId !== undefined) {
      if (kind !== 'DOCUMENT') {
        if (input.fileId) throw new ValidationError('Only a document lesson has a file.', { field: 'fileId' });
      } else if (input.fileId) {
        const f = await prisma.trainingFile.findUnique({ where: { id: input.fileId }, select: { courseId: true, kind: true } });
        if (!f || f.courseId !== courseId || (f.kind !== 'DOCUMENT' && f.kind !== 'RESOURCE')) throw new ValidationError('Upload the document to this course first.', { field: 'fileId' });
        data.fileId = input.fileId;
      } else data.fileId = null;
    }
    return data;
  }

  async function addLesson(actorId: string, courseId: unknown, body: unknown, meta?: Meta): Promise<ManageLesson> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseRow(courseId);
    const input = lessonInputSchema.parse(body ?? {});
    const count = await prisma.trainingLesson.count({ where: { courseId: c.id } });
    if (count >= LIMITS.lessonsPerCourse) throw new ValidationError(`A course has at most ${LIMITS.lessonsPerCourse} lessons.`);
    const data = await lessonFields(c.id, input.kind, input);
    const last = await prisma.trainingLesson.findFirst({ where: { courseId: c.id }, orderBy: [{ position: 'desc' }], select: { position: true } });
    const created = await prisma.trainingLesson.create({
      data: { ...(data as Prisma.TrainingLessonUncheckedCreateInput), courseId: c.id, kind: input.kind, title: input.title, minutes: input.minutes ?? 5, position: (last?.position ?? -1) + 1, changedVersion: c.version },
    });
    if (input.kind === 'QUIZ') await prisma.trainingQuiz.create({ data: { lessonId: created.id } });
    await touchCourse(c.id, actor);
    await audit(actor, meta, 'training.lesson.create', created.id, { newValue: { courseId: c.id, kind: input.kind, title: input.title } });
    return manageLesson(created.id);
  }

  async function updateLesson(actorId: string, lessonId: unknown, body: unknown, meta?: Meta): Promise<ManageLesson> {
    const actor = await managerOf(ctx, actorId);
    const l = await lessonRow(lessonId);
    const input = lessonPatchSchema.parse(body ?? {});
    if (input.kind !== undefined && input.kind !== l.kind) throw new ValidationError('A lesson’s kind can’t change: add a new lesson instead.', { field: 'kind' });
    const data = await lessonFields(l.courseId, l.kind, input);
    // 1.23.31 (D6): moved to another module of its course (or none) — last in it; the course's change, not the lesson's.
    const moving = input.moduleId !== undefined && input.moduleId !== l.moduleId;
    if (moving) await modules.checkLessonModule(l.courseId, input.moduleId!);
    await assertStillPublishable(l.courseId, (lessons, rows) =>
      lessons.map((x, i) =>
        rows[i]!.id !== l.id
          ? x
          : { ...x, ...('videoId' in data ? { videoId: (data.videoId as string | null) ?? null } : {}), ...('fileId' in data ? { fileId: (data.fileId as string | null) ?? null } : {}) },
      ),
    );
    // R1/R2: pasting, changing or clearing a video's link isn't an edit to publish — the lesson shows (or hides) at
    // once, the course never reads "Changes not published", and later starter updates still reach it.
    const VIDEO_FIELDS = new Set(['videoProvider', 'videoId', 'videoHash', 'videoUrl']);
    const current = l as unknown as Record<string, unknown>;
    const contentChanged = Object.entries(data).some(([k, v]) => !VIDEO_FIELDS.has(k) && (current[k] ?? null) !== (v ?? null));
    if (moving) {
      await assertShownPublishable(l.courseId, { moduleOf: new Map([[l.id, input.moduleId!]]) });
      const last = await prisma.trainingLesson.findFirst({ where: { courseId: l.courseId }, orderBy: [{ position: 'desc' }], select: { position: true } });
      Object.assign(data, { moduleId: input.moduleId, position: (last?.position ?? -1) + 1 });
    }
    await prisma.trainingLesson.update({ where: { id: l.id }, data: { ...data, updatedAt: contentChanged ? ctx.clock() : l.updatedAt } });
    if (moving) await touchCourse(l.courseId, actor);
    await audit(actor, meta, 'training.lesson.update', l.id, { newValue: { ...input, body: input.body === undefined ? undefined : '(changed)' } });
    // A lesson leaving a module (or a video's link cleared) can leave people with everything done (R3).
    if (moving || (l.kind === 'VIDEO' && l.videoId && 'videoId' in data && !data.videoId)) await recheck(l.courseId);
    return manageLesson(l.id);
  }

  async function deleteLesson(actorId: string, lessonId: unknown, meta?: Meta): Promise<void> {
    const actor = await managerOf(ctx, actorId);
    const l = await lessonRow(lessonId);
    await assertStillPublishable(l.courseId, (lessons, rows) => lessons.filter((_, i) => rows[i]!.id !== l.id));
    await prisma.trainingLesson.delete({ where: { id: l.id } });
    await touchCourse(l.courseId, actor);
    await audit(actor, meta, 'training.lesson.delete', l.id, { oldValue: { courseId: l.courseId, title: l.title } });
    await recheck(l.courseId);
  }

  /**
   * Batch 4b (owner, 13 Nov): before a lesson is deleted, how many people the deletion would finish (and certify,
   * when the course gives a certificate) — worked out from everyone's progress now; nothing is changed.
   */
  async function lessonDeleteImpact(actorId: string, lessonId: unknown): Promise<LessonDeleteImpact> {
    await managerOf(ctx, actorId);
    const l = await lessonRow(lessonId);
    const c = await prisma.trainingCourse.findUnique({ where: { id: l.courseId }, select: { status: true, certificateOn: true } });
    if (!c) throw notFound();
    return { finishing: await finish.finishingWithout(l.courseId, l.id), certificate: c.certificateOn, published: c.status === 'PUBLISHED' };
  }

  async function reorderLessons(actorId: string, courseId: unknown, body: unknown, meta?: Meta): Promise<ManageCourse> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseRow(courseId);
    const { lessonIds } = orderSchema.parse(body ?? {});
    const lessons = await prisma.trainingLesson.findMany({ where: { courseId: c.id }, select: { id: true, updatedAt: true } });
    const known = new Set(lessons.map((l) => l.id));
    if (lessonIds.length !== lessons.length || new Set(lessonIds).size !== lessonIds.length || lessonIds.some((x) => !known.has(x))) {
      throw new ValidationError('Send every lesson of the course once, in the new order.', { field: 'lessonIds' });
    }
    const at = new Map(lessons.map((l) => [l.id, l.updatedAt]));
    // The order is the course's change, not the lessons' (their own updatedAt stays: a Major change asks only about edited lessons).
    await prisma.$transaction(lessonIds.map((lid, i) => prisma.trainingLesson.update({ where: { id: lid }, data: { position: i, updatedAt: at.get(lid)! } })));
    await touchCourse(c.id, actor);
    await audit(actor, meta, 'training.lesson.reorder', c.id, { newValue: { lessonIds } });
    return manageCourse(c.id);
  }

  async function saveSteps(actorId: string, lessonId: unknown, body: unknown, meta?: Meta): Promise<ManageLesson> {
    const actor = await managerOf(ctx, actorId);
    const l = await lessonRow(lessonId);
    if (l.kind !== 'GUIDE') throw new ValidationError('Steps are for step-by-step guide lessons.');
    const { steps } = stepsSchema.parse(body ?? {});
    const imageIds = [...new Set(steps.map((s) => s.imageFileId).filter((x): x is string => !!x))];
    if (imageIds.length) {
      const ok = await prisma.trainingFile.count({ where: { id: { in: imageIds }, courseId: l.courseId, kind: 'IMAGE' } });
      if (ok !== imageIds.length) throw new ValidationError('Upload each step’s picture to this course first.', { field: 'steps' });
    }
    const rows = steps.map((s, i) => ({
      lessonId: l.id,
      position: i,
      title: s.title?.trim() || null,
      body: richOrNull(s.body, `steps.${i}.body`),
      imageFileId: s.imageFileId ?? null,
      imageAlt: s.imageFileId ? s.imageAlt?.trim() || null : null,
    }));
    await assertStillPublishable(l.courseId, (lessons, all) => lessons.map((x, i) => (all[i]!.id === l.id ? { ...x, stepCount: rows.length } : x)));
    // The lesson row locked first (two saves of the same guide at once write one after the other).
    const saved = await withRowLock(
      prisma,
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM training_lessons WHERE id = ${l.id} FOR UPDATE`,
      async (tx, locked) => {
        if (locked.length === 0) return false;
        await tx.trainingStep.deleteMany({ where: { lessonId: l.id } });
        await tx.trainingStep.createMany({ data: rows });
        await touchLesson(l.id, tx);
        await clampSavedSteps(tx, l.id, rows.length);
        return true;
      },
    );
    if (!saved) throw notFound('Lesson');
    await audit(actor, meta, 'training.lesson.steps', l.id, { newValue: { steps: rows.length } });
    return manageLesson(l.id);
  }

  async function saveQuiz(actorId: string, lessonId: unknown, body: unknown, meta?: Meta): Promise<ManageLesson> {
    const actor = await managerOf(ctx, actorId);
    const l = await lessonRow(lessonId);
    if (l.kind !== 'QUIZ') throw new ValidationError('Questions are for quiz lessons.');
    const input = quizInputSchema.parse(body ?? {});
    if (input.drawCount && input.questions.length && input.drawCount > input.questions.length) {
      throw new ValidationError(`The quiz draws ${input.drawCount} questions but has only ${input.questions.length}.`, { field: 'drawCount' });
    }
    const questions = normaliseQuestions(input.questions);
    await assertStillPublishable(l.courseId, (lessons, rows) =>
      lessons.map((x, i) =>
        rows[i]!.id === l.id
          ? { ...x, quiz: { passMark: input.passMark, drawCount: input.drawCount ?? null, questions: questions.map((q) => ({ kind: q.kind, prompt: q.prompt, options: q.options.map((o) => ({ correct: o.correct })) })) } }
          : x,
      ),
    );
    await prisma.$transaction(
      async (tx) => {
        const settings = {
          passMark: input.passMark,
          maxAttempts: input.maxAttempts ?? null,
          shuffle: input.shuffle ?? false,
          timeLimitMinutes: input.timeLimitMinutes ?? null,
          drawCount: input.drawCount ?? null,
        };
        const quiz = await tx.trainingQuiz.upsert({ where: { lessonId: l.id }, create: { lessonId: l.id, ...settings }, update: settings });
        const existing = await tx.trainingQuestion.findMany({ where: { quizId: quiz.id }, include: { options: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
        const free = new Map(existing.map((q) => [q.id, q]));
        for (const [i, q] of questions.entries()) {
          // Keep a question's id (the per-question report) when it is sent, or when it is the same question.
          let match = q.id ? free.get(q.id) : undefined;
          if (!match) match = [...free.values()].find((e) => e.kind === q.kind && e.prompt === q.prompt);
          if (match) free.delete(match.id);
          const qid = match
            ? (await tx.trainingQuestion.update({ where: { id: match.id }, data: { position: i, kind: q.kind, prompt: q.prompt, explanation: q.explanation } })).id
            : (await tx.trainingQuestion.create({ data: { quizId: quiz.id, position: i, kind: q.kind, prompt: q.prompt, explanation: q.explanation } })).id;
          const oldOptions = new Map((match?.options ?? []).map((o) => [o.id, o]));
          for (const [k, o] of q.options.entries()) {
            let om = o.id ? oldOptions.get(o.id) : undefined;
            if (!om) om = [...oldOptions.values()].find((e) => e.text === o.text);
            if (om) {
              oldOptions.delete(om.id);
              await tx.trainingOption.update({ where: { id: om.id }, data: { position: k, text: o.text, correct: o.correct, feedback: o.feedback } });
            } else {
              await tx.trainingOption.create({ data: { questionId: qid, position: k, text: o.text, correct: o.correct, feedback: o.feedback } });
            }
          }
          if (oldOptions.size) await tx.trainingOption.deleteMany({ where: { id: { in: [...oldOptions.keys()] } } });
        }
        if (free.size) await tx.trainingQuestion.deleteMany({ where: { id: { in: [...free.keys()] } } });
        await tx.trainingLesson.update({ where: { id: l.id }, data: { updatedAt: ctx.clock() } });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await audit(actor, meta, 'training.lesson.quiz', l.id, { newValue: { questions: questions.length, passMark: input.passMark } });
    return manageLesson(l.id);
  }

  // ── Files ───────────────────────────────────────────────────────────────────────────────────────

  async function storeFile(actor: PersonRecord, courseId: string | null, kind: FileKind, file: TrainingUpload): Promise<FileRef> {
    const checked = checkTrainingUpload(file, kind);
    let content = file.content;
    if ((kind === 'IMAGE' || kind === 'SIGNATURE') && ctx.shrinkImage) {
      try {
        content = await ctx.shrinkImage(file.content, checked.mimeType);
      } catch (err) {
        ctx.logger?.warn('training: a picture could not be made smaller (kept as uploaded)', { err: String((err as Error)?.message ?? err) });
      }
    }
    const storageKey = await ctx.files.save(content, checked.mimeType);
    try {
      const last = courseId ? await prisma.trainingFile.findFirst({ where: { courseId }, orderBy: [{ position: 'desc' }], select: { position: true } }) : null;
      const row = await prisma.trainingFile.create({
        data: { courseId, kind, name: checked.name, mimeType: checked.mimeType, sizeBytes: content.length, storageKey, position: (last?.position ?? -1) + 1, uploadedById: actor.id },
      });
      return fileRef(row);
    } catch (err) {
      await ctx.files.remove(storageKey).catch(() => {});
      throw err;
    }
  }

  async function uploadFile(actorId: string, courseId: unknown, kindRaw: unknown, file: TrainingUpload, meta?: Meta): Promise<FileRef> {
    const actor = await managerOf(ctx, actorId);
    const c = await courseRow(courseId);
    const kind = String(kindRaw ?? '');
    if (kind !== 'RESOURCE' && kind !== 'DOCUMENT' && kind !== 'IMAGE') throw new ValidationError('Say what the file is: RESOURCE, DOCUMENT or IMAGE.', { field: 'kind' });
    const ref = await storeFile(actor, c.id, kind, file);
    if (kind === 'RESOURCE') await touchCourse(c.id, actor);
    await audit(actor, meta, 'training.file.upload', ref.id, { newValue: { courseId: c.id, kind, name: ref.name, sizeBytes: ref.sizeBytes } });
    return ref;
  }

  async function uploadSignature(actorId: string, file: TrainingUpload, meta?: Meta): Promise<FileRef> {
    const actor = await managerOf(ctx, actorId);
    const ref = await storeFile(actor, null, 'SIGNATURE', file);
    await audit(actor, meta, 'training.file.signature', ref.id, { newValue: { name: ref.name } });
    return ref;
  }

  async function deleteFile(actorId: string, fileId: unknown, meta?: Meta): Promise<void> {
    const actor = await managerOf(ctx, actorId);
    const fid = idOf(fileId, 'File');
    const f = await prisma.trainingFile.findUnique({ where: { id: fid } });
    if (!f) throw notFound('File');
    const lesson = await prisma.trainingLesson.findFirst({ where: { fileId: f.id }, select: { title: true } });
    if (lesson) throw conflict(`This file is used by the lesson “${lesson.title}”. Remove it there first.`, 'FILE_IN_USE');
    const step = await prisma.trainingStep.findFirst({ where: { imageFileId: f.id }, select: { lesson: { select: { title: true } } } });
    if (step) throw conflict(`This picture is used by a step of the lesson “${step.lesson.title}”. Remove it there first.`, 'FILE_IN_USE');
    const course = await prisma.trainingCourse.findFirst({ where: { signatureFileId: f.id }, select: { title: true } });
    if (course) throw conflict(`This signature is used by the course “${course.title}”. Remove it there first.`, 'FILE_IN_USE');
    await prisma.trainingFile.delete({ where: { id: f.id } });
    await ctx.files.remove(f.storageKey).catch(() => {});
    if (f.courseId && f.kind === 'RESOURCE') await touchCourse(f.courseId, actor);
    await audit(actor, meta, 'training.file.delete', f.id, { oldValue: { courseId: f.courseId, kind: f.kind, name: f.name } });
  }

  // ── Targets ─────────────────────────────────────────────────────────────────────────────────────

  async function options(actorId: string): Promise<TargetOptions> {
    const actor = await managerOf(ctx, actorId);
    const scope = scopeOf(actor);
    const people = [...(await ctx.people()).values()].filter((p) => p.active && inScope(scope, p)).sort((a, b) => a.name.localeCompare(b.name));
    const [departments, companies, projects] = await Promise.all([
      prisma.department.findMany({ select: { id: true, name: true }, orderBy: [{ name: 'asc' }] }),
      prisma.company.findMany({ where: { status: 'ACTIVE', ...(scope ? { id: { in: scope } } : {}) }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
      prisma.project.findMany({
        where: { deletedAt: null, AND: [LIVE_PROJECT_WHERE, ...(scope ? [{ companies: { some: { companyId: { in: scope } } } }] : [])] },
        select: { id: true, name: true, code: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    // M6: a Training manager's choice of "Issued by": administrators and the Training managers of her companies.
    const issuers = [...(await ctx.people()).values()]
      .filter((p) => p.active && !p.client && (p.admin || (p.trainingManager && (!scope || p.id === actor.id || p.companyIds.some((c) => scope.includes(c))))))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      groups: GROUP_KEYS.map((key) => ({ key, label: GROUP_LABELS[key] })),
      people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, client: p.client })),
      departments,
      companies,
      projects: projects.map((p) => ({ id: p.id, name: p.name, code: p.code })),
      issuers: issuers.map((p) => ({ id: p.id, name: p.name })),
    };
  }

  /** The target exists and is inside the manager's companies (R5); its label. */
  async function checkTarget(actor: PersonRecord, kind: string, targetId: string): Promise<string> {
    const scope = scopeOf(actor);
    switch (kind) {
      case 'USER': {
        const p = await ctx.person(targetId);
        if (!p || !p.active || !inScope(scope, p)) throw new ValidationError('Choose an active person in your companies.', { field: 'targetId' });
        return p.name;
      }
      case 'GROUP':
        if (!(GROUP_KEYS as readonly string[]).includes(targetId)) throw new ValidationError('Choose a group.', { field: 'targetId' });
        return GROUP_LABELS[targetId as keyof typeof GROUP_LABELS];
      case 'DEPARTMENT': {
        const d = await prisma.department.findUnique({ where: { id: targetId }, select: { name: true } });
        if (!d) throw new ValidationError('Choose a department.', { field: 'targetId' });
        return d.name;
      }
      case 'COMPANY': {
        const co = await prisma.company.findUnique({ where: { id: targetId }, select: { name: true } });
        if (!co) throw new ValidationError('Choose a company.', { field: 'targetId' });
        if (scope && !scope.includes(targetId)) throw forbidden('You can assign training only to people in your companies.');
        return co.name;
      }
      case 'PROJECT': {
        const p = await prisma.project.findFirst({ where: { id: targetId, deletedAt: null, AND: [LIVE_PROJECT_WHERE] }, select: { name: true, companies: { select: { companyId: true } } } });
        if (!p) throw new ValidationError('Choose a project.', { field: 'targetId' });
        if (scope && !p.companies.some((c) => scope.includes(c.companyId))) throw forbidden('You can assign training only to people in your companies.');
        return p.name;
      }
      default:
        throw new ValidationError('Choose who it is for.', { field: 'targetKind' });
    }
  }

  async function publishedCourses(courseIds: readonly string[]) {
    const unique = [...new Set(courseIds)];
    const rows = await prisma.trainingCourse.findMany({ where: { id: { in: unique } }, select: { id: true, title: true, status: true, audience: true, moduleKey: true, roleKeys: true, companyIds: true } });
    if (rows.length !== unique.length) throw new ValidationError('One of those courses doesn’t exist.', { field: 'courseIds' });
    const draft = rows.find((r) => r.status !== 'PUBLISHED');
    if (draft) throw conflict(`“${draft.title}” isn’t published. Publish the course first.`, 'NOT_PUBLISHED');
    return unique.map((cid) => rows.find((r) => r.id === cid)!);
  }

  function checkDue(input: { dueDay?: string | null; dueDays?: number | null }) {
    if (input.dueDay) {
      if (Number.isNaN(Date.parse(`${input.dueDay}T12:00:00Z`)) || new Date(`${input.dueDay}T12:00:00Z`).toISOString().slice(0, 10) !== input.dueDay) throw new ValidationError('Choose a day.', { field: 'dueDay' });
      if (input.dueDay < ctx.today()) throw new ValidationError('Choose a due day from today on.', { field: 'dueDay' });
    }
  }

  const draftFacts = (actor: PersonRecord, courseId: string, input: { targetKind: string; targetId: string; mandatory: boolean; dueDay?: string | null; dueDays?: number | null }): AssignmentFacts => ({
    id: 'preview',
    courseId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    mandatory: input.mandatory,
    dueDay: input.dueDay ?? null,
    dueDays: input.dueDays ?? null,
    newAccountsOnly: false,
    scopeCompanyIds: scopeOf(actor),
    createdAt: ctx.clock(),
    frozen: false,
  });

  /** "New staff only" is for a group, a department or a company, due a number of days after joining (or never). */
  function checkNewStaff(input: { targetKind: string; dueDay?: string | null }): void {
    if (!(RULE_TARGET_KINDS as readonly string[]).includes(input.targetKind)) throw new ValidationError('“New staff only” is for a group, a department or a company.', { field: 'targetKind' });
    if (input.dueDay) throw new ValidationError('New staff get it when they join: give a number of days after that, not a day.', { field: 'dueDay' });
  }

  /** The targets to create or preview: the one target, or each ticked person as a USER (each checked like a USER target). */
  async function checkedTargets(actor: PersonRecord, input: AssignmentInputParsed): Promise<{ kind: string; id: string; label: string }[]> {
    if (input.targetKind === 'PEOPLE') {
      const out: { kind: string; id: string; label: string }[] = [];
      for (const uid of input.userIds ?? []) out.push({ kind: 'USER', id: uid, label: await checkTarget(actor, 'USER', uid) });
      return out;
    }
    return [{ kind: input.targetKind, id: input.targetId!, label: await checkTarget(actor, input.targetKind, input.targetId!) }];
  }

  async function previewAssignment(actorId: string, body: unknown): Promise<{ reach: number; already: number; skipped: { name: string; reason: string }[] }> {
    const actor = await managerOf(ctx, actorId);
    const input = assignmentInputSchema.parse(body ?? {});
    if (input.newStaffOnly) checkNewStaff(input);
    const courses = await publishedCourses(input.courseIds);
    const targets = await checkedTargets(actor, input);
    checkDue(input);
    // Nobody there today gets it: only people who join from now on.
    if (input.newStaffOnly) return { reach: 0, already: 0, skipped: [] };
    const people = input.targetKind === 'PEOPLE' ? [...(await ctx.people(input.userIds)).values()] : [...(await ctx.people()).values()];
    const enrolments = await prisma.trainingEnrolment.findMany({ where: { courseId: { in: courses.map((c) => c.id) }, withdrawnAt: null }, select: { userId: true, courseId: true } });
    const has = new Set(enrolments.map((e) => `${e.userId}|${e.courseId}`));
    const reached = new Set<string>();
    const skipped: { name: string; reason: string }[] = [];
    const seen = new Set<string>();
    for (const course of courses) {
      const cf = courseFacts(course);
      for (const t of targets) {
        const facts = draftFacts(actor, course.id, { ...input, targetKind: t.kind, targetId: t.id });
        for (const p of people) {
          if (reaches(facts, cf, p)) reached.add(p.id);
          else if (p.active && targetMatches(facts, p) && inScope(facts.scopeCompanyIds, p)) {
            const reason = courses.length === 1 ? 'can’t see this course' : `can’t see “${course.title}”`;
            const key = `${p.id}|${reason}`;
            if (!seen.has(key) && skipped.length < 50) skipped.push({ name: p.name, reason });
            seen.add(key);
          }
        }
      }
    }
    const already = [...reached].filter((uid) => courses.every((c) => has.has(`${uid}|${c.id}`))).length;
    return { reach: reached.size, already, skipped };
  }

  async function assignmentRows(actor: PersonRecord, rows: Prisma.TrainingAssignmentGetPayload<object>[]): Promise<AssignmentRow[]> {
    if (rows.length === 0) return [];
    const scope = scopeOf(actor);
    const assignees = await prisma.trainingAssignee.findMany({ where: { assignmentId: { in: rows.map((r) => r.id) }, withdrawnAt: null }, select: { assignmentId: true, userId: true, courseId: true, dueDay: true } });
    const people = await ctx.people([...new Set([...assignees.map((a) => a.userId), ...rows.map((r) => r.createdById).filter((x): x is string => !!x), ...rows.filter((r) => r.targetKind === 'USER').map((r) => r.targetId)])]);
    // I5: finished courses by course IN and people in pieces, matched in memory; assignees grouped once.
    const done = new Set<string>();
    const courseIds = [...new Set(assignees.map((a) => a.courseId))];
    for (const part of chunks([...new Set(assignees.map((a) => a.userId))])) {
      for (const e of await prisma.trainingEnrolment.findMany({ where: { courseId: { in: courseIds }, userId: { in: part }, completedAt: { not: null } }, select: { userId: true, courseId: true } })) done.add(`${e.userId}|${e.courseId}`);
    }
    const byAssignment = new Map<string, typeof assignees>();
    for (const a of assignees) {
      if (scope && !(people.get(a.userId) && inScope(scope, people.get(a.userId)!))) continue;
      const list = byAssignment.get(a.assignmentId);
      if (list) list.push(a);
      else byAssignment.set(a.assignmentId, [a]);
    }
    const courses = new Map((await prisma.trainingCourse.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } }, select: { id: true, title: true } })).map((c) => [c.id, c.title]));
    const labels = await targetLabels(rows, people, actor);
    const today = ctx.today();
    // M6: the creator is named only when an administrator or one of the reader's companies' people.
    const creator = (id: string | null) => {
      const p = id ? people.get(id) : undefined;
      return p && (!scope || p.admin || inScope(scope, p)) ? p.name : null;
    };
    const singles = rows.map((r) => {
      const mine = byAssignment.get(r.id) ?? [];
      const completed = mine.filter((a) => done.has(`${a.userId}|${a.courseId}`)).length;
      const overdue = mine.filter((a) => a.dueDay && a.dueDay < today && !done.has(`${a.userId}|${a.courseId}`)).length;
      return {
        id: r.id,
        courseId: r.courseId,
        courseTitle: courses.get(r.courseId) ?? 'Course',
        targetKind: r.targetKind as AssignmentRow['targetKind'],
        targetId: r.targetId,
        targetLabel: labels.get(`${r.targetKind}|${r.targetId}`) ?? r.targetId,
        mandatory: r.mandatory,
        dueDay: r.dueDay,
        dueDays: r.dueDays,
        ruleId: r.ruleId,
        people: mine.length,
        completed,
        overdue,
        createdAt: r.createdAt.toISOString(),
        createdByName: creator(r.createdById),
        frozen: r.frozenAt !== null,
        batchId: r.batchId,
        members: [],
      } satisfies AssignmentRow;
    });
    // R4: the USER rows made together for several people (same batch and course) are one "<n> people" entry.
    const out: AssignmentRow[] = [];
    const groups = new Map<string, AssignmentRow>();
    singles.forEach((row, i) => {
      const r = rows[i]!;
      if (!r.batchId || r.targetKind !== 'USER') {
        out.push({ ...row, batchId: null });
        return;
      }
      const key = `${r.batchId}|${r.courseId}`;
      const member = { assignmentId: r.id, userId: r.targetId, name: labels.get(`USER|${r.targetId}`) ?? 'A former account' };
      const g = groups.get(key);
      if (g) {
        g.members.push(member);
        g.people += row.people;
        g.completed += row.completed;
        g.overdue += row.overdue;
        return;
      }
      const entry: AssignmentRow = { ...row, targetKind: 'PEOPLE', targetId: r.batchId, targetLabel: '', members: [member] };
      groups.set(key, entry);
      out.push(entry);
    });
    for (const g of groups.values()) {
      g.members.sort((a, b) => a.name.localeCompare(b.name, 'en') || a.userId.localeCompare(b.userId, 'en'));
      g.targetLabel = g.members.length === 1 ? '1 person' : `${g.members.length} people`;
    }
    return out;
  }

  /** Each target's label; M6: outside a Training manager's companies people, companies and projects are never named. */
  async function targetLabels(rows: readonly { targetKind: string; targetId: string }[], people: Map<string, PersonRecord>, actor: PersonRecord): Promise<Map<string, string>> {
    const scope = scopeOf(actor);
    const ids = (kind: string) => [...new Set(rows.filter((r) => r.targetKind === kind).map((r) => r.targetId))];
    const [deps, cos, projs] = await Promise.all([
      ids('DEPARTMENT').length ? prisma.department.findMany({ where: { id: { in: ids('DEPARTMENT') } }, select: { id: true, name: true } }) : [],
      ids('COMPANY').length ? prisma.company.findMany({ where: { id: { in: ids('COMPANY') } }, select: { id: true, name: true } }) : [],
      ids('PROJECT').length ? prisma.project.findMany({ where: { id: { in: ids('PROJECT') } }, select: { id: true, name: true, companies: { select: { companyId: true } } } }) : [],
    ]);
    const out = new Map<string, string>();
    for (const r of rows) {
      const k = `${r.targetKind}|${r.targetId}`;
      if (r.targetKind === 'USER') {
        const p = people.get(r.targetId);
        out.set(k, !p ? 'A former account' : !scope || inScope(scope, p) ? p.name : 'Someone in another company');
      }
      if (r.targetKind === 'GROUP') out.set(k, GROUP_LABELS[r.targetId as keyof typeof GROUP_LABELS] ?? r.targetId);
    }
    for (const d of deps) out.set(`DEPARTMENT|${d.id}`, d.name);
    for (const c of cos) out.set(`COMPANY|${c.id}`, !scope || scope.includes(c.id) ? c.name : 'Another company');
    for (const p of projs) out.set(`PROJECT|${p.id}`, !scope || p.companies.some((c) => scope.includes(c.companyId)) ? p.name : 'A project in another company');
    return out;
  }

  /**
   * M6: the assignments and rules a Training manager may list — made inside her companies, or aimed at
   * something inside them (a group or a department covers every company). Administrators: all.
   */
  async function visibleToManager<T extends { id: string; targetKind: string; targetId: string; scopeCompanyIds: unknown }>(actor: PersonRecord, rows: readonly T[]): Promise<T[]> {
    const scope = scopeOf(actor);
    if (!scope) return [...rows];
    const userIds = [...new Set(rows.filter((r) => r.targetKind === 'USER').map((r) => r.targetId))];
    const projectIds = [...new Set(rows.filter((r) => r.targetKind === 'PROJECT').map((r) => r.targetId))];
    const [people, projects] = await Promise.all([
      ctx.people(userIds),
      projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, companies: { select: { companyId: true } } } }) : [],
    ]);
    const projectCompanies = new Map(projects.map((p) => [p.id, p.companies.map((c) => c.companyId)]));
    const targetInScope = (r: T) => {
      switch (r.targetKind) {
        case 'USER':
          return !!people.get(r.targetId) && inScope(scope, people.get(r.targetId)!);
        case 'COMPANY':
          return scope.includes(r.targetId);
        case 'PROJECT':
          return (projectCompanies.get(r.targetId) ?? []).some((c) => scope.includes(c));
        default:
          return true;
      }
    };
    return rows.filter((r) => mayChange(actor, r.scopeCompanyIds) || targetInScope(r));
  }

  async function listAssignments(actorId: string, rawQuery: unknown): Promise<{ assignments: AssignmentRow[] }> {
    const actor = await managerOf(ctx, actorId);
    const q = assignmentListQuery.parse(rawQuery ?? {});
    const rows = await prisma.trainingAssignment.findMany({ where: { withdrawnAt: null, ...(q.courseId ? { courseId: q.courseId } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1000 });
    return { assignments: await assignmentRows(actor, await visibleToManager(actor, rows)) };
  }

  async function assign(actorId: string, body: unknown, meta?: Meta): Promise<{ assignments: AssignmentRow[] }> {
    const actor = await managerOf(ctx, actorId);
    const input = assignmentInputSchema.parse(body ?? {});
    if (input.newStaffOnly) checkNewStaff(input);
    const courses = await publishedCourses(input.courseIds);
    const targets = await checkedTargets(actor, input);
    const label = targets[0]!.label;
    checkDue(input);
    if (input.newStaffOnly) {
      // Owner answer 2: the onboarding rule behind "New staff only" (listed in Assigned; switched off, never deleted there).
      const name = [...`New staff: ${label}`].slice(0, LIMITS.ruleName).join('');
      const { rule, assignmentIds } = await makeRule(actor, { name, targetKind: input.targetKind, targetId: input.targetId!, mandatory: input.mandatory, dueDays: input.dueDays ?? null, active: true }, courses);
      await audit(actor, meta, 'training.assignment.new-staff', rule.id, { newValue: { courseIds: courses.map((c) => c.id), targetKind: input.targetKind, targetId: input.targetId } });
      return { assignments: await assignmentRows(actor, await prisma.trainingAssignment.findMany({ where: { id: { in: assignmentIds } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })) };
    }
    const scope = scopeOf(actor);
    const now = ctx.clock();
    // PEOPLE: one batch id for every row made together (one USER row per person and course).
    const batchId = input.targetKind === 'PEOPLE' ? newRowId() : null;
    const rows = courses.flatMap((c) =>
      targets.map(
        (t): Prisma.TrainingAssignmentCreateManyInput => ({
          id: newRowId(),
          courseId: c.id,
          targetKind: t.kind,
          targetId: t.id,
          mandatory: input.mandatory,
          dueDay: input.dueDay ?? null,
          dueDays: input.dueDays ?? null,
          scopeCompanyIds: scope === null ? Prisma.DbNull : scope,
          batchId,
          createdById: actor.id,
          createdAt: now,
        }),
      ),
    );
    // Every row of the request at once (up to 200 people × 20 courses): a failure half-way leaves none, so a retry
    // never makes doubles; then one sync for them all.
    await prisma.$transaction(chunks(rows, 500).map((part) => prisma.trainingAssignment.createMany({ data: part })));
    const ids = rows.map((r) => r.id!);
    const order = new Map(ids.map((rid, i) => [rid, i]));
    const created = (await Promise.all(chunks(ids).map((part) => prisma.trainingAssignment.findMany({ where: { id: { in: part } } }))))
      .flat()
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    await sync.assignments(ids);
    for (const a of created) await audit(actor, meta, 'training.assignment.create', a.id, { newValue: { courseId: a.courseId, targetKind: a.targetKind, targetId: a.targetId, mandatory: a.mandatory, dueDay: a.dueDay, dueDays: a.dueDays } });
    return { assignments: await assignmentRows(actor, created) };
  }

  /** R5: administrators change anything; a Training manager only what was made inside their companies. */
  const mayChange = (actor: PersonRecord, scopeCompanyIds: unknown) => {
    if (actor.admin) return true;
    if (scopeCompanyIds === null || scopeCompanyIds === undefined) return false;
    const s = stringList(scopeCompanyIds);
    return s.length > 0 && s.every((c) => actor.companyIds.includes(c));
  };

  async function withdrawAssignment(actorId: string, assignmentId: unknown, meta?: Meta): Promise<void> {
    const actor = await managerOf(ctx, actorId);
    const aid = idOf(assignmentId, 'Assignment');
    const a = await prisma.trainingAssignment.findFirst({ where: { id: aid, withdrawnAt: null } });
    if (!a) throw notFound('Assignment');
    if (!mayChange(actor, a.scopeCompanyIds)) throw forbidden('Only an administrator (or a Training manager of the same companies) can withdraw this assignment.');
    if (a.ruleId) {
      const rule = await prisma.trainingRule.findUnique({ where: { id: a.ruleId }, select: { name: true } });
      if (rule) throw conflict('This is a “New staff only” assignment: switch it off instead. Nobody loses what they have.', 'RULE_ASSIGNMENT');
    }
    const withdrawn = await sync.withdrawAssignments([a.id], actor.id);
    await audit(actor, meta, 'training.assignment.withdraw', a.id, { oldValue: { courseId: a.courseId, targetKind: a.targetKind, targetId: a.targetId }, newValue: { enrolmentsWithdrawn: withdrawn } });
  }

  /** R4: withdraw every person of a "several people" assignment that this manager may change. */
  async function withdrawBatch(actorId: string, batchId: unknown, meta?: Meta): Promise<void> {
    const actor = await managerOf(ctx, actorId);
    const bid = idOf(batchId, 'Assignment');
    const rows = await prisma.trainingAssignment.findMany({ where: { batchId: bid, withdrawnAt: null, ruleId: null }, select: { id: true, courseId: true, targetId: true, scopeCompanyIds: true } });
    if (rows.length === 0) throw notFound('Assignment');
    const mine = rows.filter((r) => mayChange(actor, r.scopeCompanyIds));
    if (mine.length === 0) throw forbidden('Only an administrator (or a Training manager of the same companies) can withdraw this assignment.');
    const withdrawn = await sync.withdrawAssignments(mine.map((r) => r.id), actor.id);
    await audit(actor, meta, 'training.assignment.withdraw-batch', bid, { oldValue: { assignments: mine.length, people: [...new Set(mine.map((r) => r.targetId))].length }, newValue: { enrolmentsWithdrawn: withdrawn } });
  }

  // ── Onboarding rules (R8) ───────────────────────────────────────────────────────────────────────

  async function ruleRows(actor: PersonRecord, rules: Prisma.TrainingRuleGetPayload<object>[]): Promise<RuleRow[]> {
    if (rules.length === 0) return [];
    const scope = scopeOf(actor);
    const assignments = await prisma.trainingAssignment.findMany({ where: { ruleId: { in: rules.map((r) => r.id) }, withdrawnAt: null }, select: { id: true, ruleId: true } });
    const assignees = assignments.length ? await prisma.trainingAssignee.findMany({ where: { assignmentId: { in: assignments.map((a) => a.id) }, withdrawnAt: null }, select: { assignmentId: true, userId: true } }) : [];
    const people = await ctx.people([...new Set(assignees.map((a) => a.userId))]);
    const courseIds = [...new Set(rules.flatMap((r) => stringList(r.courseIds)))];
    const titles = new Map((await prisma.trainingCourse.findMany({ where: { id: { in: courseIds } }, select: { id: true, title: true } })).map((c) => [c.id, c.title]));
    const labels = await targetLabels(rules, new Map(), actor);
    return rules.map((r) => {
      const ids = new Set(assignments.filter((a) => a.ruleId === r.id).map((a) => a.id));
      const who = new Set((ids.size ? assignees : []).filter((a) => ids.has(a.assignmentId) && (!scope || (people.get(a.userId) && inScope(scope, people.get(a.userId)!)))).map((a) => a.userId));
      const cids = stringList(r.courseIds);
      return {
        id: r.id,
        name: r.name,
        targetKind: r.targetKind as RuleRow['targetKind'],
        targetId: r.targetId,
        targetLabel: labels.get(`${r.targetKind}|${r.targetId}`) ?? r.targetId,
        courseIds: cids,
        courseTitles: cids.map((c) => titles.get(c) ?? 'A deleted course'),
        mandatory: r.mandatory,
        dueDays: r.dueDays,
        active: r.active,
        createdAt: r.createdAt.toISOString(),
        people: who.size,
      };
    });
  }

  async function listRules(actorId: string): Promise<{ rules: RuleRow[] }> {
    const actor = await managerOf(ctx, actorId);
    const rules = await prisma.trainingRule.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500 });
    return { rules: await ruleRows(actor, await visibleToManager(actor, rules)) };
  }

  async function ruleOf(actor: PersonRecord, ruleId: unknown) {
    const rid = idOf(ruleId, 'Rule');
    const r = await prisma.trainingRule.findUnique({ where: { id: rid } });
    if (!r) throw notFound('Rule');
    if (!mayChange(actor, r.scopeCompanyIds)) throw forbidden('Only an administrator (or a Training manager of the same companies) can change this rule.');
    return r;
  }

  const ruleAssignment = (r: { id: string; targetKind: string; targetId: string; mandatory: boolean; dueDays: number | null; scopeCompanyIds: unknown; createdById: string | null; createdAt: Date; active: boolean }, courseId: string) => ({
    courseId,
    targetKind: r.targetKind,
    targetId: r.targetId,
    mandatory: r.mandatory,
    dueDay: null,
    dueDays: r.dueDays,
    ruleId: r.id,
    newAccountsOnly: true,
    scopeCompanyIds: r.scopeCompanyIds === null || r.scopeCompanyIds === undefined ? Prisma.DbNull : stringList(r.scopeCompanyIds),
    createdById: r.createdById,
    // "New accounts" means accounts made after the rule was set up, for courses added later too.
    createdAt: r.createdAt,
    frozenAt: r.active ? null : ctx.clock(),
  });

  async function createRule(actorId: string, body: unknown, meta?: Meta): Promise<RuleRow> {
    const actor = await managerOf(ctx, actorId);
    const input = ruleInputSchema.parse(body ?? {});
    const courses = await publishedCourses(input.courseIds);
    await checkTarget(actor, input.targetKind, input.targetId);
    const { rule } = await makeRule(actor, input, courses);
    await audit(actor, meta, 'training.rule.create', rule.id, { newValue: input });
    return (await ruleRows(actor, [rule]))[0]!;
  }

  /** A rule and its assignments (one per course), synced. Checks are the caller's. */
  async function makeRule(
    actor: PersonRecord,
    input: { name: string; targetKind: string; targetId: string; mandatory: boolean; dueDays?: number | null; active?: boolean },
    courses: readonly { id: string }[],
  ) {
    const scope = scopeOf(actor);
    const rule = await prisma.trainingRule.create({
      data: {
        name: input.name,
        targetKind: input.targetKind,
        targetId: input.targetId,
        courseIds: courses.map((c) => c.id),
        mandatory: input.mandatory,
        dueDays: input.dueDays ?? null,
        active: input.active ?? true,
        scopeCompanyIds: scope === null ? Prisma.DbNull : scope,
        createdById: actor.id,
        createdAt: ctx.clock(),
      },
    });
    const ids: string[] = [];
    for (const c of courses) ids.push((await prisma.trainingAssignment.create({ data: ruleAssignment(rule, c.id) })).id);
    await sync.assignments(ids);
    return { rule, assignmentIds: ids };
  }

  async function updateRule(actorId: string, ruleId: unknown, body: unknown, meta?: Meta): Promise<RuleRow> {
    const actor = await managerOf(ctx, actorId);
    const r = await ruleOf(actor, ruleId);
    const input = rulePatchSchema.parse(body ?? {});
    const targetKind = input.targetKind ?? r.targetKind;
    const targetId = input.targetId ?? r.targetId;
    if (input.targetKind !== undefined || input.targetId !== undefined) await checkTarget(actor, targetKind, targetId);
    const courses = input.courseIds ? await publishedCourses(input.courseIds) : null;
    const now = ctx.clock();
    const next = await prisma.trainingRule.update({
      where: { id: r.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        targetKind,
        targetId,
        ...(courses ? { courseIds: courses.map((c) => c.id) } : {}),
        ...(input.mandatory !== undefined ? { mandatory: input.mandatory } : {}),
        ...(input.dueDays !== undefined ? { dueDays: input.dueDays } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    const live = await prisma.trainingAssignment.findMany({ where: { ruleId: r.id, withdrawnAt: null }, select: { id: true, courseId: true } });
    let keep = live;
    if (courses) {
      const wanted = new Set(courses.map((c) => c.id));
      const removed = live.filter((a) => !wanted.has(a.courseId));
      if (removed.length) await sync.withdrawAssignments(removed.map((a) => a.id), actor.id);
      keep = live.filter((a) => wanted.has(a.courseId));
      const have = new Set(keep.map((a) => a.courseId));
      for (const c of courses) if (!have.has(c.id)) keep.push(await prisma.trainingAssignment.create({ data: ruleAssignment(next, c.id), select: { id: true, courseId: true } }));
    }
    const ids = keep.map((a) => a.id);
    if (ids.length) {
      await prisma.trainingAssignment.updateMany({ where: { id: { in: ids } }, data: { targetKind, targetId, mandatory: next.mandatory, dueDays: next.dueDays } });
      if (input.mandatory !== undefined) await prisma.trainingAssignee.updateMany({ where: { assignmentId: { in: ids }, withdrawnAt: null }, data: { mandatory: next.mandatory } });
      if (input.active === false) await prisma.trainingAssignment.updateMany({ where: { id: { in: ids }, frozenAt: null }, data: { frozenAt: now } });
      if (input.active === true) await prisma.trainingAssignment.updateMany({ where: { id: { in: ids } }, data: { frozenAt: null } });
      await sync.assignments(ids);
    }
    await audit(actor, meta, 'training.rule.update', r.id, { oldValue: { name: r.name, active: r.active, courseIds: stringList(r.courseIds) }, newValue: input });
    return (await ruleRows(actor, [next]))[0]!;
  }

  async function deleteRule(actorId: string, ruleId: unknown, meta?: Meta): Promise<void> {
    const actor = await managerOf(ctx, actorId);
    const r = await ruleOf(actor, ruleId);
    const live = await prisma.trainingAssignment.findMany({ where: { ruleId: r.id, withdrawnAt: null }, select: { id: true } });
    if (live.length) await sync.withdrawAssignments(live.map((a) => a.id), actor.id);
    await prisma.trainingRule.delete({ where: { id: r.id } });
    await audit(actor, meta, 'training.rule.delete', r.id, { oldValue: { name: r.name, courseIds: stringList(r.courseIds) } });
  }

  // ── Feedback ────────────────────────────────────────────────────────────────────────────────────

  async function feedbackItems(rows: Prisma.TrainingFeedbackGetPayload<object>[], people: Map<string, PersonRecord>): Promise<FeedbackItem[]> {
    const courses = new Map((await prisma.trainingCourse.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } }, select: { id: true, title: true } })).map((c) => [c.id, c.title]));
    const lessonIds = [...new Set(rows.map((r) => r.lessonId).filter((x): x is string => !!x))];
    const lessons = new Map((lessonIds.length ? await prisma.trainingLesson.findMany({ where: { id: { in: lessonIds } }, select: { id: true, title: true } }) : []).map((l) => [l.id, l.title]));
    return rows.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      courseTitle: courses.get(r.courseId) ?? 'A deleted course',
      lessonId: r.lessonId,
      lessonTitle: r.lessonId ? (lessons.get(r.lessonId) ?? null) : null,
      kind: r.kind as FeedbackItem['kind'],
      rating: r.rating,
      body: r.body,
      status: r.status as FeedbackItem['status'],
      answer: r.answer,
      createdAt: r.createdAt.toISOString(),
      answeredAt: iso(r.answeredAt),
      byName: people.get(r.userId)?.name ?? null,
    }));
  }

  async function feedbackInScope(actor: PersonRecord, feedbackId: unknown) {
    const fid = idOf(feedbackId, 'Feedback');
    const f = await prisma.trainingFeedback.findUnique({ where: { id: fid } });
    if (!f) throw notFound('Feedback');
    const author = await ctx.person(f.userId);
    const scope = scopeOf(actor);
    if (scope && (!author || !inScope(scope, author))) throw notFound('Feedback');
    return { f, author };
  }

  /** R5: the people (any status) inside a Training manager's companies, by id. */
  async function scopedUserIds(scope: readonly string[]): Promise<string[]> {
    return [...(await ctx.people()).values()].filter((p) => inScope(scope, p)).map((p) => p.id);
  }

  async function listFeedback(actorId: string, rawQuery: unknown): Promise<{ items: FeedbackItem[] }> {
    const actor = await managerOf(ctx, actorId);
    const q = feedbackListQuery.parse(rawQuery ?? {});
    const where = { ...(q.kind ? { kind: q.kind } : {}), ...(q.status ? { status: q.status } : {}) };
    const order = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    const scope = scopeOf(actor);
    // M15: a Training manager's people are asked for in the query (never the newest N, then filtered).
    const rows = scope
      ? (await Promise.all(chunks(await scopedUserIds(scope)).map((part) => prisma.trainingFeedback.findMany({ where: { ...where, userId: { in: part } }, orderBy: order, take: 500 }))))
          .flat()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, 500)
      : await prisma.trainingFeedback.findMany({ where, orderBy: order, take: 500 });
    const people = await ctx.people([...new Set(rows.map((r) => r.userId))]);
    return { items: await feedbackItems(rows, people) };
  }

  async function answerFeedback(actorId: string, feedbackId: unknown, body: unknown, meta?: Meta): Promise<FeedbackItem> {
    const actor = await managerOf(ctx, actorId);
    const { f, author } = await feedbackInScope(actor, feedbackId);
    if (f.kind !== 'QUESTION') throw conflict('Only a question can be answered.', 'NOT_A_QUESTION');
    const { answer } = answerSchema.parse(body ?? {});
    if (!fitsText(answer)) throw new ValidationError('That answer is too long.', { field: 'answer' });
    const now = ctx.clock();
    const saved = await prisma.trainingFeedback.update({ where: { id: f.id }, data: { answer, status: 'ANSWERED', answeredById: actor.id, answeredAt: now } });
    if (author && author.active && !author.client) {
      const course = await prisma.trainingCourse.findUnique({ where: { id: f.courseId }, select: { title: true } });
      try {
        await ctx.notify({
          userId: author.id,
          type: 'TRAINING_QUESTION',
          title: `Your question was answered: ${course?.title ?? 'a course'}`,
          body: answer.length > 140 ? `${answer.slice(0, 139)}…` : answer,
          entityType: 'training-course',
          entityId: f.courseId,
          projectId: null,
        });
      } catch (err) {
        ctx.logger?.warn('training: an answer notice could not be sent', { err: String((err as Error)?.message ?? err) });
      }
    }
    await audit(actor, meta, 'training.feedback.answer', f.id, { newValue: { answer } });
    return (await feedbackItems([saved], new Map(author ? [[author.id, author]] : [])))[0]!;
  }

  async function markFixed(actorId: string, feedbackId: unknown, meta?: Meta): Promise<FeedbackItem> {
    const actor = await managerOf(ctx, actorId);
    const { f, author } = await feedbackInScope(actor, feedbackId);
    if (f.kind !== 'OUTDATED') throw conflict('Only an “outdated” report can be marked fixed.', 'NOT_OUTDATED');
    const saved = await prisma.trainingFeedback.update({ where: { id: f.id }, data: { status: 'FIXED', answeredById: actor.id, answeredAt: ctx.clock() } });
    await audit(actor, meta, 'training.feedback.fixed', f.id);
    return (await feedbackItems([saved], new Map(author ? [[author.id, author]] : [])))[0]!;
  }

  // ── Certificates ────────────────────────────────────────────────────────────────────────────────

  const certRef = (c: { id: string; code: string; courseId: string; courseTitle: string; issuedAt: Date; expiresAt: Date | null; revokedAt: Date | null; learnerName?: string; completedAt?: Date | null }): CertificateRef => ({
    id: c.id,
    code: c.code,
    courseId: c.courseId,
    courseTitle: c.courseTitle,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: iso(c.expiresAt),
    status: certificateStatus(c, ctx.clock()),
    completedAt: (c.completedAt ?? c.issuedAt).toISOString(),
    learnerName: c.learnerName ?? '',
    verifyUrl: verifyLink(ctx.appUrl, c.code),
  });

  async function listCertificates(actorId: string, rawQuery: unknown) {
    const actor = await managerOf(ctx, actorId);
    const q = certificateListQuery.parse(rawQuery ?? {});
    const text = q.q?.trim();
    const where = { ...(q.courseId ? { courseId: q.courseId } : {}), ...(text ? { OR: [{ learnerName: { contains: text } }, { code: { contains: text.toUpperCase() } }, { courseTitle: { contains: text } }] } : {}) };
    const order = [{ issuedAt: 'desc' as const }, { id: 'desc' as const }];
    const scope = scopeOf(actor);
    // M15: filtered by the Training manager's people in the query.
    const rows = scope
      ? (await Promise.all(chunks(await scopedUserIds(scope)).map((part) => prisma.trainingCertificate.findMany({ where: { ...where, userId: { in: part } }, orderBy: order, take: 500 }))))
          .flat()
          .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(0, 500)
      : await prisma.trainingCertificate.findMany({ where, orderBy: order, take: 500 });
    return { certificates: rows.map((c) => ({ ...certRef(c), userId: c.userId, learnerName: c.learnerName })) };
  }

  async function revokeCertificate(actorId: string, certificateId: unknown, body: unknown, meta?: Meta): Promise<CertificateRef> {
    const actor = await managerOf(ctx, actorId);
    const cid = idOf(certificateId, 'Certificate');
    const { reason } = revokeSchema.parse(body ?? {});
    const c = await prisma.trainingCertificate.findUnique({ where: { id: cid } });
    if (!c) throw notFound('Certificate');
    const scope = scopeOf(actor);
    if (scope) {
      const learner = await ctx.person(c.userId);
      if (!learner || !inScope(scope, learner)) throw notFound('Certificate');
    }
    if (c.revokedAt) throw conflict('This certificate is revoked already.', 'ALREADY_REVOKED');
    const saved = await prisma.trainingCertificate.update({ where: { id: c.id }, data: { revokedAt: ctx.clock(), revokedReason: reason, revokedById: actor.id } });
    await audit(actor, meta, 'training.certificate.revoke', c.id, { oldValue: { code: c.code }, newValue: { reason } });
    return certRef(saved);
  }

  // ── Settings (administrators; the route checks the role) ───────────────────────────────────────

  const TOUR_KEY = 'training.tour';

  async function settings(): Promise<TrainingSettings> {
    const saved = await readSetting<{ off?: unknown }>(prisma, TOUR_KEY);
    const companies = await prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return { tourOff: stringList(saved?.off), companies };
  }

  async function saveSettings(actorId: string, body: unknown, meta?: Meta): Promise<TrainingSettings> {
    const input = settingsSchema.parse(body ?? {});
    const unique = [...new Set(input.tourOff)];
    if (unique.length && (await prisma.company.count({ where: { id: { in: unique } } })) !== unique.length) throw new ValidationError('One of those companies doesn’t exist.', { field: 'tourOff' });
    const before = await settings();
    await writeSetting(prisma, TOUR_KEY, { off: unique });
    const actor = await ctx.person(actorId);
    if (actor) await audit(actor, meta, 'training.settings.update', TOUR_KEY, { oldValue: { tourOff: before.tourOff }, newValue: { tourOff: unique } });
    return settings();
  }

  return {
    /** For routes that must refuse a non-manager before reading an upload. */
    assertManager: async (actorId: string) => {
      await managerOf(ctx, actorId);
    },
    listCourses,
    getCourse,
    createCourse,
    updateCourse,
    deleteCourse,
    publish,
    unpublish: (actorId: string, courseId: unknown, meta?: Meta) => setStatus(actorId, courseId, 'DRAFT', meta),
    archive: (actorId: string, courseId: unknown, meta?: Meta) => setStatus(actorId, courseId, 'ARCHIVED', meta),
    duplicate: copies.duplicate,
    addModule: modules.addModule,
    updateModule: modules.updateModule,
    removeModule: modules.removeModule,
    reorderModules: modules.reorderModules,
    addLesson,
    updateLesson,
    deleteLesson,
    lessonDeleteImpact,
    reorderLessons,
    saveSteps,
    saveQuiz,
    uploadFile,
    uploadSignature,
    deleteFile,
    options,
    listAssignments,
    previewAssignment,
    assign,
    withdrawAssignment,
    withdrawBatch,
    listRules,
    createRule,
    updateRule,
    deleteRule,
    listFeedback,
    answerFeedback,
    markFixed,
    listCertificates,
    revokeCertificate,
    settings: async (_actorId: string) => settings(),
    saveSettings,
  };
}

export type TrainingManage = ReturnType<typeof createTrainingManage>;

/** 'YYYY-MM-DD' moved by whole days. */
function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

