import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError, ValidationError } from '../../lib/http-errors';
import { CLIENT_WORDS } from '../clients/client-kind';
import { canLearn, inScope, isManager } from './training-access';
import { buildCertificatePdf, certificateFileName } from './training-certificate-pdf';
import { certificateStatus, normaliseCode, verifyLink } from './training-certificates';
import { COURSE, createTrainingFinish, type CourseRow } from './training-finish';
import { conflict, courseFacts, idOf, notFound, scopeOf, trainingManagersFor, type TrainingContext } from './training-context';
import { loadPeople, readSetting, type PersonRecord } from './prisma-training-store';
import { cleanAnswers, deadlineOf, drawPaper, GRACE_MS, markPaper, paperForBrowser, resultQuestions, timeIsUp, type Paper, type StoredQuestion } from './training-quiz';
import { hiddenLesson, loadState, loadStates, pairKey, type PairState } from './training-read';
import { lessonOutline } from './training-state';
import type { TrainingSync } from './training-sync';
import {
  DIFFICULTIES,
  FEEDBACK_KINDS,
  LIMITS,
  TRAINING_MODULES,
  type AttemptPaper,
  type AttemptResult,
  type Audience,
  type CertificateRef,
  type CompletionRule,
  type CourseCard,
  type CourseDetail,
  type Difficulty,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
  type FileKind,
  type FileRef,
  type LessonDone,
  type LessonKind,
  type LessonView,
  type MyCourseState,
  type MyTraining,
  type PortalTraining,
  type QuestionKind,
  type QuizInfo,
  type TrainingAccess,
  type TrainingModule,
  type VerifyResult,
} from './training-types';
import { videoInfo } from './training-video';

/**
 * Taking training (owner request; rulings R1–R3, R6, R9–R12, R15): My training, the catalogue, a course, its
 * lessons, progress, quizzes, certificates and feedback — for staff (/training/*) and for client accounts in
 * the Client portal (/portal/training/*). Every method is told the mode: staff mode refuses a client account,
 * client mode a staff account; client mode sees only published courses for clients (anything else is
 * "not found", never revealed). Training managers and administrators may also preview any course in staff
 * mode (drafts included) but take only what they can learn. Quiz answers (what is right, feedback,
 * explanations, the right order) never leave the server before an attempt is handed in.
 */
export type LearnerMode = 'staff' | 'client';

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────

/** R15: show the first-time tour on its own? */
export function tourShows(i: { launchedAt: Date | null; createdAt: Date; tourDoneAt: Date | null; client: boolean; primaryCompanyId: string | null; companyIds: readonly string[]; off: readonly string[]; auto?: boolean }): boolean {
  // R20: TRAINING_TOUR_AUTO=off — never on its own (it can still be replayed).
  if (i.auto === false) return false;
  if (!i.launchedAt || i.tourDoneAt || i.createdAt.getTime() <= i.launchedAt.getTime()) return false;
  if (i.client) return !(i.companyIds.length > 0 && i.companyIds.every((c) => i.off.includes(c)));
  const company = i.primaryCompanyId ?? i.companyIds[0] ?? null;
  return !(company && i.off.includes(company));
}

/** Assigned courses: mandatory first, then by due day (none last), then by title. */
export function orderAssigned<T extends { title: string; mine: { mandatory: boolean; dueDay: string | null } }>(cards: readonly T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      Number(b.mine.mandatory) - Number(a.mine.mandatory) ||
      (a.mine.dueDay ?? '9999-99-99').localeCompare(b.mine.dueDay ?? '9999-99-99') ||
      a.title.localeCompare(b.title),
  );
}

/** R9: "Mark as watched" may be used after half the lesson's minutes on it, at least 30 seconds. */
export const watchFallbackSeconds = (minutes: number) => Math.max(30, Math.round(minutes * 60 * 0.5));

const int = (min: number, max: number) => z.number().int().min(min).max(max);
export const progressBody = z.object({
  videoSeconds: int(0, 86_400).optional(),
  videoDuration: int(1, 86_400).optional(),
  watchedPct: int(0, 100).optional(),
  stepIndex: int(0, LIMITS.stepsPerLesson).optional(),
});

const feedbackBody = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  rating: int(1, 5).optional(),
  body: z.string().trim().max(LIMITS.feedbackBody, `Use at most ${LIMITS.feedbackBody.toLocaleString('en-US')} characters.`).nullable().optional(),
  lessonId: z.string().max(64).nullable().optional(),
});
const tourBody = z.object({ done: z.boolean() });
const catalogueQuery = z.object({
  module: z.enum(TRAINING_MODULES).or(z.literal('')).optional(),
  difficulty: z.enum(DIFFICULTIES).or(z.literal('')).optional(),
  q: z.string().max(LIMITS.search, `Search with at most ${LIMITS.search} characters.`).optional(),
});
const learnQuery = z.object({ module: z.enum(TRAINING_MODULES) });

// ── The service ───────────────────────────────────────────────────────────────────────────────────

type AttemptRow = Prisma.TrainingAttemptGetPayload<object>;
type FileRow = { id: string; name: string; mimeType: string; sizeBytes: number; kind: string };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const fileRef = (f: FileRow): FileRef => ({ id: f.id, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind as FileKind });
const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const AUDIENCE: Record<LearnerMode, Audience> = { staff: 'STAFF', client: 'CLIENTS' };
const LAUNCHED_KEY = 'training.launchedAt';
const TOUR_KEY = 'training.tour';
const DUMMY_CODE = 'TC-2222-2222-2222';

export function createTrainingLearner(ctx: TrainingContext, sync: TrainingSync) {
  const { prisma } = ctx;
  const finish = createTrainingFinish(ctx);

  // ── Who is asking ──

  async function who(userId: string, mode: LearnerMode): Promise<PersonRecord> {
    const p = await ctx.person(userId);
    if (mode === 'client') {
      if (!p || !p.active || !p.client) throw new HttpError('The Client portal is for client accounts.', 'CLIENTS_ONLY', 403);
    } else if (!p || !p.active || p.client) {
      throw new HttpError(CLIENT_WORDS.notAllowed, 'CLIENT_NOT_ALLOWED', 403);
    }
    return p;
  }

  /** May this person take the course in this mode? */
  const learnable = (c: CourseRow, p: PersonRecord, mode: LearnerMode) => c.audience === AUDIENCE[mode] && canLearn(courseFacts(c), p);

  /** 'learn' (take it), 'preview' (a manager reads it, staff mode only) or null (not found). */
  function access(c: CourseRow, p: PersonRecord, mode: LearnerMode): 'learn' | 'preview' | null {
    if (learnable(c, p, mode)) return 'learn';
    if (mode === 'staff' && isManager(p)) return 'preview';
    return null;
  }

  function needLearn(c: CourseRow, a: 'learn' | 'preview' | null): void {
    if (a === 'learn') return;
    if (a === 'preview') {
      if (c.status !== 'PUBLISHED') throw conflict('This course isn’t published.', 'COURSE_NOT_PUBLISHED');
      throw conflict('You can preview this course, but it isn’t one of yours to take.', 'NOT_FOR_YOU');
    }
    throw notFound();
  }

  async function courseFor(p: PersonRecord, rawId: unknown, mode: LearnerMode, need: 'read' | 'learn'): Promise<{ course: CourseRow; access: 'learn' | 'preview' }> {
    const course = await prisma.trainingCourse.findUnique({ where: { id: idOf(rawId) }, select: COURSE });
    const a = course ? access(course, p, mode) : null;
    if (!course || !a) throw notFound();
    if (need === 'learn') needLearn(course, a);
    return { course, access: a };
  }

  // ── Enrolments ──

  /** Started (or opened): the enrolment exists, is shown again, remembers the lesson. */
  async function ensureStarted(userId: string, courseId: string, assigned: boolean, lessonId: string | null = null): Promise<void> {
    const now = ctx.clock();
    const select = { id: true, startedAt: true, withdrawnAt: true, selfStarted: true } as const;
    let e = await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId, courseId } }, select });
    if (!e) {
      try {
        await prisma.trainingEnrolment.create({ data: { userId, courseId, selfStarted: !assigned, startedAt: now, lastActivityAt: now, lastLessonId: lessonId } });
        return;
      } catch (err) {
        if (!isUnique(err)) throw err;
        e = await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId, courseId } }, select });
        if (!e) return;
      }
    }
    // 1.23.27: one UPDATE statement (updateMany), not update() — Prisma's update() reads the row first in its own
    // transaction, and MariaDB (the live server, innodb_snapshot_isolation ON) then refuses the write when a second
    // click's request changed it in between (error 1020: a 500 for the double click).
    await prisma.trainingEnrolment.updateMany({
      where: { id: e.id },
      data: {
        startedAt: e.startedAt ?? now,
        lastActivityAt: now,
        ...(lessonId ? { lastLessonId: lessonId } : {}),
        ...(e.withdrawnAt ? { withdrawnAt: null, selfStarted: e.selfStarted || !assigned } : {}),
      },
    });
  }

  /** A lesson's progress row, written once even when two requests arrive together. */
  async function writeProgress(userId: string, courseId: string, lessonId: string, data: { doneAt?: Date; stepIndex?: number; videoSeconds?: number; videoDuration?: number; watchedPct?: number }): Promise<void> {
    const where = { userId_lessonId: { userId, lessonId } };
    try {
      await prisma.trainingProgress.upsert({ where, create: { userId, courseId, lessonId, ...data }, update: data });
    } catch (err) {
      if (!isUnique(err)) throw err;
      await prisma.trainingProgress.update({ where, data });
    }
  }

  // ── Cards ──

  async function certificateRefs(rows: { id: string; code: string; courseId: string; courseTitle: string; issuedAt: Date; expiresAt: Date | null; revokedAt: Date | null; learnerName?: string; completedAt?: Date | null }[]): Promise<CertificateRef[]> {
    const now = ctx.clock();
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      courseId: c.courseId,
      courseTitle: c.courseTitle,
      issuedAt: c.issuedAt.toISOString(),
      expiresAt: iso(c.expiresAt),
      status: certificateStatus(c, now),
      completedAt: (c.completedAt ?? c.issuedAt).toISOString(),
      learnerName: c.learnerName ?? '',
      verifyUrl: verifyLink(ctx.appUrl, c.code),
    }));
  }

  function mineOf(s: PairState, certificate: CertificateRef | null, inOrder: boolean): MyCourseState {
    const e = s.enrolment;
    const outline = lessonOutline({ lessons: s.lessons, inOrder, enrolment: e, done: s.done });
    return {
      enrolled: !!e && !e.withdrawnAt,
      status: s.state.status,
      progressPct: s.state.progressPct,
      assigned: s.state.assigned,
      mandatory: s.state.mandatory,
      dueDay: s.state.dueDay,
      overdue: s.state.overdue,
      lastLessonId: e?.lastLessonId ?? null,
      nextLessonId: outline.resumeLessonId,
      startedAt: iso(e?.startedAt),
      completedAt: s.state.status === 'COMPLETED' || s.state.status === 'REVIEW' ? iso(e?.completedAt) : null,
      certificate,
      lessonsDone: s.doneIds.size,
      modules: null,
      newForRole: 0,
      next: null,
    };
  }

  async function cardsFor(p: PersonRecord, courses: readonly CourseRow[], given?: Map<string, PairState>): Promise<Map<string, CourseCard>> {
    const out = new Map<string, CourseCard>();
    if (courses.length === 0) return out;
    const ids = courses.map((c) => c.id);
    const states = given ?? (await loadStates(ctx, ids.map((courseId) => ({ userId: p.id, courseId }))));
    const [ratings, certs] = await Promise.all([
      prisma.trainingFeedback.groupBy({ by: ['courseId'], where: { courseId: { in: ids }, kind: 'RATING', rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } }),
      prisma.trainingCertificate.findMany({ where: { userId: p.id, courseId: { in: ids } }, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }] }),
    ]);
    const refs = await certificateRefs(certs);
    for (const c of courses) {
      const s = states.get(pairKey(p.id, c.id))!;
      const rating = ratings.find((r) => r.courseId === c.id);
      const mineCerts = refs.filter((r) => r.courseId === c.id);
      const certificate = mineCerts.find((r) => r.status !== 'REVOKED') ?? mineCerts[0] ?? null;
      out.set(c.id, {
        id: c.id,
        title: c.title,
        summary: c.summary,
        moduleKey: c.moduleKey as TrainingModule,
        audience: c.audience as Audience,
        difficulty: c.difficulty as Difficulty,
        minutes: s.lessons.reduce((n, l) => n + l.minutes, 0),
        lessonCount: s.lessons.length,
        certificateOn: c.certificateOn,
        starter: c.starterKey !== null,
        rating: { average: rating?._avg.rating != null ? Math.round(rating._avg.rating * 10) / 10 : null, count: rating?._count.rating ?? 0 },
        mine: mineOf(s, certificate, c.inOrder),
      });
    }
    return out;
  }

  /** The person's courses for My training: unfinished ones they can take, finished ones always. */
  async function myCourses(p: PersonRecord, mode: LearnerMode): Promise<{ course: CourseRow; state: PairState }[]> {
    const enrolments = await prisma.trainingEnrolment.findMany({ where: { userId: p.id, withdrawnAt: null }, select: { courseId: true } });
    if (enrolments.length === 0) return [];
    const courses = await prisma.trainingCourse.findMany({
      where: { id: { in: enrolments.map((e) => e.courseId) }, audience: AUDIENCE[mode], status: { in: ['PUBLISHED', 'ARCHIVED'] } },
      select: COURSE,
      orderBy: [{ position: 'asc' }, { title: 'asc' }],
    });
    const states = await loadStates(ctx, courses.map((c) => ({ userId: p.id, courseId: c.id })));
    const out: { course: CourseRow; state: PairState }[] = [];
    for (const course of courses) {
      const state = states.get(pairKey(p.id, course.id))!;
      if (state.state.status === 'COMPLETED' || (course.status === 'PUBLISHED' && learnable(course, p, mode))) out.push({ course, state });
    }
    return out;
  }

  async function myTrainingOf(p: PersonRecord, mode: LearnerMode): Promise<MyTraining> {
    const list = await myCourses(p, mode);
    const cards = await cardsFor(p, list.map((x) => x.course), new Map(list.map((x) => [pairKey(p.id, x.course.id), x.state])));
    const assigned: CourseCard[] = [];
    const inProgress: CourseCard[] = [];
    const completed: { card: CourseCard; at: number }[] = [];
    for (const { course, state } of list) {
      const card = cards.get(course.id)!;
      if (state.state.status === 'COMPLETED') completed.push({ card, at: state.enrolment?.completedAt?.getTime() ?? 0 });
      else if (state.state.assigned) assigned.push(card);
      else inProgress.push(card);
    }
    const all = [...cards.values()];
    const certRows = await prisma.trainingCertificate.findMany({ where: { userId: p.id }, orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }] });
    const audiences = new Map(
      (await prisma.trainingCourse.findMany({ where: { id: { in: [...new Set(certRows.map((c) => c.courseId))] } }, select: { id: true, audience: true } })).map((c) => [c.id, c.audience]),
    );
    const ordered = orderAssigned(assigned);
    return {
      counts: {
        assigned: ordered.length,
        inProgress: all.filter((c) => c.mine.status === 'IN_PROGRESS').length,
        notStarted: ordered.filter((c) => c.mine.status === 'NOT_STARTED').length,
        completed: completed.length,
        overdue: all.filter((c) => c.mine.overdue).length,
        review: all.filter((c) => c.mine.status === 'REVIEW').length,
      },
      assigned: ordered,
      inProgress,
      completed: completed.sort((a, b) => b.at - a.at).map((x) => x.card),
      certificates: await certificateRefs(certRows.filter((c) => audiences.get(c.courseId) === AUDIENCE[mode])),
    };
  }

  async function catalogueOf(p: PersonRecord, mode: LearnerMode, filters: { module?: string; difficulty?: string; q?: string }): Promise<CourseCard[]> {
    const q = filters.q?.trim();
    const courses = await prisma.trainingCourse.findMany({
      where: {
        status: 'PUBLISHED',
        audience: AUDIENCE[mode],
        ...(filters.module ? { moduleKey: filters.module } : {}),
        ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
        ...(q ? { OR: [{ title: { contains: q } }, { summary: { contains: q } }] } : {}),
      },
      select: COURSE,
      orderBy: [{ position: 'asc' }, { title: 'asc' }, { id: 'asc' }],
    });
    const mine = courses.filter((c) => learnable(c, p, mode));
    const cards = await cardsFor(p, mine);
    return mine.map((c) => cards.get(c.id)!);
  }

  async function tourOf(p: PersonRecord): Promise<{ show: boolean }> {
    const [launched, tour] = await Promise.all([readSetting<unknown>(prisma, LAUNCHED_KEY), readSetting<{ off?: unknown }>(prisma, TOUR_KEY)]);
    const at = typeof launched === 'string' ? new Date(launched) : null;
    const off = Array.isArray(tour?.off) ? tour!.off.filter((x): x is string => typeof x === 'string') : [];
    return { show: tourShows({ launchedAt: at && !Number.isNaN(at.getTime()) ? at : null, createdAt: p.createdAt, tourDoneAt: p.tourDoneAt, client: p.client, primaryCompanyId: p.primaryCompanyId, companyIds: p.companyIds, off, auto: ctx.tourAuto !== false }) };
  }

  async function syncPerson(p: PersonRecord): Promise<void> {
    try {
      await sync.person(p);
    } catch (err) {
      ctx.logger?.warn('training: the sync for one person failed', { userId: p.id, err: String((err as Error)?.message ?? err) });
    }
  }

  // ── Course detail ──

  /** M16: answered questions asked by people sharing a company with the viewer (administrators: all), and their own. */
  async function colleaguesOnly<T extends { userId: string }>(p: PersonRecord, rows: T[]): Promise<T[]> {
    if (p.admin) return rows.slice(0, 200);
    const askers = [...new Set(rows.map((r) => r.userId).filter((id) => id !== p.id))];
    const colleagues =
      askers.length && p.companyIds.length
        ? new Set((await prisma.companyMember.findMany({ where: { userId: { in: askers }, companyId: { in: [...p.companyIds] }, company: { status: 'ACTIVE' } }, select: { userId: true } })).map((m) => m.userId))
        : new Set<string>();
    return rows.filter((r) => r.userId === p.id || colleagues.has(r.userId)).slice(0, 200);
  }

  async function detailOf(p: PersonRecord, course: CourseRow, a: 'learn' | 'preview', mode: LearnerMode): Promise<CourseDetail> {
    const state = await loadState(ctx, p.id, course.id);
    const card = (await cardsFor(p, [course], new Map([[pairKey(p.id, course.id), state]]))).get(course.id)!;
    const enrolled = !!state.enrolment && !state.enrolment.withdrawnAt;
    const outline = lessonOutline({ lessons: state.lessons, inOrder: course.inOrder && (a === 'learn' || enrolled), enrolment: state.enrolment, done: state.done });
    const [resources, questions, rating] = await Promise.all([
      prisma.trainingFile.findMany({ where: { courseId: course.id, kind: 'RESOURCE' }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
      prisma.trainingFeedback
        .findMany({
          where: { courseId: course.id, kind: 'QUESTION', ...(course.audience === 'STAFF' && mode === 'staff' ? { OR: [{ status: 'ANSWERED' }, { userId: p.id }] } : { userId: p.id }) },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 500,
        })
        .then((rows) => colleaguesOnly(p, rows)),
      prisma.trainingFeedback.findFirst({ where: { courseId: course.id, userId: p.id, kind: 'RATING' }, select: { rating: true } }),
    ]);
    return {
      ...card,
      completionRule: course.completionRule as CompletionRule,
      inOrder: course.inOrder,
      version: course.version,
      certificateMonths: course.certificateMonths,
      modules: [],
      lessons: state.lessons.map((l, i) => {
        const o = outline.items[i]!;
        return { id: l.id, position: l.position, kind: l.kind, title: l.title, minutes: l.minutes, done: o.done, locked: o.locked, review: o.review, moduleId: null };
      }),
      resources: resources.map(fileRef),
      questions: questions.map((f) => ({ id: f.id, question: f.body ?? '', answer: f.status === 'ANSWERED' ? f.answer : null, askedAt: f.createdAt.toISOString(), answeredAt: f.status === 'ANSWERED' ? iso(f.answeredAt) : null, mine: f.userId === p.id })),
      myRating: rating?.rating ?? null,
      resumeLessonId: outline.resumeLessonId,
    };
  }

  // ── Lessons ──

  async function lessonFor(p: PersonRecord, rawId: unknown, mode: LearnerMode, need: 'read' | 'learn') {
    const lesson = await prisma.trainingLesson.findUnique({ where: { id: idOf(rawId, 'Lesson') } });
    const course = lesson ? await prisma.trainingCourse.findUnique({ where: { id: lesson.courseId }, select: COURSE }) : null;
    const a = course ? access(course, p, mode) : null;
    if (!lesson || !course || !a) throw notFound('Lesson');
    if (need === 'learn') needLearn(course, a);
    return { lesson, course, access: a };
  }

  /** In order and an earlier lesson isn't done (a manager browsing a course they don't take sees everything). */
  function assertOpen(state: PairState, course: CourseRow, lessonId: string, a: 'learn' | 'preview'): void {
    const enrolled = !!state.enrolment && !state.enrolment.withdrawnAt;
    if (!course.inOrder || (a === 'preview' && !enrolled)) return;
    const outline = lessonOutline({ lessons: state.lessons, inOrder: true, enrolment: state.enrolment, done: state.done });
    if (outline.items.find((i) => i.id === lessonId)?.locked) throw conflict('Finish the lessons before this one first.', 'LESSON_LOCKED');
  }

  /** After a lesson was done: R9 completion (once, even with two clicks), R11 review done, the certificate. */
  async function afterLessonDone(p: PersonRecord, course: CourseRow, lessonId: string): Promise<LessonDone> {
    const state = await loadState(ctx, p.id, course.id);
    const { courseCompleted, certificateId } = await finish.settle(p.id, course, state, { person: p, touch: true });
    const i = state.lessons.findIndex((l) => l.id === lessonId);
    return {
      courseProgressPct: courseCompleted ? 100 : state.state.progressPct,
      courseCompleted,
      certificateId,
      nextLessonId: i >= 0 ? (state.lessons[i + 1]?.id ?? null) : null,
      moduleDone: null,
    };
  }

  // ── Quizzes ──

  async function quizQuestions(lessonId: string) {
    const quiz = await prisma.trainingQuiz.findUnique({ where: { lessonId }, include: { questions: { include: { options: true } } } });
    if (!quiz) return null;
    const questions: StoredQuestion[] = quiz.questions.map((q) => ({
      id: q.id,
      kind: q.kind as QuestionKind,
      prompt: q.prompt,
      explanation: q.explanation,
      position: q.position,
      options: q.options.map((o) => ({ id: o.id, text: o.text, correct: o.correct, feedback: o.feedback, position: o.position })),
    }));
    return { quiz, questions };
  }

  const paperOf = (a: AttemptRow): Paper => a.paper as unknown as Paper;
  const savedOf = (a: AttemptRow): Record<string, string[]> => (a.answers && typeof a.answers === 'object' && !Array.isArray(a.answers) ? (a.answers as Record<string, string[]>) : {});

  function attemptPaper(a: AttemptRow): AttemptPaper {
    return { id: a.id, lessonId: a.lessonId, courseId: a.courseId, startedAt: a.startedAt.toISOString(), deadlineAt: iso(a.deadlineAt), questions: paperForBrowser(paperOf(a)), answers: savedOf(a) };
  }

  async function resultOf(p: PersonRecord, a: AttemptRow, extra?: { courseCompleted: boolean; certificateId: string | null }): Promise<AttemptResult> {
    const paper = paperOf(a);
    const answers = savedOf(a);
    const [quiz, state] = await Promise.all([prisma.trainingQuiz.findUnique({ where: { lessonId: a.lessonId }, select: { maxAttempts: true } }), loadState(ctx, p.id, a.courseId)]);
    const used = state.attemptsUsed.get(a.lessonId) ?? 0;
    const max = quiz?.maxAttempts ?? null;
    let certificateId = extra?.certificateId ?? null;
    const completed = extra?.courseCompleted ?? state.state.status === 'COMPLETED';
    if (!extra && completed) certificateId = (await prisma.trainingCertificate.findFirst({ where: { userId: p.id, courseId: a.courseId, revokedAt: null }, orderBy: [{ issuedAt: 'desc' }], select: { id: true } }))?.id ?? null;
    const attemptsLeft = max === null ? null : Math.max(0, max - used);
    // M9: the right answers once the quiz is passed (this cycle) or no attempts are left (unlimited: once passed).
    const answersShown = !!a.passed || !!state.best.get(a.lessonId)?.passed || attemptsLeft === 0;
    return {
      id: a.id,
      lessonId: a.lessonId,
      courseId: a.courseId,
      submittedAt: a.submittedAt!.toISOString(),
      scorePct: a.scorePct ?? 0,
      passed: !!a.passed,
      passMark: paper.passMark,
      attemptsLeft,
      timedOut: !!a.deadlineAt && a.submittedAt!.getTime() > a.deadlineAt.getTime() + GRACE_MS,
      answersShown,
      questions: resultQuestions(paper, answers, { reveal: answersShown }),
      courseCompleted: completed,
      certificateId,
    };
  }

  /** Hands an attempt in with these answers (once: a second hand-in returns the first one's result). */
  async function handIn(p: PersonRecord, a: AttemptRow, answers: Record<string, string[]>): Promise<AttemptResult> {
    const now = ctx.clock();
    const mark = markPaper(paperOf(a), answers);
    const won = await prisma.trainingAttempt.updateMany({
      where: { id: a.id, submittedAt: null },
      data: { answers: answers as Prisma.InputJsonValue, submittedAt: now, scorePct: mark.scorePct, passed: mark.passed },
    });
    const saved = (await prisma.trainingAttempt.findUnique({ where: { id: a.id } }))!;
    if (won.count === 1 && mark.passed) {
      await writeProgress(p.id, a.courseId, a.lessonId, { doneAt: now });
      const course = await prisma.trainingCourse.findUnique({ where: { id: a.courseId }, select: COURSE });
      if (course) {
        const done = await afterLessonDone(p, course, a.lessonId);
        return resultOf(p, saved, { courseCompleted: done.courseCompleted, certificateId: done.certificateId });
      }
    }
    return resultOf(p, saved);
  }

  /** Open attempts whose time is up are handed in with what was saved. */
  async function handInTimedOut(p: PersonRecord, lessonId?: string): Promise<void> {
    const open = await prisma.trainingAttempt.findMany({ where: { userId: p.id, submittedAt: null, deadlineAt: { not: null }, ...(lessonId ? { lessonId } : {}) } });
    for (const a of open) if (timeIsUp(a.deadlineAt, ctx.clock())) await handIn(p, a, savedOf(a));
  }

  async function quizInfo(p: PersonRecord, lessonId: string, state: PairState): Promise<QuizInfo | null> {
    const q = await prisma.trainingQuiz.findUnique({ where: { lessonId }, select: { passMark: true, maxAttempts: true, timeLimitMinutes: true, drawCount: true, _count: { select: { questions: true } } } });
    if (!q) return null;
    const [open, last] = await Promise.all([
      prisma.trainingAttempt.findFirst({ where: { userId: p.id, lessonId, submittedAt: null }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], select: { id: true } }),
      prisma.trainingAttempt.findFirst({ where: { userId: p.id, lessonId, submittedAt: { not: null } }, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], select: { id: true } }),
    ]);
    const used = state.attemptsUsed.get(lessonId) ?? 0;
    const left = q.maxAttempts === null || used < q.maxAttempts;
    const n = q._count.questions;
    return {
      passMark: q.passMark,
      maxAttempts: q.maxAttempts,
      attemptsUsed: used,
      timeLimitMinutes: q.timeLimitMinutes,
      questionCount: q.drawCount ? Math.min(q.drawCount, n) : n,
      best: state.best.get(lessonId) ?? null,
      openAttemptId: open?.id ?? null,
      lastAttemptId: last?.id ?? null,
      canStart: !open && left && n > 0,
      reason: open ? null : !left ? 'No attempts left.' : n === 0 ? 'This quiz has no questions yet.' : null,
    };
  }

  /** One open attempt per person per quiz: starts are serialised here (and checked again after writing). */
  const starting = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const before = starting.get(key) ?? Promise.resolve();
    const run = before.then(fn, fn);
    starting.set(key, run);
    return run.finally(() => {
      if (starting.get(key) === run) starting.delete(key);
    });
  }

  async function attemptFor(p: PersonRecord, rawId: unknown, mode: LearnerMode): Promise<AttemptRow> {
    const a = await prisma.trainingAttempt.findUnique({ where: { id: idOf(rawId, 'Quiz attempt') } });
    if (!a || a.userId !== p.id) throw notFound('Quiz attempt');
    const course = await prisma.trainingCourse.findUnique({ where: { id: a.courseId }, select: { audience: true } });
    if (!course || course.audience !== AUDIENCE[mode]) throw notFound('Quiz attempt');
    return a;
  }

  // ── Notices ──

  async function tellManagers(p: PersonRecord, notice: { title: string; body: string; feedbackId: string }): Promise<void> {
    try {
      const candidates = await prisma.user.findMany({ where: { deletedAt: null, status: 'ACTIVE', OR: [{ trainingManager: true }, { roles: { some: { role: { name: 'ADMIN' } } } }] }, select: { id: true } });
      const people = await loadPeople(prisma, candidates.map((c) => c.id));
      const { tms, admins } = trainingManagersFor(people, p.companyIds);
      const to = (tms.length ? tms : admins).filter((id) => id !== p.id);
      for (const userId of to) {
        await ctx.notify({ userId, type: 'TRAINING_QUESTION', title: notice.title, body: notice.body, entityType: 'training-feedback', entityId: notice.feedbackId, projectId: null }).catch((err) =>
          ctx.logger?.warn('training: a question notice could not be sent', { userId, err: String((err as Error)?.message ?? err) }),
        );
      }
    } catch (err) {
      ctx.logger?.warn('training: question notices failed', { err: String((err as Error)?.message ?? err) });
    }
  }

  /** 12 Nov: a project runner's team (the projects they run) has someone with an assigned course. */
  async function teamHasCourses(p: PersonRecord): Promise<boolean> {
    if (p.runProjectIds.length === 0) return false;
    const projects = await prisma.project.findMany({ where: { id: { in: [...p.runProjectIds] } }, select: { ownerId: true, managerId: true, members: { select: { userId: true } } } });
    const team = [...new Set(projects.flatMap((x) => [x.ownerId, x.managerId, ...x.members.map((m) => m.userId)]).filter((id): id is string => !!id))];
    if (team.length === 0) return false;
    return (await prisma.trainingAssignee.count({ where: { userId: { in: team }, withdrawnAt: null } })) > 0;
  }

  // ── The methods ──

  return {
    async access(userId: string): Promise<TrainingAccess> {
      const p = await who(userId, 'staff');
      const list = await myCourses(p, 'staff');
      return {
        learner: true,
        manager: isManager(p),
        admin: p.admin,
        teamReports: !p.admin && !p.trainingManager && p.runsProject && (await teamHasCourses(p)),
        overdue: list.filter((x) => x.state.state.overdue).length,
        assigned: list.filter((x) => x.state.state.assigned && x.state.state.status !== 'COMPLETED').length,
        tour: await tourOf(p),
      };
    },

    async me(userId: string, mode: LearnerMode): Promise<MyTraining> {
      const p = await who(userId, mode);
      await syncPerson(p);
      return myTrainingOf(p, mode);
    },

    /** The Client portal's Help & training: My training, the catalogue and the tour. */
    async portal(userId: string): Promise<PortalTraining> {
      const p = await who(userId, 'client');
      await syncPerson(p);
      const [mine, catalogue, tour] = await Promise.all([myTrainingOf(p, 'client'), catalogueOf(p, 'client', {}), tourOf(p)]);
      return { ...mine, catalogue, tour };
    },

    async summary(userId: string): Promise<{ assigned: number; overdue: number; inProgress: number; tour: { show: boolean } }> {
      const p = await who(userId, 'client');
      const list = await myCourses(p, 'client');
      return {
        assigned: list.filter((x) => x.state.state.assigned && x.state.state.status !== 'COMPLETED').length,
        overdue: list.filter((x) => x.state.state.overdue).length,
        inProgress: list.filter((x) => x.state.state.status === 'IN_PROGRESS').length,
        tour: await tourOf(p),
      };
    },

    async catalogue(userId: string, mode: LearnerMode, query: unknown): Promise<{ courses: CourseCard[] }> {
      const p = await who(userId, mode);
      const f = catalogueQuery.parse(query ?? {});
      return { courses: await catalogueOf(p, mode, { module: f.module || undefined, difficulty: f.difficulty || undefined, q: f.q }) };
    },

    async learn(userId: string, query: unknown): Promise<{ courseId: string | null; module: TrainingModule; count: number }> {
      const p = await who(userId, 'staff');
      const { module } = learnQuery.parse(query ?? {});
      const courses = await catalogueOf(p, 'staff', { module });
      const pick = courses.find((c) => c.mine.assigned && c.mine.status !== 'COMPLETED') ?? courses.find((c) => c.mine.status === 'IN_PROGRESS' || c.mine.status === 'REVIEW' || c.mine.status === 'RETAKE') ?? courses[0];
      return { courseId: pick?.id ?? null, module, count: courses.length };
    },

    async course(userId: string, mode: LearnerMode, courseId: unknown): Promise<CourseDetail> {
      const p = await who(userId, mode);
      const { course, access: a } = await courseFor(p, courseId, mode, 'read');
      return detailOf(p, course, a, mode);
    },

    async start(userId: string, mode: LearnerMode, courseId: unknown): Promise<CourseDetail> {
      const p = await who(userId, mode);
      const { course } = await courseFor(p, courseId, mode, 'learn');
      const state = await loadState(ctx, p.id, course.id);
      await ensureStarted(p.id, course.id, state.state.assigned);
      return detailOf(p, course, 'learn', mode);
    },

    async lesson(userId: string, mode: LearnerMode, lessonId: unknown): Promise<LessonView> {
      const p = await who(userId, mode);
      const { lesson, course, access: a } = await lessonFor(p, lessonId, mode, 'read');
      // R2: a video lesson still waiting for its link isn't there for learners.
      if (hiddenLesson(lesson)) throw notFound('Lesson');
      if (lesson.kind === 'QUIZ' && a === 'learn') await handInTimedOut(p, lesson.id);
      const state = await loadState(ctx, p.id, course.id);
      assertOpen(state, course, lesson.id, a);
      if (a === 'learn') await ensureStarted(p.id, course.id, state.state.assigned, lesson.id);
      const [steps, doc, progress, quiz] = await Promise.all([
        lesson.kind === 'GUIDE' ? prisma.trainingStep.findMany({ where: { lessonId: lesson.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }) : Promise.resolve([]),
        lesson.fileId ? prisma.trainingFile.findFirst({ where: { id: lesson.fileId, courseId: course.id } }) : Promise.resolve(null),
        prisma.trainingProgress.findUnique({ where: { userId_lessonId: { userId: p.id, lessonId: lesson.id } } }),
        lesson.kind === 'QUIZ' ? quizInfo(p, lesson.id, state) : Promise.resolve(null),
      ]);
      const i = state.lessons.findIndex((l) => l.id === lesson.id);
      return {
        id: lesson.id,
        courseId: course.id,
        courseTitle: course.title,
        kind: lesson.kind as LessonKind,
        title: lesson.title,
        minutes: lesson.minutes,
        position: lesson.position,
        lessonCount: state.lessons.length,
        body: lesson.body,
        prevLessonId: i > 0 ? state.lessons[i - 1]!.id : null,
        nextLessonId: i >= 0 ? (state.lessons[i + 1]?.id ?? null) : null,
        video: lesson.kind === 'VIDEO' ? videoInfo(lesson) : null,
        steps: steps.map((s) => ({ id: s.id, position: s.position, title: s.title, body: s.body, image: s.imageFileId ? { fileId: s.imageFileId, alt: s.imageAlt } : null })),
        document: doc ? fileRef(doc) : null,
        quiz,
        // R3: a guide that has fewer steps now opens on its last one, never past it.
        progress: { done: state.doneIds.has(lesson.id), videoSeconds: progress?.videoSeconds ?? 0, watchedPct: progress?.watchedPct ?? 0, stepIndex: Math.min(progress?.stepIndex ?? 0, Math.max(0, steps.length - 1)) },
        courseProgressPct: state.state.progressPct,
        watchFallbackSeconds: watchFallbackSeconds(lesson.minutes),
        module: null,
      };
    },

    async saveProgress(userId: string, mode: LearnerMode, lessonId: unknown, body: unknown): Promise<{ ok: true; progressPct: number }> {
      const p = await who(userId, mode);
      const input = progressBody.parse(body ?? {});
      const { lesson, course, access: a } = await lessonFor(p, lessonId, mode, 'learn');
      const state = await loadState(ctx, p.id, course.id);
      assertOpen(state, course, lesson.id, a);
      if (input.stepIndex !== undefined) {
        const steps = lesson.kind === 'GUIDE' ? await prisma.trainingStep.count({ where: { lessonId: lesson.id } }) : 0;
        if (input.stepIndex > Math.max(0, steps - 1)) throw new ValidationError('That step isn’t in this lesson.', { field: 'stepIndex' });
      }
      await writeProgress(p.id, course.id, lesson.id, input);
      await ensureStarted(p.id, course.id, state.state.assigned, lesson.id);
      return { ok: true, progressPct: state.state.progressPct };
    },

    async complete(userId: string, mode: LearnerMode, lessonId: unknown): Promise<LessonDone> {
      const p = await who(userId, mode);
      const { lesson, course, access: a } = await lessonFor(p, lessonId, mode, 'learn');
      if (lesson.kind === 'QUIZ') throw conflict('Pass the quiz to finish this lesson.', 'QUIZ_LESSON');
      if (lesson.kind === 'VIDEO' && !videoInfo(lesson)) throw conflict('This video isn’t linked yet.', 'NO_VIDEO');
      const state = await loadState(ctx, p.id, course.id);
      assertOpen(state, course, lesson.id, a);
      const now = ctx.clock();
      const last = lesson.kind === 'GUIDE' ? Math.max(0, (await prisma.trainingStep.count({ where: { lessonId: lesson.id } })) - 1) : undefined;
      await writeProgress(p.id, course.id, lesson.id, { doneAt: now, ...(last !== undefined ? { stepIndex: last } : {}) });
      await ensureStarted(p.id, course.id, state.state.assigned, lesson.id);
      return afterLessonDone(p, course, lesson.id);
    },

    async startAttempt(userId: string, mode: LearnerMode, lessonId: unknown): Promise<AttemptPaper> {
      const p = await who(userId, mode);
      const { lesson, course, access: a } = await lessonFor(p, lessonId, mode, 'learn');
      if (lesson.kind !== 'QUIZ') throw conflict('This lesson isn’t a quiz.', 'NOT_A_QUIZ');
      const loaded = await quizQuestions(lesson.id);
      if (!loaded || loaded.questions.length === 0) throw conflict('This quiz has no questions yet.', 'NO_QUESTIONS');
      return serial(`${p.id}|${lesson.id}`, async () => {
        await handInTimedOut(p, lesson.id);
        const state = await loadState(ctx, p.id, course.id);
        assertOpen(state, course, lesson.id, a);
        const open = await prisma.trainingAttempt.findFirst({ where: { userId: p.id, lessonId: lesson.id, submittedAt: null }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
        if (open) return attemptPaper(open);
        const used = state.attemptsUsed.get(lesson.id) ?? 0;
        if (loaded.quiz.maxAttempts !== null && used >= loaded.quiz.maxAttempts) throw conflict('No attempts left for this quiz.', 'NO_ATTEMPTS_LEFT');
        const paper = drawPaper(loaded.quiz, loaded.questions, ctx.rng ?? Math.random);
        const now = ctx.clock();
        const created = await prisma.trainingAttempt.create({
          data: { userId: p.id, courseId: course.id, lessonId: lesson.id, quizId: loaded.quiz.id, paper: paper as unknown as Prisma.InputJsonValue, startedAt: now, deadlineAt: deadlineOf(now, loaded.quiz.timeLimitMinutes) },
        });
        // Another server started one at the same moment: keep the first.
        const openNow = await prisma.trainingAttempt.findMany({ where: { userId: p.id, lessonId: lesson.id, submittedAt: null }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }] });
        if (openNow.length > 1 && openNow[0]!.id !== created.id) {
          await prisma.trainingAttempt.deleteMany({ where: { id: created.id, submittedAt: null } });
          return attemptPaper(openNow[0]!);
        }
        await ensureStarted(p.id, course.id, state.state.assigned, lesson.id);
        return attemptPaper(created);
      });
    },

    async saveAnswers(userId: string, mode: LearnerMode, attemptId: unknown, body: unknown): Promise<{ savedAt: string }> {
      const p = await who(userId, mode);
      const a = await attemptFor(p, attemptId, mode);
      if (a.submittedAt) throw conflict('This attempt was handed in.', 'SUBMITTED');
      if (timeIsUp(a.deadlineAt, ctx.clock())) {
        await handIn(p, a, savedOf(a));
        throw conflict('Time is up — your saved answers were handed in.', 'TIME_UP');
      }
      const answers = cleanAnswers(paperOf(a), (body as { answers?: unknown } | null)?.answers);
      const now = ctx.clock();
      const n = await prisma.trainingAttempt.updateMany({ where: { id: a.id, submittedAt: null }, data: { answers: answers as Prisma.InputJsonValue } });
      if (n.count === 0) throw conflict('This attempt was handed in.', 'SUBMITTED');
      return { savedAt: now.toISOString() };
    },

    async submit(userId: string, mode: LearnerMode, attemptId: unknown, body: unknown): Promise<AttemptResult> {
      const p = await who(userId, mode);
      const a = await attemptFor(p, attemptId, mode);
      if (a.submittedAt) return resultOf(p, a);
      const sent = (body as { answers?: unknown } | null)?.answers;
      const answers = timeIsUp(a.deadlineAt, ctx.clock()) ? savedOf(a) : sent !== undefined ? cleanAnswers(paperOf(a), sent) : savedOf(a);
      return handIn(p, a, answers);
    },

    async result(userId: string, mode: LearnerMode, attemptId: unknown): Promise<AttemptResult> {
      const p = await who(userId, mode);
      const a = await attemptFor(p, attemptId, mode);
      if (a.submittedAt) return resultOf(p, a);
      if (timeIsUp(a.deadlineAt, ctx.clock())) return handIn(p, a, savedOf(a));
      throw conflict('Hand in the quiz first.', 'NOT_HANDED_IN');
    },

    async file(userId: string, mode: LearnerMode, fileId: unknown): Promise<{ name: string; mimeType: string; content: Buffer }> {
      const p = await who(userId, mode);
      const f = await prisma.trainingFile.findUnique({ where: { id: idOf(fileId, 'File') } });
      if (!f) throw notFound('File');
      if (f.kind === 'SIGNATURE' || !f.courseId) {
        if (mode !== 'staff' || !isManager(p)) throw notFound('File');
      } else {
        const course = await prisma.trainingCourse.findUnique({ where: { id: f.courseId }, select: COURSE });
        if (!course || !access(course, p, mode)) throw notFound('File');
      }
      let content: Buffer;
      try {
        content = await ctx.files.read(f.storageKey);
      } catch {
        throw notFound('File');
      }
      return { name: f.name, mimeType: f.mimeType, content };
    },

    async certificatePdf(userId: string, mode: LearnerMode, certificateId: unknown): Promise<{ pdf: Buffer; fileName: string }> {
      const p = await who(userId, mode);
      const c = await prisma.trainingCertificate.findUnique({ where: { id: idOf(certificateId, 'Certificate') } });
      if (!c) throw notFound('Certificate');
      if (c.userId !== p.id) {
        if (mode !== 'staff' || !isManager(p)) throw notFound('Certificate');
        if (!p.admin) {
          const learner = await ctx.person(c.userId);
          if (!learner || !inScope(scopeOf(p), learner)) throw notFound('Certificate');
        }
      } else {
        const course = await prisma.trainingCourse.findUnique({ where: { id: c.courseId }, select: { audience: true } });
        if (course && course.audience !== AUDIENCE[mode]) throw notFound('Certificate');
      }
      let signature: Buffer | null = null;
      if (c.signatureFileId) {
        const f = await prisma.trainingFile.findUnique({ where: { id: c.signatureFileId } });
        if (f) {
          try {
            const raw = await ctx.files.read(f.storageKey);
            signature = ctx.printable ? await ctx.printable(raw) : /^image\/(png|jpeg)$/.test(f.mimeType) ? raw : null;
          } catch {
            signature = null;
          }
        }
      }
      const brand = (ctx.pdfBrand ? await ctx.pdfBrand(c.companyId).catch(() => null) : null) ?? { companyName: null, logo: null };
      const now = ctx.clock();
      const pdf = buildCertificatePdf(
        {
          code: c.code,
          learnerName: c.learnerName,
          courseTitle: c.courseTitle,
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
          scorePct: c.scorePct,
          issuerName: c.issuerName,
          issuerTitle: c.issuerTitle,
          signature,
          verifyUrl: verifyLink(ctx.appUrl, c.code),
          status: certificateStatus(c, now),
          revokedReason: c.revokedReason,
          company: brand,
          timeZone: ctx.timeZone,
        },
        { printedBy: p.name, now },
      );
      return { pdf, fileName: certificateFileName(c) };
    },

    async feedback(userId: string, mode: LearnerMode, courseId: unknown, body: unknown): Promise<FeedbackItem> {
      const p = await who(userId, mode);
      const input = feedbackBody.parse(body ?? {});
      const { course } = await courseFor(p, courseId, mode, 'learn');
      let lesson: { id: string; title: string } | null = null;
      if (input.lessonId) {
        lesson = await prisma.trainingLesson.findFirst({ where: { id: idOf(input.lessonId, 'Lesson'), courseId: course.id }, select: { id: true, title: true } });
        if (!lesson) throw notFound('Lesson');
      }
      const text = input.body?.trim() || null;
      const kind = input.kind as FeedbackKind;
      let row;
      if (kind === 'RATING') {
        if (input.rating === undefined) throw new ValidationError('Choose 1 to 5 stars.', { field: 'rating' });
        const existing = await prisma.trainingFeedback.findFirst({ where: { courseId: course.id, userId: p.id, kind: 'RATING' }, select: { id: true } });
        row = existing
          ? await prisma.trainingFeedback.update({ where: { id: existing.id }, data: { rating: input.rating, body: text, lessonId: lesson?.id ?? null } })
          : await prisma.trainingFeedback.create({ data: { courseId: course.id, lessonId: lesson?.id ?? null, userId: p.id, kind, rating: input.rating, body: text, status: 'ANSWERED' } });
      } else {
        if (kind === 'QUESTION' && !text) throw new ValidationError('Write your question.', { field: 'body' });
        row = await prisma.trainingFeedback.create({ data: { courseId: course.id, lessonId: lesson?.id ?? null, userId: p.id, kind, body: text, status: 'OPEN' } });
        const about = kind === 'QUESTION' ? `Question about ${course.title}` : `Problem reported: ${course.title}`;
        const said = (text ?? lesson?.title ?? '').slice(0, 140);
        await tellManagers(p, { title: about, body: said || course.title, feedbackId: row.id });
      }
      return {
        id: row.id,
        courseId: course.id,
        courseTitle: course.title,
        lessonId: lesson?.id ?? null,
        lessonTitle: lesson?.title ?? null,
        kind,
        rating: row.rating,
        body: row.body,
        status: row.status as FeedbackStatus,
        answer: row.answer,
        createdAt: row.createdAt.toISOString(),
        answeredAt: iso(row.answeredAt),
        byName: null,
      };
    },

    async tour(userId: string, mode: LearnerMode, body: unknown): Promise<{ ok: true }> {
      const p = await who(userId, mode);
      const { done } = tourBody.parse(body ?? {});
      await prisma.user.update({ where: { id: p.id }, data: { tourDoneAt: done ? ctx.clock() : null } });
      return { ok: true };
    },

    /** Public: GET /training/verify/:code — only the course, the name, the dates and the status. */
    async verify(rawCode: unknown): Promise<VerifyResult> {
      const code = typeof rawCode === 'string' ? normaliseCode(rawCode) : null;
      // One lookup either way, so a malformed code takes as long as an unknown one.
      const row = await prisma.trainingCertificate.findUnique({
        where: { code: code ?? DUMMY_CODE },
        select: { code: true, courseTitle: true, learnerName: true, issuedAt: true, expiresAt: true, revokedAt: true },
      });
      if (!code || !row || row.code !== code) throw notFound('Certificate');
      return { courseTitle: row.courseTitle, learnerName: row.learnerName, issuedAt: row.issuedAt.toISOString(), expiresAt: iso(row.expiresAt), status: certificateStatus(row, ctx.clock()), completedAt: row.issuedAt.toISOString() };
    },
  };
}

export type TrainingLearner = ReturnType<typeof createTrainingLearner>;
