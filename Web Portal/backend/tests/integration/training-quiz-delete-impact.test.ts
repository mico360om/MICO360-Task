import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildCompanyApp, type CompanyApp } from './company-app';
import { createTrainingFromPrisma } from '../../src/modules/training/training-wiring';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import type { Viewer } from '../../src/modules/companies/company-access';
import type { AttemptPaper, AttemptResult, CourseDetail, ManageCourse, ManageLesson } from '../../src/modules/training/training-types';

// Requires a running MySQL or MariaDB (TEST_DATABASE_URL) with migrations applied.
// Owner, 13 Nov (batch 4b): deleting the quiz of a published course that gives a certificate first tells the
// administrator how many people that finishes (and certifies) — the server works the number out from everyone's
// progress, the same way the deletion then finishes them — and asks before deleting.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const training = createTrainingFromPrisma(prisma, {
  files: createTrainingFileStore(join(mkdtempSync(join(tmpdir(), 'tr-impact-')), 'training-files')),
  timeZone: 'Asia/Muscat',
  appUrl: 'http://localhost:5173',
  notify: async () => {},
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
  starterCourses: [],
});

let w: CompanyWorld;
let api: CompanyApp;
const courseIds: string[] = [];

type Res = { statusCode: number; body: string; json(): unknown };
const data = <T>(res: Res, status = 200): T => {
  if (res.statusCode !== status) throw new Error(`${res.statusCode}: ${res.body}`);
  return (res.json() as { data: T }).data;
};
async function send(method: 'GET' | 'POST' | 'PUT' | 'DELETE', who: Viewer, path: string, body?: unknown): Promise<Res> {
  return (await api.app.inject({ method, url: `/api/v1${path}`, headers: { authorization: await api.bearer(who) }, ...(body === undefined ? {} : { payload: body as object }) })) as unknown as Res;
}
type Impact = { finishing: number; certificate: boolean; published: boolean };
const impact = async (lessonId: string, who: Viewer = w.as.admin) => send('GET', who, `/training/manage/lessons/${lessonId}/delete-impact`);

async function course(title: string, o: { certificateOn?: boolean; publish?: boolean } = {}): Promise<{ course: ManageCourse; quiz: ManageLesson; guide: ManageLesson }> {
  const admin = w.as.admin;
  const c = data<ManageCourse>(await send('POST', admin, '/training/manage/courses', { title, moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', certificateOn: o.certificateOn ?? true, certificateMonths: 12 }), 201);
  courseIds.push(c.id);
  const guide = data<ManageLesson>(await send('POST', admin, `/training/manage/courses/${c.id}/lessons`, { kind: 'GUIDE', title: 'Read', minutes: 2 }), 201);
  data(await send('PUT', admin, `/training/manage/lessons/${guide.id}/steps`, { steps: [{ title: 'One', body: '<p>One.</p>' }] }));
  let q = data<ManageLesson>(await send('POST', admin, `/training/manage/courses/${c.id}/lessons`, { kind: 'QUIZ', title: 'Check', minutes: 2 }), 201);
  q = data<ManageLesson>(
    await send('PUT', admin, `/training/manage/lessons/${q.id}/quiz`, {
      passMark: 100,
      maxAttempts: null,
      shuffle: false,
      timeLimitMinutes: null,
      drawCount: null,
      questions: [{ kind: 'SINGLE', prompt: 'Pick yes', options: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }] }],
    }),
  );
  const made = o.publish === false ? c : data<ManageCourse>(await send('POST', admin, `/training/manage/courses/${c.id}/publish`, {}));
  return { course: made, quiz: q, guide };
}
async function readGuide(who: Viewer, courseId: string): Promise<void> {
  const g = ((await api.get(who, `/training/courses/${courseId}`)) as CourseDetail).lessons.find((l) => l.kind === 'GUIDE')!;
  data(await send('POST', who, `/training/lessons/${g.id}/complete`));
}
async function pass(who: Viewer, lessonId: string): Promise<AttemptResult> {
  const paper = data<AttemptPaper>(await send('POST', who, `/training/lessons/${lessonId}/attempts`));
  const q = paper.questions[0]!;
  return data<AttemptResult>(await send('POST', who, `/training/attempts/${paper.id}/submit`, { answers: { [q.id]: [q.options.find((x) => x.text === 'Yes')!.id] } }));
}

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  api = await buildCompanyApp(prisma, () => ({ training: { learner: training.learner, manage: training.manage, reports: training.reports } }));
});

afterAll(async () => {
  const users = Object.values(w.people);
  const where = { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] };
  await prisma.trainingAttempt.deleteMany({ where });
  await prisma.trainingProgress.deleteMany({ where });
  await prisma.trainingAssignee.deleteMany({ where });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingEnrolment.deleteMany({ where });
  await prisma.trainingCertificate.deleteMany({ where });
  await prisma.trainingFile.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await api.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
});

describe('deleting the quiz of a published certificate course: how many it finishes', () => {
  it('counts the people who have done everything but the quiz — and the deletion then finishes and certifies exactly them', async () => {
    const c = await course(`Impact ${w.tag}`);
    await readGuide(w.as.ana, c.course.id); // only the quiz left → finished by the deletion
    await readGuide(w.as.cat, c.course.id); // the same
    await readGuide(w.as.ben, c.course.id);
    expect((await pass(w.as.ben, c.quiz.id)).courseCompleted).toBe(true); // already finished: not counted
    await api.get(w.as.bob, `/training/courses/${c.course.id}`); // opened it, did nothing: not counted

    const before = data<Impact>(await impact(c.quiz.id));
    expect(before).toEqual({ finishing: 2, certificate: true, published: true });
    // Asking changes nothing.
    expect(await prisma.trainingCertificate.count({ where: { courseId: c.course.id, revokedAt: null } })).toBe(1);

    expect((await send('DELETE', w.as.admin, `/training/manage/lessons/${c.quiz.id}`)).statusCode).toBe(204);
    const certified = await prisma.trainingCertificate.findMany({ where: { courseId: c.course.id, revokedAt: null }, select: { userId: true } });
    expect(certified.map((x) => x.userId).sort()).toEqual([w.people.ana, w.people.ben, w.people.cat].sort());
  });

  it('a course that is not published finishes no one (it waits for its Publish), and says so', async () => {
    const c = await course(`Draft impact ${w.tag}`, { publish: false });
    expect(data<Impact>(await impact(c.quiz.id))).toMatchObject({ finishing: 0, published: false, certificate: true });
  });

  it('a course without a certificate says so (the website then asks the plain question)', async () => {
    const c = await course(`No certificate ${w.tag}`, { certificateOn: false });
    await readGuide(w.as.ana, c.course.id);
    expect(data<Impact>(await impact(c.quiz.id))).toEqual({ finishing: 1, certificate: false, published: true });
  });

  it('only administrators and Training managers may ask (403 for anyone else); an unknown lesson is 404', async () => {
    const c = await course(`Who asks ${w.tag}`);
    expect((await impact(c.quiz.id, w.as.ana)).statusCode).toBe(403);
    expect((await impact(c.quiz.id, w.as.amy)).statusCode).toBe(200);
    expect((await impact('lesson-that-is-not-there')).statusCode).toBe(404);
  });
});
