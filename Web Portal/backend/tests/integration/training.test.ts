import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { portabilityProblems } from '../../src/lib/sql-portability';
import { createTrainingFromPrisma } from '../../src/modules/training/training-wiring';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { REMINDERS_SINCE_KEY } from '../../src/modules/training/training-sweeps';
import type { Viewer } from '../../src/modules/companies/company-access';
import type { AttemptPaper, AttemptResult, CourseDetail, LessonView, ManageCourse, ManageLesson, MyTraining, PortalTraining, TrainingReport, VerifyResult } from '../../src/modules/training/training-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// The Training Center end to end through the REAL app (buildApp: the auth guard, both route tables, the app's
// multipart registration and error handler): who may use what (employee, client, Training manager,
// administrator, project manager), a client's isolation from staff courses, files and attempts, a Training
// manager's company scope, assignments to a department and a project that follow membership, an onboarding
// rule for new accounts only, a learner's journey (resume, quiz papers without answers, marking, certificate,
// public check), expiry → retake, revoke, reminders through the engine (first run records only, escalation to
// Reports to), reports' scopes, and MariaDB-safe SQL. The detailed cases per area are in training-manage,
// training-learner, training-reports, training-reminders and training-starter.test.ts.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const MB = 1024 * 1024;
const PNG = readFileSync(resolve(__dirname, '../../assets/logo-pdf.png'));
const PDF = (size = 2048) => Buffer.concat([Buffer.from('%PDF-1.4\n%training\n'), Buffer.alloc(size)]);

/** The services' clock: now, moved by `shiftMs` (a year on, for expiry). */
let shiftMs = 0;
const clockNow = () => new Date(Date.now() + shiftMs);
const notices: { userId: string; type: string; title: string; entityType: string | null; entityId: string | null }[] = [];
const training = createTrainingFromPrisma(prisma, {
  files: createTrainingFileStore(join(mkdtempSync(join(tmpdir(), 'tr-e2e-')), 'training-files')),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  now: clockNow,
  notify: async (n) => {
    notices.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
  starterCourses: [],
});

let w: CompanyWorld;
let api: CompanyApp;
let client: Viewer;
let newbie: string | null = null;
let deptId: string;
const courseIds: string[] = [];
let staffCourse: ManageCourse;
let clientCourse: ManageCourse;
let guide: ManageLesson;
let quiz: ManageLesson;
let staffResource: string;
let clientResource: string;
let certId: string;
let certCode: string;
let attemptId: string;
const savedSettings = new Map<string, unknown>();

type Res = { statusCode: number; body: string; json(): unknown };
const data = <T>(res: Res, status = 200): T => {
  if (res.statusCode !== status) throw new Error(`${res.statusCode}: ${res.body}`);
  return (res.json() as { data: T }).data;
};
async function send(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', who: Viewer, path: string, body?: unknown): Promise<Res> {
  return (await api.app.inject({ method, url: `/api/v1${path}`, headers: { authorization: await api.bearer(who) }, ...(body === undefined ? {} : { payload: body as object }) })) as unknown as Res;
}
async function upload(who: Viewer, path: string, file: { name: string; type: string; content: Buffer }, fields: Record<string, string> = {}): Promise<Res> {
  const boundary = `----tr${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.content, Buffer.from(`\r\n--${boundary}--\r\n`));
  return (await api.app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: { authorization: await api.bearer(who), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  })) as unknown as Res;
}
const code = (res: Res) => (res.json() as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  for (const key of [REMINDERS_SINCE_KEY, 'training.tour']) {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    savedSettings.set(key, row?.value);
  }
  await prisma.systemSetting.deleteMany({ where: { key: REMINDERS_SINCE_KEY } });
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  deptId = (await prisma.department.create({ data: { name: `Training dept ${w.tag}` } })).id;
  await prisma.user.updateMany({ where: { id: { in: [w.people.ana, w.people.bob] } }, data: { departmentId: deptId } });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  const c = await prisma.user.create({ data: { email: `trclient.${w.tag}@world.test`, username: `trclient_${w.tag}`, passwordHash: 'x', firstName: 'Clara', lastName: 'Client', roles: { create: { roleId: role.id } } } });
  await prisma.clientProjectGrant.create({ data: { userId: c.id, projectId: w.projects.PA, progress: true } });
  client = { id: c.id, roles: ['CLIENT'] };
  api = await buildCompanyApp(prisma, () => ({ training: { learner: training.learner, manage: training.manage, reports: training.reports } }));
});

afterAll(async () => {
  const users = [...Object.values(w.people), client.id, ...(newbie ? [newbie] : [])];
  const where = { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] };
  await prisma.trainingAttempt.deleteMany({ where });
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingAssignee.deleteMany({ where });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingRule.deleteMany({ where: { createdById: { in: users } } });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingFeedback.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingFile.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.reminderLog.deleteMany({ where: { dedupeKey: { startsWith: 'np:tr:' } } });
  for (const [key, value] of savedSettings) {
    if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  }
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  await prisma.clientProjectGrant.deleteMany({ where: { userId: client.id } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: [client.id, ...(newbie ? [newbie] : [])] } } });
  await prisma.user.updateMany({ where: { id: { in: Object.values(w.people) } }, data: { departmentId: null } });
  await prisma.department.deleteMany({ where: { id: deptId } });
  await api.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('authoring through the real app (multipart, the 25 MB training limit)', () => {
  it('a Training manager makes, fills and publishes a staff course and a client course', async () => {
    const amy = w.as.amy;
    staffCourse = data<ManageCourse>(
      await send('POST', amy, '/training/manage/courses', { title: 'Tasks basics E2E', moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', certificateOn: true, certificateMonths: 12, issuerUserId: w.people.amy, issuerTitle: 'Training lead' }),
      201,
    );
    courseIds.push(staffCourse.id);
    const pic = data<{ id: string }>(await upload(amy, `/training/manage/courses/${staffCourse.id}/files`, { name: 'step.png', type: 'image/png', content: PNG }, { kind: 'IMAGE' }), 201);
    // 12 MB: over the app-wide 10 MB multipart limit, inside the training documents' 25 MB.
    staffResource = data<{ id: string }>(await upload(amy, `/training/manage/courses/${staffCourse.id}/files`, { name: 'guide.pdf', type: 'application/pdf', content: PDF(12 * MB) }, { kind: 'RESOURCE' }), 201).id;
    expect((await upload(amy, `/training/manage/courses/${staffCourse.id}/files`, { name: 'huge.pdf', type: 'application/pdf', content: PDF(26 * MB) }, { kind: 'RESOURCE' })).statusCode).toBe(400);
    guide = data<ManageLesson>(await send('POST', amy, `/training/manage/courses/${staffCourse.id}/lessons`, { kind: 'GUIDE', title: 'Make a task', minutes: 5 }), 201);
    data(await send('PUT', amy, `/training/manage/lessons/${guide.id}/steps`, { steps: [{ title: 'Open My Tasks', body: '<p>Click <strong>My Tasks</strong>.</p>', imageFileId: pic.id, imageAlt: 'My Tasks' }, { title: 'Press New task', body: '<p>Fill it in.</p>' }] }));
    quiz = data<ManageLesson>(await send('POST', amy, `/training/manage/courses/${staffCourse.id}/lessons`, { kind: 'QUIZ', title: 'Check', minutes: 3 }), 201);
    quiz = data<ManageLesson>(
      await send('PUT', amy, `/training/manage/lessons/${quiz.id}/quiz`, {
        passMark: 100,
        maxAttempts: 3,
        shuffle: false,
        timeLimitMinutes: null,
        drawCount: null,
        questions: [
          { kind: 'SINGLE', prompt: 'Where are your tasks?', explanation: 'My Tasks lists them.', options: [{ text: 'My Tasks', correct: true, feedback: 'Right.' }, { text: 'Chat', correct: false, feedback: 'No.' }] },
          { kind: 'ORDER', prompt: 'Put the steps in order', options: [{ text: 'Open', correct: true }, { text: 'Fill', correct: true }, { text: 'Save', correct: true }] },
        ],
      }),
    );
    staffCourse = data<ManageCourse>(await send('POST', amy, `/training/manage/courses/${staffCourse.id}/publish`, {}));
    expect(staffCourse.status).toBe('PUBLISHED');

    clientCourse = data<ManageCourse>(await send('POST', amy, '/training/manage/courses', { title: 'Your client portal E2E', moduleKey: 'portal', audience: 'CLIENTS', difficulty: 'BEGINNER' }), 201);
    courseIds.push(clientCourse.id);
    clientResource = data<{ id: string }>(await upload(amy, `/training/manage/courses/${clientCourse.id}/files`, { name: 'portal.pdf', type: 'application/pdf', content: PDF() }, { kind: 'RESOURCE' }), 201).id;
    const g = data<ManageLesson>(await send('POST', amy, `/training/manage/courses/${clientCourse.id}/lessons`, { kind: 'GUIDE', title: 'Open a project', minutes: 2 }), 201);
    data(await send('PUT', amy, `/training/manage/lessons/${g.id}/steps`, { steps: [{ title: 'Open it', body: '<p>Pick it.</p>' }] }));
    data(await send('POST', amy, `/training/manage/courses/${clientCourse.id}/publish`, {}));
  });
});

describe('who may use what (the real guard and route tables)', () => {
  it('employees and clients never reach the Training Center; settings are administrators’ only', async () => {
    expect((await api.getRaw(w.as.ana, '/training/manage/courses')).statusCode).toBe(403);
    expect((await api.getRaw(client, '/training/manage/courses')).statusCode).toBe(403);
    expect((await api.getRaw(w.as.amy, '/training/manage/courses')).statusCode).toBe(200);
    expect((await api.getRaw(w.as.amy, '/training/settings')).statusCode).toBe(403);
    expect((await api.getRaw(w.as.admin, '/training/settings')).statusCode).toBe(200);
  });

  it('a client’s session is refused on every staff training route; a staff session on the portal’s', async () => {
    for (const path of ['/training/me', '/training/catalogue', `/training/courses/${clientCourse.id}`, `/training/files/${clientResource}`, '/training/reports']) {
      const res = await api.getRaw(client, path);
      expect(res.statusCode, path).toBe(403);
      expect(code(res as Res)).toBe('CLIENT_NOT_ALLOWED');
    }
    const staff = await api.getRaw(w.as.ana, '/portal/training');
    expect(staff.statusCode).toBe(403);
  });

  it('the certificate check needs no sign-in and says nothing for an unknown code', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/api/v1/training/verify/TC-AAAA-BBBB-CCCC' });
    expect(res.statusCode).toBe(404);
    expect((await api.app.inject({ method: 'GET', url: '/api/v1/training/verify/nonsense' })).statusCode).toBe(404);
  });

  it('access: managers, administrators and project managers (team reports) are told apart', async () => {
    expect(await api.get(w.as.ana, '/training/access')).toMatchObject({ learner: true, manager: false, admin: false, teamReports: false });
    expect(await api.get(w.as.amy, '/training/access')).toMatchObject({ manager: true, admin: false });
    // 12 Nov: Ben runs a project, but nothing is assigned to his team yet: no Reports tab.
    expect(await api.get(w.as.ben, '/training/access')).toMatchObject({ manager: false, teamReports: false });
    expect(await api.get(w.as.admin, '/training/access')).toMatchObject({ manager: true, admin: true });
  });
});

describe('assignments follow membership; a Training manager’s company scope', () => {
  it('a department: amy (company A) reaches ana but not bob (company B only)', async () => {
    const out = data<{ assignments: { id: string; people: number }[] }>(
      await send('POST', w.as.amy, '/training/manage/assignments', { courseIds: [staffCourse.id], targetKind: 'DEPARTMENT', targetId: deptId, mandatory: true, dueDays: 7 }),
      201,
    );
    expect(out.assignments).toHaveLength(1);
    const reached = await prisma.trainingAssignee.findMany({ where: { assignmentId: out.assignments[0]!.id, withdrawnAt: null }, select: { userId: true } });
    expect(reached.map((r) => r.userId)).toEqual([w.people.ana]);
    expect((await send('POST', w.as.amy, '/training/manage/assignments', { courseIds: [staffCourse.id], targetKind: 'COMPANY', targetId: w.companies.B, mandatory: true })).statusCode).toBe(403);
  });

  it('a project’s team (never its clients); a leaver loses unfinished training, a joiner gets it with their own due day', async () => {
    const out = data<{ assignments: { id: string }[] }>(
      await send('POST', w.as.admin, '/training/manage/assignments', { courseIds: [staffCourse.id], targetKind: 'PROJECT', targetId: w.projects.PA, mandatory: false, dueDays: 10 }),
      201,
    );
    const id = out.assignments[0]!.id;
    const who = async () => (await prisma.trainingAssignee.findMany({ where: { assignmentId: id, withdrawnAt: null }, select: { userId: true } })).map((r) => r.userId).sort();
    expect(await who()).toEqual([w.people.ana, w.people.cat].sort());
    // Cat leaves PA; Bob joins it.
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: w.projects.PA, userId: w.people.cat } } });
    await prisma.projectMember.create({ data: { projectId: w.projects.PA, userId: w.people.bob, role: 'MEMBER' } });
    await training.sweeps.membership.run();
    expect(await who()).toEqual([w.people.ana, w.people.bob].sort());
    const catEnrolment = await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId: w.people.cat, courseId: staffCourse.id } } });
    expect(catEnrolment?.withdrawnAt).not.toBeNull();
    const bob = await prisma.trainingAssignee.findFirst({ where: { assignmentId: id, userId: w.people.bob } });
    expect(bob?.dueDay).toBe(shiftDayKey(todayKey(TZ, clockNow()), 10));
    // Put the world back.
    await prisma.projectMember.delete({ where: { projectId_userId: { projectId: w.projects.PA, userId: w.people.bob } } });
    await prisma.projectMember.create({ data: { projectId: w.projects.PA, userId: w.people.cat, role: 'MEMBER' } });
    expect((await send('DELETE', w.as.admin, `/training/manage/assignments/${id}`)).statusCode).toBe(204);
  });

  it('an onboarding rule reaches accounts made after it only', async () => {
    const rule = data<{ id: string }>(await send('POST', w.as.admin, '/training/manage/rules', { name: 'New employees', targetKind: 'GROUP', targetId: 'employees', courseIds: [staffCourse.id], mandatory: true, dueDays: 14 }), 201);
    const ruleAssignment = await prisma.trainingAssignment.findFirst({ where: { ruleId: rule.id } });
    expect(await prisma.trainingAssignee.count({ where: { assignmentId: ruleAssignment!.id } })).toBe(0);
    const role = await prisma.role.findUnique({ where: { name: 'EMPLOYEE' } });
    newbie = (
      await prisma.user.create({
        data: { email: `newbie.${w.tag}@world.test`, username: `newbie_${w.tag}`, passwordHash: 'x', firstName: 'New', lastName: 'Bie', roles: { create: { roleId: role!.id } }, companies: { create: { companyId: w.companies.A } }, primaryCompanyId: w.companies.A },
      })
    ).id;
    await training.sweeps.membership.run();
    expect((await prisma.trainingAssignee.findMany({ where: { assignmentId: ruleAssignment!.id }, select: { userId: true } })).map((r) => r.userId)).toEqual([newbie]);
    expect((await send('DELETE', w.as.admin, `/training/manage/rules/${rule.id}`)).statusCode).toBe(204);
    expect((await prisma.trainingEnrolment.findUnique({ where: { userId_courseId: { userId: newbie, courseId: staffCourse.id } } }))?.withdrawnAt).not.toBeNull();
  });
});

describe('a learner’s journey', () => {
  it('My training lists the mandatory course; the guide’s step is saved and resumed', async () => {
    const me = (await api.get(w.as.ana, '/training/me')) as MyTraining;
    expect(me.assigned.map((c) => c.id)).toContain(staffCourse.id);
    expect(me.assigned.find((c) => c.id === staffCourse.id)!.mine).toMatchObject({ assigned: true, mandatory: true, status: 'NOT_STARTED' });
    const detail = (await api.get(w.as.ana, `/training/courses/${staffCourse.id}`)) as CourseDetail;
    expect(detail.resources.map((r) => r.id)).toEqual([staffResource]);
    data(await send('PUT', w.as.ana, `/training/lessons/${guide.id}/progress`, { stepIndex: 1 }));
    const view = (await api.get(w.as.ana, `/training/lessons/${guide.id}`)) as LessonView;
    expect(view.progress.stepIndex).toBe(1);
    expect(view.steps[0]!.image?.fileId).toBeTruthy();
    const file = await api.getRaw(w.as.ana, `/training/files/${view.steps[0]!.image!.fileId}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('no-store');
    data(await send('POST', w.as.ana, `/training/lessons/${guide.id}/complete`));
  });

  it('the quiz paper never holds the answers; marking is all or nothing; passing completes the course with a certificate', async () => {
    const raw = await send('POST', w.as.ana, `/training/lessons/${quiz.id}/attempts`);
    expect(raw.statusCode).toBe(200);
    expect(raw.body).not.toMatch(/"correct"|"feedback"|"explanation"|"position"/);
    const paper = data<AttemptPaper>(raw);
    attemptId = paper.id;
    const lessonRaw = await api.getRaw(w.as.ana, `/training/lessons/${quiz.id}`);
    expect(lessonRaw.body).not.toMatch(/"correct"|"feedback"|"explanation"/);
    const byText = (qi: number, t: string) => paper.questions[qi]!.options.find((o) => o.text === t)!.id;
    const wrong = data<AttemptResult>(await send('POST', w.as.ana, `/training/attempts/${paper.id}/submit`, { answers: { [paper.questions[0]!.id]: [byText(0, 'Chat')], [paper.questions[1]!.id]: [byText(1, 'Open'), byText(1, 'Fill'), byText(1, 'Save')] } }));
    expect(wrong).toMatchObject({ scorePct: 50, passed: false, courseCompleted: false, attemptsLeft: 2 });
    expect(wrong.questions[0]!.options.find((o) => o.text === 'Chat')!.feedback).toBe('No.');
    const again = data<AttemptPaper>(await send('POST', w.as.ana, `/training/lessons/${quiz.id}/attempts`));
    const t2 = (qi: number, t: string) => again.questions[qi]!.options.find((o) => o.text === t)!.id;
    const right = data<AttemptResult>(await send('POST', w.as.ana, `/training/attempts/${again.id}/submit`, { answers: { [again.questions[0]!.id]: [t2(0, 'My Tasks')], [again.questions[1]!.id]: [t2(1, 'Open'), t2(1, 'Fill'), t2(1, 'Save')] } }));
    expect(right).toMatchObject({ scorePct: 100, passed: true, courseCompleted: true });
    expect(right.certificateId).toBeTruthy();
    certId = right.certificateId!;
    const cert = await prisma.trainingCertificate.findUniqueOrThrow({ where: { id: certId } });
    certCode = cert.code;
    expect(certCode).toMatch(/^TC-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    const pdf = await api.getRaw(w.as.ana, `/training/certificates/${certId}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    // A colleague can't have it; an administrator can.
    expect((await api.getRaw(w.as.bob, `/training/certificates/${certId}/pdf`)).statusCode).toBe(404);
    expect((await api.getRaw(w.as.admin, `/training/certificates/${certId}/pdf`)).statusCode).toBe(200);
  });

  it('the public check answers only course, name, dates and status', async () => {
    const res = await api.app.inject({ method: 'GET', url: `/api/v1/training/verify/${certCode.toLowerCase()}` });
    expect(res.statusCode).toBe(200);
    const v = (res.json() as { data: VerifyResult }).data;
    expect(Object.keys(v).sort()).toEqual(['completedAt', 'courseTitle', 'expiresAt', 'issuedAt', 'learnerName', 'status']);
    expect(v).toMatchObject({ courseTitle: 'Tasks basics E2E', learnerName: expect.stringContaining('Ana'), status: 'VALID' });
  });
});

describe('a client’s Help & training is theirs alone', () => {
  it('only client courses; staff courses, lessons, files, attempts and certificates are not found', async () => {
    const mine = (await api.get(client, '/portal/training')) as PortalTraining;
    expect(mine.catalogue.map((c) => c.id)).toEqual(expect.arrayContaining([clientCourse.id]));
    expect(mine.catalogue.map((c) => c.id)).not.toContain(staffCourse.id);
    for (const path of [`/portal/training/courses/${staffCourse.id}`, `/portal/training/lessons/${guide.id}`, `/portal/training/files/${staffResource}`, `/portal/training/attempts/${attemptId}`, `/portal/training/certificates/${certId}/pdf`]) {
      expect((await api.getRaw(client, path)).statusCode, path).toBe(404);
    }
    const ok = await api.getRaw(client, `/portal/training/files/${clientResource}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    // Staff never see a client course (a Training manager previews it).
    expect((await api.getRaw(w.as.ana, `/training/courses/${clientCourse.id}`)).statusCode).toBe(404);
    expect((await api.getRaw(w.as.ana, `/training/files/${clientResource}`)).statusCode).toBe(404);
    expect((await api.getRaw(w.as.amy, `/training/files/${clientResource}`)).statusCode).toBe(200);
  });
});

describe('reminders through the Notification & Scheduling engine', () => {
  it('the first run records only; then overdue mandatory training reminds the learner and escalates to Reports to, once', async () => {
    // Bob's dept assignment was out of scope; give Cat an overdue mandatory course of her own.
    await prisma.user.update({ where: { id: w.people.cat }, data: { reportsToId: w.people.amy } });
    const first = await training.sweeps.reminders.run();
    expect(first.recordedOnly).toBe(true);
    expect(notices.filter((n) => n.type.startsWith('TRAINING_') && n.type !== 'TRAINING_ASSIGNED')).toEqual([]);
    const a = data<{ assignments: { id: string }[] }>(await send('POST', w.as.admin, '/training/manage/assignments', { courseIds: [staffCourse.id], targetKind: 'USER', targetId: w.people.cat, mandatory: true, dueDays: 1 }), 201);
    expect(a.assignments).toHaveLength(1);
    await prisma.trainingAssignee.updateMany({ where: { assignmentId: a.assignments[0]!.id }, data: { dueDay: shiftDayKey(todayKey(TZ, clockNow()), -4) } });
    notices.length = 0;
    const second = await training.sweeps.reminders.run();
    expect(second.recordedOnly).toBe(false);
    const sent = notices.filter((n) => n.type === 'TRAINING_OVERDUE');
    expect(sent.map((n) => n.userId).sort()).toEqual([w.people.amy, w.people.cat].sort());
    expect(sent.find((n) => n.userId === w.people.amy)!.title).toContain('Overdue training');
    notices.length = 0;
    await training.sweeps.reminders.run();
    expect(notices.filter((n) => n.type === 'TRAINING_OVERDUE')).toEqual([]);
  });
});

describe('expiry, retake and revoke', () => {
  it('a year on, the certificate expires and the course is to be taken again; a revoke shows as revoked', async () => {
    shiftMs = 400 * 86_400_000;
    const me = (await api.get(w.as.ana, '/training/me')) as MyTraining;
    const card = [...me.assigned, ...me.inProgress, ...me.completed].find((c) => c.id === staffCourse.id)!;
    expect(card.mine.status).toBe('RETAKE');
    const expired = (await api.app.inject({ method: 'GET', url: `/api/v1/training/verify/${certCode}` })).json() as { data: VerifyResult };
    expect(expired.data.status).toBe('EXPIRED');
    shiftMs = 0;
    // Bob is outside amy's companies: not found for her; Ana's is in scope.
    expect((await send('POST', w.as.amy, `/training/manage/certificates/${certId}/revoke`, { reason: 'Issued by mistake' })).statusCode).toBe(200);
    const revoked = (await api.app.inject({ method: 'GET', url: `/api/v1/training/verify/${certCode}` })).json() as { data: VerifyResult };
    expect(revoked.data.status).toBe('REVOKED');
  });
});

describe('reports follow the reader’s scope', () => {
  it('administrators everyone; a Training manager her companies; a project manager his team; an employee none', async () => {
    const names = (r: TrainingReport) => r.rows.map((x) => x.key);
    const all = (await api.get(w.as.admin, '/training/reports?by=person')) as TrainingReport;
    expect(all.scope).toBe('ALL');
    expect(names(all)).toEqual(expect.arrayContaining([w.people.ana, w.people.cat]));
    const amy = (await api.get(w.as.amy, '/training/reports?by=person')) as TrainingReport;
    expect(amy.scope).toBe('COMPANIES');
    expect(names(amy)).not.toContain(w.people.bob);
    const ben = (await api.get(w.as.ben, '/training/reports?by=person')) as TrainingReport;
    expect(ben.scope).toBe('TEAM');
    expect(names(ben)).not.toContain(w.people.ana);
    expect((await api.getRaw(w.as.bob, '/training/reports')).statusCode).toBe(403);
    const xlsx = await api.getRaw(w.as.admin, '/training/reports/export.xlsx?by=course');
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('MariaDB-safe SQL', () => {
  it('the Training Center uses no raw SQL that MariaDB (non-strict) would read differently', () => {
    const dir = resolve(__dirname, '../../src/modules/training');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const raw: string[] = [];
    for (const f of sources) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/\$(?:queryRaw|executeRaw)(?:Unsafe)?\s*(?:<[^>]*>)?\s*(?:`([^`]*)`|\(\s*['"`]([^'"`]*)['"`])/g)) raw.push(m[1] ?? m[2] ?? '');
    }
    expect(raw.flatMap((sql) => portabilityProblems(sql))).toEqual([]);
  });
});
