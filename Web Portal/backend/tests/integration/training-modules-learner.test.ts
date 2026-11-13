import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import type { AuthGuard } from '../../src/modules/auth/auth-guard';
import { trainingContext, type TrainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { createTrainingLearner } from '../../src/modules/training/training-learner';
import { createTrainingManage } from '../../src/modules/training/training-manage';
import { registerTrainingRoutes } from '../../src/modules/training/training-routes';
import { registerPortalTrainingRoutes } from '../../src/modules/training/portal-training-routes';
import type { CourseDetail } from '../../src/modules/training/training-types';

// Requires a running MySQL / MariaDB (TEST_DATABASE_URL) with migrations applied.
// Learning Hub as one course (1.23.30), the learner side: the course page lists the person's modules in order with
// their states and the lesson each goes on with; Continue opens the first unfinished module where they stopped;
// previous / next walk the person's own lessons (a hidden module's are skipped); a hidden module's lesson is "not
// found" (a Training manager may read it, never take it); Learn this feature points at the module; an old short
// course's link (or one of its lessons removed as a duplicate) answers COURSE_MOVED with where it lives now; and
// certificates carry the completion day, the name and the check link.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const PNG = readFileSync(resolve(__dirname, '../../assets/logo-pdf.png'));
/** The conversion's record, under a key of this file's own (the site's `training.oneCourse` is never touched). */
const RECORD_KEY = `training.oneCourse.test-${randomBytes(4).toString('hex')}`;

let w: CompanyWorld;
let app: FastifyInstance;
let clientId: string;
const courseIds: string[] = [];
const extraUsers: string[] = [];
const filesDir = join(mkdtempSync(join(tmpdir(), 'tmodl-')), 'training-files');
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(filesDir),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  notify: async () => {},
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
let peopleReads = 0;
const counted: TrainingContext = {
  ...ctx,
  people: (ids) => {
    peopleReads++;
    return ctx.people(ids);
  },
};
const sync = createTrainingSync(counted);
const learner = createTrainingLearner(counted, sync, { oneCourseKey: RECORD_KEY });

// ── Module courses made directly in the database ──
type LessonKind = 'GUIDE' | 'QUIZ' | 'VIDEO';
interface LessonSpec {
  kind: LessonKind;
  steps?: number;
  picture?: boolean;
}
interface ModSpec {
  key: string;
  title: string;
  moduleKey: string;
  lessons?: (LessonKind | LessonSpec)[];
}
interface MadeModule {
  id: string;
  title: string;
  lessons: string[];
  guides: string[];
  quiz: string | null;
  picture: string | null;
  /** A video lesson still waiting for its link (R2). */
  video: string | null;
}
interface MadeCourse {
  id: string;
  m: Record<string, MadeModule>;
  loose: string[];
  /** question id → its right option id */
  right: Map<string, string>;
}
let position = 0;
async function lessonOf(courseId: string, moduleId: string | null, title: string, spec: LessonSpec, c: MadeCourse) {
  let picture: string | null = null;
  if (spec.picture) {
    const storageKey = await ctx.files.save(PNG, 'image/png');
    picture = (await prisma.trainingFile.create({ data: { courseId, kind: 'IMAGE', name: 'step.png', mimeType: 'image/png', sizeBytes: PNG.length, storageKey } })).id;
  }
  const steps = Array.from({ length: spec.steps ?? 1 }, (_, i) => ({ position: i, title: `Step ${i + 1}`, body: '<p>Read</p>', ...(i === 0 && picture ? { imageFileId: picture } : {}) }));
  const lesson = await prisma.trainingLesson.create({
    data: { courseId, moduleId, position: position++, kind: spec.kind, title, minutes: 3, ...(spec.kind === 'GUIDE' ? { steps: { create: steps } } : {}) },
  });
  if (spec.kind === 'QUIZ') {
    const quiz = await prisma.trainingQuiz.create({ data: { lessonId: lesson.id, passMark: 70, maxAttempts: null } });
    const q = await prisma.trainingQuestion.create({
      data: { quizId: quiz.id, position: 0, kind: 'SINGLE', prompt: `${title}: pick B`, options: { create: [{ position: 0, text: 'A', correct: false }, { position: 1, text: 'B', correct: true }] } },
      include: { options: true },
    });
    c.right.set(q.id, q.options.find((x) => x.correct)!.id);
  }
  return { id: lesson.id, picture };
}
async function makeModuleCourse(title: string, mods: ModSpec[], o: Record<string, unknown> = {}, loose: LessonKind[] = []): Promise<MadeCourse> {
  const course = await prisma.trainingCourse.create({
    data: { title: `${title} ${w.tag}`, moduleKey: 'general', audience: 'STAFF', difficulty: 'BEGINNER', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 60 * 86_400_000), certificateOn: true, ...o } as never,
  });
  courseIds.push(course.id);
  const made: MadeCourse = { id: course.id, m: {}, loose: [], right: new Map() };
  for (const [i, spec] of mods.entries()) {
    const mod = await prisma.trainingModule.create({ data: { courseId: course.id, position: i + 1, title: spec.title, moduleKey: spec.moduleKey } });
    const mm: MadeModule = { id: mod.id, title: spec.title, lessons: [], guides: [], quiz: null, picture: null, video: null };
    for (const [n, raw] of (spec.lessons ?? ['GUIDE', 'QUIZ']).entries()) {
      const ls = typeof raw === 'string' ? { kind: raw } : raw;
      const l = await lessonOf(course.id, mod.id, `${spec.title} ${ls.kind.toLowerCase()} ${n + 1}`, ls, made);
      mm.lessons.push(l.id);
      if (ls.kind === 'GUIDE') mm.guides.push(l.id);
      if (ls.kind === 'QUIZ') mm.quiz = l.id;
      mm.picture ??= l.picture;
      if (ls.kind === 'VIDEO') mm.video = l.id;
    }
    made.m[spec.key] = mm;
  }
  for (const [n, kind] of loose.entries()) made.loose.push((await lessonOf(course.id, null, `Loose ${kind.toLowerCase()} ${n + 1}`, { kind }, made)).id);
  return made;
}

async function passQuiz(userId: string, c: MadeCourse, lessonId: string) {
  const paper = await learner.startAttempt(userId, 'staff', lessonId);
  const answers = Object.fromEntries(paper.questions.map((q) => [q.id, [c.right.get(q.id)!]]));
  return learner.submit(userId, 'staff', paper.id, { answers });
}
async function finishModule(userId: string, c: MadeCourse, key: string) {
  const mm = c.m[key]!;
  for (const g of mm.guides) await learner.complete(userId, 'staff', g);
  return mm.quiz ? passQuiz(userId, c, mm.quiz) : null;
}
async function newPerson(name: string) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
  const u = await prisma.user.create({
    data: {
      email: `${name}.${w.tag}@world.test`,
      username: `${name}_${w.tag}`,
      passwordHash: 'x',
      firstName: name.charAt(0).toUpperCase() + name.slice(1),
      lastName: w.tag,
      roles: { create: { roleId: r.id } },
      primaryCompanyId: w.companies.A,
      companies: { create: { companyId: w.companies.A } },
    },
  });
  extraUsers.push(u.id);
  return u.id;
}
/** A rejected call's error, for its status, code and details. */
async function failure(p: Promise<unknown>): Promise<{ status?: number; code?: string; message?: string; details?: unknown }> {
  try {
    await p;
  } catch (err) {
    return err as { status?: number; code?: string; message?: string; details?: unknown };
  }
  throw new Error('expected the call to fail');
}

const FOUR: ModSpec[] = [
  { key: 'gs', title: 'Getting started', moduleKey: 'general' },
  { key: 'tasks', title: 'Tasks', moduleKey: 'tasks', lessons: ['GUIDE', { kind: 'GUIDE', steps: 2 }, 'QUIZ'] },
  { key: 'reports', title: 'Reports', moduleKey: 'reports', lessons: [{ kind: 'GUIDE', picture: true }, 'QUIZ', 'VIDEO'] },
  { key: 'admin', title: 'Admin settings', moduleKey: 'admin' },
];

let main: MadeCourse;
/** Tasks → Reports (admins) → Chat, then a lesson with no module. */
let walk: MadeCourse;

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  clientId = (await prisma.user.create({ data: { email: `mlclient.${w.tag}@world.test`, username: `mlclient_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } })).id;
  extraUsers.push(clientId);
  await prisma.clientProjectGrant.create({ data: { userId: clientId, projectId: w.projects.PA, progress: true } });
  main = await makeModuleCourse('MICO360 Tasks User Training', FOUR);
  walk = await makeModuleCourse(
    'Walk',
    [
      { key: 'tasks', title: 'Tasks', moduleKey: 'tasks' },
      { key: 'reports', title: 'Reports', moduleKey: 'reports' },
      { key: 'chat', title: 'Chat', moduleKey: 'chat' },
    ],
    { certificateOn: false },
    ['GUIDE'],
  );

  // The routes as the website calls them (the signed-in person from a header; errors as the server sends them).
  const guard = {
    async authenticate(req: FastifyRequest) {
      req.user = { id: String(req.headers['x-user']), roles: [] };
    },
  } as unknown as AuthGuard;
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    return reply.status(500).send({ error: { code: 'ERROR', message: (err as Error).message } });
  });
  await app.register(rateLimit, { global: false });
  await app.register(
    async (api) => {
      const deps = { learner, guard };
      await registerTrainingRoutes(api, deps);
      await registerPortalTrainingRoutes(api, deps);
    },
    { prefix: '/api/v1' },
  );
});

afterAll(async () => {
  const users = [...Object.values(w.people), ...extraUsers];
  const where = { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] };
  await prisma.systemSetting.deleteMany({ where: { key: RECORD_KEY } });
  await prisma.trainingModuleDone.deleteMany({ where });
  await prisma.trainingFeedback.deleteMany({ where });
  await prisma.trainingAttempt.deleteMany({ where });
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingAssignee.deleteMany({ where });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingFile.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: extraUsers } } });
  await prisma.clientProjectGrant.deleteMany({ where: { userId: { in: extraUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('the course page by module', () => {
  it('course detail lists only the person’s modules, in order, with states', async () => {
    const dana = await newPerson('dana');
    const gs = main.m.gs!;
    const tasks = main.m.tasks!;
    let d = await learner.course(dana, 'staff', main.id);
    expect(d.modules.map((m) => [m.id, m.title, m.status])).toEqual([
      [gs.id, 'Getting started', 'NOT_STARTED'],
      [tasks.id, 'Tasks', 'NOT_STARTED'],
    ]);
    expect(d.modules[0]).toEqual({ id: gs.id, title: 'Getting started', position: 1, status: 'NOT_STARTED', lessonsDone: 0, lessonCount: 2, minutes: 6, doneAt: null, newForRole: false, nextLessonId: gs.lessons[0], lessonIds: gs.lessons });
    expect(d.modules[1]).toMatchObject({ lessonCount: 3, minutes: 9, nextLessonId: tasks.lessons[0], lessonIds: tasks.lessons });
    // Only their lessons (Reports and Admin settings aren't sent), each with its module.
    expect(d.lessons.map((l) => [l.id, l.moduleId])).toEqual([...gs.lessons.map((id) => [id, gs.id]), ...tasks.lessons.map((id) => [id, tasks.id])]);
    expect(d).toMatchObject({ lessonCount: 5, minutes: 15, resumeLessonId: gs.lessons[0] });
    expect(d.mine).toMatchObject({ status: 'NOT_STARTED', lessonsDone: 0, modules: { done: 0, total: 2 }, newForRole: 0, nextLessonId: gs.lessons[0] });
    expect(d.mine.next).toEqual({ lessonId: gs.lessons[0], lessonTitle: 'Getting started guide 1', moduleTitle: 'Getting started' });

    const done = await learner.complete(dana, 'staff', gs.guides[0]!);
    expect(done).toMatchObject({ courseCompleted: false, nextLessonId: gs.quiz, moduleDone: null });
    d = await learner.course(dana, 'staff', main.id);
    expect(d.modules[0]).toMatchObject({ status: 'IN_PROGRESS', lessonsDone: 1, lessonCount: 2, doneAt: null, nextLessonId: gs.quiz });
    expect(d.mine).toMatchObject({ status: 'IN_PROGRESS', progressPct: 0, lessonsDone: 1, modules: { done: 0, total: 2 } });

    // Passing the module's quiz finishes the module: the result says so (once).
    const result = await passQuiz(dana, main, gs.quiz!);
    expect(result).toMatchObject({ passed: true, courseCompleted: false, moduleDone: { id: gs.id, title: 'Getting started' } });
    expect(await learner.result(dana, 'staff', result.id)).toMatchObject({ moduleDone: null });
    d = await learner.course(dana, 'staff', main.id);
    expect(d.modules[0]).toMatchObject({ status: 'DONE', lessonsDone: 2, nextLessonId: null });
    expect(d.modules[0]!.doneAt).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT/));
    expect(d.modules[1]).toMatchObject({ status: 'NOT_STARTED', nextLessonId: tasks.lessons[0] });
    expect(d.mine).toMatchObject({ progressPct: 50, lessonsDone: 2, modules: { done: 1, total: 2 }, nextLessonId: tasks.lessons[0] });
    expect(d.mine.next).toEqual({ lessonId: tasks.lessons[0], lessonTitle: 'Tasks guide 1', moduleTitle: 'Tasks' });
    // The card in the catalogue and in My training says the same.
    const card = (await learner.catalogue(dana, 'staff', {})).courses.find((c) => c.id === main.id)!;
    expect(card).toMatchObject({ lessonCount: 5, minutes: 15 });
    expect(card.mine).toMatchObject({ modules: { done: 1, total: 2 }, lessonsDone: 2, next: { lessonId: tasks.lessons[0], moduleTitle: 'Tasks' } });
    const mine = (await learner.me(dana, 'staff')).inProgress.find((c) => c.id === main.id)!;
    expect(mine.mine.modules).toEqual({ done: 1, total: 2 });

    // The quiz first, then the guides: the last guide done finishes the module (LessonDone says which).
    await passQuiz(dana, main, tasks.quiz!);
    expect((await learner.complete(dana, 'staff', tasks.guides[0]!)).moduleDone).toBeNull();
    const last = await learner.complete(dana, 'staff', tasks.guides[1]!);
    expect(last).toMatchObject({ courseCompleted: true, moduleDone: { id: tasks.id, title: 'Tasks' } });
    d = await learner.course(dana, 'staff', main.id);
    expect(d.mine).toMatchObject({ status: 'COMPLETED', modules: { done: 2, total: 2 }, newForRole: 0 });
    expect(d.modules.map((m) => m.status)).toEqual(['DONE', 'DONE']);
  });

  it('a plain course keeps its plain shape (no modules, the next lesson without a module)', async () => {
    const plain = await prisma.trainingCourse.create({ data: { title: `Plain ${w.tag}`, moduleKey: 'general', audience: 'STAFF', status: 'PUBLISHED', publishedAt: new Date() } });
    courseIds.push(plain.id);
    const one = await prisma.trainingLesson.create({ data: { courseId: plain.id, kind: 'GUIDE', title: 'One', position: 0, steps: { create: [{ position: 0, title: 'S', body: '<p>S</p>' }] } } });
    const d = await learner.course(w.people.ben, 'staff', plain.id);
    expect(d.modules).toEqual([]);
    expect(d.lessons.map((l) => l.moduleId)).toEqual([null]);
    expect(d.mine).toMatchObject({ modules: null, newForRole: 0, lessonsDone: 0, next: { lessonId: one.id, lessonTitle: 'One', moduleTitle: null } });
    expect((await learner.lesson(w.people.ben, 'staff', one.id)).module).toBeNull();
  });

  it('“Other lessons”: lessons with no module come last, under their own heading', async () => {
    const ben = w.people.ben;
    const d = await learner.course(ben, 'staff', walk.id);
    expect(d.modules.map((m) => [m.id, m.title])).toEqual([
      [walk.m.tasks!.id, 'Tasks'],
      [walk.m.chat!.id, 'Chat'],
      ['other', 'Other lessons'],
    ]);
    expect(d.modules[2]).toMatchObject({ lessonIds: walk.loose, lessonCount: 1, nextLessonId: walk.loose[0] });
    expect(d.lessons.find((l) => l.id === walk.loose[0])!.moduleId).toBeNull();
    const v = await learner.lesson(ben, 'staff', walk.loose[0]!);
    expect(v.module).toEqual({ id: 'other', title: 'Other lessons', lessonIndex: 1, lessonCount: 1 });
  });
});

describe('Continue and the lesson view', () => {
  it('Continue opens the next unfinished module where they stopped', async () => {
    const eli = await newPerson('eli');
    const tasks = main.m.tasks!;
    await finishModule(eli, main, 'gs');
    await learner.lesson(eli, 'staff', tasks.lessons[1]!);
    await learner.saveProgress(eli, 'staff', tasks.lessons[1]!, { stepIndex: 1 });
    const d = await learner.course(eli, 'staff', main.id);
    expect(d.resumeLessonId).toBe(tasks.lessons[1]);
    expect(d.modules[1]).toMatchObject({ status: 'NOT_STARTED', nextLessonId: tasks.lessons[1] });
    expect(d.mine).toMatchObject({ nextLessonId: tasks.lessons[1], next: { lessonId: tasks.lessons[1], lessonTitle: 'Tasks guide 2', moduleTitle: 'Tasks' } });
    const v = await learner.lesson(eli, 'staff', tasks.lessons[1]!);
    expect(v.progress.stepIndex).toBe(1);
    expect(v.module).toEqual({ id: tasks.id, title: 'Tasks', lessonIndex: 2, lessonCount: 3 });
    expect(v).toMatchObject({ prevLessonId: tasks.lessons[0], nextLessonId: tasks.lessons[2], lessonCount: 5 });
  });

  it('next lesson skips hidden modules', async () => {
    const fay = await newPerson('fay');
    const { tasks, reports, chat } = walk.m as Record<'tasks' | 'reports' | 'chat', MadeModule>;
    const v = await learner.lesson(fay, 'staff', tasks.quiz!);
    expect(v.nextLessonId).toBe(chat.lessons[0]);
    expect(v.module).toMatchObject({ id: tasks.id, lessonIndex: 2, lessonCount: 2 });
    const back = await learner.lesson(fay, 'staff', chat.lessons[0]!);
    expect(back.prevLessonId).toBe(tasks.quiz);
    await learner.complete(fay, 'staff', tasks.guides[0]!);
    const result = await passQuiz(fay, walk, tasks.quiz!);
    expect(result.moduleDone).toEqual({ id: tasks.id, title: 'Tasks' });
    // An administrator sees Reports in between.
    expect((await learner.lesson(w.people.admin, 'staff', tasks.quiz!)).nextLessonId).toBe(reports.lessons[0]);
    // Done on a guide: LessonDone's next lesson skips Reports too.
    const pat = await newPerson('pat');
    await passQuiz(pat, walk, tasks.quiz!);
    expect(await learner.complete(pat, 'staff', tasks.guides[0]!)).toMatchObject({ nextLessonId: tasks.quiz, moduleDone: { id: tasks.id, title: 'Tasks' } });
    const chatDone = await learner.complete(pat, 'staff', chat.guides[0]!);
    expect(chatDone.nextLessonId).toBe(chat.quiz);
  });
});

describe('a module hidden from the person', () => {
  it('a hidden module’s lesson is refused', async () => {
    const gil = await newPerson('gil');
    const reports = main.m.reports!;
    for (const call of [
      () => learner.lesson(gil, 'staff', reports.guides[0]!),
      () => learner.saveProgress(gil, 'staff', reports.guides[0]!, { stepIndex: 0 }),
      () => learner.complete(gil, 'staff', reports.guides[0]!),
      () => learner.complete(gil, 'staff', reports.quiz!),
      () => learner.startAttempt(gil, 'staff', reports.quiz!),
      () => learner.file(gil, 'staff', reports.picture!),
    ]) {
      expect(await failure(call())).toMatchObject({ status: 404 });
    }
    expect((await failure(learner.lesson(gil, 'staff', reports.guides[0]!))).message).toBe('Lesson not found.');
    expect(await prisma.trainingProgress.count({ where: { userId: gil } })).toBe(0);
    expect(await prisma.trainingAttempt.count({ where: { userId: gil } })).toBe(0);

    // A Training manager (not an administrator) may read it, never take it.
    const amy = w.people.amy;
    const v = await learner.lesson(amy, 'staff', reports.guides[0]!);
    expect(v).toMatchObject({ id: reports.guides[0], module: { id: reports.id, title: 'Reports', lessonIndex: 1, lessonCount: 2 } });
    expect((await learner.file(amy, 'staff', reports.picture!)).mimeType).toBe('image/png');
    for (const call of [
      () => learner.complete(amy, 'staff', reports.guides[0]!),
      () => learner.saveProgress(amy, 'staff', reports.guides[0]!, { stepIndex: 0 }),
      () => learner.startAttempt(amy, 'staff', reports.quiz!),
    ]) {
      expect(await failure(call())).toMatchObject({ status: 409, code: 'NOT_FOR_YOU' });
    }
    expect(await prisma.trainingProgress.count({ where: { userId: amy, lessonId: { in: reports.lessons } } })).toBe(0);
    expect(await prisma.trainingAttempt.count({ where: { userId: amy, lessonId: { in: reports.lessons } } })).toBe(0);
    expect((await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId: amy, courseId: main.id } } }))?.lastLessonId ?? null).not.toBe(reports.guides[0]);
    // Her own modules are hers to take.
    await expect(learner.complete(amy, 'staff', main.m.gs!.guides[0]!)).resolves.toMatchObject({ courseCompleted: false });

    // An administrator sees Reports: an ordinary lesson.
    expect((await learner.lesson(w.people.admin, 'staff', reports.guides[0]!)).module).toMatchObject({ id: reports.id });
    expect((await learner.file(w.people.admin, 'staff', reports.picture!)).mimeType).toBe('image/png');
  });
});

describe('a module hidden from the person: every way in (fix round 1)', () => {
  it('an unlinked video in a hidden module is refused on every learn call (learner 404, manager NOT_FOR_YOU)', async () => {
    const reports = main.m.reports!;
    const max = await newPerson('max');
    for (const call of [() => learner.saveProgress(max, 'staff', reports.video!, { videoSeconds: 5 }), () => learner.complete(max, 'staff', reports.video!)]) {
      expect(await failure(call())).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Lesson not found.' });
    }
    const amy = w.people.amy;
    for (const call of [() => learner.saveProgress(amy, 'staff', reports.video!, { videoSeconds: 5 }), () => learner.complete(amy, 'staff', reports.video!)]) {
      expect(await failure(call())).toMatchObject({ status: 409, code: 'NOT_FOR_YOU' });
    }
    expect(await prisma.trainingProgress.count({ where: { lessonId: reports.video! } })).toBe(0);
    expect(await prisma.trainingEnrolment.count({ where: { courseId: main.id, lastLessonId: reports.video! } })).toBe(0);
    // Reading it stays "not found" for everyone (R2); where the module is theirs, R2 is unchanged.
    expect(await failure(learner.lesson(amy, 'staff', reports.video!))).toMatchObject({ status: 404 });
    expect(await failure(learner.complete(w.people.admin, 'staff', reports.video!))).toMatchObject({ status: 409, code: 'NO_VIDEO' });
  });

  it('feedback about a hidden module’s lesson is refused (a Training manager may still send it)', async () => {
    const reports = main.m.reports!;
    const ned = await newPerson('ned');
    for (const body of [
      { kind: 'QUESTION', body: 'How do I filter?', lessonId: reports.guides[0] },
      { kind: 'OUTDATED', body: 'The button moved.', lessonId: reports.guides[0] },
      { kind: 'RATING', rating: 4, lessonId: reports.guides[0] },
      { kind: 'OUTDATED', body: 'No link yet.', lessonId: reports.video },
    ]) {
      expect(await failure(learner.feedback(ned, 'staff', main.id, body))).toMatchObject({ status: 404, message: 'Lesson not found.' });
    }
    expect(await prisma.trainingFeedback.count({ where: { userId: ned } })).toBe(0);
    // Their own lesson is fine.
    expect(await learner.feedback(ned, 'staff', main.id, { kind: 'QUESTION', body: 'Where is it?', lessonId: main.m.gs!.guides[0] })).toMatchObject({ lessonId: main.m.gs!.guides[0], lessonTitle: 'Getting started guide 1' });
    // A Training manager previewing the module may report it.
    expect(await learner.feedback(w.people.amy, 'staff', main.id, { kind: 'OUTDATED', body: 'Check this.', lessonId: reports.guides[0] })).toMatchObject({ lessonId: reports.guides[0], lessonTitle: 'Reports guide 1' });
  });

  it('after a role shrinks, the card never names a lesson of a module they no longer see', async () => {
    const ola = await newPerson('ola');
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: ola, roleId: adminRole.id } });
    await learner.lesson(ola, 'staff', main.m.reports!.guides[0]!);
    expect((await learner.course(ola, 'staff', main.id)).mine.lastLessonId).toBe(main.m.reports!.guides[0]);
    await prisma.userRole.deleteMany({ where: { userId: ola, roleId: adminRole.id } });
    const d = await learner.course(ola, 'staff', main.id);
    expect(d.mine.lastLessonId).toBeNull();
    expect(d.resumeLessonId).toBe(main.m.gs!.lessons[0]);
    const card = (await learner.me(ola, 'staff')).inProgress.find((c) => c.id === main.id)!;
    expect(card.mine.lastLessonId).toBeNull();
  });
});

describe('Learn this feature', () => {
  it('learn(‘tasks’) points at the module', async () => {
    const hal = await newPerson('hal');
    await learner.start(hal, 'staff', main.id);
    const found = await learner.learn(hal, { module: 'tasks' });
    expect(found).toMatchObject({ courseId: main.id, moduleId: main.m.tasks!.id, module: 'tasks' });
    expect(found.count).toBeGreaterThanOrEqual(1);
    // The catalogue's feature filter finds the course through its module, only for people who see that module.
    expect((await learner.catalogue(hal, 'staff', { module: 'tasks' })).courses.map((c) => c.id)).toContain(main.id);
    expect((await learner.catalogue(hal, 'staff', { module: 'reports' })).courses.map((c) => c.id)).not.toContain(main.id);
    const notHis = await learner.learn(hal, { module: 'reports' });
    expect(notHis.courseId).not.toBe(main.id);
    expect(notHis.moduleId).toBeNull();
    // The course's own feature still counts; the module of that feature opens.
    expect(await learner.learn(hal, { module: 'general' })).toMatchObject({ courseId: main.id, moduleId: main.m.gs!.id });
    // Administrators see Reports.
    await learner.start(w.people.admin, 'staff', main.id);
    expect(await learner.learn(w.people.admin, { module: 'reports' })).toMatchObject({ courseId: main.id, moduleId: main.m.reports!.id });
    // Over HTTP: the same answer.
    const res = await app.inject({ method: 'GET', url: '/api/v1/training/learn?module=tasks', headers: { 'x-user': hal } });
    expect(JSON.parse(res.body).data).toMatchObject({ courseId: main.id, moduleId: main.m.tasks!.id });
  });
});

describe('old short-course links', () => {
  it('a merged course and a removed lesson answer COURSE_MOVED with where they live now', async () => {
    const ivy = await newPerson('ivy');
    const old = await prisma.trainingCourse.create({ data: { title: `Old tasks ${w.tag}`, moduleKey: 'tasks', audience: 'STAFF', status: 'ARCHIVED', publishedAt: new Date() } });
    const oldReports = await prisma.trainingCourse.create({ data: { title: `Old reports ${w.tag}`, moduleKey: 'reports', audience: 'STAFF', status: 'ARCHIVED', publishedAt: new Date() } });
    courseIds.push(old.id, oldReports.id);
    const deletedId = `gonecourse${w.tag}`;
    const goneLesson = `gonelesson${w.tag}`;
    const before = await prisma.systemSetting.findUnique({ where: { key: 'training.oneCourse' } });
    await prisma.systemSetting.create({
      data: {
        key: RECORD_KEY,
        value: {
          moved: {
            [old.id]: { courseId: main.id, moduleId: main.m.tasks!.id },
            [oldReports.id]: { courseId: main.id, moduleId: main.m.reports!.id },
            [deletedId]: { courseId: main.id, moduleId: null },
          },
          removedLessons: { [goneLesson]: { courseId: main.id, moduleId: main.m.tasks!.id } },
        },
      },
    });

    const moved = await failure(learner.course(ivy, 'staff', old.id));
    expect(moved).toMatchObject({ status: 404, code: 'COURSE_MOVED', message: 'This course is now part of MICO360 Tasks User Training.', details: { courseId: main.id, moduleId: main.m.tasks!.id } });
    expect(await failure(learner.course(ivy, 'staff', deletedId))).toMatchObject({ code: 'COURSE_MOVED', details: { courseId: main.id, moduleId: null } });
    expect(await failure(learner.lesson(ivy, 'staff', goneLesson))).toMatchObject({ status: 404, code: 'COURSE_MOVED', details: { courseId: main.id, moduleId: main.m.tasks!.id } });
    // A module hidden from the person isn't named; an administrator's link opens it.
    expect(await failure(learner.course(ivy, 'staff', oldReports.id))).toMatchObject({ code: 'COURSE_MOVED', details: { courseId: main.id, moduleId: null } });
    expect(await failure(learner.course(w.people.admin, 'staff', oldReports.id))).toMatchObject({ code: 'COURSE_MOVED', details: { courseId: main.id, moduleId: main.m.reports!.id } });
    // A manager's preview of the archived course is the moved course too.
    expect(await failure(learner.course(w.people.amy, 'staff', old.id))).toMatchObject({ code: 'COURSE_MOVED' });
    // Anything else is still "not found"; a client is never sent to a staff course.
    expect(await failure(learner.course(ivy, 'staff', `nope${w.tag}`))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(await failure(learner.lesson(ivy, 'staff', `nolesson${w.tag}`))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(await failure(learner.course(clientId, 'client', old.id))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(await failure(learner.lesson(clientId, 'client', goneLesson))).toMatchObject({ status: 404, code: 'NOT_FOUND' });

    // Over HTTP the details reach the website.
    const res = await app.inject({ method: 'GET', url: `/api/v1/training/courses/${old.id}`, headers: { 'x-user': ivy } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toEqual({ code: 'COURSE_MOVED', message: 'This course is now part of MICO360 Tasks User Training.', details: { courseId: main.id, moduleId: main.m.tasks!.id } });
    const lessonRes = await app.inject({ method: 'GET', url: `/api/v1/training/lessons/${goneLesson}`, headers: { 'x-user': ivy } });
    expect(JSON.parse(lessonRes.body).error).toMatchObject({ code: 'COURSE_MOVED', details: { courseId: main.id } });

    // The site's own record was never touched.
    expect(await prisma.systemSetting.findUnique({ where: { key: 'training.oneCourse' } })).toEqual(before);
    await prisma.systemSetting.deleteMany({ where: { key: RECORD_KEY } });
    expect(await failure(learner.course(ivy, 'staff', old.id))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('the Client portal passes a client course’s modules through unchanged', async () => {
    const c = await makeModuleCourse(
      'Client guide',
      [
        { key: 'portal', title: 'Your portal', moduleKey: 'portal', lessons: ['GUIDE'] },
        { key: 'beta', title: 'Beta only', moduleKey: 'general', lessons: ['GUIDE'] },
      ],
      { audience: 'CLIENTS', moduleKey: 'portal', certificateOn: false },
    );
    await prisma.trainingModule.update({ where: { id: c.m.beta!.id }, data: { companyIds: [w.companies.B] } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/portal/training/courses/${c.id}`, headers: { 'x-user': clientId } });
    expect(res.statusCode).toBe(200);
    const d = JSON.parse(res.body).data as CourseDetail;
    expect(d.modules.map((m) => m.title)).toEqual(['Your portal']);
    expect(d.lessons.map((l) => [l.id, l.moduleId])).toEqual([[c.m.portal!.lessons[0], c.m.portal!.id]]);
    expect(d.mine).toMatchObject({ modules: { done: 0, total: 1 }, next: { lessonId: c.m.portal!.lessons[0], moduleTitle: 'Your portal' } });
    const hidden = await app.inject({ method: 'GET', url: `/api/v1/portal/training/lessons/${c.m.beta!.lessons[0]}`, headers: { 'x-user': clientId } });
    expect(hidden.statusCode).toBe(404);
    const done = await app.inject({ method: 'POST', url: `/api/v1/portal/training/lessons/${c.m.portal!.lessons[0]}/complete`, headers: { 'x-user': clientId } });
    expect(JSON.parse(done.body).data).toMatchObject({ courseCompleted: true, moduleDone: { id: c.m.portal!.id, title: 'Your portal' } });
  });
});

describe('certificates', () => {
  it('certificate refs carry the completion day, name and link', async () => {
    const jo = await newPerson('jo');
    await finishModule(jo, main, 'gs');
    await finishModule(jo, main, 'tasks');
    const cert = await prisma.trainingCertificate.findFirstOrThrow({ where: { userId: jo, courseId: main.id } });
    let me = await learner.me(jo, 'staff');
    const ref = me.certificates.find((c) => c.id === cert.id)!;
    expect(ref).toMatchObject({ completedAt: cert.completedAt!.toISOString(), learnerName: `Jo ${w.tag}`, verifyUrl: `http://localhost:5173/verify/${cert.code}`, courseTitle: `MICO360 Tasks User Training ${w.tag}` });
    // Finished earlier (the conversion's day): that day; none recorded (an older certificate): the day it was issued.
    const earlier = new Date('2026-10-03T08:00:00.000Z');
    await prisma.trainingCertificate.update({ where: { id: cert.id }, data: { completedAt: earlier } });
    me = await learner.me(jo, 'staff');
    expect(me.certificates.find((c) => c.id === cert.id)!.completedAt).toBe(earlier.toISOString());
    expect(me.completed.find((c) => c.id === main.id)!.mine.certificate).toMatchObject({ id: cert.id, completedAt: earlier.toISOString(), learnerName: `Jo ${w.tag}` });
    await prisma.trainingCertificate.update({ where: { id: cert.id }, data: { completedAt: null } });
    me = await learner.me(jo, 'staff');
    expect(me.certificates.find((c) => c.id === cert.id)!.completedAt).toBe(cert.issuedAt.toISOString());
  });

  it('verify shows the completion day', async () => {
    const kim = await newPerson('kim');
    await finishModule(kim, main, 'gs');
    await finishModule(kim, main, 'tasks');
    const cert = await prisma.trainingCertificate.findFirstOrThrow({ where: { userId: kim, courseId: main.id } });
    const earlier = new Date('2026-10-05T06:30:00.000Z');
    await prisma.trainingCertificate.update({ where: { id: cert.id }, data: { completedAt: earlier } });
    expect(await learner.verify(cert.code)).toMatchObject({ completedAt: earlier.toISOString(), issuedAt: cert.issuedAt.toISOString(), status: 'VALID', learnerName: `Kim ${w.tag}` });
    await prisma.trainingCertificate.update({ where: { id: cert.id }, data: { completedAt: null } });
    expect((await learner.verify(cert.code)).completedAt).toBe(cert.issuedAt.toISOString());
  });
});

describe('people are read once', () => {
  it('a module course’s learner calls use the person already loaded', async () => {
    const lou = await newPerson('lou');
    peopleReads = 0;
    await learner.course(lou, 'staff', main.id);
    await learner.catalogue(lou, 'staff', { module: 'tasks' });
    await learner.lesson(lou, 'staff', main.m.gs!.guides[0]!);
    await learner.saveProgress(lou, 'staff', main.m.gs!.guides[0]!, { stepIndex: 0 });
    await learner.complete(lou, 'staff', main.m.gs!.guides[0]!);
    await passQuiz(lou, main, main.m.gs!.quiz!);
    await learner.learn(lou, { module: 'tasks' });
    expect(peopleReads).toBe(0);
  });
});

// ── Final review (1.23.32) ──

const ADMIN = async () => (await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } })).id;
const promote = async (userId: string) => prisma.userRole.create({ data: { userId, roleId: await ADMIN() } });
const demote = async (userId: string) => prisma.userRole.deleteMany({ where: { userId, roleId: await ADMIN() } });

describe('answered questions follow the reader’s modules (final review 1)', () => {
  it('an administrator’s answered question about an Admin settings lesson isn’t shown to an employee; one with no lesson and one about a lesson they see are', async () => {
    const boss = await newPerson('quinn');
    await promote(boss);
    const emp = await newPerson('rae');
    const ask = (body: string, lessonId?: string) => learner.feedback(boss, 'staff', main.id, { kind: 'QUESTION', body, ...(lessonId ? { lessonId } : {}) });
    const hidden = await ask('How do I add a person?', main.m.admin!.guides[0]);
    const loose = await ask('Where do I start?');
    const seen = await ask('Where are my tasks?', main.m.tasks!.guides[0]);
    await prisma.trainingFeedback.updateMany({ where: { id: { in: [hidden.id, loose.id, seen.id] } }, data: { status: 'ANSWERED', answer: 'Like this.', answeredById: w.people.admin, answeredAt: new Date() } });

    const ids = async (userId: string) => (await learner.course(userId, 'staff', main.id)).questions.map((q) => q.id);
    // A colleague in the same company who can't see Admin settings: the other two only.
    const theirs = await ids(emp);
    expect(theirs).toEqual(expect.arrayContaining([loose.id, seen.id]));
    expect(theirs).not.toContain(hidden.id);
    // A Training manager's preview follows her own view (she isn't an administrator).
    const amys = await ids(w.people.amy);
    expect(amys).toEqual(expect.arrayContaining([loose.id, seen.id]));
    expect(amys).not.toContain(hidden.id);
    // The administrator sees all three; the asker always sees their own, even once the lesson isn't theirs any more.
    expect(await ids(w.people.admin)).toEqual(expect.arrayContaining([hidden.id, loose.id, seen.id]));
    await demote(boss);
    expect(await ids(boss)).toEqual(expect.arrayContaining([hidden.id, loose.id, seen.id]));
  });
});

describe('a learner whose own role or company shrinks while part-way is finished at their next look (final review 2)', () => {
  const certificatesOf = (userId: string, courseId: string) => prisma.trainingCertificate.findMany({ where: { userId, courseId } });
  /** An administrator with every all-staff module done (not Reports or Admin settings), then made an employee. */
  async function demotedWithStaffDone(name: string): Promise<string> {
    const id = await newPerson(name);
    await promote(id);
    await finishModule(id, main, 'gs');
    await finishModule(id, main, 'tasks');
    expect((await learner.course(id, 'staff', main.id)).mine).toMatchObject({ status: 'IN_PROGRESS', modules: { done: 2, total: 4 } });
    await demote(id);
    return id;
  }
  const staffModules = () => expect.arrayContaining([main.m.gs!.id, main.m.tasks!.id]);

  it('My training: finished, with the certificate for the modules they see — once', async () => {
    const sid = await demotedWithStaffDone('sid');
    const me = await learner.me(sid, 'staff');
    expect(me.inProgress.map((c) => c.id)).not.toContain(main.id);
    const card = me.completed.find((c) => c.id === main.id)!;
    expect(card.mine).toMatchObject({ status: 'COMPLETED', progressPct: 100, modules: { done: 2, total: 2 }, certificate: { status: 'VALID' } });
    const certs = await certificatesOf(sid, main.id);
    expect(certs).toHaveLength(1);
    expect(certs[0]!.moduleIds).toEqual(staffModules());
    expect(certs[0]!.moduleIds).toHaveLength(2);
    // Reading again changes nothing.
    await learner.me(sid, 'staff');
    await learner.course(sid, 'staff', main.id);
    expect(await certificatesOf(sid, main.id)).toHaveLength(1);
  });

  it('the course page: finished, with the certificate (Continue no longer opens lesson 1 of an unfinished course)', async () => {
    const tia = await demotedWithStaffDone('tia');
    const d = await learner.course(tia, 'staff', main.id);
    expect(d.mine).toMatchObject({ status: 'COMPLETED', progressPct: 100, modules: { done: 2, total: 2 }, newForRole: 0, certificate: { status: 'VALID' } });
    expect(d.mine.completedAt).not.toBeNull();
    expect(d.modules.map((m) => m.status)).toEqual(['DONE', 'DONE']);
    expect(await certificatesOf(tia, main.id)).toHaveLength(1);
  });

  it('the Learning Hub badge (access): an overdue assignment of the course is no longer overdue', async () => {
    const uli = await newPerson('uli');
    await promote(uli);
    const a = await prisma.trainingAssignment.create({ data: { courseId: main.id, targetKind: 'USER', targetId: uli, mandatory: true, dueDay: '2026-01-05', createdById: w.people.admin } });
    await prisma.trainingAssignee.create({ data: { assignmentId: a.id, userId: uli, courseId: main.id, mandatory: true, dueDay: '2026-01-05' } });
    await finishModule(uli, main, 'gs');
    await finishModule(uli, main, 'tasks');
    expect(await learner.access(uli)).toMatchObject({ overdue: 1, assigned: 1 });
    await demote(uli);
    expect(await learner.access(uli)).toMatchObject({ overdue: 0, assigned: 0 });
    const e = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: uli, courseId: main.id } } });
    expect(e).toMatchObject({ progressPct: 100 });
    expect(e.completedAt).not.toBeNull();
    expect(await certificatesOf(uli, main.id)).toHaveLength(1);
  });

  it('leaving the company a module is limited to: finished at the next look', async () => {
    const co = await makeModuleCourse('Company limited', [
      { key: 'gs', title: 'Getting started', moduleKey: 'general' },
      { key: 'beta', title: 'Beta only', moduleKey: 'general' },
    ]);
    await prisma.trainingModule.update({ where: { id: co.m.beta!.id }, data: { companyIds: [w.companies.B] } });
    const val = await newPerson('val');
    await prisma.companyMember.create({ data: { companyId: w.companies.B, userId: val } });
    await finishModule(val, co, 'gs');
    expect((await learner.course(val, 'staff', co.id)).mine).toMatchObject({ status: 'IN_PROGRESS', modules: { done: 1, total: 2 } });
    await prisma.companyMember.deleteMany({ where: { companyId: w.companies.B, userId: val } });
    const d = await learner.course(val, 'staff', co.id);
    expect(d.mine).toMatchObject({ status: 'COMPLETED', modules: { done: 1, total: 1 }, certificate: { status: 'VALID' } });
    expect(d.modules.map((m) => m.id)).toEqual([co.m.gs!.id]);
    expect(await certificatesOf(val, co.id)).toHaveLength(1);
  });

  it('nobody is finished early: someone part-way with a module of theirs left stays in progress', async () => {
    const wes = await newPerson('wes');
    await finishModule(wes, main, 'gs');
    await learner.me(wes, 'staff');
    expect((await learner.course(wes, 'staff', main.id)).mine).toMatchObject({ status: 'IN_PROGRESS', modules: { done: 1, total: 2 } });
    expect(await certificatesOf(wes, main.id)).toHaveLength(0);
  });
});

describe('a review whose changed lessons are all in modules hidden from the person now (final review 2, REVIEW)', () => {
  const manage = createTrainingManage(ctx, sync, { oneCourseKey: RECORD_KEY });
  /** An administrator who finished Getting started and Admin settings, then a Major change to the Admin settings guide. */
  async function reviewingAdmin(name: string): Promise<{ id: string; c: MadeCourse }> {
    const c = await makeModuleCourse(`Review ${name}`, [
      { key: 'gs', title: 'Getting started', moduleKey: 'general' },
      { key: 'admin', title: 'Admin settings', moduleKey: 'admin' },
    ]);
    const id = await newPerson(name);
    await promote(id);
    await finishModule(id, c, 'gs');
    expect(await finishModule(id, c, 'admin')).toMatchObject({ courseCompleted: true });
    // Published after every lesson was written; then one lesson is edited and published as a Major change.
    const past = new Date(Date.now() - 10 * 60_000);
    await prisma.trainingLesson.updateMany({ where: { courseId: c.id }, data: { updatedAt: past } });
    await prisma.trainingCourse.update({ where: { id: c.id }, data: { publishedAt: new Date(past.getTime() + 1000) } });
    await manage.updateLesson(w.people.admin, c.m.admin!.guides[0], { title: 'Admin settings guide 1 (new)' });
    await manage.publish(w.people.admin, c.id, { change: 'MAJOR', reviewDays: 14 });
    const d = await learner.course(id, 'staff', c.id);
    expect(d.mine).toMatchObject({ status: 'REVIEW' });
    expect(d.lessons.filter((l) => l.review).map((l) => l.id)).toEqual([c.m.admin!.guides[0]]);
    await demote(id);
    return { id, c };
  }
  const enrolmentOf = (userId: string, courseId: string) => prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId } } });

  it('the course page: COMPLETED (review done, the new version), not REVIEW; no new certificate', async () => {
    const { id, c } = await reviewingAdmin('ren');
    const d = await learner.course(id, 'staff', c.id);
    expect(d.mine).toMatchObject({ status: 'COMPLETED', dueDay: null, overdue: false });
    expect(d.lessons.some((l) => l.review)).toBe(false);
    const e = await enrolmentOf(id, c.id);
    expect(e.reviewDoneAt).not.toBeNull();
    expect(e.completedVersion).toBe(2);
    expect(await prisma.trainingCertificate.count({ where: { userId: id, courseId: c.id } })).toBe(1);
  });

  it('My training: in Completed, nothing to review', async () => {
    const { id, c } = await reviewingAdmin('sol');
    const me = await learner.me(id, 'staff');
    expect(me.completed.find((x) => x.id === c.id)!.mine).toMatchObject({ status: 'COMPLETED' });
    expect(me.counts.review).toBe(0);
    expect((await enrolmentOf(id, c.id)).reviewDoneAt).not.toBeNull();
  });
});
