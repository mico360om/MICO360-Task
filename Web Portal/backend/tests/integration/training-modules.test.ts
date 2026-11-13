import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, sorted, type CompanyWorld } from './company-world';
import { trainingContext, type TrainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { createTrainingLearner } from '../../src/modules/training/training-learner';
import { COURSE, createTrainingFinish } from '../../src/modules/training/training-finish';
import { loadState, loadStates, pairKey } from '../../src/modules/training/training-read';
import { loadPerson } from '../../src/modules/training/prisma-training-store';

// Requires a running MySQL / MariaDB (TEST_DATABASE_URL) with migrations applied.
// Learning Hub as one course (1.23.30): every learner read sees only the modules a person may see (their
// lessons, %, Continue); a module is done when its visible lessons and quiz are (and stays done once recorded);
// the course finishes when every visible module is; a grown role (D3) keeps the course finished and its
// certificate valid, and finishing the new modules issues an updated certificate; a retake needs every module
// again; hidden, switched-off and unlinked-only modules never count.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';

let w: CompanyWorld;
let clockAt: Date | null = null;
const notices: { userId: string; type: string }[] = [];
const courseIds: string[] = [];
const extraUsers: string[] = [];
const filesDir = join(mkdtempSync(join(tmpdir(), 'tmods-')), 'training-files');
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(filesDir),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  now: () => clockAt ?? new Date(),
  notify: async (n) => {
    notices.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const sync = createTrainingSync(ctx);
const learner = createTrainingLearner(ctx, sync);
const finish = createTrainingFinish(ctx);

// ── Module courses made directly in the database ──
type LessonKind = 'GUIDE' | 'QUIZ' | 'VIDEO';
interface ModSpec {
  key: string;
  title: string;
  moduleKey: string;
  enabled?: boolean;
  companyIds?: string[];
  lessons?: LessonKind[];
}
interface MadeModule {
  id: string;
  title: string;
  guide: string | null;
  quiz: string | null;
  lessons: string[];
}
interface MadeCourse {
  id: string;
  m: Record<string, MadeModule>;
  /** question id → its right option id */
  right: Map<string, string>;
}
let position = 0;
async function makeModuleCourse(title: string, mods: ModSpec[], o: Record<string, unknown> = {}): Promise<MadeCourse> {
  const c = await prisma.trainingCourse.create({
    data: { title: `${title} ${w.tag}`, moduleKey: 'general', audience: 'STAFF', difficulty: 'BEGINNER', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 60 * 86_400_000), certificateOn: true, ...o } as never,
  });
  courseIds.push(c.id);
  const made: MadeCourse = { id: c.id, m: {}, right: new Map() };
  for (const [i, spec] of mods.entries()) {
    const mod = await prisma.trainingModule.create({
      data: { courseId: c.id, position: i + 1, title: spec.title, moduleKey: spec.moduleKey, enabled: spec.enabled ?? true, ...(spec.companyIds ? { companyIds: spec.companyIds } : {}) },
    });
    const mm: MadeModule = { id: mod.id, title: spec.title, guide: null, quiz: null, lessons: [] };
    for (const kind of spec.lessons ?? ['GUIDE', 'QUIZ']) {
      const lesson = await prisma.trainingLesson.create({
        data: {
          courseId: c.id,
          moduleId: mod.id,
          position: position++,
          kind,
          title: `${spec.title} ${kind.toLowerCase()}`,
          minutes: 3,
          ...(kind === 'GUIDE' ? { steps: { create: [{ position: 0, title: 'Only step', body: '<p>Read</p>' }] } } : {}),
        },
      });
      mm.lessons.push(lesson.id);
      if (kind === 'GUIDE' && !mm.guide) mm.guide = lesson.id;
      if (kind === 'QUIZ') {
        mm.quiz = lesson.id;
        const quiz = await prisma.trainingQuiz.create({ data: { lessonId: lesson.id, passMark: 70, maxAttempts: null } });
        const q = await prisma.trainingQuestion.create({
          data: { quizId: quiz.id, position: 0, kind: 'SINGLE', prompt: `${spec.title}: pick B`, options: { create: [{ position: 0, text: 'A', correct: false }, { position: 1, text: 'B', correct: true }] } },
          include: { options: true },
        });
        made.right.set(q.id, q.options.find((x) => x.correct)!.id);
      }
    }
    made.m[spec.key] = mm;
  }
  return made;
}

const FOUR: ModSpec[] = [
  { key: 'gs', title: 'Getting started', moduleKey: 'general' },
  { key: 'tasks', title: 'Tasks', moduleKey: 'tasks' },
  { key: 'reports', title: 'Reports', moduleKey: 'reports' },
  { key: 'admin', title: 'Admin settings', moduleKey: 'admin' },
];

async function passQuiz(userId: string, c: MadeCourse, lessonId: string) {
  const paper = await learner.startAttempt(userId, 'staff', lessonId);
  const answers = Object.fromEntries(paper.questions.map((q) => [q.id, [c.right.get(q.id)!]]));
  return learner.submit(userId, 'staff', paper.id, { answers });
}
/** The module's guide (Mark as done) and quiz (passed), as the person would. */
async function finishModule(userId: string, c: MadeCourse, key: string) {
  const mm = c.m[key]!;
  if (mm.guide) await learner.complete(userId, 'staff', mm.guide);
  if (mm.quiz) return passQuiz(userId, c, mm.quiz);
  return null;
}
async function newPerson(name: string, role: 'EMPLOYEE' | 'ADMIN' = 'EMPLOYEE') {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const u = await prisma.user.create({
    data: { email: `${name}.${w.tag}@world.test`, username: `${name}_${w.tag}`, passwordHash: 'x', firstName: name, lastName: w.tag, roles: { create: { roleId: r.id } }, primaryCompanyId: w.companies.A, companies: { create: { companyId: w.companies.A } } },
  });
  extraUsers.push(u.id);
  return u.id;
}
async function setAdmin(userId: string, on: boolean) {
  const r = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  if (on) await prisma.userRole.createMany({ data: [{ userId, roleId: r.id }], skipDuplicates: true });
  else await prisma.userRole.deleteMany({ where: { userId, roleId: r.id } });
}
const certificates = (userId: string, courseId: string) => prisma.trainingCertificate.findMany({ where: { userId, courseId }, orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }] });
const moduleRows = (userId: string, courseId: string) => prisma.trainingModuleDone.findMany({ where: { userId, courseId } });
const courseRow = (id: string) => prisma.trainingCourse.findUniqueOrThrow({ where: { id }, select: COURSE });
const ids = (list: unknown) => sorted((list as string[]) ?? []);

let main: MadeCourse;

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  main = await makeModuleCourse('MICO360 Tasks User Training', FOUR);
});

afterAll(async () => {
  const users = [...Object.values(w.people), ...extraUsers];
  const where = { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] };
  await prisma.trainingModuleDone.deleteMany({ where });
  await prisma.trainingAttempt.deleteMany({ where });
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingAssignee.deleteMany({ where });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: extraUsers } } });
  await prisma.clientProjectGrant.deleteMany({ where: { userId: { in: extraUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('who sees which module', () => {
  it('employee sees two modules, admin four', async () => {
    const states = await loadStates(ctx, [
      { userId: w.people.ana, courseId: main.id },
      { userId: w.people.admin, courseId: main.id },
    ]);
    const ana = states.get(pairKey(w.people.ana, main.id))!;
    const admin = states.get(pairKey(w.people.admin, main.id))!;
    expect(ana.units.map((u) => u.unit.title)).toEqual(['Getting started', 'Tasks']);
    expect(admin.units.map((u) => u.unit.title)).toEqual(['Getting started', 'Tasks', 'Reports', 'Admin settings']);
    // The person's lessons are their modules' lessons, in module order; Reports and Admin settings aren't there.
    expect(ana.lessons.map((l) => l.id)).toEqual([...main.m.gs!.lessons, ...main.m.tasks!.lessons]);
    for (const id of [...main.m.reports!.lessons, ...main.m.admin!.lessons]) expect(ana.lessons.some((l) => l.id === id)).toBe(false);
    expect(admin.lessons).toHaveLength(8);
    // Every module of the course, for the editor and reports.
    expect(ana.modules.map((m) => m.title)).toEqual(['Getting started', 'Tasks', 'Reports', 'Admin settings']);
    expect(ana.modules[2]).toMatchObject({ moduleKey: 'reports', roleKeys: [], companyIds: [], enabled: true, offReason: null });
    expect(ana.state).toMatchObject({ status: 'NOT_STARTED', progressPct: 0 });
    expect(ana.units[0]).toMatchObject({ status: 'NOT_STARTED', lessonsDone: 0, lessonCount: 2, minutes: 6, newForRole: false, doneAt: null });
    expect(ana.continueAt).toEqual({ unitId: main.m.gs!.id, lessonId: main.m.gs!.guide });
  });

  it('a client sees a client course’s modules by company only (feature and groups don’t apply)', async () => {
    const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
    const client = await prisma.user.create({ data: { email: `mclient.${w.tag}@world.test`, username: `mclient_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } });
    extraUsers.push(client.id);
    await prisma.clientProjectGrant.create({ data: { userId: client.id, projectId: w.projects.PA, progress: true } });
    const c = await makeModuleCourse(
      'Client modules',
      [
        { key: 'portal', title: 'Your portal', moduleKey: 'portal' },
        { key: 'reports', title: 'Your reports', moduleKey: 'reports' },
        { key: 'beta', title: 'Beta only', moduleKey: 'general', companyIds: [w.companies.B] },
      ],
      { audience: 'CLIENTS', moduleKey: 'portal' },
    );
    const s = await loadState(ctx, client.id, c.id);
    expect(s.units.map((u) => u.unit.title)).toEqual(['Your portal', 'Your reports']);
  });

  it('uses the people given, and a missing account sees no restricted module', async () => {
    const anaRecord = (await loadPerson(prisma, w.people.ana))!;
    const asAdmin = await loadStates(ctx, [{ userId: w.people.ana, courseId: main.id }], new Map([[w.people.ana, { ...anaRecord, admin: true }]]));
    expect(asAdmin.get(pairKey(w.people.ana, main.id))!.units).toHaveLength(4);
    const ghost = `ghost-${w.tag}`;
    const gone = await loadStates(ctx, [{ userId: ghost, courseId: main.id }]);
    expect(gone.get(pairKey(ghost, main.id))!.units.map((u) => u.unit.title)).toEqual(['Getting started', 'Tasks']);
  });

  it('a course without modules reads nobody’s record and keeps every lesson', async () => {
    const plain = await prisma.trainingCourse.create({ data: { title: `Plain ${w.tag}`, moduleKey: 'general', audience: 'STAFF', status: 'PUBLISHED', publishedAt: new Date() } });
    courseIds.push(plain.id);
    await prisma.trainingLesson.create({ data: { courseId: plain.id, kind: 'GUIDE', title: 'One', position: 0, steps: { create: [{ position: 0, title: 'S', body: '<p>S</p>' }] } } });
    let asked = 0;
    const counting: TrainingContext = {
      ...ctx,
      people: (list) => {
        asked++;
        return ctx.people(list);
      },
    };
    const s = (await loadStates(counting, [{ userId: w.people.ana, courseId: plain.id }])).get(pairKey(w.people.ana, plain.id))!;
    expect(asked).toBe(0);
    expect(s.lessons).toHaveLength(1);
    expect(s.units).toEqual([]);
    expect(s.modules).toEqual([]);
    expect(s.continueAt).toBeNull();
    // A module course: one read for everyone asked about.
    await loadStates(counting, [
      { userId: w.people.ana, courseId: main.id },
      { userId: w.people.ben, courseId: main.id },
      { userId: w.people.ana, courseId: plain.id },
    ]);
    expect(asked).toBe(1);
  });
});

describe('finishing a module course', () => {
  it('finishing the employee’s modules completes the course and issues one certificate with moduleIds of both', async () => {
    const ana = w.people.ana;
    await learner.complete(ana, 'staff', main.m.gs!.guide!);
    let s = await loadState(ctx, ana, main.id);
    expect(s.state).toMatchObject({ status: 'IN_PROGRESS', progressPct: 0 });
    expect(s.units[0]).toMatchObject({ status: 'IN_PROGRESS', lessonsDone: 1, lessonCount: 2 });
    expect(s.continueAt).toEqual({ unitId: main.m.gs!.id, lessonId: main.m.gs!.quiz });

    await passQuiz(ana, main, main.m.gs!.quiz!);
    s = await loadState(ctx, ana, main.id);
    expect(s.state).toMatchObject({ status: 'IN_PROGRESS', progressPct: 50 });
    expect(s.units[0]!.status).toBe('DONE');
    expect(s.continueAt).toEqual({ unitId: main.m.tasks!.id, lessonId: main.m.tasks!.guide });
    expect((await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: ana, courseId: main.id } } })).progressPct).toBe(50);

    await learner.complete(ana, 'staff', main.m.tasks!.guide!);
    const result = await passQuiz(ana, main, main.m.tasks!.quiz!);
    expect(result.courseCompleted).toBe(true);
    s = await loadState(ctx, ana, main.id);
    expect(s.state).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
    expect(s.continueAt).toBeNull();
    expect(s.enrolment!.completedAt).not.toBeNull();

    const certs = await certificates(ana, main.id);
    expect(certs).toHaveLength(1);
    expect(result.certificateId).toBe(certs[0]!.id);
    expect(certs[0]!.completedAt).not.toBeNull();
    expect(ids(certs[0]!.moduleIds)).toEqual(sorted([main.m.gs!.id, main.m.tasks!.id]));

    const rows = await moduleRows(ana, main.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.via === 'LEARNED')).toBe(true);
    const gsRow = rows.find((r) => r.moduleId === main.m.gs!.id)!;
    expect(gsRow.doneAt.getTime()).toBe(s.units[0]!.doneAt!.getTime());
  });

  it('D3 role growth: the course stays completed, the new modules are new for the role, and finishing them adds a certificate', async () => {
    const ana = w.people.ana;
    const completedAt = (await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: ana, courseId: main.id } } })).completedAt!;
    await setAdmin(ana, true);
    let s = await loadState(ctx, ana, main.id);
    expect(s.state).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
    expect(s.units.map((u) => [u.unit.title, u.status, u.newForRole])).toEqual([
      ['Getting started', 'DONE', false],
      ['Tasks', 'DONE', false],
      ['Reports', 'NOT_STARTED', true],
      ['Admin settings', 'NOT_STARTED', true],
    ]);
    expect(s.continueAt).toEqual({ unitId: main.m.reports!.id, lessonId: main.m.reports!.guide });

    await finishModule(ana, main, 'reports');
    expect(await certificates(ana, main.id)).toHaveLength(1);
    const last = await finishModule(ana, main, 'admin');
    s = await loadState(ctx, ana, main.id);
    expect(s.state.status).toBe('COMPLETED');
    expect(s.enrolment!.completedAt!.getTime()).toBe(completedAt.getTime());
    const certs = await certificates(ana, main.id);
    expect(certs).toHaveLength(2);
    expect(certs[0]!.revokedAt).toBeNull();
    expect(ids(certs[1]!.moduleIds)).toEqual(sorted(Object.values(main.m).map((m) => m.id)));
    expect(certs[1]!.completedAt).not.toBeNull();
    expect(last!.certificateId).toBe(certs[1]!.id);
    expect(await moduleRows(ana, main.id)).toHaveLength(4);

    // Doing a lesson again changes nothing: the newest certificate covers every module.
    await learner.complete(ana, 'staff', main.m.reports!.guide!);
    expect(await certificates(ana, main.id)).toHaveLength(2);

    // A manager revokes the updated certificate: the next lesson done doesn't bring one back (review fix 1).
    await prisma.trainingCertificate.update({ where: { id: certs[1]!.id }, data: { revokedAt: new Date(), revokedReason: 'Revoked by a manager' } });
    await learner.complete(ana, 'staff', main.m.tasks!.guide!);
    const after = await certificates(ana, main.id);
    expect(after).toHaveLength(2);
    expect(after[1]!.revokedAt).not.toBeNull();
    expect(after[0]!.revokedAt).toBeNull();
  });

  it('D3 with an expiry: the updated certificate keeps the expiry of the one it updates', async () => {
    const c = await makeModuleCourse('Expiring', FOUR, { certificateMonths: 1 });
    const lea = await newPerson('lea');
    clockAt = new Date(Date.now() - 5 * 86_400_000);
    try {
      await finishModule(lea, c, 'gs');
      await finishModule(lea, c, 'tasks');
    } finally {
      clockAt = null;
    }
    await setAdmin(lea, true);
    await finishModule(lea, c, 'reports');
    await finishModule(lea, c, 'admin');
    const certs = await certificates(lea, c.id);
    expect(certs).toHaveLength(2);
    expect(certs[0]!.revokedAt).toBeNull();
    expect(certs[1]!.expiresAt!.getTime()).toBe(certs[0]!.expiresAt!.getTime());
    expect(ids(certs[1]!.moduleIds)).toHaveLength(4);
  });

  it('a certificate from before the course had modules covers what was done by then: a repeat adds nothing, a later module does', async () => {
    const c = await prisma.trainingCourse.create({ data: { title: `Split later ${w.tag}`, moduleKey: 'general', audience: 'STAFF', status: 'PUBLISHED', publishedAt: new Date(), certificateOn: true } });
    courseIds.push(c.id);
    const guide = async (title: string, moduleId: string | null = null) =>
      (await prisma.trainingLesson.create({ data: { courseId: c.id, moduleId, position: position++, kind: 'GUIDE', title, steps: { create: [{ position: 0, title: 'S', body: '<p>S</p>' }] } } })).id;
    const g1 = await guide('One');
    const g2 = await guide('Two');
    const mo = await newPerson('mo');
    await learner.complete(mo, 'staff', g1);
    expect((await learner.complete(mo, 'staff', g2)).courseCompleted).toBe(true);
    let certs = await certificates(mo, c.id);
    expect(certs).toHaveLength(1);
    expect(certs[0]!.moduleIds).toBeNull();

    // An admin splits the course into two modules afterwards.
    const mA = await prisma.trainingModule.create({ data: { courseId: c.id, position: 1, title: 'Part A', moduleKey: 'tasks' } });
    const mB = await prisma.trainingModule.create({ data: { courseId: c.id, position: 2, title: 'Part B', moduleKey: 'tasks' } });
    await prisma.trainingLesson.update({ where: { id: g1 }, data: { moduleId: mA.id } });
    await prisma.trainingLesson.update({ where: { id: g2 }, data: { moduleId: mB.id } });
    await new Promise((r) => setTimeout(r, 20));
    await learner.complete(mo, 'staff', g1);
    await learner.complete(mo, 'staff', g1);
    expect(await certificates(mo, c.id)).toHaveLength(1);

    // A module added later and finished after the certificate: an updated one listing every module.
    const mC = await prisma.trainingModule.create({ data: { courseId: c.id, position: 3, title: 'Part C', moduleKey: 'calendar' } });
    const g3 = await guide('Three', mC.id);
    const s = await loadState(ctx, mo, c.id);
    expect(s.state.status).toBe('COMPLETED');
    expect(s.units.map((u) => [u.unit.title, u.newForRole])).toEqual([
      ['Part A', false],
      ['Part B', false],
      ['Part C', true],
    ]);
    await learner.complete(mo, 'staff', g3);
    certs = await certificates(mo, c.id);
    expect(certs).toHaveLength(2);
    expect(certs[0]!.revokedAt).toBeNull();
    expect(ids(certs[1]!.moduleIds)).toEqual(sorted([mA.id, mB.id, mC.id]));
  });

  it('role shrink: an admin with all four done, demoted, stays completed with no new certificate', async () => {
    const dana = await newPerson('dana', 'ADMIN');
    for (const key of ['gs', 'tasks', 'reports', 'admin']) await finishModule(dana, main, key);
    expect(await certificates(dana, main.id)).toHaveLength(1);
    await setAdmin(dana, false);
    const s = await loadState(ctx, dana, main.id);
    expect(s.state).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
    expect(s.units.map((u) => [u.unit.title, u.status, u.newForRole])).toEqual([
      ['Getting started', 'DONE', false],
      ['Tasks', 'DONE', false],
    ]);
    await learner.complete(dana, 'staff', main.m.gs!.guide!);
    const certs = await certificates(dana, main.id);
    expect(certs).toHaveLength(1);
    expect(certs[0]!.revokedAt).toBeNull();
  });

  it('unlinked-only module: not a unit, and the course completes without it', async () => {
    const c = await makeModuleCourse('Unlinked', [
      { key: 'tasks', title: 'Tasks', moduleKey: 'tasks' },
      { key: 'video', title: 'Calendar', moduleKey: 'calendar', lessons: ['VIDEO'] },
    ]);
    const bob = w.people.bob;
    let s = await loadState(ctx, bob, c.id);
    expect(s.units.map((u) => u.unit.id)).toEqual([c.m.tasks!.id]);
    expect(s.lessons.map((l) => l.id)).toEqual(c.m.tasks!.lessons);
    const result = await finishModule(bob, c, 'tasks');
    expect(result!.courseCompleted).toBe(true);
    s = await loadState(ctx, bob, c.id);
    expect(s.state.status).toBe('COMPLETED');
    expect(ids((await certificates(bob, c.id))[0]!.moduleIds)).toEqual([c.m.tasks!.id]);
  });

  it('switched-off module: not a unit, not needed', async () => {
    const c = await makeModuleCourse('Switched off', [
      { key: 'tasks', title: 'Tasks', moduleKey: 'tasks' },
      { key: 'chat', title: 'Chat', moduleKey: 'chat', enabled: false },
    ]);
    const ben = w.people.ben;
    let s = await loadState(ctx, ben, c.id);
    expect(s.units.map((u) => u.unit.id)).toEqual([c.m.tasks!.id]);
    expect(s.modules.find((m) => m.id === c.m.chat!.id)).toMatchObject({ enabled: false });
    await finishModule(ben, c, 'tasks');
    s = await loadState(ctx, ben, c.id);
    expect(s.state.status).toBe('COMPLETED');
  });

  it('retake: after the certificate expires every module must be done again, then a new certificate', async () => {
    const c = await makeModuleCourse('Retake', FOUR.slice(0, 2), { certificateMonths: 1 });
    const eve = await newPerson('eve');
    clockAt = new Date(Date.now() - 40 * 86_400_000);
    try {
      await finishModule(eve, c, 'gs');
      await finishModule(eve, c, 'tasks');
    } finally {
      clockAt = null;
    }
    const [first] = await certificates(eve, c.id);
    expect(first!.expiresAt!.getTime()).toBeLessThan(Date.now());
    expect(await sync.applyExpiry(eve)).toBe(1);

    let s = await loadState(ctx, eve, c.id);
    expect(s.state).toMatchObject({ status: 'RETAKE', progressPct: 0 });
    expect(s.units.map((u) => u.status)).toEqual(['NOT_STARTED', 'NOT_STARTED']);
    expect(s.continueAt).toEqual({ unitId: c.m.gs!.id, lessonId: c.m.gs!.guide });

    await finishModule(eve, c, 'gs');
    s = await loadState(ctx, eve, c.id);
    expect(s.state).toMatchObject({ status: 'RETAKE', progressPct: 50 });
    expect(s.units.map((u) => u.status)).toEqual(['DONE', 'NOT_STARTED']);
    const result = await finishModule(eve, c, 'tasks');
    expect(result!.courseCompleted).toBe(true);
    s = await loadState(ctx, eve, c.id);
    expect(s.state.status).toBe('COMPLETED');

    const certs = await certificates(eve, c.id);
    expect(certs).toHaveLength(2);
    expect(certs[1]!.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(result!.certificateId).toBe(certs[1]!.id);
    const rows = await moduleRows(eve, c.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.doneAt.getTime()).toBeGreaterThanOrEqual(s.enrolment!.retakeFrom!.getTime());
  });

  it('recorded module stays done after a lesson is added', async () => {
    const c = await makeModuleCourse('Recorded', FOUR.slice(0, 2));
    const fay = await newPerson('fay');
    const gil = await newPerson('gil');
    await finishModule(fay, c, 'gs');
    await finishModule(fay, c, 'tasks');
    await finishModule(gil, c, 'gs');
    await prisma.trainingLesson.create({ data: { courseId: c.id, moduleId: c.m.gs!.id, position: position++, kind: 'GUIDE', title: 'Added later', steps: { create: [{ position: 0, title: 'S', body: '<p>S</p>' }] } } });

    const fs = await loadState(ctx, fay, c.id);
    expect(fs.state).toMatchObject({ status: 'COMPLETED', progressPct: 100 });
    expect(fs.units[0]).toMatchObject({ status: 'DONE', lessonsDone: 2, lessonCount: 3 });
    const gs = await loadState(ctx, gil, c.id);
    expect(gs.state).toMatchObject({ status: 'IN_PROGRESS', progressPct: 50 });
    expect(gs.units[0]).toMatchObject({ status: 'DONE', lessonsDone: 2, lessonCount: 3 });
    // Gil finishes the other module: the course completes without the added lesson.
    const result = await finishModule(gil, c, 'tasks');
    expect(result!.courseCompleted).toBe(true);
  });
});

describe('settle and completeAt', () => {
  /** Lessons done without the learner service (so nothing settled them yet). */
  async function doneRows(userId: string, c: MadeCourse, keys: string[], at = new Date()) {
    await prisma.trainingEnrolment.createMany({ data: [{ userId, courseId: c.id, startedAt: at }], skipDuplicates: true });
    for (const key of keys) for (const lessonId of c.m[key]!.lessons) await prisma.trainingProgress.create({ data: { userId, courseId: c.id, lessonId, doneAt: at } });
  }

  it('settle reports the module it newly recorded, once', async () => {
    const hal = await newPerson('hal');
    await doneRows(hal, main, ['gs']);
    const course = await courseRow(main.id);
    const out = await finish.settle(hal, course, await loadState(ctx, hal, main.id));
    expect(out).toMatchObject({ courseCompleted: false, certificateId: null, moduleDone: { id: main.m.gs!.id, title: 'Getting started' } });
    const again = await finish.settle(hal, course, await loadState(ctx, hal, main.id));
    expect(again.moduleDone).toBeNull();
    expect(await moduleRows(hal, main.id)).toHaveLength(1);
  });

  it('two settles at once for a grown role issue one updated certificate', async () => {
    const ivy = await newPerson('ivy');
    await finishModule(ivy, main, 'gs');
    await finishModule(ivy, main, 'tasks');
    expect(await certificates(ivy, main.id)).toHaveLength(1);
    await setAdmin(ivy, true);
    await doneRows(ivy, main, ['reports', 'admin']);
    const course = await courseRow(main.id);
    const state = await loadState(ctx, ivy, main.id);
    const person = await loadPerson(prisma, ivy);
    const [a, b] = await Promise.all([finish.settle(ivy, course, state, { person }), finish.settle(ivy, course, state, { person })]);
    const certs = await certificates(ivy, main.id);
    expect(certs).toHaveLength(2);
    expect(certs.every((x) => x.revokedAt === null)).toBe(true);
    expect([a.certificateId, b.certificateId].filter(Boolean)).toEqual([certs[1]!.id]);
    expect(await moduleRows(ivy, main.id)).toHaveLength(4);
    expect([a.moduleDone, b.moduleDone].filter(Boolean)).toHaveLength(1);
  });

  it('completeAt finishes quietly on the given day with its certificate; a second call changes nothing', async () => {
    const jon = await newPerson('jon');
    await doneRows(jon, main, ['gs', 'tasks']);
    const course = await courseRow(main.id);
    const person = (await loadPerson(prisma, jon))!;
    const day = new Date('2026-10-20T08:00:00Z');
    const before = notices.length;
    const out = await finish.completeAt(jon, course, await loadState(ctx, jon, main.id), day, person);
    expect(out.completed).toBe(true);
    const e = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: jon, courseId: main.id } } });
    expect(e.completedAt!.getTime()).toBe(day.getTime());
    expect(e.progressPct).toBe(100);
    const certs = await certificates(jon, main.id);
    expect(certs).toHaveLength(1);
    expect(out.certificateId).toBe(certs[0]!.id);
    expect(certs[0]!.completedAt!.getTime()).toBe(day.getTime());
    expect(ids(certs[0]!.moduleIds)).toEqual(sorted([main.m.gs!.id, main.m.tasks!.id]));
    expect(notices.length).toBe(before);
    expect(await finish.completeAt(jon, course, await loadState(ctx, jon, main.id), day, person)).toEqual({ completed: false, certificateId: null });
    expect(await certificates(jon, main.id)).toHaveLength(1);
  });

  it('completeAt leaves someone with a module still to do alone', async () => {
    const kim = await newPerson('kim');
    await doneRows(kim, main, ['gs']);
    const out = await finish.completeAt(kim, await courseRow(main.id), await loadState(ctx, kim, main.id), new Date(), (await loadPerson(prisma, kim))!);
    expect(out).toEqual({ completed: false, certificateId: null });
    expect(await certificates(kim, main.id)).toHaveLength(0);
  });
});
