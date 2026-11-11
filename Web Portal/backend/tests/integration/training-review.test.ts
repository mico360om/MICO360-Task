import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { createTrainingFromPrisma } from '../../src/modules/training/training-wiring';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import type { Viewer } from '../../src/modules/companies/company-access';
import type { AssignmentRow, AttemptPaper, AttemptResult, CourseDetail, ManageCourse, ManageLesson, RuleRow, TargetOptions } from '../../src/modules/training/training-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// The review's fixes (11 Nov night) on a real database through the real app: a big group assigned in one
// request (I4) and the Assignments tab's counts (I5); a Training manager sees only what is hers (M6) and her
// lists are filtered in the query (M15); edits that would break a published course are refused (M8); a
// signature belongs to its "Issued by" person (M18); a review is its own cycle for a changed quiz (I1);
// renewing after expiry leaves the old certificate expired, not revoked (M10); answered questions only from
// colleagues (M16).
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const PNG = readFileSync(resolve(__dirname, '../../assets/logo-pdf.png'));

let shiftMs = 0;
const notices: { userId: string; type: string; entityType: string | null }[] = [];
const training = createTrainingFromPrisma(prisma, {
  files: createTrainingFileStore(join(mkdtempSync(join(tmpdir(), 'tr-review-')), 'training-files')),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  now: () => new Date(Date.now() + shiftMs),
  notify: async (n) => {
    notices.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
  starterCourses: [],
});

let w: CompanyWorld;
let api: CompanyApp;
const courseIds: string[] = [];
const extraUsers: string[] = [];
let course: ManageCourse;
let quiz: ManageLesson;

type Res = { statusCode: number; body: string; json(): unknown };
const data = <T>(res: Res, status = 200): T => {
  if (res.statusCode !== status) throw new Error(`${res.statusCode}: ${res.body}`);
  return (res.json() as { data: T }).data;
};
async function send(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', who: Viewer, path: string, body?: unknown): Promise<Res> {
  return (await api.app.inject({ method, url: `/api/v1${path}`, headers: { authorization: await api.bearer(who) }, ...(body === undefined ? {} : { payload: body as object }) })) as unknown as Res;
}
async function upload(who: Viewer, path: string, fields: Record<string, string> = {}): Promise<Res> {
  const boundary = `----rv${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sig.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${boundary}--\r\n`));
  return (await api.app.inject({ method: 'POST', url: `/api/v1${path}`, headers: { authorization: await api.bearer(who), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) })) as unknown as Res;
}
const code = (res: Res) => (res.json() as { error?: { code?: string } }).error?.code;

async function publishedCourse(title: string, o: { maxAttempts?: number | null; certificateMonths?: number | null } = {}): Promise<{ course: ManageCourse; quiz: ManageLesson; guide: ManageLesson }> {
  const admin = w.as.admin;
  const c = data<ManageCourse>(await send('POST', admin, '/training/manage/courses', { title, moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', certificateOn: true, certificateMonths: o.certificateMonths ?? 12 }), 201);
  courseIds.push(c.id);
  const guide = data<ManageLesson>(await send('POST', admin, `/training/manage/courses/${c.id}/lessons`, { kind: 'GUIDE', title: 'Read', minutes: 2 }), 201);
  data(await send('PUT', admin, `/training/manage/lessons/${guide.id}/steps`, { steps: [{ title: 'One', body: '<p>One.</p>' }] }));
  let q = data<ManageLesson>(await send('POST', admin, `/training/manage/courses/${c.id}/lessons`, { kind: 'QUIZ', title: 'Check', minutes: 2 }), 201);
  q = data<ManageLesson>(
    await send('PUT', admin, `/training/manage/lessons/${q.id}/quiz`, {
      passMark: 100,
      maxAttempts: o.maxAttempts === undefined ? 1 : o.maxAttempts,
      shuffle: false,
      timeLimitMinutes: null,
      drawCount: null,
      questions: [{ kind: 'SINGLE', prompt: 'Pick yes', explanation: 'Yes is right.', options: [{ text: 'Yes', correct: true, feedback: 'Good.' }, { text: 'No', correct: false, feedback: 'Not that one.' }] }],
    }),
  );
  return { course: data<ManageCourse>(await send('POST', admin, `/training/manage/courses/${c.id}/publish`, {})), quiz: q, guide };
}

async function takeQuiz(who: Viewer, lessonId: string, pick: 'Yes' | 'No'): Promise<AttemptResult> {
  const paper = data<AttemptPaper>(await send('POST', who, `/training/lessons/${lessonId}/attempts`));
  const q = paper.questions[0]!;
  return data<AttemptResult>(await send('POST', who, `/training/attempts/${paper.id}/submit`, { answers: { [q.id]: [q.options.find((o) => o.text === pick)!.id] } }));
}

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  await prisma.user.update({ where: { id: w.people.bob }, data: { trainingManager: true } });
  api = await buildCompanyApp(prisma, () => ({ training: { learner: training.learner, manage: training.manage, reports: training.reports } }));
  ({ course, quiz } = await publishedCourse(`Review course ${w.tag}`));
});

afterAll(async () => {
  const users = [...Object.values(w.people), ...extraUsers];
  const where = { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] };
  await prisma.trainingAttempt.deleteMany({ where });
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingAssignee.deleteMany({ where });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingRule.deleteMany({ where: { createdById: { in: users } } });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingFeedback.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingFile.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { uploadedById: { in: users } }] } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  await api.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('I4/I5 a big group in one request', () => {
  it('150 new people of a company get it at once; the notices follow after the answer; the tab counts them', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    for (let i = 0; i < 150; i++) {
      const u = await prisma.user.create({
        data: { email: `bulk${i}.${w.tag}@world.test`, username: `bulk${i}_${w.tag}`, passwordHash: 'x', firstName: 'Bulk', lastName: `${i}`, roles: { create: { roleId: role.id } }, companies: { create: { companyId: w.companies.A } }, primaryCompanyId: w.companies.A },
      });
      extraUsers.push(u.id);
    }
    notices.length = 0;
    const started = Date.now();
    const out = data<{ assignments: AssignmentRow[] }>(await send('POST', w.as.admin, '/training/manage/assignments', { courseIds: [course.id], targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true, dueDays: 14 }), 201);
    expect(Date.now() - started).toBeLessThan(15_000);
    const a = out.assignments[0]!;
    // ana, amy, cat and the 150.
    expect(a.people).toBe(153);
    expect(await prisma.trainingEnrolment.count({ where: { courseId: course.id, userId: { in: extraUsers }, withdrawnAt: null } })).toBe(150);
    await training.sync.idle();
    expect(notices.filter((n) => n.type === 'TRAINING_ASSIGNED').length).toBe(153);
    const tab = data<{ assignments: AssignmentRow[] }>(await send('POST', w.as.admin, '/training/manage/assignments/preview', { courseIds: [course.id], targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true, dueDays: 14 }));
    expect(tab).toMatchObject({ reach: 153, already: 153 });
    const list = (await api.get(w.as.admin, `/training/manage/assignments?courseId=${course.id}`)) as { assignments: AssignmentRow[] };
    expect(list.assignments.find((x) => x.id === a.id)).toMatchObject({ people: 153, completed: 0, overdue: 0 });
    // Withdrawn again in one go (unfinished training withdrawn).
    expect((await send('DELETE', w.as.admin, `/training/manage/assignments/${a.id}`)).statusCode).toBe(204);
    expect(await prisma.trainingEnrolment.count({ where: { courseId: course.id, userId: { in: extraUsers }, withdrawnAt: null } })).toBe(0);
  });
});

describe('M6/M15 a Training manager sees only what is hers', () => {
  it('assignments and rules outside her companies are not listed; names outside them never shown', async () => {
    const admin = w.as.admin;
    const toBob = data<{ assignments: AssignmentRow[] }>(await send('POST', admin, '/training/manage/assignments', { courseIds: [course.id], targetKind: 'USER', targetId: w.people.bob, mandatory: false }), 201).assignments[0]!;
    const toB = data<{ assignments: AssignmentRow[] }>(await send('POST', admin, '/training/manage/assignments', { courseIds: [course.id], targetKind: 'COMPANY', targetId: w.companies.B, mandatory: false }), 201).assignments[0]!;
    const toAll = data<{ assignments: AssignmentRow[] }>(await send('POST', admin, '/training/manage/assignments', { courseIds: [course.id], targetKind: 'GROUP', targetId: 'everyone', mandatory: false }), 201).assignments[0]!;
    const hers = data<{ assignments: AssignmentRow[] }>(await send('POST', w.as.amy, '/training/manage/assignments', { courseIds: [course.id], targetKind: 'USER', targetId: w.people.ana, mandatory: false }), 201).assignments[0]!;
    const listed = ((await api.get(w.as.amy, `/training/manage/assignments?courseId=${course.id}`)) as { assignments: AssignmentRow[] }).assignments;
    const ids = listed.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([hers.id, toAll.id]));
    expect(ids).not.toContain(toBob.id);
    expect(ids).not.toContain(toB.id);
    expect(JSON.stringify(listed)).not.toMatch(/Bob|Beta/);
    const rule = data<RuleRow>(await send('POST', admin, '/training/manage/rules', { name: 'Beta onboarding', targetKind: 'COMPANY', targetId: w.companies.B, courseIds: [course.id], mandatory: true, dueDays: 7 }), 201);
    const rules = ((await api.get(w.as.amy, '/training/manage/rules')) as { rules: RuleRow[] }).rules;
    expect(rules.map((r) => r.id)).not.toContain(rule.id);
    expect(((await api.get(w.as.admin, '/training/manage/rules')) as { rules: RuleRow[] }).rules.map((r) => r.id)).toContain(rule.id);
    for (const id of [toBob.id, toB.id, toAll.id, hers.id]) await send('DELETE', admin, `/training/manage/assignments/${id}`);
    await send('DELETE', admin, `/training/manage/rules/${rule.id}`);
  });

  it('issuers: administrators and the Training managers of her companies (not Bob, a Training manager of Beta only)', async () => {
    const amy = (await api.get(w.as.amy, '/training/manage/options')) as TargetOptions;
    expect(amy.issuers.map((i) => i.id)).toEqual(expect.arrayContaining([w.people.admin, w.people.amy]));
    expect(amy.issuers.map((i) => i.id)).not.toContain(w.people.bob);
    const admin = (await api.get(w.as.admin, '/training/manage/options')) as TargetOptions;
    expect(admin.issuers.map((i) => i.id)).toContain(w.people.bob);
    expect((await send('PATCH', w.as.amy, `/training/manage/courses/${course.id}`, { issuerUserId: w.people.bob })).statusCode).toBe(400);
  });

  it('feedback and certificates of people outside her companies are left out by the query', async () => {
    await prisma.trainingFeedback.createMany({
      data: [
        { courseId: course.id, userId: w.people.ana, kind: 'QUESTION', body: 'ZZANA question', status: 'OPEN' },
        { courseId: course.id, userId: w.people.ben, kind: 'QUESTION', body: 'ZZBEN question', status: 'OPEN' },
      ],
    });
    const items = ((await api.get(w.as.amy, '/training/manage/feedback')) as { items: { body: string | null }[] }).items.map((i) => i.body);
    expect(items).toContain('ZZANA question');
    expect(items).not.toContain('ZZBEN question');
    await prisma.trainingCertificate.createMany({
      data: [
        { code: `TC-RVA-${w.tag}`, userId: w.people.ana, courseId: course.id, learnerName: 'Ana', courseTitle: course.title },
        { code: `TC-RVB-${w.tag}`, userId: w.people.ben, courseId: course.id, learnerName: 'Ben', courseTitle: course.title },
      ],
      skipDuplicates: true,
    });
    const certs = ((await api.get(w.as.amy, `/training/manage/certificates?courseId=${course.id}`)) as { certificates: { userId: string }[] }).certificates.map((c) => c.userId);
    expect(certs).toContain(w.people.ana);
    expect(certs).not.toContain(w.people.ben);
    await prisma.trainingCertificate.deleteMany({ where: { courseId: course.id } });
  });
});

describe('M8 a published course can’t be left unfinished', () => {
  it('refuses removing the last answer, emptying a guide, removing a video link or the last lesson', async () => {
    const admin = w.as.admin;
    const noRight = await send('PUT', admin, `/training/manage/lessons/${quiz.id}/quiz`, { passMark: 100, maxAttempts: 1, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [{ kind: 'SINGLE', prompt: 'Pick yes', options: [{ text: 'Yes', correct: false }, { text: 'No', correct: false }] }] });
    expect(noRight.statusCode).toBe(409);
    expect(code(noRight)).toBe('WOULD_BREAK_PUBLISHED');
    const lessons = ((await api.get(admin, `/training/manage/courses/${course.id}`)) as ManageCourse).lessons;
    const guide = lessons.find((l) => l.kind === 'GUIDE')!;
    expect((await send('PUT', admin, `/training/manage/lessons/${guide.id}/steps`, { steps: [] })).statusCode).toBe(409);
    const video = data<ManageLesson>(await send('POST', admin, `/training/manage/courses/${course.id}/lessons`, { kind: 'VIDEO', title: 'Watch', minutes: 3, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }), 201);
    expect((await send('PATCH', admin, `/training/manage/lessons/${video.id}`, { videoUrl: null })).statusCode).toBe(409);
    expect((await send('DELETE', admin, `/training/manage/lessons/${video.id}`)).statusCode).toBe(204);
    // A draft may be anything while it is made.
    const draft = data<ManageCourse>(await send('POST', admin, '/training/manage/courses', { title: `Draft ${w.tag}`, moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER' }), 201);
    courseIds.push(draft.id);
    const only = data<ManageLesson>(await send('POST', admin, `/training/manage/courses/${draft.id}/lessons`, { kind: 'GUIDE', title: 'Only', minutes: 1 }), 201);
    expect((await send('DELETE', admin, `/training/manage/lessons/${only.id}`)).statusCode).toBe(204);
    // The published course's last lesson can't go.
    const one = await publishedCourse(`One lesson ${w.tag}`);
    await send('DELETE', admin, `/training/manage/lessons/${one.guide.id}`);
    const last = await send('DELETE', admin, `/training/manage/lessons/${one.quiz.id}`);
    expect(last.statusCode).toBe(409);
  });
});

describe('M18 a signature belongs to its “Issued by” person', () => {
  it('only the issuer’s own upload; changing the issuer drops someone else’s signature', async () => {
    const adminSig = data<{ id: string }>(await upload(w.as.admin, '/training/manage/signatures'), 201);
    const amySig = data<{ id: string }>(await upload(w.as.amy, '/training/manage/signatures'), 201);
    const bad = await send('PATCH', w.as.admin, `/training/manage/courses/${course.id}`, { issuerUserId: w.people.amy, signatureFileId: adminSig.id });
    expect(bad.statusCode).toBe(400);
    const ok = data<ManageCourse>(await send('PATCH', w.as.admin, `/training/manage/courses/${course.id}`, { issuerUserId: w.people.amy, signatureFileId: amySig.id }));
    expect(ok.signature?.id).toBe(amySig.id);
    const moved = data<ManageCourse>(await send('PATCH', w.as.admin, `/training/manage/courses/${course.id}`, { issuerUserId: w.people.admin }));
    expect(moved.signature).toBeNull();
  });
});

describe('I1 a review is its own cycle; M10 an old certificate expires, it isn’t revoked', () => {
  it('a Major change to a quiz with one attempt gives the review a fresh attempt; passing it ends the review', async () => {
    const c = await publishedCourse(`Review cycle ${w.tag}`, { maxAttempts: 1 });
    const ana = w.as.ana;
    const g = ((await api.get(ana, `/training/courses/${c.course.id}`)) as CourseDetail).lessons.find((l) => l.kind === 'GUIDE')!;
    data(await send('POST', ana, `/training/lessons/${g.id}/complete`));
    expect((await takeQuiz(ana, c.quiz.id, 'Yes')).courseCompleted).toBe(true);
    // A Major change to the quiz: Ana must review it.
    data(await send('PUT', w.as.admin, `/training/manage/lessons/${c.quiz.id}/quiz`, { passMark: 100, maxAttempts: 1, shuffle: false, timeLimitMinutes: null, drawCount: null, questions: [{ kind: 'SINGLE', prompt: 'Pick yes (new)', options: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }] }] }));
    data(await send('POST', w.as.admin, `/training/manage/courses/${c.course.id}/publish`, { change: 'MAJOR', reviewDays: 7 }));
    expect(((await api.get(ana, `/training/courses/${c.course.id}`)) as CourseDetail).mine.status).toBe('REVIEW');
    const again = await takeQuiz(ana, c.quiz.id, 'Yes');
    expect(again.passed).toBe(true);
    expect(((await api.get(ana, `/training/courses/${c.course.id}`)) as CourseDetail).mine.status).toBe('COMPLETED');
  });

  it('M9: before passing, a hand-in shows right or wrong and the chosen answer’s feedback only', async () => {
    const c = await publishedCourse(`Answers ${w.tag}`, { maxAttempts: 3 });
    const r = await takeQuiz(w.as.cat, c.quiz.id, 'No');
    expect(r).toMatchObject({ passed: false, answersShown: false, attemptsLeft: 2 });
    expect(r.questions[0]!.explanation).toBeNull();
    expect(r.questions[0]!.options.every((o) => !o.correct)).toBe(true);
    expect(r.questions[0]!.options.find((o) => o.text === 'No')!.feedback).toBe('Not that one.');
    expect(r.questions[0]!.options.find((o) => o.text === 'Yes')!.feedback).toBeNull();
    const ok = await takeQuiz(w.as.cat, c.quiz.id, 'Yes');
    expect(ok).toMatchObject({ passed: true, answersShown: true });
    expect(ok.questions[0]!.explanation).toBe('Yes is right.');
  });

  it('renewing after expiry leaves the old certificate EXPIRED (not revoked) and issues a new one', async () => {
    const c = await publishedCourse(`Renew ${w.tag}`, { maxAttempts: null, certificateMonths: 1 });
    const amy = w.as.amy;
    const g = ((await api.get(amy, `/training/courses/${c.course.id}`)) as CourseDetail).lessons.find((l) => l.kind === 'GUIDE')!;
    data(await send('POST', amy, `/training/lessons/${g.id}/complete`));
    const first = await takeQuiz(amy, c.quiz.id, 'Yes');
    shiftMs = 40 * 86_400_000;
    try {
      await api.get(amy, '/training/me');
      expect(((await api.get(amy, `/training/courses/${c.course.id}`)) as CourseDetail).mine.status).toBe('RETAKE');
      data(await send('POST', amy, `/training/lessons/${g.id}/complete`));
      const second = await takeQuiz(amy, c.quiz.id, 'Yes');
      expect(second.certificateId).toBeTruthy();
      expect(second.certificateId).not.toBe(first.certificateId);
      const old = await prisma.trainingCertificate.findUniqueOrThrow({ where: { id: first.certificateId! } });
      expect(old.revokedAt).toBeNull();
      const v = (await api.app.inject({ method: 'GET', url: `/api/v1/training/verify/${old.code}` })).json() as { data: { status: string } };
      expect(v.data.status).toBe('EXPIRED');
    } finally {
      shiftMs = 0;
    }
  });
});

describe('M16 answered questions on a staff course come only from colleagues', () => {
  it('Ana (Alpha) sees an answered question asked in Alpha, not one asked by Bob (Beta only); an administrator sees both', async () => {
    await prisma.trainingFeedback.createMany({
      data: [
        { courseId: course.id, userId: w.people.amy, kind: 'QUESTION', body: 'ZZALPHA asked', status: 'ANSWERED', answer: 'Yes.', answeredAt: new Date() },
        { courseId: course.id, userId: w.people.bob, kind: 'QUESTION', body: 'ZZBETA asked', status: 'ANSWERED', answer: 'No.', answeredAt: new Date() },
      ],
    });
    const asked = (d: CourseDetail) => d.questions.map((q) => q.question);
    const ana = (await api.get(w.as.ana, `/training/courses/${course.id}`)) as CourseDetail;
    expect(asked(ana)).toContain('ZZALPHA asked');
    expect(asked(ana)).not.toContain('ZZBETA asked');
    const admin = (await api.get(w.as.admin, `/training/courses/${course.id}`)) as CourseDetail;
    expect(asked(admin)).toEqual(expect.arrayContaining(['ZZALPHA asked', 'ZZBETA asked']));
  });
});
