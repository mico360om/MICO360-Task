import { z } from 'zod';
import { HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { zonedStartOfDay } from '../../lib/due-date';
import { formatDay } from '../../lib/export-format';
import { daysBetween, shiftDay } from '../../lib/working-days';
import { XLSX_CONTENT_TYPE } from '../../lib/xlsx-writer';
import { courseVisible, inScope, isManager, moduleShown, reportScope } from './training-access';
import { courseFacts, type TrainingContext } from './training-context';
import { stringList, type PersonRecord } from './prisma-training-store';
import { loadStates } from './training-read';
import { aggregateReport, quizQuestionStats, type ReportEnrolment, type ReportPerson } from './training-reports';
import type { Paper, StoredQuestion } from './training-quiz';
import { buildTrainingReportPdf, buildTrainingReportXlsx, trainingReportFileName } from './training-export';
import { REPORT_BY, REPORT_DATES, type QuestionKind, type QuizReport, type ModuleLearnerRow, type ModuleReportRow, type ReportBy, type ReportDates, type TrainingReport } from './training-types';

/**
 * The Training Center's Reports (owner request; ruling R5), server-enforced: administrators see everyone
 * (clients too), a Training manager the people of their companies (and clients of projects in them), a
 * project manager the teams of the projects they run (read-only, never clients). Anyone else: 403.
 * The period (from/to) is "who got the training in this period" (the enrolment's day, site zone).
 */

export type ReportScope = 'ALL' | 'COMPANIES' | 'TEAM';

export interface ReportQuery {
  by: ReportBy;
  /** Which date the period is about: when they got the course, or when they finished it. */
  dates: ReportDates;
  courseId?: string;
  from?: string;
  to?: string;
}

const NOT_ALLOWED = 'Only Training managers, administrators and project managers can see Learning Hub reports.';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const realDay = (s: string) => {
  const d = new Date(`${s}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a day like 2026-11-30.')
  .refine(realDay, 'That day doesn’t exist.');
const querySchema = z.object({
  by: z.preprocess(blank, z.enum(REPORT_BY).optional()),
  dates: z.preprocess(blank, z.enum(REPORT_DATES).optional()),
  courseId: z.preprocess(blank, z.string().regex(ID, 'Course not found.').optional()),
  from: z.preprocess(blank, day.optional()),
  to: z.preprocess(blank, day.optional()),
});

/** ?by=&courseId=&from=&to= → the report's query (400 for anything it can't be). */
export function parseReportQuery(raw: unknown): ReportQuery {
  const q = querySchema.parse(raw ?? {});
  if (q.from && q.to) {
    if (q.to < q.from) throw new ValidationError('The period’s first day must be before its last day.', { field: 'from' });
    if (daysBetween(q.from, q.to) > 366) throw new ValidationError('Choose a period of a year or less.', { field: 'to' });
  }
  return { by: q.by ?? 'course', dates: q.dates ?? 'got', ...(q.courseId ? { courseId: q.courseId } : {}), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) };
}

/** R5: is this person's training inside the viewer's report scope? */
export function personInReportScope(scope: ReportScope, viewer: PersonRecord, p: PersonRecord): boolean {
  if (scope === 'ALL') return true;
  if (scope === 'COMPANIES') return inScope(viewer.companyIds, p);
  return !p.client && p.teamProjectIds.some((id) => viewer.runProjectIds.includes(id));
}

/** M6: the key of the group a reader may not see by name. */
export const OTHER = 'other';

/**
 * M6: a person's companies and projects as this reader may see them — administrators every one; a Training
 * manager her companies and the projects with one of her companies; a project manager his companies and the
 * projects he runs. The rest is folded into one "Other" group (never named).
 */
export function foldGroups(scope: ReportScope, viewer: PersonRecord, p: Pick<PersonRecord, 'companyIds' | 'teamProjectIds'>, projectCompanies: ReadonlyMap<string, readonly string[]>): { companyIds: string[]; teamProjectIds: string[] } {
  if (scope === 'ALL') return { companyIds: [...p.companyIds], teamProjectIds: [...p.teamProjectIds] };
  const fold = (ids: readonly string[], seen: (id: string) => boolean) => {
    const out = ids.filter(seen);
    if (out.length < ids.length) out.push(OTHER);
    return out;
  };
  const projectSeen =
    scope === 'COMPANIES' ? (id: string) => (projectCompanies.get(id) ?? []).some((c) => viewer.companyIds.includes(c)) : (id: string) => viewer.runProjectIds.includes(id);
  return { companyIds: fold(p.companyIds, (id) => viewer.companyIds.includes(id)), teamProjectIds: fold(p.teamProjectIds, projectSeen) };
}

/** M7: quiz figures only for courses the reader manages (Training managers, administrators) or may see. */
export function quizCourseVisible(viewer: PersonRecord, course: { audience: string; moduleKey: string; roleKeys: unknown; companyIds: unknown; status: string }): boolean {
  return isManager(viewer) || courseVisible(courseFacts(course), viewer);
}

/** The lines a file says its filters with. */
export function reportFilterLines(q: ReportQuery, courseTitle: string | null): string[] {
  const out: string[] = [];
  if (courseTitle) out.push(`Course: ${courseTitle}`);
  if (q.from && q.to) out.push(`From ${formatDay(q.from)} to ${formatDay(q.to)}`);
  else if (q.from) out.push(`From ${formatDay(q.from)}`);
  else if (q.to) out.push(`Until ${formatDay(q.to)}`);
  if (q.dates === 'finished') out.push('Only people who finished the course');
  return out;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);
const average = (list: readonly number[]) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
function chunks<T>(list: readonly T[], size = 300): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function createTrainingReports(ctx: TrainingContext) {
  const { prisma } = ctx;

  /** The viewer and their scope (403 for anyone without one). */
  async function viewerOf(viewerId: string): Promise<{ viewer: PersonRecord; scope: ReportScope }> {
    const viewer = await ctx.person(viewerId);
    const scope = viewer && viewer.active ? reportScope(viewer) : null;
    if (!viewer || !scope) throw new HttpError(NOT_ALLOWED, 'FORBIDDEN', 403);
    return { viewer, scope };
  }

  /** Everyone in the viewer's scope, by id. */
  async function scopedPeople(viewer: PersonRecord, scope: ReportScope): Promise<Map<string, PersonRecord>> {
    const all = await ctx.people();
    return new Map([...all].filter(([, p]) => personInReportScope(scope, viewer, p)));
  }

  /** The period as instants (from's start, the day after to's start), site zone. */
  function period(q: ReportQuery): { gte?: Date; lt?: Date } {
    return {
      ...(q.from ? { gte: zonedStartOfDay(q.from, ctx.timeZone) } : {}),
      ...(q.to ? { lt: zonedStartOfDay(shiftDay(q.to, 1), ctx.timeZone) } : {}),
    };
  }

  async function report(viewerId: string, raw: unknown): Promise<TrainingReport> {
    const { viewer, scope } = await viewerOf(viewerId);
    const q = parseReportQuery(raw);
    return build(viewer, scope, q);
  }

  async function build(viewer: PersonRecord, scope: ReportScope, q: ReportQuery): Promise<TrainingReport> {
    if (q.courseId && !(await prisma.trainingCourse.findUnique({ where: { id: q.courseId }, select: { id: true } }))) throw new NotFoundError('Course not found.');
    const people = await scopedPeople(viewer, scope);
    const courses = await prisma.trainingCourse.findMany({
      where: { status: { in: ['PUBLISHED', 'ARCHIVED'] }, ...(q.courseId ? { id: q.courseId } : {}) },
      select: { id: true, title: true, audience: true, moduleKey: true, roleKeys: true, companyIds: true, status: true },
    });
    const courseIds = courses.map((c) => c.id);
    const courseTitle = new Map(courses.map((c) => [c.id, c.title]));
    const span = period(q);
    // I3: everyone (administrators) in one read; a scope's people in pieces.
    // "Dates by": when they got the course (the enrolment's day), or when they finished it (only finished ones).
    const dateWhere = q.dates === 'finished' ? { completedAt: { not: null, ...span } } : span.gte || span.lt ? { createdAt: span } : {};
    const enrolmentWhere = { withdrawnAt: null, courseId: { in: courseIds }, ...dateWhere };
    const select = { userId: true, courseId: true } as const;
    const enrolments = !courseIds.length
      ? []
      : scope === 'ALL'
        ? (await prisma.trainingEnrolment.findMany({ where: enrolmentWhere, select })).filter((e) => people.has(e.userId))
        : (await Promise.all(chunks([...people.keys()]).map((part) => prisma.trainingEnrolment.findMany({ where: { ...enrolmentWhere, userId: { in: part } }, select })))).flat();
    const states = await loadStates(
      ctx,
      enrolments.map((e) => ({ userId: e.userId, courseId: e.courseId })),
      people,
    );
    const rows: ReportEnrolment[] = [];
    const today = ctx.today();
    const overdue: TrainingReport['overdue'] = [];
    for (const s of states.values()) {
      const p = people.get(s.userId)!;
      rows.push({ userId: s.userId, courseId: s.courseId, status: s.state.status, assigned: s.state.assigned, started: !!s.enrolment?.startedAt || s.doneIds.size > 0, selfStarted: !!s.enrolment?.selfStarted, overdue: s.state.overdue, bestScore: s.bestScore });
      if (s.state.overdue && s.state.dueDay) {
        overdue.push({ userId: s.userId, name: p.name, courseId: s.courseId, courseTitle: courseTitle.get(s.courseId) ?? 'Course', dueDay: s.state.dueDay, daysLate: Math.max(0, daysBetween(s.state.dueDay, today)), mandatory: s.state.mandatory, client: p.client });
      }
    }
    overdue.sort((a, b) => b.daysLate - a.daysLate || a.name.localeCompare(b.name) || a.courseTitle.localeCompare(b.courseTitle));

    // Labels for the groups.
    const involved = [...new Set(rows.map((r) => r.userId))].map((id) => people.get(id)!);
    const deptIds = [...new Set(involved.map((p) => p.departmentId).filter((d): d is string => !!d))];
    const companyIds = [...new Set(involved.flatMap((p) => p.companyIds))];
    const projectIds = [...new Set(involved.flatMap((p) => p.teamProjectIds))];
    const [departments, companies, projects] = await Promise.all([
      deptIds.length ? prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [],
      companyIds.length ? prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
      projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, companies: { select: { companyId: true } } } }) : [],
    ]);
    // M6: companies and projects the reader may not see are one "Other" group.
    const projectCompanies = new Map(projects.map((p) => [p.id, p.companies.map((c) => c.companyId)]));
    const reportPeople: ReportPerson[] = involved.map((p) => ({ id: p.id, name: p.name, client: p.client, admin: p.admin, departmentId: p.departmentId, ...foldGroups(scope, viewer, p, projectCompanies) }));
    const { totals, rows: grouped } = aggregateReport(q.by, rows, reportPeople, {
      course: courseTitle,
      department: new Map(departments.map((d) => [d.id, d.name])),
      company: new Map([...companies.map((c) => [c.id, c.name] as [string, string]), [OTHER, 'Other'] as [string, string]]),
      project: new Map([...projects.map((p) => [p.id, p.name] as [string, string]), [OTHER, 'Other'] as [string, string]]),
    });

    // Certificates expiring in the next 30 days (valid ones), soonest first.
    const now = ctx.clock();
    const certificates = courseIds.length
      ? (
          await prisma.trainingCertificate.findMany({
            where: { revokedAt: null, courseId: { in: courseIds }, expiresAt: { gt: now, lte: new Date(now.getTime() + 30 * 86_400_000) } },
            select: { id: true, userId: true, courseId: true, courseTitle: true, expiresAt: true },
            orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          })
        ).filter((c) => people.has(c.userId))
      : [];
    const expiring = certificates.map((c) => ({ certificateId: c.id, userId: c.userId, name: people.get(c.userId)!.name, courseId: c.courseId, courseTitle: courseTitle.get(c.courseId) ?? c.courseTitle, expiresAt: c.expiresAt!.toISOString() }));

    // Quizzes of the courses in view: handed-in attempts by people in scope (in the period).
    // M7: quizzes only of the courses the reader manages or may see.
    const quizCourseIds = courses.filter((c) => quizCourseVisible(viewer, c)).map((c) => c.id);
    const quizLessons = quizCourseIds.length
      ? await prisma.trainingLesson.findMany({ where: { courseId: { in: quizCourseIds }, kind: 'QUIZ' }, select: { id: true, courseId: true, title: true, position: true, moduleId: true, quiz: { select: { _count: { select: { questions: true } } } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] })
      : [];
    const attempts = quizLessons.length
      ? (
          await prisma.trainingAttempt.findMany({
            where: { lessonId: { in: quizLessons.map((l) => l.id) }, submittedAt: { not: null, ...(span.gte ? { gte: span.gte } : {}), ...(span.lt ? { lt: span.lt } : {}) } },
            select: { userId: true, lessonId: true, scorePct: true, passed: true },
          })
        ).filter((a) => people.has(a.userId))
      : [];
    const attemptsOf = new Map<string, typeof attempts>();
    for (const a of attempts) {
      const list = attemptsOf.get(a.lessonId);
      if (list) list.push(a);
      else attemptsOf.set(a.lessonId, [a]);
    }
    // A reader who isn't a manager never sees a module (or its quiz) that isn't shown to them; managers see all.
    const manager = isManager(viewer);
    const quizModules = new Map<string, { title: string; shown: boolean }>();
    if (quizLessons.some((l) => l.moduleId)) {
      for (const m of await prisma.trainingModule.findMany({ where: { courseId: { in: quizCourseIds } }, select: { id: true, title: true, moduleKey: true, roleKeys: true, companyIds: true, enabled: true } })) {
        quizModules.set(m.id, { title: m.title, shown: manager || moduleShown({ moduleKey: m.moduleKey, roleKeys: stringList(m.roleKeys), companyIds: stringList(m.companyIds), enabled: m.enabled }, viewer) });
      }
    }
    const quizzes = quizLessons
      .filter((l) => !l.moduleId || quizModules.get(l.moduleId)?.shown !== false)
      .map((l) => {
        const mine = attemptsOf.get(l.id) ?? [];
        return {
          lessonId: l.id,
          courseTitle: courseTitle.get(l.courseId) ?? 'Course',
          title: l.title,
          attempts: mine.length,
          passRate: pct(mine.filter((a) => a.passed).length, mine.length),
          averageScore: average(mine.map((a) => a.scorePct ?? 0)),
          people: new Set(mine.map((a) => a.userId)).size,
          moduleTitle: l.moduleId ? (quizModules.get(l.moduleId)?.title ?? null) : null,
          questions: l.quiz?._count.questions ?? 0,
        };
      })
      .sort((a, b) => a.courseTitle.localeCompare(b.courseTitle, 'en'));

    const { modules, learners } = q.courseId ? await byModuleAndPerson(q.courseId, states, people, viewer) : { modules: null, learners: null };
    return { scope, by: q.by, dates: q.dates, totals, rows: grouped, overdue: overdue.slice(0, 500), expiring: expiring.slice(0, 500), quizzes, modules, learners };
  }

  /**
   * One course with modules: per module the people who can see it (what `loadStates` made of `moduleShown`, so a
   * hidden or switched-off module never counts for anyone) by done / in progress / not started, and per person
   * how many of theirs they have done, when they last learned and their newest valid certificate.
   */
  async function byModuleAndPerson(courseId: string, states: Awaited<ReturnType<typeof loadStates>>, people: ReadonlyMap<string, PersonRecord>, viewer: PersonRecord): Promise<Pick<TrainingReport, 'modules' | 'learners'>> {
    const courseModules = await prisma.trainingModule.findMany({ where: { courseId }, select: { id: true, title: true, moduleKey: true, roleKeys: true, companyIds: true, enabled: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
    if (courseModules.length === 0) return { modules: null, learners: null };
    const all = [...states.values()].filter((s) => s.courseId === courseId);
    // Managers see every module; anyone else only the modules shown to them.
    const listed = isManager(viewer) ? courseModules : courseModules.filter((m) => moduleShown({ moduleKey: m.moduleKey, roleKeys: stringList(m.roleKeys), companyIds: stringList(m.companyIds), enabled: m.enabled }, viewer));
    const modules: ModuleReportRow[] = listed.map((m) => {
      const mine = all.map((s) => s.units.find((u) => u.unit.id === m.id)).filter((u): u is NonNullable<typeof u> => !!u);
      const done = mine.filter((u) => u.status === 'DONE').length;
      const inProgress = mine.filter((u) => u.status === 'IN_PROGRESS').length;
      return { moduleId: m.id, title: m.title, people: mine.length, done, inProgress, notStarted: mine.length - done - inProgress };
    });
    const now = ctx.clock();
    const newest = new Map<string, { id: string; code: string }>();
    for (const part of chunks(all.map((s) => s.userId))) {
      const certs = await prisma.trainingCertificate.findMany({
        where: { courseId, userId: { in: part }, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { id: true, code: true, userId: true },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      });
      for (const c of certs) if (!newest.has(c.userId)) newest.set(c.userId, { id: c.id, code: c.code });
    }
    const learners: ModuleLearnerRow[] = all
      .map((s) => ({
        userId: s.userId,
        name: people.get(s.userId)?.name ?? 'Someone',
        modulesDone: s.units.filter((u) => u.status === 'DONE').length,
        modulesRequired: s.units.length,
        lastActivityAt: s.enrolment?.lastActivityAt ? s.enrolment.lastActivityAt.toISOString() : null,
        certificate: newest.get(s.userId) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.userId.localeCompare(b.userId));
    return { modules, learners };
  }

  async function quizReport(viewerId: string, lessonIdRaw: unknown): Promise<QuizReport> {
    const { viewer, scope } = await viewerOf(viewerId);
    if (typeof lessonIdRaw !== 'string' || !ID.test(lessonIdRaw)) throw new NotFoundError('Quiz not found.');
    const lesson = await prisma.trainingLesson.findUnique({
      where: { id: lessonIdRaw },
      select: {
        id: true,
        kind: true,
        title: true,
        course: { select: { title: true, audience: true, moduleKey: true, roleKeys: true, companyIds: true, status: true } },
        quiz: { select: { questions: { select: { id: true, kind: true, prompt: true, explanation: true, position: true, options: { select: { id: true, text: true, correct: true, feedback: true, position: true } } } } } },
      },
    });
    if (!lesson || lesson.kind !== 'QUIZ' || !lesson.quiz || !quizCourseVisible(viewer, lesson.course)) throw new NotFoundError('Quiz not found.');
    const people = await scopedPeople(viewer, scope);
    const attempts = (
      await prisma.trainingAttempt.findMany({ where: { lessonId: lesson.id, submittedAt: { not: null } }, select: { userId: true, scorePct: true, passed: true, paper: true, answers: true } })
    ).filter((a) => people.has(a.userId));
    const questions: StoredQuestion[] = lesson.quiz.questions.map((q) => ({ id: q.id, kind: q.kind as QuestionKind, prompt: q.prompt, explanation: q.explanation, position: q.position, options: q.options }));
    return {
      lessonId: lesson.id,
      courseTitle: lesson.course.title,
      title: lesson.title,
      attempts: attempts.length,
      people: new Set(attempts.map((a) => a.userId)).size,
      passRate: pct(attempts.filter((a) => a.passed).length, attempts.length),
      averageScore: average(attempts.map((a) => a.scorePct ?? 0)),
      questions: quizQuestionStats(
        questions,
        attempts.map((a) => ({ paper: a.paper as unknown as Paper, answers: (a.answers ?? {}) as Record<string, string[]> })),
      ),
    };
  }

  /** The report as a file: the same query, the same scope. */
  async function exportFile(viewerId: string, raw: unknown, format: 'xlsx' | 'pdf', generatedBy: string | null): Promise<{ body: Buffer; fileName: string; contentType: string }> {
    const { viewer, scope } = await viewerOf(viewerId);
    const q = parseReportQuery(raw);
    const r = await build(viewer, scope, q);
    const courseTitle = q.courseId ? ((await prisma.trainingCourse.findUnique({ where: { id: q.courseId }, select: { title: true } }))?.title ?? null) : null;
    const now = ctx.clock();
    const company = format === 'pdf' && ctx.pdfBrand ? await ctx.pdfBrand(viewer.primaryCompanyId).catch(() => null) : null;
    const meta = { generatedBy, timeZone: ctx.timeZone, now, filters: reportFilterLines(q, courseTitle), company };
    const fileName = trainingReportFileName(r, format, ctx.today());
    return format === 'xlsx'
      ? { body: buildTrainingReportXlsx(r, meta), fileName, contentType: XLSX_CONTENT_TYPE }
      : { body: buildTrainingReportPdf(r, meta), fileName, contentType: 'application/pdf' };
  }

  /** Whose reports this person may see (null: none). */
  async function access(viewerId: string): Promise<{ scope: ReportScope | null }> {
    const viewer = await ctx.person(viewerId);
    return { scope: viewer && viewer.active ? reportScope(viewer) : null };
  }

  return { report, quizReport, exportFile, access };
}

export type TrainingReports = ReturnType<typeof createTrainingReports>;
