import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import { validationErrorBody } from '../../src/lib/validation-errors';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthGuard } from '../../src/modules/auth/auth-guard';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingReports } from '../../src/modules/training/training-report-service';
import { registerTrainingReportRoutes } from '../../src/modules/training/training-report-routes';
import type { Paper } from '../../src/modules/training/training-quiz';
import { newCertificateCode } from '../../src/modules/training/training-certificates';
import type { QuizReport, ReportRow, TrainingReport } from '../../src/modules/training/training-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// Training reports on a real database (R5): administrators see everyone (a client too); a Training manager
// the people of their companies (and clients of projects there); whoever runs a project their projects'
// teams (read-only, never clients); anyone else — an employee, a client — is refused. Rows by course,
// person, department, role, company and project; the period ("who got it then"); overdue training,
// certificates expiring, quiz results per question; the Excel and PDF files.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const DAY = 86_400_000;

let w: CompanyWorld;
let app: FastifyInstance;
let clientId: string;
let deptId: string;
const filesDir = join(mkdtempSync(join(tmpdir(), 'tr-')), 'training-files');
const C: Record<'c1' | 'c2' | 'c3' | 'c4', string> = { c1: '', c2: '', c3: '', c4: '' };
let guideLesson: string;
let quizLesson: string;
let quizId: string;
const Q: Record<'q1' | 'q2', string> = { q1: '', q2: '' };
const O: Record<'a' | 'b' | 't' | 'f', string> = { a: '', b: '', t: '', f: '' };
const tokenService = createTokenService({
  accessSecret: 'training-reports-access',
  refreshSecret: 'training-reports-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(filesDir),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  notify: async () => {},
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const reports = createTrainingReports(ctx);

type Who = 'admin' | 'ana' | 'amy' | 'ben' | 'bob' | 'cat' | 'client';
const idOf = (who: Who) => (who === 'client' ? clientId : w.people[who]);
const rolesOf = (who: Who) => (who === 'client' ? ['CLIENT'] : who === 'admin' ? ['ADMIN'] : ['EMPLOYEE']);
async function get(who: Who, path: string) {
  const { accessToken } = await tokenService.issueTokens({ id: idOf(who), roles: rolesOf(who) });
  return app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { authorization: `Bearer ${accessToken}` } });
}
async function data<T>(who: Who, path: string): Promise<T> {
  const res = await get(who, path);
  if (res.statusCode !== 200) throw new Error(`GET ${path} as ${who} → ${res.statusCode}: ${res.body}`);
  return (res.json() as { data: T }).data;
}
const keys = (rows: ReportRow[]) => rows.map((r) => r.key).sort();
const rowOf = (rows: ReportRow[], key: string) => rows.find((r) => r.key === key);
const sorted = (ids: string[]) => [...ids].sort();

async function course(title: string, o: { audience?: string; moduleKey?: string; status?: string } = {}) {
  const status = o.status ?? 'PUBLISHED';
  return (
    await prisma.trainingCourse.create({
      data: { title: `${title} ${w.tag}`, moduleKey: o.moduleKey ?? 'tasks', audience: o.audience ?? 'STAFF', status, publishedAt: status === 'DRAFT' ? null : new Date() },
    })
  ).id;
}
async function enrol(userId: string, courseId: string, o: { started?: boolean; completed?: boolean; withdrawn?: boolean; createdDaysAgo?: number; selfStarted?: boolean } = {}) {
  const at = new Date(Date.now() - (o.createdDaysAgo ?? 0) * DAY);
  await prisma.trainingEnrolment.create({
    data: {
      userId,
      courseId,
      createdAt: at,
      selfStarted: o.selfStarted ?? false,
      startedAt: o.started || o.completed ? at : null,
      completedAt: o.completed ? new Date() : null,
      completedVersion: o.completed ? 1 : null,
      progressPct: o.completed ? 100 : 0,
      withdrawnAt: o.withdrawn ? new Date() : null,
    },
  });
}
async function assign(userId: string, courseId: string, mandatory: boolean, dueDay: string) {
  const a = await prisma.trainingAssignment.create({ data: { courseId, targetKind: 'USER', targetId: userId, mandatory, dueDay, createdById: w.people.admin } });
  await prisma.trainingAssignee.create({ data: { assignmentId: a.id, userId, courseId, mandatory, dueDay } });
}
function paper(): Paper {
  return {
    passMark: 70,
    questions: [
      { id: Q.q1, kind: 'SINGLE', prompt: 'Pick A', explanation: null, position: 0, options: [{ id: O.a, text: 'A', correct: true, feedback: null, position: 0 }, { id: O.b, text: 'B', correct: false, feedback: null, position: 1 }] },
      { id: Q.q2, kind: 'TRUE_FALSE', prompt: 'True?', explanation: null, position: 1, options: [{ id: O.t, text: 'True', correct: true, feedback: null, position: 0 }, { id: O.f, text: 'False', correct: false, feedback: null, position: 1 }] },
    ],
  };
}
async function attempt(userId: string, answers: Record<string, string[]> | null, scorePct: number | null, passed: boolean | null, submitted = true) {
  await prisma.trainingAttempt.create({
    data: { userId, courseId: C.c1, lessonId: quizLesson, quizId, paper: paper() as object, answers: (answers ?? undefined) as object | undefined, scorePct, passed, submittedAt: submitted ? new Date() : null },
  });
}
async function certificate(userId: string, courseId: string, days: number, revoked = false) {
  await prisma.trainingCertificate.create({
    data: {
      code: newCertificateCode(),
      userId,
      courseId,
      learnerName: 'Someone',
      courseTitle: 'Course',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + days * DAY),
      revokedAt: revoked ? new Date() : null,
    },
  });
}

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  clientId = (await prisma.user.create({ data: { email: `client.${w.tag}@world.test`, username: `client_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } })).id;
  await prisma.clientProjectGrant.create({ data: { userId: clientId, projectId: w.projects.PA, progress: true } });
  deptId = (await prisma.department.create({ data: { name: `Field ${w.tag}` } })).id;
  await prisma.user.update({ where: { id: w.people.ana }, data: { departmentId: deptId } });

  C.c1 = await course('Tasks basics');
  C.c2 = await course('Meetings', { moduleKey: 'meetings' });
  C.c3 = await course('Portal', { audience: 'CLIENTS', moduleKey: 'portal' });
  C.c4 = await course('Draft', { status: 'DRAFT' });
  guideLesson = (await prisma.trainingLesson.create({ data: { courseId: C.c1, kind: 'GUIDE', title: 'Read', position: 0 } })).id;
  quizLesson = (await prisma.trainingLesson.create({ data: { courseId: C.c1, kind: 'QUIZ', title: 'Check', position: 1 } })).id;
  quizId = (await prisma.trainingQuiz.create({ data: { lessonId: quizLesson, passMark: 70 } })).id;
  const q1 = await prisma.trainingQuestion.create({ data: { quizId, kind: 'SINGLE', prompt: 'Pick A', position: 0, options: { create: [{ text: 'A', correct: true, position: 0 }, { text: 'B', position: 1 }] } }, include: { options: true } });
  const q2 = await prisma.trainingQuestion.create({ data: { quizId, kind: 'TRUE_FALSE', prompt: 'True?', position: 1, options: { create: [{ text: 'True', correct: true, position: 0 }, { text: 'False', position: 1 }] } }, include: { options: true } });
  Q.q1 = q1.id;
  Q.q2 = q2.id;
  O.a = q1.options.find((o) => o.text === 'A')!.id;
  O.b = q1.options.find((o) => o.text === 'B')!.id;
  O.t = q2.options.find((o) => o.text === 'True')!.id;
  O.f = q2.options.find((o) => o.text === 'False')!.id;

  const P = w.people;
  await enrol(P.ana, C.c1, { completed: true });
  await enrol(P.cat, C.c1, { started: true });
  await enrol(P.ben, C.c1, { completed: true });
  await enrol(P.gus, C.c1, { completed: true });
  await enrol(P.bob, C.c1, { started: true, withdrawn: true });
  await enrol(P.ana, C.c2);
  await assign(P.ana, C.c2, true, shiftDayKey(today, -3));
  await enrol(P.bob, C.c2, { createdDaysAgo: 40 });
  await assign(P.bob, C.c2, false, shiftDayKey(today, 5));
  await enrol(P.amy, C.c2, { started: true, selfStarted: true });
  await enrol(clientId, C.c3, { started: true, selfStarted: true });
  await enrol(P.ana, C.c4, { started: true });

  await attempt(P.ana, { [Q.q1]: [O.a], [Q.q2]: [O.t] }, 100, true);
  await attempt(P.cat, { [Q.q1]: [O.b], [Q.q2]: [O.t] }, 50, false);
  await attempt(P.gus, { [Q.q1]: [O.a] }, null, null, false); // still open: never counted

  await certificate(P.ana, C.c1, 10);
  await certificate(P.ben, C.c1, 20);
  await certificate(clientId, C.c3, 25);
  await certificate(P.gus, C.c1, 5, true); // revoked
  await certificate(P.gus, C.c1, 60); // not soon

  const guard = createAuthGuard(tokenService);
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    if (err instanceof ZodError) return reply.status(400).send(validationErrorBody(err));
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { code: 'ERROR', message: (err as Error).message } });
  });
  await app.register(async (api) => registerTrainingReportRoutes(api, { reports, guard, userName: async () => 'Admin World' }), { prefix: '/api/v1' });
});

afterAll(async () => {
  const courseIds = Object.values(C).filter(Boolean);
  const users = [...Object.values(w.people), clientId];
  await prisma.trainingAttempt.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCertificate.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignee.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingEnrolment.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingProgress.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.clientProjectGrant.deleteMany({ where: { userId: clientId } });
  await prisma.user.updateMany({ where: { id: w.people.ana }, data: { departmentId: null } });
  await prisma.user.deleteMany({ where: { id: clientId } });
  await prisma.department.deleteMany({ where: { id: deptId } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('who may see training reports (R5)', () => {
  it('an employee who runs no project and a client are refused on every report route', async () => {
    for (const path of ['/training/reports', `/training/reports/quiz/${quizLesson}`, '/training/reports/export.xlsx', '/training/reports/export.pdf']) {
      expect((await get('bob', path)).statusCode, `bob ${path}`).toBe(403);
      expect((await get('client', path)).statusCode, `client ${path}`).toBe(403);
    }
  });

  it('an administrator sees everyone (a client too), and drafts and withdrawn training are left out', async () => {
    const r = await data<TrainingReport>('admin', '/training/reports?by=course');
    expect(r.scope).toBe('ALL');
    expect(rowOf(r.rows, C.c4)).toBeUndefined();
    expect(rowOf(r.rows, C.c1)).toMatchObject({ key: C.c1, label: `Tasks basics ${w.tag}`, people: 4, assigned: 0, started: 4, completed: 3, overdue: 0, completionRate: 75, averageScore: 75 });
    expect(rowOf(r.rows, C.c2)).toMatchObject({ people: 3, assigned: 2, started: 1, completed: 0, overdue: 1, completionRate: 0, averageScore: null });
    expect(rowOf(r.rows, C.c3)).toMatchObject({ people: 1, started: 1 });
    const people = await data<TrainingReport>('admin', '/training/reports?by=person');
    expect(keys(people.rows)).toEqual(sorted([w.people.ana, w.people.cat, w.people.ben, w.people.gus, w.people.bob, w.people.amy, clientId]));
  });

  it('a Training manager sees the people of her companies and clients of projects there, nobody else', async () => {
    const r = await data<TrainingReport>('amy', '/training/reports?by=person');
    expect(r.scope).toBe('COMPANIES');
    expect(keys(r.rows)).toEqual(sorted([w.people.ana, w.people.amy, w.people.cat, clientId]));
    expect(rowOf(r.rows, w.people.ana)).toMatchObject({ people: 1, enrolments: 2, completed: 1, overdue: 1 });
  });

  it('whoever runs a project sees its team (themselves too), read-only, never a client or someone off the team', async () => {
    const r = await data<TrainingReport>('ben', '/training/reports?by=person');
    expect(r.scope).toBe('TEAM');
    expect(keys(r.rows)).toEqual(sorted([w.people.ben, w.people.cat]));
  });
});

describe('rows by course, person, department, role, company and project', () => {
  it('department, role, company and project groups', async () => {
    const dept = await data<TrainingReport>('admin', '/training/reports?by=department');
    expect(rowOf(dept.rows, deptId)).toMatchObject({ label: `Field ${w.tag}`, people: 1, enrolments: 2 });
    const role = await data<TrainingReport>('admin', '/training/reports?by=role');
    expect(rowOf(role.rows, 'clients')).toMatchObject({ label: 'Clients', people: 1 });
    expect(rowOf(role.rows, 'employees')).toMatchObject({ label: 'Employees', people: 6, enrolments: 7 });
    expect(rowOf(role.rows, 'admins')).toBeUndefined();
    const company = await data<TrainingReport>('amy', '/training/reports?by=company');
    expect(rowOf(company.rows, w.companies.A)).toMatchObject({ label: `Alpha ${w.tag}`, people: 4, enrolments: 5 });
    // M6: Beta isn't hers — Cat (in both) counts under “Other”, never named.
    expect(rowOf(company.rows, w.companies.B)).toBeUndefined();
    expect(rowOf(company.rows, 'other')).toMatchObject({ label: 'Other', people: 1 });
    const project = await data<TrainingReport>('admin', '/training/reports?by=project');
    expect(rowOf(project.rows, w.projects.PA)).toMatchObject({ people: 2, enrolments: 3 });
    expect(rowOf(project.rows, w.projects.PB)).toMatchObject({ people: 2 });
    expect(rowOf(project.rows, w.projects.PC)).toBeUndefined(); // an archived company's project
  });

  it('one course, and a period (who got it then)', async () => {
    const one = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c2}`);
    expect(keys(one.rows)).toEqual(sorted([w.people.ana, w.people.bob, w.people.amy]));
    const recent = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c2}&from=${shiftDayKey(today, -10)}&to=${today}`);
    expect(keys(recent.rows)).toEqual(sorted([w.people.ana, w.people.amy]));
    expect((await get('admin', `/training/reports?from=${today}&to=${shiftDayKey(today, -1)}`)).statusCode).toBe(400);
    expect((await get('admin', '/training/reports?by=nonsense')).statusCode).toBe(400);
    expect((await get('admin', '/training/reports?courseId=nocourse123')).statusCode).toBe(404);
  });
});

describe('overdue, certificates expiring and quizzes', () => {
  it('overdue training with how late and whether it is mandatory', async () => {
    const r = await data<TrainingReport>('admin', '/training/reports');
    const mine = r.overdue.filter((o) => [C.c1, C.c2, C.c3].includes(o.courseId));
    expect(mine).toEqual([{ userId: w.people.ana, name: `Ana Alpha ${w.tag}`, courseId: C.c2, courseTitle: `Meetings ${w.tag}`, dueDay: shiftDayKey(today, -3), daysLate: 3, mandatory: true, client: false }]);
    expect((await data<TrainingReport>('ben', '/training/reports')).overdue).toEqual([]);
  });

  it('valid certificates expiring in the next 30 days, soonest first, in scope', async () => {
    const all = await data<TrainingReport>('admin', '/training/reports');
    expect(all.expiring.map((e) => e.userId)).toEqual([w.people.ana, w.people.ben, clientId]);
    expect((await data<TrainingReport>('amy', '/training/reports')).expiring.map((e) => e.userId)).toEqual([w.people.ana, clientId]);
    expect((await data<TrainingReport>('ben', '/training/reports')).expiring.map((e) => e.userId)).toEqual([w.people.ben]);
  });

  it('each quiz: handed-in attempts in scope, pass rate and average', async () => {
    const all = await data<TrainingReport>('admin', '/training/reports');
    expect(all.quizzes.find((q) => q.lessonId === quizLesson)).toMatchObject({ lessonId: quizLesson, courseTitle: `Tasks basics ${w.tag}`, title: 'Check', attempts: 2, passRate: 50, averageScore: 75 });
    expect((await data<TrainingReport>('ben', '/training/reports')).quizzes.find((q) => q.lessonId === quizLesson)).toMatchObject({ attempts: 1, passRate: 0, averageScore: 50 });
  });

  it('a quiz’s questions: how often each was answered right; not a quiz → 404', async () => {
    const q = await data<QuizReport>('admin', `/training/reports/quiz/${quizLesson}`);
    expect(q).toEqual({
      lessonId: quizLesson,
      courseTitle: `Tasks basics ${w.tag}`,
      title: 'Check',
      attempts: 2,
      people: 2,
      passRate: 50,
      averageScore: 75,
      questions: [
        { id: Q.q1, prompt: 'Pick A', answered: 2, rightPct: 50 },
        { id: Q.q2, prompt: 'True?', answered: 2, rightPct: 100 },
      ],
    });
    expect((await data<QuizReport>('ben', `/training/reports/quiz/${quizLesson}`)).attempts).toBe(1);
    expect((await get('admin', `/training/reports/quiz/${guideLesson}`)).statusCode).toBe(404);
    expect((await get('admin', '/training/reports/quiz/nope')).statusCode).toBe(404);
  });
});

describe('the files', () => {
  it('Excel and PDF with the server’s file name, never cached', async () => {
    const x = await get('admin', `/training/reports/export.xlsx?by=course&courseId=${C.c1}`);
    expect(x.statusCode).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect(String(x.headers['content-disposition'])).toContain(`Learning Hub report by course ${today}.xlsx`);
    expect(x.headers['cache-control']).toBe('no-store');
    expect(x.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const p = await get('amy', '/training/reports/export.pdf?by=person');
    expect(p.statusCode).toBe(200);
    expect(p.headers['content-type']).toBe('application/pdf');
    expect(String(p.headers['content-disposition'])).toContain(`Learning Hub report by person ${today}.pdf`);
    expect(p.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('people once, Started themselves and Dates by', () => {
  it('people are distinct persons, enrolments the rows, the rate is of enrolments, Started themselves counts those not assigned', async () => {
    const r = await data<TrainingReport>('admin', '/training/reports?by=course');
    expect(r.totals.enrolments).toBeGreaterThanOrEqual(r.totals.people);
    const people = await data<TrainingReport>('admin', '/training/reports?by=person');
    expect(rowOf(people.rows, w.people.ana)).toMatchObject({ people: 1, enrolments: 2, completed: 1, completionRate: 50 });
    expect(rowOf(r.rows, C.c2)).toMatchObject({ people: 3, enrolments: 3, selfStarted: 1 });
    expect(rowOf(r.rows, C.c3)).toMatchObject({ people: 1, enrolments: 1, selfStarted: 1 });
    expect(rowOf(r.rows, C.c1)).toMatchObject({ people: 4, enrolments: 4, selfStarted: 0, completionRate: 75 });
  });

  it('a person given the training now is not "started themselves", even if they began it that way', async () => {
    await assign(w.people.amy, C.c2, false, shiftDayKey(today, 30));
    try {
      const r = await data<TrainingReport>('admin', '/training/reports?by=course');
      expect(rowOf(r.rows, C.c2)).toMatchObject({ assigned: 3, selfStarted: 0 });
    } finally {
      await prisma.trainingAssignee.deleteMany({ where: { courseId: C.c2, userId: w.people.amy } });
      await prisma.trainingAssignment.deleteMany({ where: { courseId: C.c2, targetId: w.people.amy } });
    }
  });

  it('Dates by finished: only finished enrolments, by the day they finished; the answer says which basis', async () => {
    const got = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c1}`);
    expect(got.dates).toBe('got');
    expect(keys(got.rows)).toEqual(sorted([w.people.ana, w.people.cat, w.people.ben, w.people.gus]));
    const done = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c1}&dates=finished`);
    expect(done.dates).toBe('finished');
    expect(keys(done.rows)).toEqual(sorted([w.people.ana, w.people.ben, w.people.gus]));
    const span = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c1}&dates=finished&from=${shiftDayKey(today, -1)}&to=${today}`);
    expect(keys(span.rows)).toEqual(sorted([w.people.ana, w.people.ben, w.people.gus]));
    const later = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c1}&dates=finished&from=${shiftDayKey(today, 1)}`);
    expect(later.rows).toEqual([]);
    // "Got it" for a period still goes by the day they got it: Bob's c2 enrolment is 40 days old.
    const old = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c2}&from=${shiftDayKey(today, -45)}&to=${shiftDayKey(today, -35)}`);
    expect(keys(old.rows)).toEqual([w.people.bob]);
    expect((await get('admin', '/training/reports?dates=yesterday')).statusCode).toBe(400);
  });

  it('the files answer for either basis', async () => {
    expect((await get('admin', '/training/reports/export.xlsx?by=course&dates=finished')).statusCode).toBe(200);
    expect((await get('admin', '/training/reports/export.pdf?by=course')).statusCode).toBe(200);
  });
});

describe('one course with modules: by module and by person', () => {
  let cm = '';
  let m1 = '';
  let quizNone = '';

  beforeAll(async () => {
    const P = w.people;
    cm = (await prisma.trainingCourse.create({ data: { title: `One course ${w.tag}`, moduleKey: 'general', audience: 'STAFF', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 60 * DAY), certificateOn: true } })).id;
    const specs = [
      { key: 'start', title: 'Getting started', moduleKey: 'tasks' },
      { key: 'tasks', title: 'Tasks', moduleKey: 'tasks' },
      { key: 'reports', title: 'Reports', moduleKey: 'reports' },
      { key: 'admin', title: 'Admin settings', moduleKey: 'admin' },
    ];
    const mods: Record<string, { id: string; guides: string[] }> = {};
    for (const [i, s] of specs.entries()) {
      const mod = await prisma.trainingModule.create({ data: { courseId: cm, position: i + 1, title: s.title, moduleKey: s.moduleKey } });
      const g1 = await prisma.trainingLesson.create({ data: { courseId: cm, moduleId: mod.id, kind: 'GUIDE', title: `${s.title} guide 1`, position: i * 10 } });
      const g2 = await prisma.trainingLesson.create({ data: { courseId: cm, moduleId: mod.id, kind: 'GUIDE', title: `${s.title} guide 2`, position: i * 10 + 1 } });
      mods[s.key] = { id: mod.id, guides: [g1.id, g2.id] };
    }
    m1 = mods.start!.id;
    // A quiz nobody has tried, in the "Tasks" module.
    quizNone = (await prisma.trainingLesson.create({ data: { courseId: cm, moduleId: mods.tasks!.id, kind: 'QUIZ', title: 'Tasks check', position: 15 } })).id;
    const qz = await prisma.trainingQuiz.create({ data: { lessonId: quizNone, passMark: 70 } });
    for (const n of [0, 1, 2]) await prisma.trainingQuestion.create({ data: { quizId: qz.id, kind: 'SINGLE', prompt: `Q${n}`, position: n, options: { create: [{ text: 'A', correct: true, position: 0 }, { text: 'B', position: 1 }] } } });

    await enrol(P.ana, cm, { started: true });
    await enrol(P.admin, cm, { started: true });
    // Ana: "Getting started" done (recorded), "Tasks" begun (a guide done). The administrator: "Reports" done.
    await prisma.trainingModuleDone.create({ data: { userId: P.ana, courseId: cm, moduleId: mods.start!.id, doneAt: new Date() } });
    await prisma.trainingProgress.create({ data: { userId: P.ana, courseId: cm, lessonId: mods.tasks!.guides[0]!, doneAt: new Date() } });
    await prisma.trainingModuleDone.create({ data: { userId: P.admin, courseId: cm, moduleId: mods.reports!.id, doneAt: new Date() } });
    const cert = (userId: string, code: string, o: { revoked?: boolean; expired?: boolean; at: number }) =>
      prisma.trainingCertificate.create({
        data: { code, userId, courseId: cm, learnerName: 'Someone', courseTitle: 'MICO360 Tasks User Training', issuedAt: new Date(Date.now() - o.at * DAY), expiresAt: o.expired ? new Date(Date.now() - DAY) : null, revokedAt: o.revoked ? new Date() : null },
      });
    await cert(P.admin, `MT-OLD${w.tag}`.slice(0, 24), { at: 5 });
    await cert(P.admin, `MT-REV${w.tag}`.slice(0, 24), { at: 1, revoked: true });
    await cert(P.admin, `MT-EXP${w.tag}`.slice(0, 24), { at: 2, expired: true });
  });

  afterAll(async () => {
    await prisma.trainingCertificate.deleteMany({ where: { courseId: cm } });
    await prisma.trainingModuleDone.deleteMany({ where: { courseId: cm } });
    await prisma.trainingProgress.deleteMany({ where: { courseId: cm } });
    await prisma.trainingEnrolment.deleteMany({ where: { courseId: cm } });
    await prisma.trainingCourse.deleteMany({ where: { id: cm } });
  });

  it('modules count only the people who can see them; learners show modules done of needed', async () => {
    const r = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${cm}`);
    expect(r.modules).toEqual([
      { moduleId: m1, title: 'Getting started', people: 2, done: 1, inProgress: 0, notStarted: 1 },
      expect.objectContaining({ title: 'Tasks', people: 2, done: 0, inProgress: 1, notStarted: 1 }),
      expect.objectContaining({ title: 'Reports', people: 1, done: 1, inProgress: 0, notStarted: 0 }),
      expect.objectContaining({ title: 'Admin settings', people: 1, done: 0, inProgress: 0, notStarted: 1 }),
    ]);
    const by = new Map(r.learners!.map((l) => [l.userId, l]));
    expect(by.get(w.people.ana)).toMatchObject({ name: `Ana Alpha ${w.tag}`, modulesDone: 1, modulesRequired: 2, certificate: null });
    expect(by.get(w.people.admin)).toMatchObject({ modulesDone: 1, modulesRequired: 4 });
    // The newest valid certificate: not the revoked one, not the expired one.
    expect(by.get(w.people.admin)!.certificate!.code).toBe(`MT-OLD${w.tag}`.slice(0, 24));
    const names = r.learners!.map((l) => l.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('other reports have no module views', async () => {
    expect((await data<TrainingReport>('admin', '/training/reports?by=course')).modules).toBeNull();
    const plain = await data<TrainingReport>('admin', `/training/reports?by=person&courseId=${C.c1}`);
    expect(plain.modules).toBeNull();
    expect(plain.learners).toBeNull();
  });

  it('a manager sees only the people in scope in the module views', async () => {
    const r = await data<TrainingReport>('amy', `/training/reports?by=person&courseId=${cm}`);
    expect(r.learners!.map((l) => l.userId)).toEqual([w.people.ana]);
    expect(r.modules!.find((m) => m.title === 'Getting started')).toMatchObject({ people: 1, done: 1 });
  });

  it('quizzes with nobody trying them are listed, with their module, people and question count', async () => {
    const r = await data<TrainingReport>('admin', `/training/reports?courseId=${cm}`);
    expect(r.quizzes.find((q) => q.lessonId === quizNone)).toMatchObject({ title: 'Tasks check', moduleTitle: 'Tasks', attempts: 0, people: 0, passRate: null, averageScore: null, questions: 3 });
    const old = (await data<TrainingReport>('admin', '/training/reports')).quizzes.find((q) => q.lessonId === quizLesson);
    expect(old).toMatchObject({ moduleTitle: null, questions: 2, people: 2 });
  });

  it('the files carry By module and By person', async () => {
    expect((await get('admin', `/training/reports/export.xlsx?by=person&courseId=${cm}&dates=finished`)).statusCode).toBe(200);
    expect((await get('admin', `/training/reports/export.pdf?by=person&courseId=${cm}`)).statusCode).toBe(200);
  });
});
