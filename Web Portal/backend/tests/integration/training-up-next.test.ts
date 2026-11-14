import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testPrisma } from './test-prisma';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import type { AuthGuard } from '../../src/modules/auth/auth-guard';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { createTrainingLearner } from '../../src/modules/training/training-learner';
import { registerTrainingRoutes } from '../../src/modules/training/training-routes';
import { registerPortalTrainingRoutes } from '../../src/modules/training/portal-training-routes';
import type { MyTraining, PortalTraining } from '../../src/modules/training/training-types';

// Requires a running MySQL / MariaDB (TEST_DATABASE_URL) with migrations applied.
// 1.23.34 (owner 14 Nov, "Show the course as Up next"): My training offers the built-in course — found by its starter
// key, never by its title — as `suggested` to everyone who hasn't finished it, when it is published and theirs to
// take: optional (not assigned, no due day, not counted), the person's own modules only. Started from there it is
// "Started themselves". Archived, unpublished, deleted, finished, already on their lists or assigned: not offered.
// The Client portal offers its own guide the same way. The keys are this file's own (the site's never touched).
const url = process.env.TEST_DATABASE_URL!;
const prisma = testPrisma(url);
const TAG = randomBytes(4).toString('hex');
const STAFF_KEY = `starter:upnext-staff-${TAG}`;
const CLIENT_KEY = `starter:upnext-client-${TAG}`;

let w: CompanyWorld;
let app: FastifyInstance;
let clientId: string;
const courseIds: string[] = [];
const extraUsers: string[] = [];
const filesDir = join(mkdtempSync(join(tmpdir(), 'tupn-')), 'training-files');
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(filesDir),
  timeZone: 'Asia/Muscat',
  appUrl: 'http://localhost:5173',
  notify: async () => {},
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const learner = createTrainingLearner(ctx, createTrainingSync(ctx), { oneCourseKey: `training.oneCourse.upnext-${TAG}`, builtInKeys: { staff: STAFF_KEY, client: CLIENT_KEY } });

interface Made {
  id: string;
  /** module key → its lessons (guides first, the quiz last) */
  m: Record<string, { id: string; guides: string[]; quiz: string | null }>;
  right: Map<string, string>;
}
let position = 0;
/** A published course with modules made directly in the database (each module: a guide and a quiz). */
async function makeCourse(title: string, mods: { key: string; title: string; moduleKey: string }[], o: Record<string, unknown> = {}): Promise<Made> {
  const course = await prisma.trainingCourse.create({
    data: { title, moduleKey: 'general', audience: 'STAFF', difficulty: 'BEGINNER', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 30 * 86_400_000), certificateOn: true, ...o } as never,
  });
  courseIds.push(course.id);
  const made: Made = { id: course.id, m: {}, right: new Map() };
  for (const [i, spec] of mods.entries()) {
    const mod = await prisma.trainingModule.create({ data: { courseId: course.id, position: i + 1, title: spec.title, moduleKey: spec.moduleKey } });
    const guide = await prisma.trainingLesson.create({
      data: { courseId: course.id, moduleId: mod.id, position: position++, kind: 'GUIDE', title: `${spec.title} guide`, minutes: 4, steps: { create: [{ position: 0, title: 'Step 1', body: '<p>Read</p>' }] } },
    });
    const quizLesson = await prisma.trainingLesson.create({ data: { courseId: course.id, moduleId: mod.id, position: position++, kind: 'QUIZ', title: `Quiz: ${spec.title}`, minutes: 3 } });
    const quiz = await prisma.trainingQuiz.create({ data: { lessonId: quizLesson.id, passMark: 70, maxAttempts: null } });
    const q = await prisma.trainingQuestion.create({
      data: { quizId: quiz.id, position: 0, kind: 'SINGLE', prompt: `${spec.title}: pick B`, options: { create: [{ position: 0, text: 'A', correct: false }, { position: 1, text: 'B', correct: true }] } },
      include: { options: true },
    });
    made.right.set(q.id, q.options.find((x) => x.correct)!.id);
    made.m[spec.key] = { id: mod.id, guides: [guide.id], quiz: quizLesson.id };
  }
  return made;
}
/** Finishes the modules named (default: all — a person's own; an employee's are Getting started and Tasks). */
async function finishAll(userId: string, c: Made, mode: 'staff' | 'client' = 'staff', keys: string[] = Object.keys(c.m)) {
  for (const mm of keys.map((k) => c.m[k]!)) {
    for (const g of mm.guides) await learner.complete(userId, mode, g);
    if (mm.quiz) {
      const paper = await learner.startAttempt(userId, mode, mm.quiz);
      await learner.submit(userId, mode, paper.id, { answers: Object.fromEntries(paper.questions.map((q) => [q.id, [c.right.get(q.id)!]])) });
    }
  }
}
async function newPerson(name: string, role: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE') {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
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
async function assign(userId: string, courseId: string, o: { mandatory?: boolean; dueDay?: string | null } = {}) {
  const a = await prisma.trainingAssignment.create({ data: { courseId, targetKind: 'USER', targetId: userId, mandatory: o.mandatory ?? true, dueDay: o.dueDay ?? '2026-12-31', createdById: w.people.admin } });
  await prisma.trainingAssignee.create({ data: { assignmentId: a.id, userId, courseId, mandatory: o.mandatory ?? true, dueDay: o.dueDay ?? '2026-12-31' } });
  // The enrolment an assignment gives (as the assignment's own sync makes it).
  await prisma.trainingEnrolment.createMany({ data: [{ userId, courseId }], skipDuplicates: true });
  return a.id;
}
async function me(userId: string): Promise<MyTraining> {
  const res = await app.inject({ method: 'GET', url: '/api/v1/training/me', headers: { 'x-user': userId } });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data as MyTraining;
}

const STAFF_MODULES = [
  { key: 'gs', title: 'Getting started', moduleKey: 'general' },
  { key: 'tasks', title: 'Tasks', moduleKey: 'tasks' },
  { key: 'reports', title: 'Reports', moduleKey: 'reports' },
  { key: 'admin', title: 'Admin settings', moduleKey: 'admin' },
];
let builtIn: Made;
let other: Made;
let guide: Made;

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  // The built-in staff course (its starter key; any title), an admin-made course, and the client guide.
  builtIn = await makeCourse(`Built-in training ${TAG}`, STAFF_MODULES, { starterKey: STAFF_KEY });
  other = await makeCourse(`Acme site induction ${TAG}`, [{ key: 'gs', title: 'Before you go on site', moduleKey: 'general' }]);
  guide = await makeCourse(`Client guide ${TAG}`, [{ key: 'portal', title: 'Your portal', moduleKey: 'portal' }], { audience: 'CLIENTS', moduleKey: 'portal', starterKey: CLIENT_KEY });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  clientId = (await prisma.user.create({ data: { email: `upclient.${w.tag}@world.test`, username: `upclient_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } })).id;
  extraUsers.push(clientId);
  await prisma.clientProjectGrant.create({ data: { userId: clientId, projectId: w.projects.PA, progress: true } });

  const guard = {
    async authenticate(req: FastifyRequest) {
      req.user = { id: String(req.headers['x-user']), roles: [] };
    },
  } as unknown as AuthGuard;
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
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
  await prisma.trainingModuleDone.deleteMany({ where });
  await prisma.trainingAttempt.deleteMany({ where });
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingAssignee.deleteMany({ where });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: extraUsers } } });
  await prisma.clientProjectGrant.deleteMany({ where: { userId: { in: extraUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('My training offers the built-in course (GET /training/me → suggested)', () => {
  it('nothing assigned or started: the built-in course, optional — not assigned, no due day, not counted', async () => {
    const nia = await newPerson('nia');
    const d = await me(nia);
    expect(d.assigned).toEqual([]);
    expect(d.inProgress).toEqual([]);
    expect(d.completed).toEqual([]);
    expect(d.counts).toEqual({ assigned: 0, inProgress: 0, notStarted: 0, completed: 0, overdue: 0, review: 0 });
    expect(d.suggested?.id).toBe(builtIn.id);
    expect(d.suggested?.starter).toBe(true);
    expect(d.suggested?.mine).toMatchObject({ enrolled: false, status: 'NOT_STARTED', assigned: false, mandatory: false, dueDay: null, overdue: false, lessonsDone: 0, certificate: null });
    // Start opens its first lesson: the first module of theirs.
    expect(d.suggested?.mine.nextLessonId).toBe(builtIn.m.gs!.guides[0]);
    // Nothing was written for them by looking.
    expect(await prisma.trainingEnrolment.count({ where: { userId: nia } })).toBe(0);
    expect(await prisma.trainingModuleDone.count({ where: { userId: nia } })).toBe(0);
    expect(await prisma.trainingCertificate.count({ where: { userId: nia } })).toBe(0);
    // The Learning Hub badge is unchanged (nothing assigned, nothing overdue).
    expect(await learner.access(nia)).toMatchObject({ assigned: 0, overdue: 0 });
  });

  it('a person whose role hides some modules: only theirs count (employee 2 of 4; administrator 4)', async () => {
    const emp = await newPerson('ema');
    const adm = await newPerson('ada', 'ADMIN');
    const e = (await me(emp)).suggested!;
    const a = (await me(adm)).suggested!;
    expect(e.mine.modules).toEqual({ done: 0, total: 2 });
    expect(e.lessonCount).toBe(4);
    expect(a.mine.modules).toEqual({ done: 0, total: 4 });
    expect(a.lessonCount).toBe(8);
  });

  it('started from Up next: on their list as started themselves, no longer suggested', async () => {
    const sam = await newPerson('sam');
    const res = await app.inject({ method: 'POST', url: `/api/v1/training/courses/${builtIn.id}/start`, headers: { 'x-user': sam } });
    expect(res.statusCode).toBe(200);
    const d = await me(sam);
    expect(d.suggested).toBeNull();
    expect(d.inProgress.map((c) => c.id)).toEqual([builtIn.id]);
    expect(d.inProgress[0]!.mine).toMatchObject({ enrolled: true, assigned: false, mandatory: false, dueDay: null });
    expect(d.counts.assigned).toBe(0);
    const e = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: sam, courseId: builtIn.id } } });
    expect(e.selfStarted).toBe(true);
  });

  it('an assigned course is on their list as before; the built-in course is still offered beside it (the website puts the assigned one first)', async () => {
    const ali = await newPerson('ali');
    await assign(ali, other.id);
    const d = await me(ali);
    expect(d.assigned.map((c) => c.id)).toEqual([other.id]);
    expect(d.counts.assigned).toBe(1);
    expect(d.suggested?.id).toBe(builtIn.id);
  });

  it('the built-in course assigned to them: it is in Assigned (mandatory, due) and not suggested again', async () => {
    const asa = await newPerson('asa');
    await assign(asa, builtIn.id, { mandatory: true, dueDay: '2026-12-20' });
    const d = await me(asa);
    expect(d.assigned.map((c) => c.id)).toEqual([builtIn.id]);
    expect(d.assigned[0]!.mine).toMatchObject({ assigned: true, mandatory: true, dueDay: '2026-12-20' });
    expect(d.suggested).toBeNull();
  });

  it('finished: in Completed as today, nothing suggested', async () => {
    const fay = await newPerson('fay');
    await finishAll(fay, builtIn, 'staff', ['gs', 'tasks']);
    const d = await me(fay);
    expect(d.completed.map((c) => c.id)).toEqual([builtIn.id]);
    expect(d.suggested).toBeNull();
  });

  it('archived, unpublished (draft) or deleted: nothing offered', async () => {
    const dee = await newPerson('dee');
    try {
      for (const status of ['ARCHIVED', 'DRAFT']) {
        await prisma.trainingCourse.update({ where: { id: builtIn.id }, data: { status } });
        expect((await me(dee)).suggested, status).toBeNull();
      }
    } finally {
      await prisma.trainingCourse.update({ where: { id: builtIn.id }, data: { status: 'PUBLISHED' } });
    }
    expect((await me(dee)).suggested?.id).toBe(builtIn.id);
    // Deleted: no course with the key (here: the key taken off) — nothing offered, and never a course by its title.
    await prisma.trainingCourse.update({ where: { id: builtIn.id }, data: { starterKey: null } });
    try {
      expect((await me(dee)).suggested).toBeNull();
    } finally {
      await prisma.trainingCourse.update({ where: { id: builtIn.id }, data: { starterKey: STAFF_KEY } });
    }
  });

  it('a course limited to another company: not offered to someone outside it', async () => {
    const out = await newPerson('ola');
    await prisma.trainingCourse.update({ where: { id: builtIn.id }, data: { companyIds: [w.companies.B] } as never });
    try {
      expect((await me(out)).suggested).toBeNull();
    } finally {
      await prisma.trainingCourse.update({ where: { id: builtIn.id }, data: { companyIds: [] } as never });
    }
    expect((await me(out)).suggested?.id).toBe(builtIn.id);
  });

  it('every module hidden from the person (here: each limited to another company): nothing offered', async () => {
    const hal = await newPerson('hal');
    const ids = Object.values(builtIn.m).map((m) => m.id);
    await prisma.trainingModule.updateMany({ where: { id: { in: ids } }, data: { companyIds: [w.companies.B] } as never });
    try {
      expect((await me(hal)).suggested).toBeNull();
    } finally {
      await prisma.trainingModule.updateMany({ where: { id: { in: ids } }, data: { companyIds: [] } as never });
    }
    expect((await me(hal)).suggested?.id).toBe(builtIn.id);
  });

  it('an assignment withdrawn part-way: offered again as optional, with their progress (Start makes it theirs, started themselves)', async () => {
    const wes = await newPerson('wes');
    const a = await assign(wes, builtIn.id);
    await me(wes); // the sync gives them the course
    await learner.complete(wes, 'staff', builtIn.m.gs!.guides[0]!);
    await prisma.trainingAssignee.updateMany({ where: { assignmentId: a }, data: { withdrawnAt: new Date() } });
    await prisma.trainingAssignment.update({ where: { id: a }, data: { withdrawnAt: new Date() } });
    // What Withdraw does to an unfinished enrolment the person didn't start themselves (training-targets enrolmentAfterSync).
    await prisma.trainingEnrolment.updateMany({ where: { userId: wes, courseId: builtIn.id }, data: { withdrawnAt: new Date() } });
    const d = await me(wes);
    expect(d.assigned).toEqual([]);
    expect(d.suggested?.id).toBe(builtIn.id);
    expect(d.suggested?.mine).toMatchObject({ enrolled: false, assigned: false, mandatory: false, dueDay: null, lessonsDone: 1 });
    await learner.start(wes, 'staff', builtIn.id);
    const after = await me(wes);
    expect(after.suggested).toBeNull();
    expect(after.inProgress.map((c) => c.id)).toEqual([builtIn.id]);
    expect((await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: wes, courseId: builtIn.id } } })).selfStarted).toBe(true);
  });
});

describe('the Client portal offers its own guide (GET /portal/training → suggested)', () => {
  it('a client with nothing assigned: the client guide, optional; never the staff course', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/portal/training', headers: { 'x-user': clientId } });
    expect(res.statusCode).toBe(200);
    const d = JSON.parse(res.body).data as PortalTraining;
    expect(d.suggested?.id).toBe(guide.id);
    expect(d.suggested?.mine).toMatchObject({ enrolled: false, assigned: false, mandatory: false, dueDay: null });
    expect(d.counts.assigned).toBe(0);
  });

  it('staff are never offered the client guide', async () => {
    const sid = await newPerson('sid');
    expect((await me(sid)).suggested?.id).toBe(builtIn.id);
  });

  it('a client who finished the guide: in Completed, nothing suggested', async () => {
    await finishAll(clientId, guide, 'client');
    const d = await learner.portal(clientId);
    expect(d.completed.map((c) => c.id)).toEqual([guide.id]);
    expect(d.suggested).toBeNull();
  });
});
