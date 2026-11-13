import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import { validationErrorBody } from '../../src/lib/validation-errors';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthGuard } from '../../src/modules/auth/auth-guard';
import { trainingContext, type TrainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore, type TrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { clampSavedSteps, createTrainingManage } from '../../src/modules/training/training-manage';
import { createModuleOps } from '../../src/modules/training/training-manage-modules';
import { registerTrainingManageRoutes } from '../../src/modules/training/training-manage-routes';
import { untouchedStarter } from '../../src/modules/training/training-starter';
import type { FileRef, ManageCourse, ManageCourseRow, ManageLesson } from '../../src/modules/training/training-types';

// Requires a running MySQL / MariaDB (TEST_DATABASE_URL) with migrations applied.
// Learning Hub as one course (1.23.31, D6/§9b): modules are a course-editor feature of any course — added, renamed,
// reordered, limited (feature, groups, companies), switched on and off and removed (lessons move, never deleted);
// a lesson moves between modules; a module change edits a built-in course (no more built-in updates) and finishes
// anyone it leaves with everything done; Duplicate (R3) copies a course (modules, lessons, quiz, new copies of its
// files) as an unpublished draft with nobody's progress; the Manage list's Audience filter and its facts (notice,
// limited to, ever published, modules).
const url = process.env.TEST_DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const TZ = 'Asia/Muscat';
const MB = 1024 * 1024;
const PNG = readFileSync(resolve(__dirname, '../../assets/logo-pdf.png'));
const PDF_HEAD = Buffer.from('%PDF-1.4\n%training modules test\n', 'utf8');
/** The conversion's record, under this file's own key (the site's `training.oneCourse` is never touched). */
const RECORD_KEY = `training.oneCourse.test-${randomBytes(4).toString('hex')}`;

let w: CompanyWorld;
let app: FastifyInstance;
let clientId: string;
const courseIds: string[] = [];
const audits: { action: string; entityId: string | null; newValue?: unknown }[] = [];
const filesDir = join(mkdtempSync(join(tmpdir(), 'tmm-')), 'training-files');
const files = createTrainingFileStore(filesDir);
const tokenService = createTokenService({
  accessSecret: 'training-modules-access',
  refreshSecret: 'training-modules-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const ctx = trainingContext({
  prisma,
  files,
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  notify: async () => {},
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
  audit: async (e) => {
    audits.push({ action: e.action, entityId: e.entityId, newValue: e.newValue });
  },
});
const sync = createTrainingSync(ctx);
const manage = createTrainingManage(ctx, sync, { oneCourseKey: RECORD_KEY });

type Who = 'admin' | 'ana' | 'amy' | 'client';
const userOf = (who: Who) => (who === 'client' ? clientId : w.people[who]);
const rolesOf = (who: Who) => (who === 'client' ? ['CLIENT'] : who === 'admin' ? ['ADMIN'] : ['EMPLOYEE']);
type Reply = { status: number; body: { data?: unknown; error?: { code: string; message: string; details?: unknown } } };
async function call(who: Who, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Reply> {
  const { accessToken } = await tokenService.issueTokens({ id: userOf(who), roles: rolesOf(who) });
  const res = await app.inject({ method, url: `/api/v1${path}`, headers: { authorization: `Bearer ${accessToken}` }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : {} };
}
const data = async <T,>(p: Promise<Reply>, status = 200): Promise<T> => {
  const r = await p;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data as T;
};
async function upload(courseId: string, kind: 'IMAGE' | 'DOCUMENT' | 'RESOURCE', file: { name: string; type: string; content: Buffer }, path = `/training/manage/courses/${courseId}/files`): Promise<FileRef> {
  const boundary = `----modules${Math.random().toString(16).slice(2)}`;
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  const { accessToken } = await tokenService.issueTokens({ id: w.people.amy, roles: ['EMPLOYEE'] });
  const res = await app.inject({ method: 'POST', url: `/api/v1${path}`, headers: { authorization: `Bearer ${accessToken}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) });
  if (res.statusCode !== 201) throw new Error(`upload: ${res.statusCode} ${res.body}`);
  return (JSON.parse(res.body) as { data: FileRef }).data;
}
const newCourse = async (title: string, o: Record<string, unknown> = {}) => {
  const c = await data<ManageCourse>(call('amy', 'POST', '/training/manage/courses', { title: `${title} ${w.tag}`, moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER', ...o }), 201);
  courseIds.push(c.id);
  return c;
};
const addLesson = (courseId: string, body: Record<string, unknown>) => data<ManageLesson>(call('amy', 'POST', `/training/manage/courses/${courseId}/lessons`, body), 201);
async function guideLesson(courseId: string, title: string, steps: Record<string, unknown>[] = [{ title: 'Do it', body: '<p>Do this</p>' }]): Promise<ManageLesson> {
  const l = await addLesson(courseId, { kind: 'GUIDE', title });
  return data<ManageLesson>(call('amy', 'PUT', `/training/manage/lessons/${l.id}/steps`, { steps }));
}
const addModule = (courseId: string, body: Record<string, unknown>, who: Who = 'amy') => data<ManageCourse>(call(who, 'POST', `/training/manage/courses/${courseId}/modules`, body), 201);
const moduleNamed = (c: ManageCourse, title: string) => c.modules.find((m) => m.title === title)!;
const moveLesson = (lessonId: string, moduleId: string | null) => data<ManageLesson>(call('amy', 'PATCH', `/training/manage/lessons/${lessonId}`, { moduleId }));
const getCourse = (id: string) => data<ManageCourse>(call('amy', 'GET', `/training/manage/courses/${id}`));
const listed = async (query: string) => (await data<{ courses: ManageCourseRow[] }>(call('amy', 'GET', `/training/manage/courses?q=${encodeURIComponent(w.tag)}${query}`))).courses;
/** Lessons of the course in course order, as [title, module title or null]. */
const layout = (c: ManageCourse) => [...c.lessons].sort((a, b) => a.position - b.position).map((l) => [l.title, c.modules.find((m) => m.id === l.moduleId)?.title ?? null]);

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  const role = await prisma.role.upsert({ where: { name: 'CLIENT' }, create: { name: 'CLIENT' }, update: {} });
  clientId = (await prisma.user.create({ data: { email: `client.${w.tag}@world.test`, username: `client_${w.tag}`, passwordHash: 'x', firstName: 'Client', lastName: w.tag, roles: { create: { roleId: role.id } } } })).id;

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
      await api.register(multipart, { limits: { fileSize: 10 * MB, files: 1 } });
      await registerTrainingManageRoutes(api, { manage, guard });
    },
    { prefix: '/api/v1' },
  );
});

afterAll(async () => {
  const copies = (await prisma.trainingCourse.findMany({ where: { title: { contains: w.tag } }, select: { id: true } })).map((c) => c.id);
  const all = [...new Set([...courseIds, ...copies])];
  const users = [...Object.values(w.people), clientId];
  await prisma.trainingAssignee.deleteMany({ where: { OR: [{ courseId: { in: all } }, { userId: { in: users } }] } });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: all } } });
  await prisma.trainingEnrolment.deleteMany({ where: { OR: [{ courseId: { in: all } }, { userId: { in: users } }] } });
  await prisma.trainingProgress.deleteMany({ where: { OR: [{ courseId: { in: all } }, { userId: { in: users } }] } });
  await prisma.trainingAttempt.deleteMany({ where: { OR: [{ courseId: { in: all } }, { userId: { in: users } }] } });
  await prisma.trainingModuleDone.deleteMany({ where: { OR: [{ courseId: { in: all } }, { userId: { in: users } }] } });
  await prisma.trainingFeedback.deleteMany({ where: { OR: [{ courseId: { in: all } }, { userId: { in: users } }] } });
  await prisma.trainingCertificate.deleteMany({ where: { OR: [{ courseId: { in: all } }, { userId: { in: users } }] } });
  await prisma.trainingFile.deleteMany({ where: { OR: [{ courseId: { in: all } }, { uploadedById: { in: users } }] } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: all } } });
  await prisma.systemSetting.deleteMany({ where: { key: RECORD_KEY } });
  await prisma.user.deleteMany({ where: { id: clientId } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('modules in any course (a Training manager)', () => {
  let course: ManageCourse;
  it('adds modules at the end (teaching the course’s feature, for all staff); renames, limits and reorders them; with plain words', async () => {
    course = await newCourse('Modules');
    expect(course.modules).toEqual([]);
    course = await addModule(course.id, { title: 'Basics' });
    expect(course.modules).toEqual([{ id: expect.any(String), title: 'Basics', position: 0, moduleKey: 'tasks', roleKeys: [], companyIds: [], enabled: true, offReason: null, starter: false, visibility: 'All staff' }]);
    course = await addModule(course.id, { title: 'For admins', moduleKey: 'reports' });
    course = await addModule(course.id, { title: 'Later', enabled: false });
    expect(course.modules.map((m) => [m.title, m.position, m.visibility])).toEqual([
      ['Basics', 0, 'All staff'],
      ['For admins', 1, 'Admins only'],
      ['Later', 2, 'Off'],
    ]);
    const basics = moduleNamed(course, 'Basics');
    course = await data<ManageCourse>(call('amy', 'PATCH', `/training/manage/modules/${basics.id}`, { title: '  The basics ', roleKeys: ['employees', 'employees'], companyIds: [w.companies.A] }));
    expect(moduleNamed(course, 'The basics')).toMatchObject({ id: basics.id, roleKeys: ['employees'], companyIds: [w.companies.A], visibility: `Employees only · Alpha ${w.tag}` });
    course = await data<ManageCourse>(call('amy', 'PATCH', `/training/manage/modules/${basics.id}`, { roleKeys: [], companyIds: [] }));
    expect(moduleNamed(course, 'The basics')).toMatchObject({ roleKeys: [], companyIds: [], visibility: 'All staff' });

    const ids = course.modules.map((m) => m.id);
    course = await data<ManageCourse>(call('amy', 'PUT', `/training/manage/courses/${course.id}/module-order`, { moduleIds: [ids[2], ids[0], ids[1]] }));
    expect(course.modules.map((m) => [m.title, m.position])).toEqual([
      ['Later', 0],
      ['The basics', 1],
      ['For admins', 2],
    ]);
    for (const moduleIds of [[ids[0], ids[1]], [ids[0], ids[0], ids[1]], [...ids, 'nope']]) {
      expect((await call('amy', 'PUT', `/training/manage/courses/${course.id}/module-order`, { moduleIds })).status, JSON.stringify(moduleIds)).toBe(400);
    }
    expect(audits.filter((a) => a.action.startsWith('training.module.')).map((a) => a.action)).toEqual([
      'training.module.create',
      'training.module.create',
      'training.module.create',
      'training.module.update',
      'training.module.update',
      'training.module.reorder',
    ]);
  });

  it('refuses what doesn’t fit: a long title, the Client portal feature in a staff course, an unknown company, more than 30 modules', async () => {
    expect((await call('amy', 'POST', `/training/manage/courses/${course.id}/modules`, { title: 'x'.repeat(161) })).status).toBe(400);
    expect((await call('amy', 'POST', `/training/manage/courses/${course.id}/modules`, { title: ' ' })).status).toBe(400);
    expect((await call('amy', 'POST', `/training/manage/courses/${course.id}/modules`, { title: 'Portal', moduleKey: 'portal' })).status).toBe(400);
    expect((await call('amy', 'POST', `/training/manage/courses/${course.id}/modules`, { title: 'Where', companyIds: ['nope'] })).status).toBe(400);
    expect((await call('amy', 'PATCH', `/training/manage/modules/${course.modules[0]!.id}`, { moduleKey: 'portal' })).status).toBe(400);
    expect((await call('amy', 'PATCH', '/training/manage/modules/nope', { title: 'x' })).status).toBe(404);
    expect((await call('amy', 'POST', '/training/manage/courses/nope/modules', { title: 'x' })).status).toBe(404);
    const full = await newCourse('Full');
    await prisma.trainingModule.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ courseId: full.id, position: i, title: `M${i}` })) });
    const refused = await call('amy', 'POST', `/training/manage/courses/${full.id}/modules`, { title: 'One more' });
    expect(refused.status).toBe(400);
    expect(refused.body.error!.message).toBe('A course has at most 30 modules.');
  });

  it('a course for clients: its modules are for clients (feature and groups don’t apply), limited by company', async () => {
    let guide = await newCourse('Client guide', { moduleKey: 'portal', audience: 'CLIENTS' });
    guide = await addModule(guide.id, { title: 'Your projects' });
    expect(guide.modules[0]).toMatchObject({ moduleKey: 'general', visibility: 'Clients' });
    guide = await data<ManageCourse>(call('amy', 'PATCH', `/training/manage/modules/${guide.modules[0]!.id}`, { companyIds: [w.companies.B], roleKeys: ['admins'], moduleKey: 'admin' }));
    expect(guide.modules[0]).toMatchObject({ roleKeys: ['admins'], companyIds: [w.companies.B], visibility: `Clients · Beta ${w.tag}` });
  });

  it('an employee (and a client) is refused every module call and Duplicate; an administrator may', async () => {
    const m = course.modules[0]!;
    const calls: ['POST' | 'PATCH' | 'PUT', string, unknown][] = [
      ['POST', `/training/manage/courses/${course.id}/modules`, { title: 'Mine' }],
      ['PATCH', `/training/manage/modules/${m.id}`, { title: 'Mine' }],
      ['POST', `/training/manage/modules/${m.id}/remove`, { moveTo: null }],
      ['PUT', `/training/manage/courses/${course.id}/module-order`, { moduleIds: course.modules.map((x) => x.id) }],
      ['POST', `/training/manage/courses/${course.id}/duplicate`, undefined],
    ];
    for (const [method, path, body] of calls) {
      expect((await call('ana', method, path, body)).status, `${method} ${path}`).toBe(403);
      expect((await call('client', method, path, body)).status, `client ${method} ${path}`).toBe(403);
    }
    expect((await call('ana', 'GET', `/training/manage/courses?audience=STAFF`)).status).toBe(403);
    expect((await getCourse(course.id)).modules.map((x) => x.title)).toEqual(['Later', 'The basics', 'For admins']);
    const byAdmin = await addModule(course.id, { title: 'By the administrator' }, 'admin');
    expect(byAdmin.modules.at(-1)).toMatchObject({ title: 'By the administrator', position: 3 });
  });
});

describe('lessons and modules', () => {
  let c: ManageCourse;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    c = await newCourse('Moving');
    for (const t of ['One', 'Two', 'Three', 'Four']) ids[t] = (await guideLesson(c.id, t)).id;
    c = await addModule(c.id, { title: 'First' });
    c = await addModule(c.id, { title: 'Second' });
    c = await addModule(c.id, { title: 'Empty' });
  });

  it('a lesson moves into a module (last in it), between modules and out again; never to another course’s module; its own edit time stays', async () => {
    const first = moduleNamed(c, 'First').id;
    const second = moduleNamed(c, 'Second').id;
    const before = await prisma.trainingLesson.findUnique({ where: { id: ids.Two! }, select: { updatedAt: true } });
    const moved = await moveLesson(ids.Two!, first);
    expect(moved.moduleId).toBe(first);
    await moveLesson(ids.One!, first);
    await moveLesson(ids.Three!, second);
    await moveLesson(ids.Four!, second);
    c = await getCourse(c.id);
    expect(layout(c)).toEqual([
      ['Two', 'First'],
      ['One', 'First'],
      ['Three', 'Second'],
      ['Four', 'Second'],
    ]);
    expect((await prisma.trainingLesson.findUnique({ where: { id: ids.Two! }, select: { updatedAt: true } }))!.updatedAt).toEqual(before!.updatedAt);

    const other = await newCourse('Elsewhere');
    const elsewhere = (await addModule(other.id, { title: 'Theirs' })).modules[0]!.id;
    const refused = await call('amy', 'PATCH', `/training/manage/lessons/${ids.One}`, { moduleId: elsewhere });
    expect(refused.status).toBe(400);
    expect((await call('amy', 'PATCH', `/training/manage/lessons/${ids.One}`, { moduleId: 'nope' })).status).toBe(400);
    expect((await moveLesson(ids.Four!, null)).moduleId).toBeNull();
    await moveLesson(ids.Four!, second);
  });

  it('remove: its lessons move to the module chosen, after that module’s own (none deleted); never to another course’s module or itself', async () => {
    const first = moduleNamed(c, 'First');
    const second = moduleNamed(c, 'Second');
    const other = await newCourse('Elsewhere too');
    const theirs = (await addModule(other.id, { title: 'Theirs' })).modules[0]!.id;
    expect((await call('amy', 'POST', `/training/manage/modules/${first.id}/remove`, { moveTo: theirs })).status).toBe(400);
    expect((await call('amy', 'POST', `/training/manage/modules/${first.id}/remove`, { moveTo: first.id })).status).toBe(400);
    await prisma.trainingModuleDone.create({ data: { userId: w.people.ana, courseId: c.id, moduleId: first.id, doneAt: new Date() } });

    c = await data<ManageCourse>(call('amy', 'POST', `/training/manage/modules/${first.id}/remove`, { moveTo: second.id }));
    expect(c.modules.map((m) => m.title)).toEqual(['Second', 'Empty']);
    expect(layout(c)).toEqual([
      ['Three', 'Second'],
      ['Four', 'Second'],
      ['Two', 'Second'],
      ['One', 'Second'],
    ]);
    expect(await prisma.trainingModule.count({ where: { id: first.id } })).toBe(0);
    // A person's record of the removed module stays (it is simply no module any more).
    expect(await prisma.trainingModuleDone.count({ where: { moduleId: first.id } })).toBe(1);
    expect((await call('amy', 'POST', `/training/manage/modules/${first.id}/remove`, { moveTo: null })).status).toBe(404);
  });

  it('remove with no module chosen: its lessons are left without a module; an empty module just goes', async () => {
    c = await data<ManageCourse>(call('amy', 'POST', `/training/manage/modules/${moduleNamed(c, 'Second').id}/remove`, { moveTo: null }));
    expect(c.lessons).toHaveLength(4);
    expect(c.lessons.every((l) => l.moduleId === null)).toBe(true);
    c = await data<ManageCourse>(call('amy', 'POST', `/training/manage/modules/${moduleNamed(c, 'Empty').id}/remove`, { moveTo: null }));
    expect(c.modules).toEqual([]);
    expect(c.lessons.map((l) => l.title).sort()).toEqual(['Four', 'One', 'Three', 'Two']);
    expect(audits.filter((a) => a.action === 'training.module.remove').length).toBeGreaterThanOrEqual(3);
  });

  it('a new lesson goes straight into a module of its course, last in it; none sent: no module; another course’s module is refused (final review 3)', async () => {
    let k = await newCourse('Adding into');
    const loose = await guideLesson(k.id, 'Loose');
    k = await addModule(k.id, { title: 'First' });
    k = await addModule(k.id, { title: 'Second' });
    const first = moduleNamed(k, 'First').id;
    const second = moduleNamed(k, 'Second').id;
    await moveLesson(loose.id, first);
    expect((await addLesson(k.id, { kind: 'GUIDE', title: 'Into second', moduleId: second })).moduleId).toBe(second);
    expect((await addLesson(k.id, { kind: 'VIDEO', title: 'Into first', moduleId: first })).moduleId).toBe(first);
    expect((await addLesson(k.id, { kind: 'GUIDE', title: 'Nowhere', moduleId: null })).moduleId).toBeNull();
    expect((await addLesson(k.id, { kind: 'QUIZ', title: 'Nowhere either' })).moduleId).toBeNull();
    k = await getCourse(k.id);
    const inModule = (id: string | null) => [...k.lessons].filter((l) => l.moduleId === id).sort((x, y) => x.position - y.position).map((l) => l.title);
    expect(inModule(first)).toEqual(['Loose', 'Into first']);
    expect(inModule(second)).toEqual(['Into second']);
    expect(inModule(null)).toEqual(['Nowhere', 'Nowhere either']);

    const other = await newCourse('Not this one');
    const theirs = (await addModule(other.id, { title: 'Theirs' })).modules[0]!.id;
    const before = await prisma.trainingLesson.count({ where: { courseId: k.id } });
    for (const moduleId of [theirs, 'nope']) {
      const refused = await call('amy', 'POST', `/training/manage/courses/${k.id}/lessons`, { kind: 'GUIDE', title: 'Wrong', moduleId });
      expect(refused.status).toBe(400);
      expect(refused.body.error!.message).toBe('Choose a module of this course.');
    }
    expect(await prisma.trainingLesson.count({ where: { courseId: k.id } })).toBe(before);
  });
});

describe('a module change on a published course', () => {
  it('a built-in course whose modules change is edited (no more built-in updates)', async () => {
    const sc = await prisma.trainingCourse.create({ data: { title: `Built-in ${w.tag}`, moduleKey: 'general', audience: 'STAFF', status: 'PUBLISHED', starterKey: `starter:test-${w.tag}`, publishedAt: new Date() } });
    courseIds.push(sc.id);
    const mod = await prisma.trainingModule.create({ data: { courseId: sc.id, position: 0, title: 'Tasks', moduleKey: 'tasks', starterKey: 'module:tasks' } });
    const lesson = await prisma.trainingLesson.create({ data: { courseId: sc.id, moduleId: mod.id, position: 0, kind: 'GUIDE', title: 'Read', steps: { create: [{ position: 0, title: 'One' }] } } });
    await prisma.trainingCourse.update({ where: { id: sc.id }, data: { publishedAt: lesson.updatedAt } });
    const read = async () => {
      const row = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: sc.id }, include: { lessons: { select: { updatedAt: true } } } });
      return untouchedStarter(row, row.lessons);
    };
    expect(await read()).toBe(true);
    const after = await data<ManageCourse>(call('amy', 'PATCH', `/training/manage/modules/${mod.id}`, { title: 'Tasks (ours)' }));
    expect(after.modules[0]).toMatchObject({ title: 'Tasks (ours)', starter: true });
    expect(await read()).toBe(false);
    expect(after.unpublishedChanges).toBe(true);
  });

  it('switching a module on or off is a site setting, not an edit: a built-in course stays untouched (still audited); anything else sent with it is an edit (final review 6)', async () => {
    const sc = await prisma.trainingCourse.create({ data: { title: `Built-in switch ${w.tag}`, moduleKey: 'general', audience: 'STAFF', status: 'PUBLISHED', starterKey: `starter:test-switch-${w.tag}`, publishedAt: new Date() } });
    courseIds.push(sc.id);
    const on = await prisma.trainingModule.create({ data: { courseId: sc.id, position: 0, title: 'Tasks', moduleKey: 'tasks', starterKey: 'module:tasks' } });
    // Off because its old short course was removed before the change (C2): an administrator may switch it on.
    const off = await prisma.trainingModule.create({ data: { courseId: sc.id, position: 1, title: 'Chat', moduleKey: 'chat', starterKey: 'module:chat', enabled: false, offReason: 'REMOVED' } });
    for (const [i, m] of [on, off].entries()) await prisma.trainingLesson.create({ data: { courseId: sc.id, moduleId: m.id, position: i, kind: 'GUIDE', title: `Read ${m.title}`, steps: { create: [{ position: 0, title: 'One', body: '<p>One</p>' }] } } });
    const at = new Date();
    await prisma.trainingCourse.update({ where: { id: sc.id }, data: { publishedAt: at, updatedAt: at } });
    const stamp = () => prisma.trainingCourse.findUniqueOrThrow({ where: { id: sc.id }, select: { updatedAt: true, updatedById: true } });
    const read = async () => {
      const row = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: sc.id }, include: { lessons: { select: { updatedAt: true } } } });
      return untouchedStarter(row, row.lessons);
    };
    expect(await read()).toBe(true);
    const before = await stamp();
    const switched = (enabled: boolean, extra: Record<string, unknown> = {}) => data<ManageCourse>(call('amy', 'PATCH', `/training/manage/modules/${off.id}`, { enabled, ...extra }));

    let after = await switched(true);
    expect(after.modules.find((m) => m.id === off.id)).toMatchObject({ enabled: true, offReason: null });
    expect(after.unpublishedChanges).toBe(false);
    expect(await read()).toBe(true);
    expect(await stamp()).toEqual(before);
    expect(audits).toContainEqual(expect.objectContaining({ action: 'training.module.update', entityId: off.id, newValue: { enabled: true } }));
    after = await switched(false);
    expect(after.modules.find((m) => m.id === off.id)).toMatchObject({ enabled: false });
    expect(after.unpublishedChanges).toBe(false);
    expect(await stamp()).toEqual(before);
    // The same title sent along changes nothing else: still only a switch.
    after = await switched(true, { title: 'Chat' });
    expect(after.unpublishedChanges).toBe(false);
    expect(await read()).toBe(true);

    // Renaming it (with or without a switch) edits the course: no more built-in updates, "Changes not published".
    after = await switched(false, { title: 'Chat (ours)' });
    expect(after.modules.find((m) => m.id === off.id)).toMatchObject({ title: 'Chat (ours)', enabled: false });
    expect(after.unpublishedChanges).toBe(true);
    expect(await read()).toBe(false);
    expect((await stamp()).updatedById).toBe(w.people.amy);
  });

  it('switching a module off finishes a person who had done every other module, with the certificate; the last one on can’t be switched off', async () => {
    let c = await newCourse('Finish by modules', { certificateOn: true });
    const g1 = await guideLesson(c.id, 'Learn one');
    const g2 = await guideLesson(c.id, 'Learn two');
    c = await addModule(c.id, { title: 'One' });
    c = await addModule(c.id, { title: 'Two' });
    const one = moduleNamed(c, 'One').id;
    const two = moduleNamed(c, 'Two').id;
    await moveLesson(g1.id, one);
    await moveLesson(g2.id, two);
    await data(call('amy', 'POST', `/training/manage/courses/${c.id}/publish`, {}));
    const start = new Date(Date.now() - 3_600_000);
    await prisma.trainingEnrolment.create({ data: { userId: w.people.ana, courseId: c.id, startedAt: start, lastActivityAt: start } });
    await prisma.trainingProgress.create({ data: { userId: w.people.ana, courseId: c.id, lessonId: g1.id, doneAt: new Date(Date.now() - 60_000) } });

    c = await data<ManageCourse>(call('amy', 'PATCH', `/training/manage/modules/${two}`, { enabled: false }));
    expect(moduleNamed(c, 'Two')).toMatchObject({ enabled: false, offReason: null, visibility: 'Off' });
    const e = await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId: w.people.ana, courseId: c.id } } });
    expect(e.completedAt).not.toBeNull();
    const certs = await prisma.trainingCertificate.findMany({ where: { userId: w.people.ana, courseId: c.id } });
    expect(certs).toHaveLength(1);
    expect(certs[0]!.moduleIds).toEqual([one]);

    const refused = await call('amy', 'PATCH', `/training/manage/modules/${one}`, { enabled: false });
    expect(refused.status).toBe(409);
    expect(refused.body.error!.code).toBe('WOULD_BREAK_PUBLISHED');
    // The same words as Publish and a lesson's delete (cleanup batch CB-1).
    expect(refused.body.error!.details).toEqual({ problems: ['Add a lesson people can see: lessons in a module that’s switched off aren’t shown.'] });
    expect((await call('amy', 'POST', `/training/manage/modules/${one}/remove`, { moveTo: two })).status).toBe(409);
    expect((await call('amy', 'PATCH', `/training/manage/lessons/${g1.id}`, { moduleId: two })).status).toBe(409);
    expect((await getCourse(c.id)).modules.find((m) => m.id === one)!.enabled).toBe(true);
  });
});

describe('Duplicate (R3)', () => {
  let original: ManageCourse;
  let picture: FileRef;
  let doc: FileRef;
  let resource: FileRef;
  beforeAll(async () => {
    original = await newCourse('Original', {
      summary: 'All about tasks',
      roleKeys: ['employees'],
      companyIds: [w.companies.A],
      difficulty: 'INTERMEDIATE',
      completionRule: 'QUIZZES',
      inOrder: true,
      certificateOn: true,
      certificateMonths: 12,
      issuerUserId: w.people.amy,
      issuerTitle: 'Head of training',
    });
    picture = await upload(original.id, 'IMAGE', { name: 'step.png', type: 'image/png', content: PNG });
    doc = await upload(original.id, 'DOCUMENT', { name: 'Read.pdf', type: 'application/pdf', content: PDF_HEAD });
    resource = await upload(original.id, 'RESOURCE', { name: 'Handout.pdf', type: 'application/pdf', content: Buffer.concat([PDF_HEAD, Buffer.from('handout')]) });
    const guide = await guideLesson(original.id, 'Make a task', [
      { title: 'Open', body: '<p>Open My Tasks</p>', imageFileId: picture.id, imageAlt: 'My Tasks' },
      { title: 'Save', body: '<p>Save it</p>' },
    ]);
    const video = await addLesson(original.id, { kind: 'VIDEO', title: 'Watch', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    const quiz = await addLesson(original.id, { kind: 'QUIZ', title: 'Check' });
    await data(
      call('amy', 'PUT', `/training/manage/lessons/${quiz.id}/quiz`, {
        passMark: 80,
        maxAttempts: 3,
        shuffle: true,
        timeLimitMinutes: 10,
        drawCount: null,
        questions: [
          { kind: 'SINGLE', prompt: 'Where are tasks?', explanation: 'In My Tasks', options: [{ text: 'My Tasks', correct: true, feedback: 'Yes' }, { text: 'Chat', correct: false }] },
          { kind: 'ORDER', prompt: 'Make a task', options: [{ text: 'Open', correct: true }, { text: 'Type', correct: true }, { text: 'Save', correct: true }] },
        ],
      }),
    );
    await addLesson(original.id, { kind: 'DOCUMENT', title: 'Read', fileId: doc.id });
    original = await addModule(original.id, { title: 'Learn' });
    original = await addModule(original.id, { title: 'Prove it', moduleKey: 'reports', enabled: false });
    await moveLesson(guide.id, moduleNamed(original, 'Learn').id);
    await moveLesson(video.id, moduleNamed(original, 'Learn').id);
    await moveLesson(quiz.id, moduleNamed(original, 'Prove it').id);
    await data(call('amy', 'POST', `/training/manage/courses/${original.id}/publish`, {}));
    await prisma.trainingCourse.update({ where: { id: original.id }, data: { starterKey: `starter:dup-${w.tag}` } });
    await prisma.trainingModule.updateMany({ where: { courseId: original.id }, data: { starterKey: null } });
    await prisma.trainingModule.update({ where: { id: moduleNamed(original, 'Learn').id }, data: { starterKey: 'module:learn', fromCourseId: original.id } });
    // People on the original: none of it is copied.
    await prisma.trainingEnrolment.create({ data: { userId: w.people.ana, courseId: original.id, startedAt: new Date() } });
    await prisma.trainingProgress.create({ data: { userId: w.people.ana, courseId: original.id, lessonId: guide.id, doneAt: new Date() } });
    await prisma.trainingAssignment.create({ data: { courseId: original.id, targetKind: 'USER', targetId: w.people.ana, createdById: w.people.amy } });
    await prisma.trainingCertificate.create({ data: { code: `TC-${randomBytes(4).toString('hex').toUpperCase()}`, userId: w.people.cat, courseId: original.id, learnerName: 'Cat', courseTitle: 'Original' } });
    await prisma.trainingFeedback.create({ data: { courseId: original.id, userId: w.people.ana, kind: 'QUESTION', body: 'Why?' } });
    original = await getCourse(original.id);
  });

  it('an unpublished draft “Copy of …” with the modules, lessons, quiz, video links and new copies of every file; nobody’s progress', async () => {
    const copy = await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${original.id}/duplicate`), 201);
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({
      title: `Copy of Original ${w.tag}`,
      summary: 'All about tasks',
      moduleKey: 'tasks',
      audience: 'STAFF',
      roleKeys: ['employees'],
      companyIds: [w.companies.A],
      difficulty: 'INTERMEDIATE',
      completionRule: 'QUIZZES',
      inOrder: true,
      certificateOn: true,
      certificateMonths: 12,
      issuerUserId: w.people.amy,
      issuerTitle: 'Head of training',
      status: 'DRAFT',
      version: 1,
      starter: false,
      publishedAt: null,
      unpublishedChanges: false,
      enrolled: 0,
      completed: 0,
      publishProblems: [],
    });
    const row = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: copy.id } });
    expect(row).toMatchObject({ starterKey: null, majorAt: null, createdById: w.people.amy });
    // Modules: the same, in order, never built-in.
    expect(copy.modules.map((m) => [m.title, m.position, m.moduleKey, m.enabled, m.visibility, m.starter])).toEqual(original.modules.map((m) => [m.title, m.position, m.moduleKey, m.enabled, m.visibility, false]));
    expect(copy.modules.every((m) => !original.modules.some((o) => o.id === m.id))).toBe(true);
    expect(await prisma.trainingModule.count({ where: { courseId: copy.id, OR: [{ starterKey: { not: null } }, { fromCourseId: { not: null } }] } })).toBe(0);
    // Lessons in the same modules and order, with their steps, quiz, video and document.
    expect(layout(copy)).toEqual(layout(original));
    expect(copy.lessons.every((l) => !original.lessons.some((o) => o.id === l.id) && l.changedVersion === 1)).toBe(true);
    const strip = (c: ManageCourse) =>
      c.lessons.map((l) => ({
        kind: l.kind,
        title: l.title,
        minutes: l.minutes,
        body: l.body,
        videoUrl: l.videoUrl,
        video: l.video,
        steps: l.steps.map((s) => ({ position: s.position, title: s.title, body: s.body, alt: s.image?.alt ?? null, picture: !!s.image })),
        quiz: l.quiz && { ...l.quiz, questions: l.quiz.questions.map((q) => ({ ...q, id: undefined, options: q.options.map((o) => ({ ...o, id: undefined })) })) },
        document: l.document && { name: l.document.name, kind: l.document.kind, sizeBytes: l.document.sizeBytes },
      }));
    expect(strip(copy)).toEqual(strip(original));
    const copyQuiz = copy.lessons.find((l) => l.kind === 'QUIZ')!.quiz!;
    const origQuiz = original.lessons.find((l) => l.kind === 'QUIZ')!.quiz!;
    expect(copyQuiz.questions.every((q) => !origQuiz.questions.some((o) => o.id === q.id))).toBe(true);
    // Files: new rows and new stored copies with the same bytes; the original's untouched.
    const copyFiles = await prisma.trainingFile.findMany({ where: { courseId: copy.id } });
    const origFiles = await prisma.trainingFile.findMany({ where: { courseId: original.id } });
    expect(copyFiles.map((f) => [f.kind, f.name]).sort()).toEqual(origFiles.map((f) => [f.kind, f.name]).sort());
    for (const f of copyFiles) {
      expect(origFiles.some((o) => o.id === f.id || o.storageKey === f.storageKey)).toBe(false);
      const twin = origFiles.find((o) => o.kind === f.kind && o.name === f.name)!;
      expect((await files.read(f.storageKey)).equals(await files.read(twin.storageKey))).toBe(true);
      expect(f).toMatchObject({ starter: false, uploadedById: w.people.amy, sizeBytes: twin.sizeBytes, mimeType: twin.mimeType });
    }
    const step = copy.lessons.find((l) => l.kind === 'GUIDE')!.steps[0]!;
    expect(copyFiles.find((f) => f.id === step.image!.fileId)).toMatchObject({ kind: 'IMAGE' });
    expect(copyFiles.find((f) => f.id === copy.lessons.find((l) => l.kind === 'DOCUMENT')!.document!.id)).toMatchObject({ kind: 'DOCUMENT' });
    expect(copy.resources.map((r) => r.name)).toEqual([resource.name]);
    expect(copy.resources[0]!.id).not.toBe(resource.id);
    // Nobody's progress, enrolments, assignments, certificates or feedback.
    const where = { courseId: copy.id };
    expect(
      await Promise.all([
        prisma.trainingEnrolment.count({ where }),
        prisma.trainingProgress.count({ where }),
        prisma.trainingAssignment.count({ where }),
        prisma.trainingAssignee.count({ where }),
        prisma.trainingCertificate.count({ where }),
        prisma.trainingFeedback.count({ where }),
        prisma.trainingModuleDone.count({ where }),
        prisma.trainingAttempt.count({ where }),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(audits.find((a) => a.action === 'training.course.duplicate' && a.entityId === copy.id)).toMatchObject({ newValue: { fromCourseId: original.id } });
    // The copy is a course of its own: Delete works (never published), and the original keeps its files.
    expect((await call('amy', 'DELETE', `/training/manage/courses/${copy.id}`)).status).toBe(204);
    for (const f of origFiles) expect(existsSync(join(filesDir, f.storageKey))).toBe(true);
  });

  it('a long title is cut to 160 characters', async () => {
    await prisma.trainingCourse.update({ where: { id: original.id }, data: { title: `${w.tag} ${'L'.repeat(150)}`.slice(0, 160) } });
    const copy = await data<ManageCourse>(call('admin', 'POST', `/training/manage/courses/${original.id}/duplicate`), 201);
    expect(copy.title).toHaveLength(160);
    expect(copy.title.startsWith(`Copy of ${w.tag} LLL`)).toBe(true);
    expect((await call('amy', 'POST', '/training/manage/courses/nope/duplicate')).status).toBe(404);
  });

  it('when the database write fails, the copied files are removed again', async () => {
    const saved: string[] = [];
    const removed: string[] = [];
    const tracking: TrainingFileStore = {
      dir: files.dir,
      read: (k) => files.read(k),
      save: async (content, mime) => {
        const k = await files.save(content, mime);
        saved.push(k);
        return k;
      },
      remove: async (k) => {
        removed.push(k);
        await files.remove(k);
      },
    };
    const failing = new Proxy(prisma, {
      get: (target, key) =>
        key === '$transaction'
          ? async () => {
              throw new Error('the database went away');
            }
          : Reflect.get(target, key),
    });
    const broken: TrainingContext = { ...ctx, prisma: failing, files: tracking };
    const titles = await prisma.trainingCourse.count({ where: { title: { startsWith: 'Copy of' }, AND: [{ title: { contains: w.tag } }] } });
    await expect(createTrainingManage(broken, sync).duplicate(w.people.amy, original.id)).rejects.toThrow('the database went away');
    expect(saved.length).toBe(3);
    expect([...removed].sort()).toEqual([...saved].sort());
    for (const k of saved) expect(existsSync(join(filesDir, k))).toBe(false);
    expect(await prisma.trainingCourse.count({ where: { title: { startsWith: 'Copy of' }, AND: [{ title: { contains: w.tag } }] } })).toBe(titles);
  });

  it('the copy keeps the course’s place in the list; a module off because its old course was removed stays off, without that reason (cleanup batch)', async () => {
    await prisma.trainingCourse.update({ where: { id: original.id }, data: { position: 7 } });
    const prove = moduleNamed(original, 'Prove it');
    await prisma.trainingModule.update({ where: { id: prove.id }, data: { enabled: false, offReason: 'REMOVED' } });
    expect(moduleNamed(await getCourse(original.id), 'Prove it')).toMatchObject({ offReason: 'REMOVED', visibility: 'Off — the old course was removed' });
    const copy = await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${original.id}/duplicate`), 201);
    expect((await prisma.trainingCourse.findUniqueOrThrow({ where: { id: copy.id } })).position).toBe(7);
    expect(moduleNamed(copy, 'Prove it')).toMatchObject({ enabled: false, offReason: null, visibility: 'Off' });
    expect(moduleNamed(copy, 'Learn')).toMatchObject({ enabled: true, offReason: null });
    expect((await prisma.trainingModule.findUniqueOrThrow({ where: { id: prove.id } })).offReason).toBe('REMOVED');
  });
});

describe('the Manage list', () => {
  it('Audience filter; “limited to”, ever published, modules; the notice on an edited built-in course until it is archived', async () => {
    const all = await newCourse('List all staff');
    const reports = await newCourse('List reports', { moduleKey: 'reports' });
    const mine = await newCourse('List one company', { companyIds: [w.companies.B], roleKeys: ['training-managers'] });
    const clients = await newCourse('List clients', { moduleKey: 'portal', audience: 'CLIENTS' });
    const clientsB = await newCourse('List clients of B', { moduleKey: 'portal', audience: 'CLIENTS', companyIds: [w.companies.B] });
    await addModule(all.id, { title: 'A' });
    await addModule(all.id, { title: 'B' });
    await guideLesson(reports.id, 'Read');
    await data(call('amy', 'POST', `/training/manage/courses/${reports.id}/publish`, {}));
    await data(call('amy', 'POST', `/training/manage/courses/${reports.id}/unpublish`));
    await prisma.systemSetting.create({ data: { key: RECORD_KEY, value: { phase: 'done', at: new Date().toISOString(), courseId: 'x', moved: {}, removedLessons: {}, notMerged: [mine.id, clients.id], noticesAt: null } } });

    const rows = await listed('');
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row(all.id)).toMatchObject({ limitedTo: null, everPublished: false, moduleCount: 2, notice: null, status: 'DRAFT' });
    expect(row(reports.id)).toMatchObject({ limitedTo: 'Admins only', everPublished: true, moduleCount: 0, notice: null, status: 'DRAFT' });
    expect(row(mine.id)).toMatchObject({ limitedTo: `Training managers only · Beta ${w.tag}`, notice: 'This built-in course was edited, so it wasn’t merged. Its assignments moved to MICO360 Tasks User Training. Archive it when you’re ready.' });
    expect(row(clients.id)).toMatchObject({ limitedTo: null, notice: expect.stringContaining('wasn’t merged') });
    expect(row(clientsB.id)).toMatchObject({ limitedTo: `Clients · Beta ${w.tag}`, notice: null });
    expect((await getCourse(mine.id)).notice).toMatch(/^This built-in course was edited/);
    expect((await getCourse(all.id)).notice).toBeNull();

    const staff = await listed('&audience=STAFF');
    expect(staff.some((r) => r.id === all.id)).toBe(true);
    expect(staff.every((r) => r.audience === 'STAFF')).toBe(true);
    expect(staff.some((r) => r.id === clients.id)).toBe(false);
    const forClients = await listed('&audience=CLIENTS');
    expect(forClients.map((r) => r.id)).toEqual(expect.arrayContaining([clients.id, clientsB.id]));
    expect(forClients.every((r) => r.audience === 'CLIENTS')).toBe(true);
    expect(forClients.some((r) => r.id === all.id)).toBe(false);
    expect((await call('amy', 'GET', '/training/manage/courses?audience=EVERYONE')).status).toBe(400);

    await data(call('amy', 'POST', `/training/manage/courses/${mine.id}/archive`));
    expect((await listed('')).find((r) => r.id === mine.id)!.notice).toBeNull();
    expect((await getCourse(mine.id)).notice).toBeNull();
  });
});

describe('deleting a lesson of a course with modules: how many people it finishes (batch 4b)', () => {
  type Impact = { finishing: number; certificate: boolean; published: boolean };
  const impact = (lessonId: string) => data<Impact>(call('admin', 'GET', `/training/manage/lessons/${lessonId}/delete-impact`));
  const quizLesson = async (courseId: string, title: string) => {
    const q = await addLesson(courseId, { kind: 'QUIZ', title });
    return data<ManageLesson>(
      call('amy', 'PUT', `/training/manage/lessons/${q.id}/quiz`, {
        passMark: 100,
        maxAttempts: null,
        shuffle: false,
        timeLimitMinutes: null,
        drawCount: null,
        questions: [{ kind: 'SINGLE', prompt: 'Pick yes', options: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }] }],
      }),
    );
  };
  /** A published course with two modules; `lessons` per module, by title. */
  async function moduleCourse(title: string, o: Record<string, unknown>, lessons: Record<'One' | 'Two', ('GUIDE' | 'QUIZ')[]>) {
    let c = await newCourse(title, { certificateOn: true, ...o });
    c = await addModule(c.id, { title: 'One' });
    c = await addModule(c.id, { title: 'Two' });
    const ids: Record<string, string> = {};
    for (const mod of ['One', 'Two'] as const) {
      for (const [i, kind] of lessons[mod].entries()) {
        const name = `${mod} ${i + 1}`;
        const l = kind === 'QUIZ' ? await quizLesson(c.id, name) : await guideLesson(c.id, name);
        await moveLesson(l.id, moduleNamed(c, mod).id);
        ids[name] = l.id;
      }
    }
    await data(call('amy', 'POST', `/training/manage/courses/${c.id}/publish`, {}));
    return { c, ids };
  }
  async function enrol(userId: string, courseId: string, done: string[]) {
    const start = new Date(Date.now() - 3_600_000);
    await prisma.trainingEnrolment.create({ data: { userId, courseId, startedAt: start, lastActivityAt: start } });
    for (const lessonId of done) await prisma.trainingProgress.create({ data: { userId, courseId, lessonId, doneAt: new Date(Date.now() - 60_000) } });
  }
  const finished = async (userId: string, courseId: string) => (await prisma.trainingEnrolment.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId } } })).completedAt !== null;

  it('a module recorded done counts though a lesson was added to it later: deleting the last lesson left elsewhere finishes them', async () => {
    const { c, ids } = await moduleCourse('Impact recorded', {}, { One: ['GUIDE', 'GUIDE'], Two: ['GUIDE', 'GUIDE'] });
    // One: "One 1" done and the module recorded done (its "One 2" came later); Two: "Two 2" done, "Two 1" not.
    await enrol(w.people.ana, c.id, [ids['One 1']!, ids['Two 2']!]);
    await prisma.trainingModuleDone.create({ data: { userId: w.people.ana, courseId: c.id, moduleId: moduleNamed(c, 'One').id, doneAt: new Date(Date.now() - 120_000) } });
    expect(await impact(ids['Two 1']!)).toEqual({ finishing: 1, certificate: true, published: true });
    expect((await impact(ids['One 2']!)).finishing).toBe(0);
    await data(call('amy', 'DELETE', `/training/manage/lessons/${ids['Two 1']}`), 204);
    expect(await finished(w.people.ana, c.id)).toBe(true);
  });

  it('“passing every quiz is enough” is per module: a module without a quiz still needs its lessons', async () => {
    const { c, ids } = await moduleCourse('Impact quizzes', { completionRule: 'QUIZZES' }, { One: ['GUIDE', 'QUIZ'], Two: ['GUIDE', 'GUIDE'] });
    // One: its quiz passed (done); Two (no quiz): nothing done.
    await enrol(w.people.ben, c.id, [ids['One 2']!]);
    expect((await impact(ids['Two 2']!)).finishing).toBe(0);
    await data(call('amy', 'DELETE', `/training/manage/lessons/${ids['Two 2']}`), 204);
    expect(await finished(w.people.ben, c.id)).toBe(false);
    await prisma.trainingProgress.create({ data: { userId: w.people.ben, courseId: c.id, lessonId: ids['Two 1']!, doneAt: new Date() } });
    expect((await impact(ids['One 1']!)).finishing).toBe(1);
  });
});

// ── Cleanup batch CB-1 (1.23.31): concurrent and half-failed edits ──

describe('module edits at the same moment (cleanup batch)', () => {
  it('module switches on the same course at once all succeed (the course is marked changed in one statement)', async () => {
    let c = await newCourse('All at once');
    for (const t of ['A', 'B', 'C', 'D', 'E', 'F']) c = await addModule(c.id, { title: t });
    for (const enabled of [false, true, false, true]) {
      const replies = await Promise.all(c.modules.map((m) => call('amy', 'PATCH', `/training/manage/modules/${m.id}`, { enabled })));
      expect(
        replies.map((r) => r.status),
        JSON.stringify(replies.find((r) => r.status !== 200)?.body),
      ).toEqual(c.modules.map(() => 200));
      expect((await getCourse(c.id)).modules.map((m) => m.enabled)).toEqual(c.modules.map(() => enabled));
    }
    // Two people saving the same course's lessons' modules at once, too.
    const lessons = [await guideLesson(c.id, 'One'), await guideLesson(c.id, 'Two')];
    const moved = await Promise.all(lessons.map((l, i) => call('amy', 'PATCH', `/training/manage/lessons/${l.id}`, { moduleId: c.modules[i]!.id })));
    expect(moved.map((r) => r.status)).toEqual([200, 200]);
    const row = await prisma.trainingCourse.findUniqueOrThrow({ where: { id: c.id }, select: { updatedById: true } });
    expect(row.updatedById).toBe(w.people.amy);
  });

  it('a module change whose “course changed” mark fails is still audited and finishing is still checked again', async () => {
    const c = await newCourse('Mark fails');
    const seen: string[] = [];
    const ops = createModuleOps(ctx, {
      manageCourse: async (id) => {
        seen.push('course');
        return { id } as ManageCourse;
      },
      touchCourse: async () => {
        throw new Error('the database went away for a moment');
      },
      audit: async (_a, _m, action) => {
        seen.push(action);
      },
      recheck: async () => {
        seen.push('recheck');
      },
      assertShownPublishable: async () => {},
    });
    const out = await ops.addModule(w.people.amy, c.id, { title: 'Still here' });
    expect(out.id).toBe(c.id);
    expect(seen).toEqual(['training.module.create', 'recheck', 'course']);
    expect(await prisma.trainingModule.count({ where: { courseId: c.id, title: 'Still here' } })).toBe(1);
  });
});

describe('saving a guide’s steps (cleanup batch)', () => {
  it('saved places past the new last step come back to it, and a progress save on another course is never held up meanwhile', async () => {
    const c = await newCourse('Steps clamp');
    const g = await guideLesson(c.id, 'Long', [{ title: '1' }, { title: '2' }, { title: '3' }, { title: '4' }]);
    const other = await newCourse('Steps elsewhere');
    const og = await guideLesson(other.id, 'Elsewhere');
    await prisma.trainingProgress.createMany({
      data: [
        { userId: w.people.ana, courseId: c.id, lessonId: g.id, stepIndex: 3 },
        { userId: w.people.ben, courseId: c.id, lessonId: g.id, stepIndex: 1 },
        { userId: w.people.cat, courseId: c.id, lessonId: g.id, stepIndex: 0 },
      ],
    });
    const elsewhere = (await prisma.trainingProgress.create({ data: { userId: w.people.ana, courseId: other.id, lessonId: og.id, stepIndex: 0 } })).id;
    const places = async () =>
      Object.fromEntries((await prisma.trainingProgress.findMany({ where: { lessonId: g.id }, select: { userId: true, stepIndex: true } })).map((p) => [p.userId, p.stepIndex]));

    // Through the editor: two steps left, so the last is step index 1.
    const saved = await data<ManageLesson>(call('amy', 'PUT', `/training/manage/lessons/${g.id}/steps`, { steps: [{ title: '1' }, { title: '2' }] }));
    expect(saved.steps).toHaveLength(2);
    expect(await places()).toEqual({ [w.people.ana]: 1, [w.people.ben]: 1, [w.people.cat]: 0 });

    // While the clamp's transaction is open, a second connection (waiting at most 2 s for a row lock) saves elsewhere.
    const second = new PrismaClient({ datasources: { db: { url: `${url}${url.includes('?') ? '&' : '?'}connection_limit=1` } } });
    let waited = -1;
    try {
      await second.$executeRawUnsafe('SET SESSION innodb_lock_wait_timeout = 2');
      await prisma.$transaction(async (tx) => {
        await clampSavedSteps(tx, g.id, 1);
        const t0 = Date.now();
        await second.trainingProgress.updateMany({ where: { id: elsewhere }, data: { stepIndex: 1 } });
        waited = Date.now() - t0;
      });
    } finally {
      await second.$disconnect();
    }
    expect(waited).toBeGreaterThanOrEqual(0);
    expect(waited).toBeLessThan(1500);
    expect((await prisma.trainingProgress.findUniqueOrThrow({ where: { id: elsewhere } })).stepIndex).toBe(1);
    expect(await places()).toEqual({ [w.people.ana]: 0, [w.people.ben]: 0, [w.people.cat]: 0 });
    expect((await call('amy', 'PUT', '/training/manage/lessons/nope/steps', { steps: [] })).status).toBe(404);
  });
});

describe('lessons in a module that’s switched off are nobody’s lessons (cleanup batch)', () => {
  it('a draft whose lessons all sit in switched-off modules can’t be published (Manage says why)', async () => {
    let c = await newCourse('All off');
    const g = await guideLesson(c.id, 'Hidden');
    c = await addModule(c.id, { title: 'Off', enabled: false });
    await moveLesson(g.id, moduleNamed(c, 'Off').id);
    const why = 'Add a lesson people can see: lessons in a module that’s switched off aren’t shown.';
    expect((await getCourse(c.id)).publishProblems).toEqual([why]);
    const refused = await call('amy', 'POST', `/training/manage/courses/${c.id}/publish`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'PUBLISH_PROBLEMS', details: { problems: [why] } });
    expect((await getCourse(c.id)).status).toBe('DRAFT');
    // A lesson outside it (in no module) is enough.
    await guideLesson(c.id, 'Shown');
    expect((await data<ManageCourse>(call('amy', 'POST', `/training/manage/courses/${c.id}/publish`, {}))).status).toBe('PUBLISHED');
  });

  it('the last lesson outside switched-off modules of a published course can’t be deleted (or its video link cleared)', async () => {
    let c = await newCourse('Last shown');
    const shown = await guideLesson(c.id, 'Shown');
    const video = await addLesson(c.id, { kind: 'VIDEO', title: 'Watch', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    const hidden = await guideLesson(c.id, 'Hidden');
    c = await addModule(c.id, { title: 'On' });
    c = await addModule(c.id, { title: 'Off' });
    await moveLesson(shown.id, moduleNamed(c, 'On').id);
    await moveLesson(hidden.id, moduleNamed(c, 'Off').id);
    await data(call('amy', 'POST', `/training/manage/courses/${c.id}/publish`, {}));
    c = await data<ManageCourse>(call('amy', 'PATCH', `/training/manage/modules/${moduleNamed(c, 'Off').id}`, { enabled: false }));
    // Two lessons people see: one may go.
    await data(call('amy', 'DELETE', `/training/manage/lessons/${shown.id}`), 204);
    // The video is the last: deleting it, or clearing its link, would leave nothing anyone sees.
    const refused = await call('amy', 'DELETE', `/training/manage/lessons/${video.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error!.code).toBe('WOULD_BREAK_PUBLISHED');
    expect((await call('amy', 'PATCH', `/training/manage/lessons/${video.id}`, { videoUrl: null })).status).toBe(409);
    expect((await getCourse(c.id)).lessons.map((l) => l.title).sort()).toEqual(['Hidden', 'Watch']);
    // The lesson in the switched-off module isn't the last one people see: it can go.
    await data(call('amy', 'DELETE', `/training/manage/lessons/${hidden.id}`), 204);
  });
});

describe('removing a module whose chosen module goes meanwhile (cleanup batch)', () => {
  it('409 MODULE_GONE, and its lessons stay where they were', async () => {
    let c = await newCourse('Gone meanwhile');
    const l1 = await guideLesson(c.id, 'One');
    const l2 = await guideLesson(c.id, 'Two');
    c = await addModule(c.id, { title: 'Leaving' });
    c = await addModule(c.id, { title: 'Chosen' });
    const leaving = moduleNamed(c, 'Leaving').id;
    const chosen = moduleNamed(c, 'Chosen').id;
    await moveLesson(l1.id, leaving);
    await moveLesson(l2.id, leaving);
    // Another manager removes the chosen module just after this request checked it (before its lock).
    let checked = false;
    const racing = new Proxy(prisma, {
      get: (target, key) => {
        if (key !== 'trainingModule') return Reflect.get(target, key);
        return new Proxy(target.trainingModule, {
          get: (models, name) =>
            name === 'findFirst'
              ? async (args: Parameters<typeof target.trainingModule.findFirst>[0]) => {
                  const found = await target.trainingModule.findFirst(args);
                  if (!checked && found?.id === chosen) {
                    checked = true;
                    await target.trainingModule.deleteMany({ where: { id: chosen } });
                  }
                  return found;
                }
              : Reflect.get(models, name),
        });
      },
    });
    const racer = createTrainingManage({ ...ctx, prisma: racing }, sync, { oneCourseKey: RECORD_KEY });
    const err = await racer.removeModule(w.people.amy, leaving, { moveTo: chosen }).catch((e: unknown) => e);
    expect(checked).toBe(true);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, code: 'MODULE_GONE', message: 'The module you chose was removed meanwhile. Choose another.' });
    expect(await prisma.trainingModule.count({ where: { id: leaving } })).toBe(1);
    expect((await prisma.trainingLesson.findMany({ where: { id: { in: [l1.id, l2.id] } }, select: { moduleId: true } })).map((l) => l.moduleId)).toEqual([leaving, leaving]);
  });
});
