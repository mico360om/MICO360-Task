import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import { validationErrorBody } from '../../src/lib/validation-errors';
import { shiftDayKey, todayKey } from '../../src/lib/due-date';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthGuard } from '../../src/modules/auth/auth-guard';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { createTrainingManage } from '../../src/modules/training/training-manage';
import { registerTrainingManageRoutes } from '../../src/modules/training/training-manage-routes';
import type { AssignmentRow, FileRef, ManageCourse, ManageLesson, RuleRow } from '../../src/modules/training/training-types';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// The Training Center (manage) on a real database: who may use it (Training managers and administrators;
// never an employee or a client), authoring (courses, lessons, guide steps with pictures, video links,
// quizzes), publish problems, Minor fix / Major change, the 25 MB per-request file limit, assignments to a
// person / group / department / company / project with the membership-following sync, a Training manager's
// company scope, onboarding rules (new accounts only, switched off, deleted), feedback, certificates and the
// tour setting.
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const today = todayKey(TZ);
const MB = 1024 * 1024;
const PNG = readFileSync(resolve(__dirname, '../../assets/logo-pdf.png'));
const PDF_HEAD = Buffer.from('%PDF-1.4\n%training test\n', 'utf8');

let w: CompanyWorld;
let app: FastifyInstance;
let filesDir: string;
let clientId: string;
let deptId: string;
const notices: { userId: string; type: string; title: string; entityType: string | null; entityId: string | null }[] = [];
const extraUsers: string[] = [];
const courseIds: string[] = [];
const tokenService = createTokenService({
  accessSecret: 'training-manage-access',
  refreshSecret: 'training-manage-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(join(mkdtempSync(join(tmpdir(), 'tm-')), 'training-files')),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  notify: async (n) => {
    notices.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const sync = createTrainingSync(ctx);
const manage = createTrainingManage(ctx, sync);

type Who = 'admin' | 'ana' | 'amy' | 'ben' | 'bob' | 'cat' | 'client';
const idOf = (who: Who) => (who === 'client' ? clientId : w.people[who]);
const rolesOf = (who: Who) => (who === 'client' ? ['CLIENT'] : who === 'admin' ? ['ADMIN'] : ['EMPLOYEE']);
async function call(who: Who, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const { accessToken } = await tokenService.issueTokens({ id: idOf(who), roles: rolesOf(who) });
  const res = await app.inject({ method, url: `/api/v1${path}`, headers: { authorization: `Bearer ${accessToken}` }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as { data?: unknown; error?: { code: string; message: string; details?: unknown } }) : {} };
}
const data = async <T,>(p: ReturnType<typeof call>, status = 200): Promise<T> => {
  const r = await p;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data as T;
};
async function upload(who: Who, path: string, file: { name: string; type: string; content: Buffer }, fields: Record<string, string> = {}) {
  const boundary = `----training${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.content, Buffer.from(`\r\n--${boundary}--\r\n`));
  const { accessToken } = await tokenService.issueTokens({ id: idOf(who), roles: rolesOf(who) });
  const res = await app.inject({ method: 'POST', url: `/api/v1${path}`, headers: { authorization: `Bearer ${accessToken}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') as { data?: FileRef; error?: { code: string; message: string } } };
}
const sized = (n: number, head: Buffer) => Buffer.concat([head, Buffer.alloc(n - head.length, 0x20)]);
const newCourse = async (title: string, o: Record<string, unknown> = {}) => {
  const c = await data<ManageCourse>(call('amy', 'POST', '/training/manage/courses', { title: `${title} ${w.tag}`, moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', ...o }), 201);
  courseIds.push(c.id);
  return c;
};
/** A published one-guide course (made by an administrator). */
async function readyCourse(title: string, o: Record<string, unknown> = {}): Promise<string> {
  const c = await newCourse(title, o);
  const l = await data<ManageLesson>(call('admin', 'POST', `/training/manage/courses/${c.id}/lessons`, { kind: 'GUIDE', title: 'Read me' }), 201);
  await data(call('admin', 'PUT', `/training/manage/lessons/${l.id}/steps`, { steps: [{ title: 'One', body: '<p>Do this</p>' }] }));
  await data(call('admin', 'POST', `/training/manage/courses/${c.id}/publish`, {}));
  return c.id;
}
const activeAssignees = async (assignmentId: string) =>
  (await prisma.trainingAssignee.findMany({ where: { assignmentId, withdrawnAt: null }, select: { userId: true } })).map((a) => a.userId).sort();
const sorted = (ids: string[]) => [...ids].sort();

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  const c = await prisma.user.create({ data: { email: `client.${w.tag}@world.test`, username: `client_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } });
  clientId = c.id;
  await prisma.clientProjectGrant.create({ data: { userId: clientId, projectId: w.projects.PA, progress: true } });
  deptId = (await prisma.department.create({ data: { name: `Field ${w.tag}` } })).id;
  await prisma.user.update({ where: { id: w.people.ana }, data: { departmentId: deptId } });

  const guard = createAuthGuard(tokenService);
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    if (err instanceof ZodError) return reply.status(400).send(validationErrorBody(err));
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { code: 'ERROR', message: (err as Error).message } });
  });
  await app.register(
    async (api) => {
      // The app-wide multipart limit stays 10 MB; training files ask for 25 MB per request.
      await api.register(multipart, { limits: { fileSize: 10 * MB, files: 1 } });
      await registerTrainingManageRoutes(api, { manage, guard });
    },
    { prefix: '/api/v1' },
  );
  filesDir = ctx.files.dir;
});

afterAll(async () => {
  const users = [...Object.values(w.people), clientId, ...extraUsers];
  await prisma.trainingAssignee.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingRule.deleteMany({ where: { createdById: { in: users } } });
  await prisma.trainingEnrolment.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingFeedback.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCertificate.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingFile.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { uploadedById: { in: users } }] } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.systemSetting.deleteMany({ where: { key: 'training.tour' } });
  await prisma.clientProjectGrant.deleteMany({ where: { userId: clientId } });
  await prisma.user.updateMany({ where: { id: w.people.ana }, data: { departmentId: null } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, ...extraUsers] } } });
  await prisma.department.deleteMany({ where: { id: deptId } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('who may use the Training Center', () => {
  it('an employee is refused on every family; a client too; settings are for administrators only', async () => {
    const paths: ['GET' | 'POST' | 'PUT', string, unknown?][] = [
      ['GET', '/training/manage/courses'],
      ['POST', '/training/manage/courses', { title: 'x', moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER' }],
      ['GET', '/training/manage/courses/nope'],
      ['GET', '/training/manage/options'],
      ['GET', '/training/manage/assignments'],
      ['POST', '/training/manage/assignments/preview', {}],
      ['GET', '/training/manage/rules'],
      ['GET', '/training/manage/feedback'],
      ['GET', '/training/manage/certificates'],
      ['GET', '/training/settings'],
    ];
    for (const [m, p, b] of paths) {
      expect((await call('ana', m, p, b)).status, `${m} ${p}`).toBe(403);
      expect((await call('client', m, p, b)).status, `client ${m} ${p}`).toBe(403);
    }
    expect((await upload('ana', '/training/manage/signatures', { name: 's.png', type: 'image/png', content: PNG })).status).toBe(403);
    expect((await call('amy', 'GET', '/training/settings')).status).toBe(403);
    expect((await call('amy', 'GET', '/training/manage/courses')).status).toBe(200);
    expect((await call('admin', 'GET', '/training/settings')).status).toBe(200);
  });
});

let course: ManageCourse;
let guide: ManageLesson;
let video: ManageLesson;
let quiz: ManageLesson;
let picture: FileRef;
describe('authoring a course (a Training manager)', () => {
  it('a new course is a draft that can’t be published yet; a Client portal course must be for clients', async () => {
    course = await newCourse('Tasks basics');
    expect(course).toMatchObject({ status: 'DRAFT', version: 1, starter: false, publishProblems: ['Add at least one lesson.'], unpublishedChanges: false, roleKeys: [], companyIds: [] });
    expect((await call('amy', 'POST', '/training/manage/courses', { title: 'Portal', moduleKey: 'portal', audience: 'STAFF', difficulty: 'BEGINNER' })).status).toBe(400);
    expect((await call('amy', 'POST', '/training/manage/courses', { title: 'x'.repeat(161), moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER' })).status).toBe(400);
    const listed = await data<{ courses: { id: string; status: string }[] }>(call('amy', 'GET', `/training/manage/courses?status=DRAFT&q=${encodeURIComponent('Tasks basics')}`));
    expect(listed.courses.map((c) => c.id)).toContain(course.id);
  });

  it('a guide with a picture per step (only this course’s pictures)', async () => {
    guide = await data<ManageLesson>(call('amy', 'POST', `/training/manage/courses/${course.id}/lessons`, { kind: 'GUIDE', title: 'Make a task', minutes: 4, body: '<p>Hello <script>x</script></p>' }), 201);
    expect(guide.body).toBe('<p>Hello</p>');
    const up = await upload('amy', `/training/manage/courses/${course.id}/files`, { name: 'step.png', type: 'image/png', content: PNG }, { kind: 'IMAGE' });
    expect(up.status).toBe(201);
    picture = up.body.data!;
    expect(picture).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png', name: 'step.png' });
    const stored = await prisma.trainingFile.findUnique({ where: { id: picture.id } });
    expect(existsSync(join(filesDir, stored!.storageKey))).toBe(true);
    guide = await data<ManageLesson>(call('amy', 'PUT', `/training/manage/lessons/${guide.id}/steps`, { steps: [{ title: 'Open', body: '<p>Open My Tasks</p>', imageFileId: picture.id, imageAlt: 'My Tasks' }, { title: 'Save' }] }));
    expect(guide.steps.map((s) => [s.position, s.title, s.image])).toEqual([
      [0, 'Open', { fileId: picture.id, alt: 'My Tasks' }],
      [1, 'Save', null],
    ]);
    const other = await newCourse('Other');
    const otherPic = (await upload('amy', `/training/manage/courses/${other.id}/files`, { name: 'o.png', type: 'image/png', content: PNG }, { kind: 'IMAGE' })).body.data!;
    expect((await call('amy', 'PUT', `/training/manage/lessons/${guide.id}/steps`, { steps: [{ title: 'x', imageFileId: otherPic.id }] })).status).toBe(400);
  });

  it('a video from a YouTube link (normalised; anything else refused)', async () => {
    video = await data<ManageLesson>(call('amy', 'POST', `/training/manage/courses/${course.id}/lessons`, { kind: 'VIDEO', title: 'Watch', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3' }), 201);
    expect(video.video).toEqual({ provider: 'YOUTUBE', videoId: 'dQw4w9WgXcQ', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect((await call('amy', 'PATCH', `/training/manage/lessons/${video.id}`, { videoUrl: 'https://evil.example/v.mp4' })).status).toBe(400);
    expect((await call('amy', 'PATCH', `/training/manage/lessons/${video.id}`, { kind: 'GUIDE' })).status).toBe(400);
  });

  it('a quiz: True/False stored as True and False, put-in-order keeps the right order; an edit keeps question ids', async () => {
    quiz = await data<ManageLesson>(call('amy', 'POST', `/training/manage/courses/${course.id}/lessons`, { kind: 'QUIZ', title: 'Check' }), 201);
    expect(quiz.quiz).toMatchObject({ passMark: 70, questions: [] });
    const input = {
      passMark: 60,
      maxAttempts: 3,
      shuffle: true,
      timeLimitMinutes: null,
      drawCount: null,
      questions: [
        { kind: 'SINGLE', prompt: 'Where are tasks?', explanation: 'My Tasks', options: [{ text: 'My Tasks', correct: true, feedback: 'Yes' }, { text: 'Chat', correct: false }] },
        { kind: 'TRUE_FALSE', prompt: 'A task can have a due day', options: [{ text: 'True', correct: true }, { text: 'False', correct: false }] },
        { kind: 'ORDER', prompt: 'Make a task', options: [{ text: 'Open', correct: false }, { text: 'Type', correct: false }, { text: 'Save', correct: false }] },
      ],
    };
    quiz = await data<ManageLesson>(call('amy', 'PUT', `/training/manage/lessons/${quiz.id}/quiz`, input));
    expect(quiz.quiz!.questions.map((q) => [q.kind, q.options.map((o) => `${o.text}:${o.correct}`)])).toEqual([
      ['SINGLE', ['My Tasks:true', 'Chat:false']],
      ['TRUE_FALSE', ['True:true', 'False:false']],
      ['ORDER', ['Open:true', 'Type:true', 'Save:true']],
    ]);
    const ids = quiz.quiz!.questions.map((q) => q.id);
    const again = await data<ManageLesson>(call('amy', 'PUT', `/training/manage/lessons/${quiz.id}/quiz`, { ...input, passMark: 70 }));
    expect(again.quiz!.questions.map((q) => q.id)).toEqual(ids);
    expect((await call('amy', 'PUT', `/training/manage/lessons/${quiz.id}/quiz`, { ...input, drawCount: 9 })).status).toBe(400);
    expect((await call('amy', 'PUT', `/training/manage/lessons/${guide.id}/quiz`, input)).status).toBe(400);
  });

  it('publish problems first, then publish (version 1)', async () => {
    const empty = await data<ManageLesson>(call('amy', 'POST', `/training/manage/courses/${course.id}/lessons`, { kind: 'VIDEO', title: 'Coming soon' }), 201);
    const refused = await call('amy', 'POST', `/training/manage/courses/${course.id}/publish`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'PUBLISH_PROBLEMS', details: { problems: ['Lesson “Coming soon”: add the YouTube or Vimeo link.'] } });
    await data(call('amy', 'PATCH', `/training/manage/lessons/${empty.id}`, { videoUrl: 'https://vimeo.com/76979871/8272103f6e' }));
    course = await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${course.id}/publish`, {}));
    expect(course).toMatchObject({ status: 'PUBLISHED', version: 1, publishProblems: [], unpublishedChanges: false });
    expect(course.lessons.map((l) => l.kind)).toEqual(['GUIDE', 'VIDEO', 'QUIZ', 'VIDEO']);
    expect(course.lessons[3]!.video!.embedUrl).toBe('https://player.vimeo.com/video/76979871?h=8272103f6e');
  });

  it('Minor fix: version + 1 only; Major change: the edited lessons, and completed people review them', async () => {
    await data(call('amy', 'PATCH', `/training/manage/lessons/${guide.id}`, { title: 'Make a task (new)' }));
    course = await data<ManageCourse>(call('amy', 'GET', `/training/manage/courses/${course.id}`));
    expect(course.unpublishedChanges).toBe(true);
    const ask = await call('amy', 'POST', `/training/manage/courses/${course.id}/publish`, {});
    expect(ask.status).toBe(400);
    expect(ask.body.error!.code).toBe('CHANGE_KIND_NEEDED');
    course = await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${course.id}/publish`, { change: 'MINOR' }));
    expect(course).toMatchObject({ version: 2, unpublishedChanges: false });
    expect(course.lessons.every((l) => l.changedVersion <= 1)).toBe(true);

    const done = await prisma.trainingEnrolment.create({ data: { userId: w.people.cat, courseId: course.id, startedAt: new Date(Date.now() - 86_400_000), completedAt: new Date(Date.now() - 3_600_000), completedVersion: 2, progressPct: 100 } });
    await data(call('amy', 'PUT', `/training/manage/lessons/${guide.id}/steps`, { steps: [{ title: 'Open' }, { title: 'Type' }, { title: 'Save' }] }));
    course = await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${course.id}/publish`, { change: 'MAJOR', reviewDays: 10 }));
    expect(course.version).toBe(3);
    expect(course.lessons.find((l) => l.id === guide.id)!.changedVersion).toBe(3);
    expect(course.lessons.filter((l) => l.id !== guide.id).every((l) => l.changedVersion < 3)).toBe(true);
    const e = await prisma.trainingEnrolment.findUnique({ where: { id: done.id } });
    expect(e!.reviewFrom).not.toBeNull();
    expect(e!.reviewDueDay).toBe(shiftDayKey(today, 10));
    expect(e!.reviewDoneAt).toBeNull();
    expect(course.unpublishedChanges).toBe(false);
    expect(course.completed).toBe(1);
  });

  it('a published course can’t be deleted (archive it); a draft never published can, with its files', async () => {
    const del = await call('amy', 'DELETE', `/training/manage/courses/${course.id}`);
    expect(del.status).toBe(409);
    const draft = await newCourse('Scratch');
    const f = (await upload('amy', `/training/manage/courses/${draft.id}/files`, { name: 'n.pdf', type: 'application/pdf', content: PDF_HEAD }, { kind: 'RESOURCE' })).body.data!;
    const key = (await prisma.trainingFile.findUnique({ where: { id: f.id } }))!.storageKey;
    expect((await call('amy', 'DELETE', `/training/manage/courses/${draft.id}`)).status).toBe(204);
    expect(await prisma.trainingCourse.count({ where: { id: draft.id } })).toBe(0);
    expect(await prisma.trainingFile.count({ where: { id: f.id } })).toBe(0);
    expect(existsSync(join(filesDir, key))).toBe(false);
    const archived = await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${course.id}/archive`));
    expect(archived.status).toBe('ARCHIVED');
    course = await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${course.id}/publish`, { change: 'MINOR' }));
    expect(course.status).toBe('PUBLISHED');
  });
});

describe('training files', () => {
  it('pictures up to 10 MB; documents and downloads up to 25 MB (the app-wide limit is 10 MB)', async () => {
    const bigPicture = await upload('amy', `/training/manage/courses/${course.id}/files`, { name: 'big.png', type: 'image/png', content: sized(10 * MB + 1, PNG) }, { kind: 'IMAGE' });
    expect(bigPicture.status).toBe(400);
    expect(bigPicture.body.error!.message).toMatch(/10 MB/);
    const pdf = await upload('amy', `/training/manage/courses/${course.id}/files`, { name: 'Guide.pdf', type: 'application/pdf', content: sized(12 * MB, PDF_HEAD) }, { kind: 'RESOURCE' });
    expect(pdf.status).toBe(201);
    expect(pdf.body.data).toMatchObject({ kind: 'RESOURCE', sizeBytes: 12 * MB });
    const tooBig = await upload('amy', `/training/manage/courses/${course.id}/files`, { name: 'Huge.pdf', type: 'application/pdf', content: sized(25 * MB + 10, PDF_HEAD) }, { kind: 'RESOURCE' });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error!.message).toMatch(/25 MB/);
    const fake = await upload('amy', `/training/manage/courses/${course.id}/files`, { name: 'fake.pdf', type: 'application/pdf', content: PNG }, { kind: 'RESOURCE' });
    expect(fake.status).toBe(400);
    const noKind = await upload('amy', `/training/manage/courses/${course.id}/files`, { name: 'a.pdf', type: 'application/pdf', content: PDF_HEAD });
    expect(noKind.status).toBe(400);
    const viaQuery = await upload('amy', `/training/manage/courses/${course.id}/files?kind=RESOURCE`, { name: 'a.pdf', type: 'application/pdf', content: PDF_HEAD });
    expect(viaQuery.status).toBe(201);
  });

  it('a file in use can’t be deleted; a document lesson takes a file of its course', async () => {
    const doc = (await upload('amy', `/training/manage/courses/${course.id}/files`, { name: 'Read.pdf', type: 'application/pdf', content: PDF_HEAD }, { kind: 'DOCUMENT' })).body.data!;
    const lesson = await data<ManageLesson>(call('amy', 'POST', `/training/manage/courses/${course.id}/lessons`, { kind: 'DOCUMENT', title: 'Read', fileId: doc.id }), 201);
    expect(lesson.document).toMatchObject({ id: doc.id, kind: 'DOCUMENT' });
    expect((await call('amy', 'DELETE', `/training/manage/files/${doc.id}`)).status).toBe(409);
    await data(call('amy', 'PUT', `/training/manage/lessons/${guide.id}/steps`, { steps: [{ title: 'Open', imageFileId: picture.id, imageAlt: 'My Tasks' }, { title: 'Save' }] }));
    expect((await call('amy', 'DELETE', `/training/manage/files/${picture.id}`)).status).toBe(409);
    await data(call('amy', 'DELETE', `/training/manage/lessons/${lesson.id}`), 204).catch(() => undefined);
    expect((await call('amy', 'DELETE', `/training/manage/files/${doc.id}`)).status).toBe(204);
  });

  it('a signature picture, and “Issued by” is a Training manager or an administrator', async () => {
    const sig = await upload('amy', '/training/manage/signatures', { name: 'sig.png', type: 'image/png', content: PNG });
    expect(sig.status).toBe(201);
    expect(sig.body.data).toMatchObject({ kind: 'SIGNATURE' });
    const pdfSig = await upload('amy', '/training/manage/signatures', { name: 'sig.pdf', type: 'application/pdf', content: PDF_HEAD });
    expect(pdfSig.status).toBe(400);
    const c = await data<ManageCourse>(call('amy', 'PATCH', `/training/manage/courses/${course.id}`, { certificateOn: true, certificateMonths: 12, issuerUserId: w.people.amy, issuerTitle: 'Training lead', signatureFileId: sig.body.data!.id }));
    expect(c).toMatchObject({ certificateOn: true, certificateMonths: 12, issuerUserId: w.people.amy, issuerTitle: 'Training lead', signature: { id: sig.body.data!.id } });
    expect((await call('amy', 'PATCH', `/training/manage/courses/${course.id}`, { issuerUserId: w.people.ana })).status).toBe(400);
    expect((await call('amy', 'PATCH', `/training/manage/courses/${course.id}`, { signatureFileId: picture.id })).status).toBe(400);
  });
});

let basics: string;
describe('assignments (they follow membership)', () => {
  beforeAll(async () => {
    basics = await readyCourse('Board basics');
  });

  it('to a company, a department, a project, a group and a person: each reaches its people (with an enrolment)', async () => {
    const assign = async (who: Who, body: Record<string, unknown>) => (await data<{ assignments: AssignmentRow[] }>(call(who, 'POST', '/training/manage/assignments', { courseIds: [basics], mandatory: true, ...body }), 201)).assignments;
    const [company] = await assign('admin', { targetKind: 'COMPANY', targetId: w.companies.A, dueDays: 7 });
    expect(company).toMatchObject({ targetLabel: `Alpha ${w.tag}`, people: 3, completed: 0, overdue: 0, frozen: false, mandatory: true, dueDays: 7 });
    expect(await activeAssignees(company!.id)).toEqual(sorted([w.people.ana, w.people.amy, w.people.cat]));
    const due = await prisma.trainingAssignee.findFirst({ where: { assignmentId: company!.id, userId: w.people.ana } });
    expect(due!.dueDay).toBe(shiftDayKey(today, 7));
    expect(await prisma.trainingEnrolment.count({ where: { courseId: basics, userId: { in: [w.people.ana, w.people.amy, w.people.cat] }, withdrawnAt: null } })).toBe(3);

    const [dept] = await assign('admin', { targetKind: 'DEPARTMENT', targetId: deptId });
    expect(dept!.targetLabel).toBe(`Field ${w.tag}`);
    expect(await activeAssignees(dept!.id)).toEqual([w.people.ana]);
    const [project] = await assign('admin', { targetKind: 'PROJECT', targetId: w.projects.PB });
    expect(await activeAssignees(project!.id)).toEqual(sorted([w.people.ben, w.people.cat]));
    const [tms] = await assign('admin', { targetKind: 'GROUP', targetId: 'training-managers' });
    expect(tms!.targetLabel).toBe('Training managers');
    expect(await activeAssignees(tms!.id)).toContain(w.people.amy);
    const [one] = await assign('admin', { targetKind: 'USER', targetId: w.people.bob, dueDay: shiftDayKey(today, 3) });
    expect(one).toMatchObject({ targetLabel: expect.stringContaining('Bob'), dueDay: shiftDayKey(today, 3), people: 1 });
    // The client isn't on a project's team: never reached by a project or company assignment.
    expect(await prisma.trainingAssignee.count({ where: { courseId: basics, userId: clientId } })).toBe(0);
  });

  it('refused: a draft course, both due kinds, a day in the past', async () => {
    const draft = await newCourse('Not yet');
    expect((await call('admin', 'POST', '/training/manage/assignments', { courseIds: [draft.id], targetKind: 'GROUP', targetId: 'everyone', mandatory: true })).status).toBe(409);
    expect((await call('admin', 'POST', '/training/manage/assignments', { courseIds: [basics], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDay: shiftDayKey(today, 2), dueDays: 2 })).status).toBe(400);
    expect((await call('admin', 'POST', '/training/manage/assignments', { courseIds: [basics], targetKind: 'GROUP', targetId: 'everyone', mandatory: true, dueDay: shiftDayKey(today, -1) })).status).toBe(400);
    expect((await call('admin', 'POST', '/training/manage/assignments', { courseIds: [basics], targetKind: 'GROUP', targetId: 'nobody', mandatory: true })).status).toBe(400);
  });

  it('a Training manager assigns only inside her companies (scope stored), and can’t withdraw an administrator’s assignment', async () => {
    expect((await call('amy', 'POST', '/training/manage/assignments', { courseIds: [basics], targetKind: 'COMPANY', targetId: w.companies.B, mandatory: true })).status).toBe(403);
    expect((await call('amy', 'POST', '/training/manage/assignments', { courseIds: [basics], targetKind: 'USER', targetId: w.people.bob, mandatory: true })).status).toBe(400);
    const extra = await readyCourse('Calendar basics');
    const [mine] = (await data<{ assignments: AssignmentRow[] }>(call('amy', 'POST', '/training/manage/assignments', { courseIds: [extra], targetKind: 'GROUP', targetId: 'everyone', mandatory: false }), 201)).assignments;
    const row = await prisma.trainingAssignment.findUnique({ where: { id: mine!.id } });
    expect(row!.scopeCompanyIds).toEqual([w.companies.A]);
    const reached = await activeAssignees(mine!.id);
    expect(reached).toEqual(expect.arrayContaining([w.people.ana, w.people.amy, w.people.cat]));
    expect(reached).not.toContain(w.people.ben);
    expect(reached).not.toContain(w.people.bob);
    const adminOne = (await data<{ assignments: AssignmentRow[] }>(call('admin', 'GET', `/training/manage/assignments?courseId=${basics}`))).assignments[0]!;
    expect((await call('amy', 'DELETE', `/training/manage/assignments/${adminOne.id}`)).status).toBe(403);
    // M6: her list leaves out what is outside her companies (the PB project, Bob); the rest counts her people only.
    const hers = (await data<{ assignments: AssignmentRow[] }>(call('amy', 'GET', `/training/manage/assignments?courseId=${basics}`))).assignments;
    expect(hers.find((a) => a.targetKind === 'PROJECT')).toBeUndefined();
    expect(hers.find((a) => a.targetKind === 'USER' && a.targetId === w.people.bob)).toBeUndefined();
    expect(hers.find((a) => a.targetKind === 'COMPANY')!.people).toBe(3);
    expect(JSON.stringify(hers)).not.toMatch(/Betaonly|Project PB/);
  });

  it('the preview: how many it reaches, who can’t see the course, who has it already', async () => {
    const preview = await data<{ reach: number; already: number; skipped: { name: string; reason: string }[] }>(call('amy', 'POST', '/training/manage/assignments/preview', { courseIds: [basics], targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true }));
    expect(preview).toEqual({ reach: 3, already: 3, skipped: [] });
    const adminsOnly = await readyCourse('Admin settings', { moduleKey: 'admin' });
    const p2 = await data<{ reach: number; already: number; skipped: { name: string; reason: string }[] }>(call('amy', 'POST', '/training/manage/assignments/preview', { courseIds: [adminsOnly], targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true }));
    expect(p2.reach).toBe(0);
    expect(p2.skipped.map((s) => s.reason)).toEqual(['can’t see this course', 'can’t see this course', 'can’t see this course']);
  });

  it('withdrawing: unfinished training with nothing else left is withdrawn; finished training is kept', async () => {
    const c3 = await readyCourse('Meetings basics');
    const [a] = (await data<{ assignments: AssignmentRow[] }>(call('admin', 'POST', '/training/manage/assignments', { courseIds: [c3], targetKind: 'COMPANY', targetId: w.companies.A, mandatory: true }), 201)).assignments;
    await prisma.trainingEnrolment.update({ where: { userId_courseId: { userId: w.people.cat, courseId: c3 } }, data: { startedAt: new Date(), completedAt: new Date(), completedVersion: 1 } });
    expect((await call('admin', 'DELETE', `/training/manage/assignments/${a!.id}`)).status).toBe(204);
    const rows = await prisma.trainingEnrolment.findMany({ where: { courseId: c3 }, select: { userId: true, withdrawnAt: true } });
    expect(rows.find((r) => r.userId === w.people.ana)!.withdrawnAt).not.toBeNull();
    expect(rows.find((r) => r.userId === w.people.amy)!.withdrawnAt).not.toBeNull();
    expect(rows.find((r) => r.userId === w.people.cat)!.withdrawnAt).toBeNull();
    expect(await activeAssignees(a!.id)).toEqual([]);
    expect((await call('admin', 'DELETE', `/training/manage/assignments/${a!.id}`)).status).toBe(404);
  });
});

describe('onboarding rules (new accounts only)', () => {
  let ruleCourse: string;
  let rule: RuleRow;
  const newPerson = async (name: string) => {
    await new Promise((r) => setTimeout(r, 30));
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    const u = await prisma.user.create({
      data: { email: `${name}.${w.tag}@world.test`, username: `${name}_${w.tag}`, passwordHash: 'x', firstName: name, lastName: w.tag, roles: { create: { roleId: role.id } }, primaryCompanyId: w.companies.A, companies: { create: { companyId: w.companies.A } } },
    });
    extraUsers.push(u.id);
    return u.id;
  };

  it('a rule reaches nobody who is there already; a new account gets it with its own due day', async () => {
    ruleCourse = await readyCourse('Welcome');
    rule = await data<RuleRow>(call('amy', 'POST', '/training/manage/rules', { name: 'New staff', targetKind: 'COMPANY', targetId: w.companies.A, courseIds: [ruleCourse], mandatory: true, dueDays: 10 }), 201);
    expect(rule).toMatchObject({ name: 'New staff', targetLabel: `Alpha ${w.tag}`, courseTitles: [`Welcome ${w.tag}`], active: true, people: 0, dueDays: 10 });
    expect(await prisma.trainingAssignee.count({ where: { courseId: ruleCourse } })).toBe(0);
    const nia = await newPerson('nia');
    await sync.all();
    const got = await prisma.trainingAssignee.findFirst({ where: { courseId: ruleCourse, userId: nia, withdrawnAt: null } });
    expect(got!.dueDay).toBe(shiftDayKey(today, 10));
    const rules = (await data<{ rules: RuleRow[] }>(call('amy', 'GET', '/training/manage/rules'))).rules;
    expect(rules.find((r) => r.id === rule.id)!.people).toBe(1);
    // An administrator's rule is not hers to change; a company outside hers is refused.
    const adminRule = await data<RuleRow>(call('admin', 'POST', '/training/manage/rules', { name: 'Everyone', targetKind: 'GROUP', targetId: 'everyone', courseIds: [ruleCourse], mandatory: false, dueDays: null }), 201);
    expect((await call('amy', 'PATCH', `/training/manage/rules/${adminRule.id}`, { name: 'Mine' })).status).toBe(403);
    expect((await call('amy', 'POST', '/training/manage/rules', { name: 'B', targetKind: 'COMPANY', targetId: w.companies.B, courseIds: [ruleCourse], mandatory: true, dueDays: null })).status).toBe(403);
    expect((await call('admin', 'DELETE', `/training/manage/rules/${adminRule.id}`)).status).toBe(204);
    // A rule's assignment is changed through the rule.
    const ra = await prisma.trainingAssignment.findFirst({ where: { ruleId: rule.id, withdrawnAt: null } });
    expect((await call('amy', 'DELETE', `/training/manage/assignments/${ra!.id}`)).status).toBe(409);
  });

  it('switched off: it stops following (nobody new gets it; nobody loses it)', async () => {
    const off = await data<RuleRow>(call('amy', 'PATCH', `/training/manage/rules/${rule.id}`, { active: false }));
    expect(off.active).toBe(false);
    expect(await prisma.trainingAssignment.count({ where: { ruleId: rule.id, withdrawnAt: null, frozenAt: null } })).toBe(0);
    const omar = await newPerson('omar');
    await sync.all();
    expect(await prisma.trainingAssignee.count({ where: { courseId: ruleCourse, userId: omar } })).toBe(0);
    expect(await prisma.trainingAssignee.count({ where: { courseId: ruleCourse, withdrawnAt: null } })).toBe(1);
  });

  it('deleted: its unfinished training is withdrawn', async () => {
    expect((await call('amy', 'DELETE', `/training/manage/rules/${rule.id}`)).status).toBe(204);
    expect(await prisma.trainingRule.count({ where: { id: rule.id } })).toBe(0);
    expect(await prisma.trainingAssignee.count({ where: { courseId: ruleCourse, withdrawnAt: null } })).toBe(0);
    const e = await prisma.trainingEnrolment.findFirst({ where: { courseId: ruleCourse, userId: extraUsers[0] } });
    expect(e!.withdrawnAt).not.toBeNull();
  });
});

describe('feedback, certificates and settings', () => {
  it('a Training manager sees and answers feedback from her companies’ people; the staff asker is told, a client isn’t', async () => {
    const q = (userId: string, kind: string, body: string) => prisma.trainingFeedback.create({ data: { courseId: course.id, userId, kind, body } });
    const ana = await q(w.people.ana, 'QUESTION', 'How do I add a picture?');
    const cli = await q(clientId, 'QUESTION', 'Where is my project?');
    const ben = await q(w.people.ben, 'QUESTION', 'Beta question');
    const old = await prisma.trainingFeedback.create({ data: { courseId: course.id, lessonId: guide.id, userId: w.people.cat, kind: 'OUTDATED', body: 'The button moved' } });
    const list = (await data<{ items: { id: string; byName: string | null; lessonTitle: string | null }[] }>(call('amy', 'GET', '/training/manage/feedback'))).items.map((i) => i.id);
    expect(list).toEqual(expect.arrayContaining([ana.id, cli.id, old.id]));
    expect(list).not.toContain(ben.id);
    const all = (await data<{ items: { id: string }[] }>(call('admin', 'GET', '/training/manage/feedback?kind=QUESTION&status=OPEN'))).items.map((i) => i.id);
    expect(all).toEqual(expect.arrayContaining([ana.id, cli.id, ben.id]));
    expect(all).not.toContain(old.id);
    notices.length = 0;
    const answered = await data<{ status: string; answer: string; byName: string }>(call('amy', 'POST', `/training/manage/feedback/${ana.id}/answer`, { answer: 'Use the picture button.' }));
    expect(answered).toMatchObject({ status: 'ANSWERED', answer: 'Use the picture button.' });
    await data(call('amy', 'POST', `/training/manage/feedback/${cli.id}/answer`, { answer: 'On your home page.' }));
    expect(notices.map((n) => [n.userId, n.type, n.entityType, n.entityId])).toEqual([[w.people.ana, 'TRAINING_QUESTION', 'training-course', course.id]]);
    expect((await call('amy', 'POST', `/training/manage/feedback/${ben.id}/answer`, { answer: 'x' })).status).toBe(404);
    expect((await call('amy', 'POST', `/training/manage/feedback/${ana.id}/fixed`)).status).toBe(409);
    expect(await data<{ status: string; lessonTitle: string }>(call('amy', 'POST', `/training/manage/feedback/${old.id}/fixed`))).toMatchObject({ status: 'FIXED', lessonTitle: 'Make a task (new)' });
  });

  it('certificates in scope; revoking needs a reason and happens once', async () => {
    const cert = (userId: string, code: string) => prisma.trainingCertificate.create({ data: { code: `${code}${w.tag.toUpperCase().slice(0, 4).padEnd(4, 'Z')}`, userId, courseId: course.id, learnerName: 'Someone', courseTitle: course.title } });
    const anaCert = await cert(w.people.ana, 'TC-AAAA-BBBB-');
    const benCert = await cert(w.people.ben, 'TC-CCCC-DDDD-');
    const hers = (await data<{ certificates: { id: string; status: string; userId: string; learnerName: string }[] }>(call('amy', 'GET', `/training/manage/certificates?courseId=${course.id}`))).certificates;
    expect(hers.map((c) => c.id)).toEqual([anaCert.id]);
    expect(hers[0]).toMatchObject({ status: 'VALID', userId: w.people.ana, learnerName: 'Someone' });
    const everyone = (await data<{ certificates: { id: string }[] }>(call('admin', 'GET', `/training/manage/certificates?q=${encodeURIComponent('TC-CCCC')}`))).certificates;
    expect(everyone.map((c) => c.id)).toEqual([benCert.id]);
    expect((await call('amy', 'POST', `/training/manage/certificates/${benCert.id}/revoke`, { reason: 'Wrong person' })).status).toBe(404);
    expect((await call('amy', 'POST', `/training/manage/certificates/${anaCert.id}/revoke`, {})).status).toBe(400);
    expect(await data<{ status: string }>(call('amy', 'POST', `/training/manage/certificates/${anaCert.id}/revoke`, { reason: 'Issued by mistake' }))).toMatchObject({ status: 'REVOKED' });
    expect((await call('amy', 'POST', `/training/manage/certificates/${anaCert.id}/revoke`, { reason: 'Again' })).status).toBe(409);
  });

  it('options: a Training manager sees her companies’ people, companies and projects; issuers are managers and administrators', async () => {
    const o = await data<{ people: { id: string; client: boolean }[]; companies: { id: string }[]; projects: { id: string }[]; issuers: { id: string }[]; groups: { key: string }[]; departments: { id: string }[] }>(call('amy', 'GET', '/training/manage/options'));
    const ids = o.people.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([w.people.ana, w.people.amy, w.people.cat, clientId]));
    expect(ids).not.toContain(w.people.ben);
    expect(o.people.find((p) => p.id === clientId)!.client).toBe(true);
    expect(o.companies.map((c) => c.id)).toEqual([w.companies.A]);
    expect(o.projects.map((p) => p.id)).toEqual(expect.arrayContaining([w.projects.PA, w.projects.PAB]));
    expect(o.projects.map((p) => p.id)).not.toContain(w.projects.PB);
    expect(o.issuers.map((i) => i.id)).toEqual(expect.arrayContaining([w.people.amy, w.people.admin]));
    expect(o.groups.map((g) => g.key)).toEqual(['everyone', 'admins', 'employees', 'clients', 'project-runners', 'training-managers']);
    expect(o.departments.map((d) => d.id)).toContain(deptId);
  });

  it('settings: the tour switched off per company (administrators; unknown companies refused)', async () => {
    const s = await data<{ tourOff: string[]; companies: { id: string }[] }>(call('admin', 'PUT', '/training/settings', { tourOff: [w.companies.A, w.companies.A] }));
    expect(s.tourOff).toEqual([w.companies.A]);
    expect(s.companies.map((c) => c.id)).toEqual(expect.arrayContaining([w.companies.A, w.companies.B]));
    expect((await call('admin', 'PUT', '/training/settings', { tourOff: ['nope'] })).status).toBe(400);
    expect((await call('amy', 'PUT', '/training/settings', { tourOff: [] })).status).toBe(403);
    expect((await data<{ tourOff: string[] }>(call('admin', 'GET', '/training/settings'))).tourOff).toEqual([w.companies.A]);
  });
});
