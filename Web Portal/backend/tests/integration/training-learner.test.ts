import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import { validationErrorBody } from '../../src/lib/validation-errors';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthGuard, type AuthGuard } from '../../src/modules/auth/auth-guard';
import { clientRouteClass, routeKeyOf } from '../../src/modules/clients/client-route-table';
import { isClientRoles } from '../../src/modules/clients/client-kind';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { seededRng } from '../../src/modules/training/training-quiz';
import { createTrainingLearner } from '../../src/modules/training/training-learner';
import { registerTrainingRoutes } from '../../src/modules/training/training-routes';
import { registerPortalTrainingRoutes } from '../../src/modules/training/portal-training-routes';
import type { AttemptPaper, AttemptResult, CourseCard, CourseDetail, LessonDone, LessonView, MyTraining, PortalTraining, TrainingAccess } from '../../src/modules/training/training-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Taking training on a real database (staff /training/* and the Client portal's /portal/training/*): who sees
// which course (modules, company limits, clients never a staff course, lesson, file, attempt or certificate),
// a manager's preview, progress saved and resumed, lessons in order, completion rules, quizzes (marking,
// retakes, a question bank, time limits; papers never holding the answers), certificates (codes, the public
// check, PDFs, expiry → retake → a new certificate), feedback notices and the first-time tour.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const PNG = readFileSync(resolve(__dirname, '../../assets/logo-pdf.png'));
const PDF = Buffer.from('%PDF-1.4\n%training learner test\n', 'utf8');

let w: CompanyWorld;
let app: FastifyInstance;
let clientId: string;
let newcomerId: string | null = null;
let clockAt: Date | null = null;
const notices: { userId: string; type: string; title: string; entityType: string | null; entityId: string | null }[] = [];
const courseIds: string[] = [];
const filesDir = join(mkdtempSync(join(tmpdir(), 'tl-')), 'training-files');
const savedSettings = new Map<string, unknown>();
const tokenService = createTokenService({
  accessSecret: 'training-learner-access',
  refreshSecret: 'training-learner-refresh',
  accessTtl: 3600,
  refreshTtl: 7200,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(filesDir),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  now: () => clockAt ?? new Date(),
  rng: seededRng(7),
  notify: async (n) => {
    notices.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const sync = createTrainingSync(ctx);
const learner = createTrainingLearner(ctx, sync);

type Who = 'admin' | 'ana' | 'amy' | 'ben' | 'bob' | 'cat' | 'client' | 'newcomer';
const idOf = (who: Who) => (who === 'client' ? clientId : who === 'newcomer' ? newcomerId! : w.people[who]);
const rolesOf = (who: Who) => (who === 'client' ? ['CLIENT'] : who === 'admin' ? ['ADMIN'] : ['EMPLOYEE']);
async function raw(who: Who | null, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${(await tokenService.issueTokens({ id: idOf(who), roles: rolesOf(who) })).accessToken}`;
  return app.inject({ method, url: `/api/v1${path}`, headers, ...(body !== undefined ? { payload: body as object } : {}) });
}
async function call(who: Who | null, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
  const res = await raw(who, method, path, body);
  return { status: res.statusCode, text: res.body, body: res.body ? (JSON.parse(res.body) as { data?: unknown; error?: { code: string; message: string } }) : {} };
}
const data = async <T,>(p: ReturnType<typeof call>, status = 200): Promise<T> => {
  const r = await p;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${r.text}`);
  return r.body.data as T;
};

// ── Courses made directly in the database ──
interface OptSpec { text: string; correct: boolean; feedback?: string }
interface QSpec { kind: 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE' | 'ORDER'; prompt: string; explanation?: string; options: OptSpec[] }
interface LessonSpec {
  kind: 'GUIDE' | 'VIDEO' | 'QUIZ' | 'DOCUMENT';
  title: string;
  minutes?: number;
  videoId?: string;
  steps?: { title: string; image?: boolean }[];
  quiz?: { passMark: number; maxAttempts: number | null; timeLimitMinutes?: number | null; drawCount?: number | null; questions: QSpec[] };
}
interface Made {
  id: string;
  lessons: { id: string; kind: string }[];
  imageId: string | null;
  resourceId: string | null;
  options: Map<string, { id: string; correct: boolean; position: number }[]>;
  questions: Map<string, string>;
}
async function fileRow(courseId: string | null, kind: string, name: string, mimeType: string, content: Buffer) {
  const storageKey = await ctx.files.save(content, mimeType);
  return (await prisma.trainingFile.create({ data: { courseId, kind, name, mimeType, sizeBytes: content.length, storageKey } })).id;
}
async function makeCourse(title: string, o: Record<string, unknown>, lessons: LessonSpec[], withFiles = false): Promise<Made> {
  const c = await prisma.trainingCourse.create({
    data: { title: `${title} ${w.tag}`, moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', status: 'PUBLISHED', publishedAt: new Date(), ...o } as never,
  });
  courseIds.push(c.id);
  const imageId = withFiles ? await fileRow(c.id, 'IMAGE', 'step.png', 'image/png', PNG) : null;
  const resourceId = withFiles ? await fileRow(c.id, 'RESOURCE', 'guide.pdf', 'application/pdf', PDF) : null;
  const made: Made = { id: c.id, lessons: [], imageId, resourceId, options: new Map(), questions: new Map() };
  for (const [i, l] of lessons.entries()) {
    const lesson = await prisma.trainingLesson.create({
      data: {
        courseId: c.id,
        position: i,
        kind: l.kind,
        title: l.title,
        minutes: l.minutes ?? 4,
        ...(l.videoId ? { videoProvider: 'YOUTUBE', videoId: l.videoId, videoUrl: `https://youtu.be/${l.videoId}` } : {}),
        ...(l.steps ? { steps: { create: l.steps.map((s, k) => ({ position: k, title: s.title, body: `<p>${s.title}</p>`, imageFileId: s.image ? imageId : null, imageAlt: s.image ? 'A picture' : null })) } } : {}),
      },
    });
    made.lessons.push({ id: lesson.id, kind: l.kind });
    if (l.quiz) {
      const quiz = await prisma.trainingQuiz.create({ data: { lessonId: lesson.id, passMark: l.quiz.passMark, maxAttempts: l.quiz.maxAttempts, timeLimitMinutes: l.quiz.timeLimitMinutes ?? null, drawCount: l.quiz.drawCount ?? null } });
      for (const [qi, q] of l.quiz.questions.entries()) {
        const question = await prisma.trainingQuestion.create({
          data: { quizId: quiz.id, position: qi, kind: q.kind, prompt: q.prompt, explanation: q.explanation ?? null, options: { create: q.options.map((op, k) => ({ position: k, text: op.text, correct: op.correct, feedback: op.feedback ?? null })) } },
          include: { options: true },
        });
        made.questions.set(q.prompt, question.id);
        made.options.set(question.id, question.options.map((op) => ({ id: op.id, correct: op.correct, position: op.position })));
      }
    }
  }
  return made;
}
const rightAnswers = (m: Made, questionIds: string[]) =>
  Object.fromEntries(
    questionIds.map((qid) => {
      const opts = m.options.get(qid)!;
      return [qid, opts.every((op) => op.correct) ? [...opts].sort((a, b) => a.position - b.position).map((op) => op.id) : opts.filter((op) => op.correct).map((op) => op.id)];
    }),
  );

let staff: Made;
let quizOnly: Made;
let clientCourse: Made;
let draft: Made;
let adminCourse: Made;
let bCourse: Made;
let quick: Made;
let signatureId: string;
let anaCert: { id: string; code: string };

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  clientId = (await prisma.user.create({ data: { email: `lclient.${w.tag}@world.test`, username: `lclient_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } })).id;
  await prisma.clientProjectGrant.create({ data: { userId: clientId, projectId: w.projects.PA, progress: true } });
  for (const key of ['training.launchedAt', 'training.tour']) {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    savedSettings.set(key, row ? row.value : undefined);
  }
  signatureId = await fileRow(null, 'SIGNATURE', 'sign.png', 'image/png', PNG);

  staff = await makeCourse(
    'Staff basics',
    { inOrder: true, certificateOn: true, certificateMonths: 12, issuerUserId: w.people.amy, issuerTitle: 'Training lead', signatureFileId: signatureId },
    [
      { kind: 'GUIDE', title: 'Read the guide', steps: [{ title: 'Step one', image: true }, { title: 'Step two' }] },
      { kind: 'VIDEO', title: 'Watch the video', videoId: 'dQw4w9WgXcQ' },
      {
        kind: 'QUIZ',
        title: 'Check yourself',
        quiz: {
          passMark: 60,
          maxAttempts: 2,
          questions: [
            { kind: 'SINGLE', prompt: 'Pick B', explanation: 'Because B is right', options: [{ text: 'A', correct: false, feedback: 'Not A' }, { text: 'B', correct: true, feedback: 'Yes B' }] },
            { kind: 'MULTIPLE', prompt: 'Pick A and C', options: [{ text: 'A', correct: true }, { text: 'B', correct: false }, { text: 'C', correct: true }] },
            { kind: 'ORDER', prompt: 'Put in order', options: [{ text: 'first', correct: true }, { text: 'second', correct: true }, { text: 'third', correct: true }] },
          ],
        },
      },
    ],
    true,
  );
  quizOnly = await makeCourse('Quiz only', { completionRule: 'QUIZZES' }, [
    { kind: 'GUIDE', title: 'Optional reading', steps: [{ title: 'Only step' }] },
    {
      kind: 'QUIZ',
      title: 'The bank',
      quiz: {
        passMark: 100,
        maxAttempts: null,
        timeLimitMinutes: 10,
        drawCount: 2,
        questions: [1, 2, 3].map((n) => ({ kind: 'TRUE_FALSE' as const, prompt: `Statement ${n} is true`, options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] })),
      },
    },
  ]);
  clientCourse = await makeCourse('Client portal basics', { audience: 'CLIENTS', moduleKey: 'portal' }, [{ kind: 'GUIDE', title: 'Your portal', steps: [{ title: 'Sign in', image: true }] }], true);
  draft = await makeCourse('Draft course', { status: 'DRAFT', publishedAt: null }, [{ kind: 'GUIDE', title: 'Draft lesson', steps: [{ title: 'Soon' }] }]);
  adminCourse = await makeCourse('Admin settings', { moduleKey: 'admin' }, [{ kind: 'GUIDE', title: 'Settings', steps: [{ title: 'Open settings' }] }]);
  bCourse = await makeCourse('Beta only', { companyIds: [w.companies.B] }, [{ kind: 'GUIDE', title: 'Beta', steps: [{ title: 'Beta step' }] }]);
  quick = await makeCourse('Quick win', { moduleKey: 'general', certificateOn: true }, [{ kind: 'GUIDE', title: 'One step', steps: [{ title: 'Done' }] }]);

  // The real guard (route tables included). Until the portal training rows are in the route tables, a
  // /portal/training route without a row gets the rule its row will say ('client': client accounts only).
  const real = createAuthGuard(tokenService);
  const guard: AuthGuard = {
    ...real,
    async authenticate(req, reply) {
      const key = routeKeyOf(req.method, req.routeOptions?.url ?? req.url);
      if (!key.split(' ')[1]!.startsWith('/portal/training') || clientRouteClass(key) !== undefined) return real.authenticate(req, reply);
      const claims = tokenService.verifyAccess(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
      const roles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
      req.user = { id: claims.sub!, roles };
      if (!isClientRoles(roles)) throw new HttpError('The Client portal is for client accounts. Staff use the rest of the site.', 'CLIENTS_ONLY', 403);
    },
  };
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    if (err instanceof ZodError) return reply.status(400).send(validationErrorBody(err));
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { code: status === 429 ? 'RATE_LIMITED' : 'ERROR', message: (err as Error).message } });
  });
  await app.register(rateLimit, { global: false });
  await app.register(
    async (api) => {
      const deps = { learner, guard, feedbackPerMinute: 500, progressPerMinute: 1000, filesPerMinute: 500, pdfsPerMinute: 500 };
      await registerTrainingRoutes(api, deps);
      await registerPortalTrainingRoutes(api, deps);
    },
    { prefix: '/api/v1' },
  );
});

afterAll(async () => {
  const users = [...Object.values(w.people), clientId, ...(newcomerId ? [newcomerId] : [])];
  await prisma.trainingAttempt.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingProgress.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignee.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingEnrolment.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingFeedback.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCertificate.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingFile.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { id: signatureId }] } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  for (const [key, value] of savedSettings) {
    if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  }
  await prisma.clientProjectGrant.deleteMany({ where: { userId: clientId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, ...(newcomerId ? [newcomerId] : [])] } } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('who sees which course', () => {
  it('the catalogue: modules they can use, their companies, published staff courses only', async () => {
    const ana = (await data<{ courses: CourseCard[] }>(call('ana', 'GET', '/training/catalogue'))).courses.map((c) => c.id);
    expect(ana).toEqual(expect.arrayContaining([staff.id, quizOnly.id, quick.id]));
    for (const hidden of [clientCourse.id, draft.id, adminCourse.id, bCourse.id]) expect(ana).not.toContain(hidden);
    const admin = (await data<{ courses: CourseCard[] }>(call('admin', 'GET', '/training/catalogue'))).courses.map((c) => c.id);
    expect(admin).toEqual(expect.arrayContaining([adminCourse.id, bCourse.id]));
    expect(admin).not.toContain(clientCourse.id);
    const filtered = (await data<{ courses: CourseCard[] }>(call('ana', 'GET', '/training/catalogue?module=general'))).courses.map((c) => c.id);
    expect(filtered).toContain(quick.id);
    expect(filtered).not.toContain(staff.id);
    expect((await data<{ courses: CourseCard[] }>(call('ana', 'GET', `/training/catalogue?q=${encodeURIComponent('Quick win')}`))).courses.map((c) => c.id)).toEqual([quick.id]);
    expect((await call('ana', 'GET', '/training/catalogue?module=nonsense')).status).toBe(400);
    expect((await call('ana', 'GET', `/training/catalogue?q=${'x'.repeat(101)}`)).status).toBe(400);
  });

  it('a module or company they can’t see is “not found”; administrators see admin courses; Beta people the Beta course', async () => {
    expect((await call('ana', 'GET', `/training/courses/${adminCourse.id}`)).status).toBe(404);
    expect((await call('admin', 'GET', `/training/courses/${adminCourse.id}`)).status).toBe(200);
    expect((await call('ana', 'GET', `/training/courses/${bCourse.id}`)).status).toBe(404);
    expect((await call('ben', 'GET', `/training/courses/${bCourse.id}`)).status).toBe(200);
    expect((await call('ana', 'GET', `/training/lessons/${adminCourse.lessons[0]!.id}`)).status).toBe(404);
    expect((await call('ana', 'GET', '/training/courses/nope')).status).toBe(404);
  });

  it('a Training manager previews a draft (reads only); an employee can’t see it', async () => {
    expect((await call('ana', 'GET', `/training/courses/${draft.id}`)).status).toBe(404);
    const d = await data<CourseDetail>(call('amy', 'GET', `/training/courses/${draft.id}`));
    expect(d.id).toBe(draft.id);
    expect((await call('amy', 'GET', `/training/lessons/${draft.lessons[0]!.id}`)).status).toBe(200);
    const start = await call('amy', 'POST', `/training/courses/${draft.id}/start`);
    expect(start.status).toBe(409);
    expect(start.body.error?.code).toBe('COURSE_NOT_PUBLISHED');
    expect((await call('amy', 'POST', `/training/lessons/${draft.lessons[0]!.id}/complete`)).status).toBe(409);
    expect(await prisma.trainingEnrolment.count({ where: { courseId: draft.id } })).toBe(0);
  });

  it('Learn this feature: the module’s course for them; a module they can’t use: none', async () => {
    expect(await data(call('ana', 'GET', '/training/learn?module=general'))).toEqual({ courseId: quick.id, moduleId: null, module: 'general', count: 1 });
    expect(await data(call('ana', 'GET', '/training/learn?module=admin'))).toEqual({ courseId: null, moduleId: null, module: 'admin', count: 0 });
    expect((await call('ana', 'GET', '/training/learn?module=bad')).status).toBe(400);
  });
});

describe('a client account (the Client portal only)', () => {
  it('never reaches a staff route; a staff account never the portal', async () => {
    for (const path of ['/training/me', '/training/catalogue', `/training/courses/${staff.id}`, `/training/lessons/${staff.lessons[0]!.id}`, `/training/files/${staff.resourceId}`, '/training/access']) {
      expect((await call('client', 'GET', path)).status, path).toBe(403);
    }
    const staffOnPortal = await call('ana', 'GET', '/portal/training');
    expect(staffOnPortal.status).toBe(403);
    expect((await call('ana', 'GET', `/portal/training/courses/${clientCourse.id}`)).status).toBe(403);
  });

  it('sees only courses for clients; staff content is “not found” through every portal route', async () => {
    const mine = await data<PortalTraining>(call('client', 'GET', '/portal/training'));
    expect(mine.catalogue.map((c) => c.id)).toEqual([clientCourse.id]);
    expect(mine.tour).toEqual({ show: false });
    for (const path of [`/portal/training/courses/${staff.id}`, `/portal/training/lessons/${staff.lessons[0]!.id}`, `/portal/training/files/${staff.resourceId}`, `/portal/training/files/${staff.imageId}`, `/portal/training/files/${signatureId}`, `/portal/training/courses/${draft.id}`]) {
      expect((await call('client', 'GET', path)).status, path).toBe(404);
    }
    expect((await call('client', 'POST', `/portal/training/courses/${staff.id}/start`)).status).toBe(404);
    expect((await call('client', 'POST', `/portal/training/lessons/${staff.lessons[2]!.id}/attempts`)).status).toBe(404);
    expect((await call('client', 'POST', `/portal/training/courses/${staff.id}/feedback`, { kind: 'QUESTION', body: 'Hi' })).status).toBe(404);
  });

  it('takes a client course: its pictures open in the browser; staff can’t open it, a manager can', async () => {
    const d = await data<CourseDetail>(call('client', 'POST', `/portal/training/courses/${clientCourse.id}/start`));
    expect(d.mine.status).toBe('IN_PROGRESS');
    const lesson = await data<LessonView>(call('client', 'GET', `/portal/training/lessons/${clientCourse.lessons[0]!.id}`));
    expect(lesson.steps[0]!.image?.fileId).toBe(clientCourse.imageId);
    const pic = await raw('client', 'GET', `/portal/training/files/${clientCourse.imageId}`);
    expect(pic.statusCode).toBe(200);
    expect(pic.headers['content-type']).toBe('image/png');
    expect(String(pic.headers['content-disposition'])).toMatch(/^inline;/);
    expect(pic.headers['x-content-type-options']).toBe('nosniff');
    expect(pic.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(pic.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(pic.rawPayload).equals(PNG)).toBe(true);
    expect((await call('ana', 'GET', `/training/files/${clientCourse.imageId}`)).status).toBe(404);
    expect((await raw('amy', 'GET', `/training/files/${clientCourse.imageId}`)).statusCode).toBe(200);
    const done = await data<LessonDone>(call('client', 'POST', `/portal/training/lessons/${clientCourse.lessons[0]!.id}/complete`));
    expect(done).toMatchObject({ courseCompleted: true, courseProgressPct: 100, certificateId: null });
    const summary = await data<{ assigned: number; overdue: number; inProgress: number }>(call('client', 'GET', '/portal/training/summary'));
    expect(summary).toMatchObject({ assigned: 0, overdue: 0, inProgress: 0 });
    expect((await data<PortalTraining>(call('client', 'GET', '/portal/training'))).completed.map((c) => c.id)).toEqual([clientCourse.id]);
  });
});

describe('progress, order and completion (a course in order, with a certificate)', () => {
  it('lessons open in order; progress is saved and read back (resume)', async () => {
    const [g, v] = staff.lessons;
    const locked = await call('ana', 'GET', `/training/lessons/${v!.id}`);
    expect(locked.status).toBe(409);
    expect(locked.body.error?.code).toBe('LESSON_LOCKED');
    const guide = await data<LessonView>(call('ana', 'GET', `/training/lessons/${g!.id}`));
    expect(guide.steps.map((s) => s.title)).toEqual(['Step one', 'Step two']);
    expect(guide.nextLessonId).toBe(v!.id);
    await data(call('ana', 'PUT', `/training/lessons/${g!.id}/progress`, { stepIndex: 1 }));
    expect((await data<LessonView>(call('ana', 'GET', `/training/lessons/${g!.id}`))).progress.stepIndex).toBe(1);
    expect((await call('ana', 'PUT', `/training/lessons/${g!.id}/progress`, { stepIndex: 5 })).status).toBe(400);
    expect((await call('ana', 'PUT', `/training/lessons/${g!.id}/progress`, { watchedPct: 140 })).status).toBe(400);
    const done = await data<LessonDone>(call('ana', 'POST', `/training/lessons/${g!.id}/complete`));
    expect(done).toEqual({ courseProgressPct: 33, courseCompleted: false, certificateId: null, nextLessonId: v!.id, moduleDone: null });
    const video = await data<LessonView>(call('ana', 'GET', `/training/lessons/${v!.id}`));
    expect(video.video).toEqual({ provider: 'YOUTUBE', videoId: 'dQw4w9WgXcQ', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(video.watchFallbackSeconds).toBe(120);
    await data(call('ana', 'PUT', `/training/lessons/${v!.id}/progress`, { videoSeconds: 42, videoDuration: 300, watchedPct: 14 }));
    expect((await data<LessonView>(call('ana', 'GET', `/training/lessons/${v!.id}`))).progress).toMatchObject({ videoSeconds: 42, watchedPct: 14, done: false });
    const course = await data<CourseDetail>(call('ana', 'GET', `/training/courses/${staff.id}`));
    expect(course.resumeLessonId).toBe(v!.id);
    expect(course.lessons.map((l) => [l.done, l.locked])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    expect(course.resources.map((r) => r.name)).toEqual(['guide.pdf']);
    expect(course.mine).toMatchObject({ status: 'IN_PROGRESS', progressPct: 33, enrolled: true, lastLessonId: v!.id });
    expect((await call('ana', 'POST', `/training/lessons/${staff.lessons[2]!.id}/complete`)).status).toBe(409);
    expect((await data<LessonDone>(call('ana', 'POST', `/training/lessons/${v!.id}/complete`))).courseProgressPct).toBe(66);
  });

  it('a quiz paper never holds the answers; marking is all or nothing; two attempts, the second passes and completes the course', async () => {
    const q = staff.lessons[2]!;
    const view = await call('ana', 'GET', `/training/lessons/${q.id}`);
    expect(view.status).toBe(200);
    expect(view.text).not.toMatch(/"correct"|feedback|explanation|Because B|Yes B/);
    expect((view.body.data as LessonView).quiz).toMatchObject({ passMark: 60, maxAttempts: 2, attemptsUsed: 0, questionCount: 3, canStart: true, openAttemptId: null });
    const started = await call('ana', 'POST', `/training/lessons/${q.id}/attempts`);
    expect(started.text).not.toMatch(/"correct"|feedback|explanation|"position"|Because B|Yes B/);
    const paper = started.body.data as AttemptPaper;
    expect(paper.questions).toHaveLength(3);
    const order = paper.questions.find((x) => x.kind === 'ORDER')!;
    const single = staff.questions.get('Pick B')!;
    const multiple = staff.questions.get('Pick A and C')!;
    const orderId = staff.questions.get('Put in order')!;
    // Save a draft, resume the same attempt.
    await data(call('ana', 'PUT', `/training/attempts/${paper.id}`, { answers: { [single]: [staff.options.get(single)!.find((o) => o.correct)!.id] } }));
    const again = await data<AttemptPaper>(call('ana', 'POST', `/training/lessons/${q.id}/attempts`));
    expect(again.id).toBe(paper.id);
    expect(again.answers[single]).toHaveLength(1);
    expect((await call('ana', 'PUT', `/training/attempts/${paper.id}`, { answers: { nope: ['x'] } })).status).toBe(400);
    expect((await call('ben', 'PUT', `/training/attempts/${paper.id}`, { answers: {} })).status).toBe(404);
    // First hand-in: SINGLE right, MULTIPLE half right, ORDER as handed out (never the right order) → 33.
    const wrongMulti = [staff.options.get(multiple)!.find((o) => o.correct)!.id];
    const first = await data<AttemptResult>(call('ana', 'POST', `/training/attempts/${paper.id}/submit`, { answers: { [single]: again.answers[single], [multiple]: wrongMulti, [orderId]: order.options.map((o) => o.id) } }));
    expect(first).toMatchObject({ scorePct: 33, passed: false, passMark: 60, attemptsLeft: 1, timedOut: false, courseCompleted: false, certificateId: null, answersShown: false });
    const single1 = first.questions.find((x) => x.id === single)!;
    expect(single1.right).toBe(true);
    // M9: not passed and attempts left — the chosen answer's feedback, never which are right or the explanation.
    expect(single1.explanation).toBeNull();
    expect(single1.options.some((o) => o.correct)).toBe(false);
    expect(single1.options.find((o) => o.text === 'B')?.feedback).toBe('Yes B');
    expect(single1.options.find((o) => o.text === 'A')?.feedback).toBeNull();
    expect(first.questions.find((x) => x.id === multiple)!.right).toBe(false);
    expect(first.questions.find((x) => x.id === orderId)!.right).toBe(false);
    // Handing in again returns the same result.
    expect((await data<AttemptResult>(call('ana', 'POST', `/training/attempts/${paper.id}/submit`, {}))).scorePct).toBe(33);
    expect((await data<AttemptResult>(call('ana', 'GET', `/training/attempts/${paper.id}`))).scorePct).toBe(33);
    // Second attempt: everything right → passed, the course is complete, a certificate.
    const second = await data<AttemptPaper>(call('ana', 'POST', `/training/lessons/${q.id}/attempts`));
    expect(second.id).not.toBe(paper.id);
    const passed = await data<AttemptResult>(call('ana', 'POST', `/training/attempts/${second.id}/submit`, { answers: rightAnswers(staff, [single, multiple, orderId]) }));
    expect(passed).toMatchObject({ scorePct: 100, passed: true, attemptsLeft: 0, courseCompleted: true, answersShown: true });
    expect(passed.questions.find((x) => x.id === single)!.explanation).toBe('Because B is right');
    expect(passed.certificateId).toBeTruthy();
    const none = await call('ana', 'POST', `/training/lessons/${q.id}/attempts`);
    expect(none.status).toBe(409);
    expect(none.body.error?.code).toBe('NO_ATTEMPTS_LEFT');
    const cert = await prisma.trainingCertificate.findUniqueOrThrow({ where: { id: passed.certificateId! } });
    expect(cert.code).toMatch(/^TC-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(cert).toMatchObject({ scorePct: 100, issuerTitle: 'Training lead', signatureFileId: signatureId, companyId: w.companies.A });
    expect(cert.issuerName).toBe('Amy Alphaonly');
    expect(cert.expiresAt).not.toBeNull();
    anaCert = { id: cert.id, code: cert.code };
    const me = await data<MyTraining>(call('ana', 'GET', '/training/me'));
    expect(me.completed.map((c) => c.id)).toContain(staff.id);
    expect(me.certificates.map((c) => c.code)).toEqual([cert.code]);
    expect(me.completed.find((c) => c.id === staff.id)!.mine).toMatchObject({ status: 'COMPLETED', progressPct: 100, certificate: { code: cert.code, status: 'VALID' } });
  });

  it('a double click completes once: one certificate', async () => {
    const lesson = quick.lessons[0]!.id;
    const [a, b] = await Promise.all([call('ben', 'POST', `/training/lessons/${lesson}/complete`), call('ben', 'POST', `/training/lessons/${lesson}/complete`)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await prisma.trainingCertificate.count({ where: { userId: w.people.ben, courseId: quick.id } })).toBe(1);
  });

  // 1.23.27 integration (MariaDB 11.8.9 like live, innodb_snapshot_isolation ON): with the lesson's progress row already
  // there (a step saved), both requests update it — Prisma's update()/upsert() read it first in their own transaction,
  // and MariaDB refused the later write (error 1020: a 500 for the second click).
  it('a double click on a lesson already part-way (its step saved) completes once, both answered', async () => {
    const twoSteps = await makeCourse('Two steps', { moduleKey: 'general' }, [{ kind: 'GUIDE', title: 'Two steps', steps: [{ title: 'First' }, { title: 'Second' }] }]);
    const lesson = twoSteps.lessons[0]!.id;
    for (let round = 0; round < 5; round++) {
      await prisma.trainingProgress.deleteMany({ where: { lessonId: lesson } });
      await prisma.trainingEnrolment.deleteMany({ where: { courseId: twoSteps.id } });
      await data(call('ben', 'PUT', `/training/lessons/${lesson}/progress`, { stepIndex: 0 }));
      const [a, b] = await Promise.all([call('ben', 'POST', `/training/lessons/${lesson}/complete`), call('ben', 'POST', `/training/lessons/${lesson}/complete`)]);
      expect([a.status, b.status, round]).toEqual([200, 200, round]);
      expect(await prisma.trainingProgress.count({ where: { lessonId: lesson, userId: w.people.ben, doneAt: { not: null } } })).toBe(1);
    }
  });
});

describe('certificates', () => {
  it('the public check answers only the course, the name, the dates and the status; unknown and malformed codes are “not found”', async () => {
    const res = await call(null, 'GET', `/training/verify/${anaCert.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    const v = res.body.data as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(['completedAt', 'courseTitle', 'expiresAt', 'issuedAt', 'learnerName', 'status']);
    expect(v).toMatchObject({ courseTitle: `Staff basics ${w.tag}`, learnerName: `Ana Alpha ${w.tag}`, status: 'VALID' });
    expect((await raw(null, 'GET', `/training/verify/${anaCert.code}`)).headers['cache-control']).toBe('no-store');
    expect((await call(null, 'GET', '/training/verify/TC-2345-6789-ABCD')).status).toBe(404);
    expect((await call(null, 'GET', '/training/verify/not-a-code')).status).toBe(404);
  });

  it('the PDF: the learner, managers in scope and administrators; nobody else', async () => {
    const own = await raw('ana', 'GET', `/training/certificates/${anaCert.id}/pdf`);
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(own.rawPayload).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await raw('admin', 'GET', `/training/certificates/${anaCert.id}/pdf`)).statusCode).toBe(200);
    expect((await raw('amy', 'GET', `/training/certificates/${anaCert.id}/pdf`)).statusCode).toBe(200);
    expect((await call('ben', 'GET', `/training/certificates/${anaCert.id}/pdf`)).status).toBe(404);
    expect((await call('client', 'GET', `/portal/training/certificates/${anaCert.id}/pdf`)).status).toBe(404);
    expect((await call('client', 'GET', `/training/certificates/${anaCert.id}/pdf`)).status).toBe(403);
    // A Training manager of Beta only can't open Ana's (Alpha) certificate.
    await prisma.user.update({ where: { id: w.people.bob }, data: { trainingManager: true } });
    expect((await call('bob', 'GET', `/training/certificates/${anaCert.id}/pdf`)).status).toBe(404);
    await prisma.user.update({ where: { id: w.people.bob }, data: { trainingManager: false } });
  });

  it('expiry → a retake (lessons count again); finishing again issues a new certificate and replaces the old', async () => {
    const cert = await prisma.trainingCertificate.findUniqueOrThrow({ where: { id: anaCert.id } });
    clockAt = new Date(cert.expiresAt!.getTime() + 24 * 3600 * 1000);
    try {
      const me = await data<MyTraining>(call('ana', 'GET', '/training/me'));
      const card = [...me.assigned, ...me.inProgress].find((c) => c.id === staff.id)!;
      expect(card.mine).toMatchObject({ status: 'RETAKE', progressPct: 0 });
      expect((await call('ana', 'GET', `/training/lessons/${staff.lessons[1]!.id}`)).body.error?.code).toBe('LESSON_LOCKED');
      await data(call('ana', 'POST', `/training/lessons/${staff.lessons[0]!.id}/complete`));
      await data(call('ana', 'POST', `/training/lessons/${staff.lessons[1]!.id}/complete`));
      // A fresh cycle: the attempts count again.
      const info = (await data<LessonView>(call('ana', 'GET', `/training/lessons/${staff.lessons[2]!.id}`))).quiz!;
      expect(info).toMatchObject({ attemptsUsed: 0, canStart: true, best: null });
      const p = await data<AttemptPaper>(call('ana', 'POST', `/training/lessons/${staff.lessons[2]!.id}/attempts`));
      const ids = p.questions.map((x) => x.id);
      const r = await data<AttemptResult>(call('ana', 'POST', `/training/attempts/${p.id}/submit`, { answers: rightAnswers(staff, ids) }));
      expect(r.courseCompleted).toBe(true);
      expect(r.certificateId).not.toBe(anaCert.id);
      const old = await prisma.trainingCertificate.findUniqueOrThrow({ where: { id: anaCert.id } });
      // M10: the old certificate isn't revoked — it stays expired.
      expect(old.revokedAt).toBeNull();
      expect((await data<{ status: string }>(call(null, 'GET', `/training/verify/${anaCert.code}`))).status).toBe('EXPIRED');
      expect((await data<CourseDetail>(call('ana', 'GET', `/training/courses/${staff.id}`))).mine.status).toBe('COMPLETED');
    } finally {
      clockAt = null;
    }
  });
});

describe('a quiz-only course (QUIZZES rule): a question bank and a time limit', () => {
  it('draws 2 of 3; time up: saving is refused and the saved answers are handed in; passing the quiz completes the course', async () => {
    const q = quizOnly.lessons[1]!.id;
    const start = new Date();
    clockAt = start;
    try {
      const p = await data<AttemptPaper>(call('cat', 'POST', `/training/lessons/${q}/attempts`));
      expect(p.questions).toHaveLength(2);
      expect(new Date(p.deadlineAt!).getTime() - new Date(p.startedAt).getTime()).toBe(10 * 60_000);
      const first = p.questions[0]!;
      const trueId = first.options.find((o) => o.text === 'True')!.id;
      await data(call('cat', 'PUT', `/training/attempts/${p.id}`, { answers: { [first.id]: [trueId] } }));
      clockAt = new Date(start.getTime() + 11 * 60_000);
      const late = await call('cat', 'PUT', `/training/attempts/${p.id}`, { answers: {} });
      expect(late.status).toBe(409);
      expect(late.body.error?.code).toBe('TIME_UP');
      const result = await data<AttemptResult>(call('cat', 'GET', `/training/attempts/${p.id}`));
      expect(result).toMatchObject({ timedOut: true, scorePct: 50, passed: false, attemptsLeft: null });
      expect(result.questions.find((x) => x.id === first.id)!.chosen).toEqual([trueId]);
      const p2 = await data<AttemptPaper>(call('cat', 'POST', `/training/lessons/${q}/attempts`));
      const answers = Object.fromEntries(p2.questions.map((x) => [x.id, [x.options.find((o) => o.text === 'True')!.id]]));
      const passed = await data<AttemptResult>(call('cat', 'POST', `/training/attempts/${p2.id}/submit`, { answers }));
      expect(passed).toMatchObject({ passed: true, scorePct: 100, courseCompleted: true, certificateId: null, timedOut: false });
      const detail = await data<CourseDetail>(call('cat', 'GET', `/training/courses/${quizOnly.id}`));
      expect(detail.mine.status).toBe('COMPLETED');
      expect(detail.lessons[0]!.done).toBe(false); // the reading wasn't needed
    } finally {
      clockAt = null;
    }
  });
});

describe('assigned training in My training', () => {
  it('an assignment shows first, mandatory and overdue; the badge counts it; Learn this feature opens it', async () => {
    const a = await prisma.trainingAssignment.create({
      // Made today with a due day already past (the API refuses that; the database doesn't): Ana is there from the start.
      data: { courseId: quick.id, targetKind: 'USER', targetId: w.people.ana, mandatory: true, dueDay: shiftDayKey(todayKey(TZ), -2), createdById: w.people.admin },
    });
    await sync.assignments([a.id]);
    const me = await data<MyTraining>(call('ana', 'GET', '/training/me'));
    expect(me.assigned.map((c) => c.id)).toEqual([quick.id]);
    expect(me.assigned[0]!.mine).toMatchObject({ assigned: true, mandatory: true, overdue: true, status: 'NOT_STARTED' });
    expect(me.counts).toMatchObject({ assigned: 1, notStarted: 1, overdue: 1 });
    expect((await data<TrainingAccess>(call('ana', 'GET', '/training/access'))).overdue).toBe(1);
    expect((await data<{ courseId: string }>(call('ana', 'GET', '/training/learn?module=general'))).courseId).toBe(quick.id);
  });
});

describe('feedback', () => {
  it('a question tells the Training manager of the asker’s company (never the asker); answered questions show to colleagues without names', async () => {
    notices.length = 0;
    const item = await data<{ id: string; status: string; byName: string | null }>(call('ana', 'POST', `/training/courses/${staff.id}/feedback`, { kind: 'QUESTION', body: 'Where is the board?' }), 201);
    expect(item).toMatchObject({ status: 'OPEN', byName: null });
    expect(notices.map((n) => [n.userId, n.type, n.entityType, n.entityId])).toEqual([[w.people.amy, 'TRAINING_QUESTION', 'training-feedback', item.id]]);
    expect((await data<CourseDetail>(call('ben', 'GET', `/training/courses/${staff.id}`))).questions).toEqual([]);
    expect((await data<CourseDetail>(call('ana', 'GET', `/training/courses/${staff.id}`))).questions.map((q) => [q.question, q.mine])).toEqual([['Where is the board?', true]]);
    await prisma.trainingFeedback.update({ where: { id: item.id }, data: { status: 'ANSWERED', answer: 'In the side menu.', answeredAt: new Date() } });
    // M16: answered questions show to colleagues (Cat shares Alpha with Ana), never across companies (Ben: Beta only).
    expect((await data<CourseDetail>(call('ben', 'GET', `/training/courses/${staff.id}`))).questions).toEqual([]);
    const seen = (await data<CourseDetail>(call('cat', 'GET', `/training/courses/${staff.id}`))).questions;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ question: 'Where is the board?', answer: 'In the side menu.', mine: false });
    expect(JSON.stringify(seen)).not.toMatch(/Ana/);
    expect((await call('ana', 'POST', `/training/courses/${staff.id}/feedback`, { kind: 'QUESTION', body: '' })).status).toBe(400);
    expect((await call('ana', 'POST', `/training/courses/${staff.id}/feedback`, { kind: 'OUTDATED', lessonId: adminCourse.lessons[0]!.id })).status).toBe(404);
  });

  it('a rating: one per person (changed, not added); a client’s question reaches the Training managers of their projects’ companies, and the client gets no notice', async () => {
    await data(call('ben', 'POST', `/training/courses/${quick.id}/feedback`, { kind: 'RATING', rating: 2 }), 201);
    await data(call('ben', 'POST', `/training/courses/${quick.id}/feedback`, { kind: 'RATING', rating: 4, body: 'Good' }), 201);
    expect(await prisma.trainingFeedback.count({ where: { courseId: quick.id, userId: w.people.ben, kind: 'RATING' } })).toBe(1);
    const d = await data<CourseDetail>(call('ben', 'GET', `/training/courses/${quick.id}`));
    expect(d.myRating).toBe(4);
    expect(d.rating).toEqual({ average: 4, count: 1 });
    expect((await call('ben', 'POST', `/training/courses/${quick.id}/feedback`, { kind: 'RATING', rating: 6 })).status).toBe(400);
    notices.length = 0;
    await data(call('client', 'POST', `/portal/training/courses/${clientCourse.id}/feedback`, { kind: 'QUESTION', body: 'How do I sign off?' }), 201);
    expect(notices.map((n) => n.userId)).toEqual([w.people.amy]);
    expect(notices.some((n) => n.userId === clientId)).toBe(false);
  });
});

describe('the first-time tour', () => {
  it('for accounts made after the launch, until done; a company can switch it off', async () => {
    // Launched just after Ana's account was made (and before the newcomer's).
    const anaMade = (await prisma.user.findUniqueOrThrow({ where: { id: w.people.ana }, select: { createdAt: true } })).createdAt;
    const launched = new Date(anaMade.getTime() + 1).toISOString();
    await prisma.systemSetting.upsert({ where: { key: 'training.launchedAt' }, create: { key: 'training.launchedAt', value: launched }, update: { value: launched } });
    await prisma.systemSetting.deleteMany({ where: { key: 'training.tour' } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    newcomerId = (
      await prisma.user.create({
        data: { email: `newcomer.${w.tag}@world.test`, username: `newcomer_${w.tag}`, passwordHash: 'x', firstName: 'New', lastName: 'Comer', roles: { create: { roleId: role.id } }, primaryCompanyId: w.companies.A, companies: { create: { companyId: w.companies.A } } },
      })
    ).id;
    expect((await data<TrainingAccess>(call('newcomer', 'GET', '/training/access'))).tour).toEqual({ show: true });
    expect((await data<TrainingAccess>(call('ana', 'GET', '/training/access'))).tour).toEqual({ show: false });
    await prisma.systemSetting.create({ data: { key: 'training.tour', value: { off: [w.companies.A] } } });
    expect((await data<TrainingAccess>(call('newcomer', 'GET', '/training/access'))).tour).toEqual({ show: false });
    await prisma.systemSetting.deleteMany({ where: { key: 'training.tour' } });
    expect(await data(call('newcomer', 'PUT', '/training/tour', { done: true }))).toEqual({ ok: true });
    expect((await data<TrainingAccess>(call('newcomer', 'GET', '/training/access'))).tour).toEqual({ show: false });
    await data(call('newcomer', 'PUT', '/training/tour', { done: false }));
    expect((await data<TrainingAccess>(call('newcomer', 'GET', '/training/access'))).tour).toEqual({ show: true });
    const access = await data<TrainingAccess>(call('amy', 'GET', '/training/access'));
    expect(access).toMatchObject({ learner: true, manager: true, admin: false, teamReports: false });
  });
});

describe('the public check is rate limited', () => {
  it('30 a minute per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await call(null, 'GET', `/training/verify/${anaCert.code}`)).status);
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(30);
  });
});
