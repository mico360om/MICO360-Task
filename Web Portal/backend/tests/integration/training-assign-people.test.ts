import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testPrisma } from './test-prisma';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { HttpError } from '../../src/lib/http-errors';
import { validationErrorBody } from '../../src/lib/validation-errors';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthGuard } from '../../src/modules/auth/auth-guard';
import { trainingContext } from '../../src/modules/training/training-context';
import { createTrainingFileStore } from '../../src/modules/training/training-files';
import { createTrainingSync } from '../../src/modules/training/training-sync';
import { createTrainingManage } from '../../src/modules/training/training-manage';
import { registerTrainingManageRoutes } from '../../src/modules/training/training-manage-routes';
import type { AssignmentRow, ManageCourse, ManageLesson } from '../../src/modules/training/training-types';

// Requires a running MySQL/MariaDB (TEST_DATABASE_URL) with migrations applied.
// Assigning a course to several ticked people at once (R4): one USER assignment per person and course sharing
// a batchId, shown as one "<n> people" entry, withdrawn one by one or all together.
const url = process.env.TEST_DATABASE_URL!;
const prisma = testPrisma(url);
const TZ = 'Asia/Muscat';

let w: CompanyWorld;
let app: FastifyInstance;
let filesDir: string;
let courseId: string;
let course2: string;
const notices: { userId: string; type: string }[] = [];
const courseIds: string[] = [];
const tokenService = createTokenService({
  accessSecret: 'training-people-access',
  refreshSecret: 'training-people-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const ctx = trainingContext({
  prisma,
  files: createTrainingFileStore(join(mkdtempSync(join(tmpdir(), 'tap-')), 'training-files')),
  timeZone: TZ,
  appUrl: 'http://localhost:5173',
  notify: async (n) => {
    notices.push(n);
  },
  rules: async () => ({ calendar: { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }, step1Days: 3, step2Days: 5 }),
});
const sync = createTrainingSync(ctx);
const manage = createTrainingManage(ctx, sync);

type Who = 'admin' | 'amy' | 'ana';
async function call(who: Who, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  const { accessToken } = await tokenService.issueTokens({ id: w.people[who], roles: who === 'admin' ? ['ADMIN'] : ['EMPLOYEE'] });
  const res = await app.inject({ method, url: `/api/v1${path}`, headers: { authorization: `Bearer ${accessToken}` }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as { data?: unknown; error?: { code: string; message: string } }) : {} };
}
const data = async <T,>(p: ReturnType<typeof call>, status = 200): Promise<T> => {
  const r = await p;
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data as T;
};
async function readyCourse(title: string): Promise<string> {
  const c = await data<ManageCourse>(call('amy', 'POST', '/training/manage/courses', { title: `${title} ${w.tag}`, moduleKey: 'tasks', audience: 'STAFF', difficulty: 'BEGINNER' }), 201);
  courseIds.push(c.id);
  const l = await data<ManageLesson>(call('admin', 'POST', `/training/manage/courses/${c.id}/lessons`, { kind: 'GUIDE', title: 'Read me' }), 201);
  await data(call('admin', 'PUT', `/training/manage/lessons/${l.id}/steps`, { steps: [{ title: 'One', body: '<p>Do this</p>' }] }));
  await data(call('admin', 'POST', `/training/manage/courses/${c.id}/publish`, {}));
  return c.id;
}
const list = async (who: Who, cid: string) => (await data<{ assignments: AssignmentRow[] }>(call(who, 'GET', `/training/manage/assignments?courseId=${cid}`))).assignments;
const post = (who: Who, body: Record<string, unknown>) => call(who, 'POST', '/training/manage/assignments', { mandatory: true, ...body });

beforeAll(async () => {
  w = await buildCompanyWorld(prisma);
  await prisma.user.update({ where: { id: w.people.amy }, data: { trainingManager: true } });
  const guard = createAuthGuard(tokenService);
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send(validationErrorBody(err));
    return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: { code: 'ERROR', message: (err as Error).message } });
  });
  await app.register(async (api) => registerTrainingManageRoutes(api, { manage, guard }), { prefix: '/api/v1' });
  filesDir = ctx.files.dir;
  courseId = await readyCourse('People one');
  course2 = await readyCourse('People two');
});

afterAll(async () => {
  const users = Object.values(w.people);
  await prisma.trainingAssignee.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingAssignment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.trainingEnrolment.deleteMany({ where: { OR: [{ courseId: { in: courseIds } }, { userId: { in: users } }] } });
  await prisma.trainingCourse.deleteMany({ where: { id: { in: courseIds } } });
  await app.close();
  await dropCompanyWorld(prisma, w);
  await prisma.$disconnect();
  rmSync(filesDir, { recursive: true, force: true });
});

describe('assigning several people at once', () => {
  const three = () => [w.people.ana, w.people.cat, w.people.ben];

  it('previews the reach of the ticked people', async () => {
    const r = await data<{ reach: number; already: number }>(call('admin', 'POST', '/training/manage/assignments/preview', { courseIds: [courseId], targetKind: 'PEOPLE', userIds: three(), mandatory: true }));
    expect(r).toMatchObject({ reach: 3, already: 0 });
  });

  it('creates one USER row per person sharing a batch id, one notice each, and lists one "3 people" entry', async () => {
    notices.length = 0;
    const made = (await data<{ assignments: AssignmentRow[] }>(post('admin', { courseIds: [courseId], targetKind: 'PEOPLE', userIds: three() }), 201)).assignments;
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ targetKind: 'PEOPLE', targetLabel: '3 people', people: 3, mandatory: true });
    const rows = await prisma.trainingAssignment.findMany({ where: { courseId, withdrawnAt: null } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.targetKind === 'USER' && r.batchId && r.batchId === rows[0]!.batchId)).toBe(true);
    expect(made[0]!.batchId).toBe(rows[0]!.batchId);
    const got = notices.filter((n) => n.type === 'TRAINING_ASSIGNED');
    expect(got.map((n) => n.userId).sort()).toEqual([...three()].sort());

    const listed = await list('admin', courseId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ targetKind: 'PEOPLE', targetLabel: '3 people', people: 3 });
    const names = listed[0]!.members.map((m) => m.name);
    expect(names).toHaveLength(3);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(listed[0]!.members.map((m) => m.userId).sort()).toEqual([...three()].sort());
  });

  it('a single-person assignment stays a plain USER row', async () => {
    const [one] = (await data<{ assignments: AssignmentRow[] }>(post('admin', { courseIds: [course2], targetKind: 'USER', targetId: w.people.ana }), 201)).assignments;
    expect(one).toMatchObject({ targetKind: 'USER', batchId: null, members: [], people: 1 });
  });

  it('withdrawing one member leaves "2 people"; withdrawing the batch removes the rest', async () => {
    const before = (await list('admin', courseId))[0]!;
    const member = before.members.find((m) => m.userId === w.people.ben)!;
    expect((await call('admin', 'DELETE', `/training/manage/assignments/${member.assignmentId}`)).status).toBe(204);
    const mid = await list('admin', courseId);
    expect(mid).toHaveLength(1);
    expect(mid[0]).toMatchObject({ targetLabel: '2 people', people: 2 });
    expect(mid[0]!.members).toHaveLength(2);
    expect((await call('admin', 'DELETE', `/training/manage/assignment-batches/${before.batchId}`)).status).toBe(204);
    expect(await list('admin', courseId)).toHaveLength(0);
    expect(await prisma.trainingAssignee.count({ where: { courseId, withdrawnAt: null } })).toBe(0);
    expect((await call('admin', 'DELETE', `/training/manage/assignment-batches/${before.batchId}`)).status).toBe(404);
  });

  it('several courses at once make one entry per course', async () => {
    const made = (await data<{ assignments: AssignmentRow[] }>(post('admin', { courseIds: [courseId, course2], targetKind: 'PEOPLE', userIds: [w.people.ana, w.people.cat] }), 201)).assignments;
    expect(made).toHaveLength(2);
    expect(made.every((a) => a.targetLabel === '2 people')).toBe(true);
    expect(new Set(made.map((a) => a.batchId)).size).toBe(1);
  });

  it('a Training manager cannot include someone outside her companies, nor withdraw an administrator batch', async () => {
    const c = await readyCourse('People three');
    expect((await post('amy', { courseIds: [c], targetKind: 'PEOPLE', userIds: [w.people.ana, w.people.ben] })).status).toBe(400);
    expect((await call('amy', 'POST', '/training/manage/assignments/preview', { courseIds: [c], targetKind: 'PEOPLE', userIds: [w.people.ana, w.people.ben], mandatory: true })).status).toBe(400);
    const mine = (await data<{ assignments: AssignmentRow[] }>(post('amy', { courseIds: [c], targetKind: 'PEOPLE', userIds: [w.people.ana, w.people.cat] }), 201)).assignments;
    expect(mine[0]).toMatchObject({ targetLabel: '2 people', people: 2 });
    const adminBatch = (await data<{ assignments: AssignmentRow[] }>(post('admin', { courseIds: [c], targetKind: 'PEOPLE', userIds: [w.people.ben] }), 201)).assignments[0]!;
    expect((await call('amy', 'DELETE', `/training/manage/assignment-batches/${adminBatch.batchId}`)).status).toBe(403);
    expect((await call('amy', 'DELETE', `/training/manage/assignment-batches/${mine[0]!.batchId}`)).status).toBe(204);
    expect((await call('ana', 'DELETE', `/training/manage/assignment-batches/${adminBatch.batchId}`)).status).toBe(403);
  });

  it('refuses 201 people, no people, duplicates, a missing person and "new staff only"', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `u${i}`);
    expect((await post('admin', { courseIds: [courseId], targetKind: 'PEOPLE', userIds: many })).status).toBe(400);
    expect((await post('admin', { courseIds: [courseId], targetKind: 'PEOPLE', userIds: [] })).status).toBe(400);
    expect((await post('admin', { courseIds: [courseId], targetKind: 'PEOPLE' })).status).toBe(400);
    expect((await post('admin', { courseIds: [courseId], targetKind: 'PEOPLE', userIds: [w.people.ana, w.people.ana] })).status).toBe(400);
    expect((await post('admin', { courseIds: [courseId], targetKind: 'PEOPLE', userIds: [w.people.ana], newStaffOnly: true })).status).toBe(400);
    expect((await post('admin', { courseIds: [courseId], targetKind: 'PEOPLE', userIds: ['nobody-here'] })).status).toBe(400);
    expect((await post('admin', { courseIds: [courseId], targetKind: 'GROUP' })).status).toBe(400);
  });
});

describe('a request’s assignments are written together (cleanup batch)', () => {
  it('a failure while they are written leaves none of them, and nobody is told', async () => {
    const c = await readyCourse('People all or none');
    const people = [w.people.ana, w.people.cat, w.people.ben, w.people.amy];
    // The database refuses part-way: one by one, the third write fails; all at once, a repeated row (same id) fails the statement.
    let creates = 0;
    const assignments = new Proxy(prisma.trainingAssignment, {
      get: (models, name) => {
        if (name === 'create') {
          return async (args: Parameters<typeof prisma.trainingAssignment.create>[0]) => {
            if (++creates === 3) throw new Error('the database refused a row');
            return prisma.trainingAssignment.create(args);
          };
        }
        if (name === 'createMany') {
          return (args: { data: Record<string, unknown>[] }) => prisma.trainingAssignment.createMany({ ...args, data: [...args.data, { ...args.data[0]! }] } as Parameters<typeof prisma.trainingAssignment.createMany>[0]);
        }
        const v = Reflect.get(models, name);
        return typeof v === 'function' ? v.bind(models) : v;
      },
    });
    const failing = new Proxy(prisma, {
      get: (target, key) => {
        if (key === 'trainingAssignment') return assignments;
        const v = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const broken = { ...ctx, prisma: failing };
    notices.length = 0;
    await expect(createTrainingManage(broken, createTrainingSync(broken)).assign(w.people.admin, { courseIds: [c], targetKind: 'PEOPLE', userIds: people, mandatory: true })).rejects.toThrow();
    expect(await prisma.trainingAssignment.count({ where: { courseId: c } })).toBe(0);
    expect(await prisma.trainingAssignee.count({ where: { courseId: c } })).toBe(0);
    expect(notices).toEqual([]);
    // And the same request, with nothing failing, writes them all (one batch).
    const made = (await data<{ assignments: AssignmentRow[] }>(post('admin', { courseIds: [c], targetKind: 'PEOPLE', userIds: people }), 201)).assignments;
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ targetLabel: '4 people', people: 4 });
    const rows = await prisma.trainingAssignment.findMany({ where: { courseId: c } });
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
    expect(notices.filter((n) => n.type === 'TRAINING_ASSIGNED').map((n) => n.userId).sort()).toEqual([...people].sort());
  });

  it('several courses to a group: one row per course, all written', async () => {
    const c1 = await readyCourse('Group one');
    const c2 = await readyCourse('Group two');
    const made = (await data<{ assignments: AssignmentRow[] }>(post('admin', { courseIds: [c1, c2], targetKind: 'COMPANY', targetId: w.companies.A }), 201)).assignments;
    expect(made.map((a) => a.courseId)).toEqual([c1, c2]);
    expect(made.every((a) => a.targetKind === 'COMPANY' && a.batchId === null)).toBe(true);
    expect(await prisma.trainingAssignment.count({ where: { courseId: { in: [c1, c2] }, targetKind: 'COMPANY' } })).toBe(2);
  });
});
