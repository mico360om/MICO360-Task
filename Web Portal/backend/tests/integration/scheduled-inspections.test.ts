import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createRecurrenceService } from '../../src/modules/tasks/recurrence-service';
import type { RecurrenceRule } from '../../src/modules/tasks/recurrence';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { createPrismaTaskRepository, createPrismaProjectLookup } from '../../src/modules/tasks/prisma-task-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createStatusChangeEffects } from '../../src/modules/tasks/task-status-effects';
import { updateActivity } from '../../src/modules/tasks/task-changes';
import type { TaskRecord } from '../../src/modules/tasks/task-repository';
import { createInspectionService } from '../../src/modules/inspections/inspection-service';
import { createPrismaInspectionStore } from '../../src/modules/inspections/prisma-inspection-store';
import { createInspectionPorts } from '../../src/modules/inspections/prisma-inspection-ports';
import { createInspectionScheduleService } from '../../src/modules/inspections/inspection-schedules';
import { createPrismaInspectionScheduleSource } from '../../src/modules/inspections/prisma-inspection-schedule-source';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createProjectAuthz } from '../../src/modules/projects/project-authz';
import { createColumnService } from '../../src/modules/projects/column-service';
import { createPrismaColumnRepository } from '../../src/modules/projects/prisma-column-repository';

// Scheduled inspections on MySQL (TEST_DATABASE_URL, migrations applied). Only this file's project
// (code SCHED), its forms and its people (*@sched.mico360.test) are made and removed.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-01T06:00:00Z'); // 10:00 on 1 Oct in Muscat
const port = createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => NOW });
const recurrence = createRecurrenceService({ tasks: port, timeZone: TZ, now: () => NOW });
const DAILY: RecurrenceRule = { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' };

let ownerId = '';
let mateId = '';
let projectId = '';
let todoId = '';
let doneId = '';
let n = 0;

async function cleanup() {
  const ids = (await prisma.project.findMany({ where: { code: { in: ['SCHED', 'SCHEDB'] } }, select: { id: true } })).map((p) => p.id);
  const users = (await prisma.user.findMany({ where: { email: { endsWith: '@sched.mico360.test' } }, select: { id: true } })).map((u) => u.id);
  await prisma.inspection.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.taskKeyAlias.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.inspectionForm.deleteMany({ where: { createdById: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}

const person = (name: string) => prisma.user.create({ data: { email: `${name}@sched.mico360.test`, username: `sched-${name}`, passwordHash: 'x', firstName: name, lastName: 'Tester' } });

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  ownerId = (await person('owner')).id;
  mateId = (await person('mate')).id;
  const p = await prisma.project.create({ data: { code: 'SCHED', name: 'Scheduled checks', createdById: ownerId, ownerId, members: { create: [{ userId: mateId }] } } });
  projectId = p.id;
  todoId = (await prisma.kanbanColumn.create({ data: { projectId, name: 'To do', category: 'TODO', position: 0 } })).id;
  doneId = (await prisma.kanbanColumn.create({ data: { projectId, name: 'Done', category: 'DONE', position: 1 } })).id;
});

const sections = [{ id: 's1', title: 'Deck', items: [{ id: 'c1', kind: 'CHECK', label: 'Guard rails fitted', help: null }] }] as unknown as Prisma.InputJsonValue;
const newForm = (title = 'Rig daily check') => prisma.inspectionForm.create({ data: { title, sections, clientSignature: 'NONE', supervisorSignature: 'NONE', createdById: ownerId } });

async function scheduledCheck(formId: string, dueDate: string, rule: RecurrenceRule = DAILY) {
  return prisma.task.create({
    data: {
      key: `SCHED-${++n}`,
      title: 'Daily rig check – Rig 3',
      projectId,
      columnId: todoId,
      createdById: ownerId,
      dueDate: new Date(`${dueDate}T00:00:00.000Z`),
      recurrenceRule: rule as unknown as Prisma.InputJsonValue,
      inspectionFormId: formId,
      inspectionPlace: 'Rig 3 – الحفار ٣',
      assignees: { create: [{ userId: mateId }] },
    },
  });
}

describe('repeat copies of a scheduled check (MySQL)', () => {
  it('each copy keeps the form and the place, and the same inspector', async () => {
    const form = await newForm();
    const source = await scheduledCheck(form.id, '2026-09-30');
    const made = await recurrence.runSchedule();
    const mine = made.filter((m) => m.projectId === projectId);
    expect(mine).toHaveLength(1);
    const copy = await prisma.task.findUniqueOrThrow({ where: { id: mine[0]!.id }, include: { assignees: true } });
    expect(copy).toMatchObject({ inspectionFormId: form.id, inspectionPlace: 'Rig 3 – الحفار ٣', recurrenceSourceId: source.id, dueDate: new Date('2026-10-01T00:00:00.000Z') });
    expect(copy.assignees.map((a) => a.userId)).toEqual([mateId]);
    // The missed check stays open (nothing is auto-closed).
    expect((await prisma.task.findUniqueOrThrow({ where: { id: source.id } })).completedAt).toBeNull();
  });

  it('a copy made when one is completed keeps them too', async () => {
    const form = await newForm();
    const source = await scheduledCheck(form.id, '2026-10-01', { freq: 'WEEKLY', interval: 1 });
    const next = await recurrence.onTaskCompleted({ id: source.id, dueDate: source.dueDate, recurrenceRule: { freq: 'WEEKLY', interval: 1 }, recurrenceParentId: null });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: next!.id } })).toMatchObject({ inspectionFormId: form.id, inspectionPlace: 'Rig 3 – الحفار ٣' });
  });

  it('the on-schedule sweep makes nothing for a series whose form was deleted', async () => {
    const form = await newForm();
    const source = await scheduledCheck(form.id, '2026-09-30');
    await prisma.inspectionForm.update({ where: { id: form.id }, data: { deletedAt: new Date() } });
    expect((await recurrence.runSchedule()).filter((m) => m.projectId === projectId)).toEqual([]);
    expect(await prisma.task.count({ where: { recurrenceSourceId: source.id } })).toBe(0);
    // Asked directly (a skip, a completion), the port still makes no copy of a deleted form's check.
    expect(await port.spawnNext(source.id, new Date('2026-10-01T00:00:00.000Z'), DAILY)).toBeNull();
  });

  it('a task moved to another project keeps its form and place (forms are company-wide)', async () => {
    const form = await newForm();
    const t = await scheduledCheck(form.id, '2026-10-01');
    const other = await prisma.project.create({ data: { code: 'SCHEDB', name: 'Other', createdById: ownerId, ownerId } });
    await prisma.kanbanColumn.create({ data: { projectId: other.id, name: 'To do', category: 'TODO', position: 0 } });
    const moves = createTaskMoveService({ repo: createPrismaTaskMoveRepository(prisma), timeZone: TZ, now: () => NOW });
    const moved = await moves.moveTask({ id: ownerId, roles: ['ADMIN'] }, t.id, { projectId: other.id, assignees: 'ADD_TO_TEAM' });
    expect(moved.task).toMatchObject({ id: t.id, projectId: other.id, inspectionFormId: form.id, inspectionPlace: 'Rig 3 – الحفار ٣' });
  });
});

// ── The whole server side: tasks, inspections, schedules, with the app's real access rules ──────────

function world(clock: { at: Date }, opts: { noticesFail?: boolean } = {}) {
  const warnings: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
  const logger = { warn: (msg: string, ctx?: Record<string, unknown>) => void warnings.push({ msg, ctx }) };
  const notices: Array<{ userId: string; title: string; entityId: string }> = [];
  const lines: Array<{ taskId: string; userId: string; action: string; meta: Record<string, unknown> }> = [];
  const events: Array<{ event: string; id: string }> = [];
  const nowFn = () => clock.at;
  const recurrenceSvc = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma, { timeZone: TZ, now: nowFn }), timeZone: TZ, now: nowFn });
  const effects = createStatusChangeEffects({
    column: (id) => prisma.kanbanColumn.findUnique({ where: { id }, select: { name: true, category: true } }),
    nextCopy: (task) => recurrenceSvc.onTaskCompleted({ id: task.id, dueDate: task.dueDate, recurrenceRule: task.recurrenceRule, recurrenceParentId: task.recurrenceParentId }),
    announceCopy: async () => {},
    followActionItems: async () => {},
    recipients: async (taskId, actorId) => (await prisma.taskAssignee.findMany({ where: { taskId } })).map((a) => a.userId).filter((u) => u !== actorId),
    notify: async (x) => {
      if (opts.noticesFail) throw new Error('Deadlock found when trying to get lock');
      notices.push({ userId: x.userId, title: x.title, entityId: x.entityId });
    },
    // Kept in the database too, as the app does (a repeat of a finish reads it).
    record: async (e) => {
      lines.push({ taskId: e.taskId, userId: e.userId, action: e.action, meta: e.meta });
      await prisma.activity.create({ data: { taskId: e.taskId, projectId: e.projectId, userId: e.userId, action: e.action, meta: e.meta as Prisma.InputJsonValue } });
    },
  });
  const onUpdated = async (before: TaskRecord, after: TaskRecord, actorId?: string) => {
    const meta = updateActivity(before, after, TZ);
    if (meta && actorId) lines.push({ taskId: after.id, userId: actorId, action: 'UPDATED', meta: { ...meta } });
  };
  const taskService = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ, now: nowFn, onMoved: (t, prev, actor) => effects(t, prev, actor), onUpdated });
  const managers = createPrismaProjectManagerLookup(prisma);
  const access = createProjectAccess({ projects: createPrismaProjectRepository(prisma), managers });
  const makePorts = (tasks: Parameters<typeof createInspectionPorts>[0]['tasks'] = taskService) =>
    createInspectionPorts({
      prisma,
      access,
      authz: createProjectAuthz({ managers }),
      tasks,
      onTaskUpdated: onUpdated,
      columns: createColumnService({ columns: createPrismaColumnRepository(prisma) }),
      assignees: { eligibleAssignees: async (_p, ids) => ids, assertAssignable: async (_p, ids) => ids, notifyAssigned: async () => {} },
      broadcast: (_p, event, payload) => void events.push({ event, id: (payload as { id: string }).id }),
      userNames: async (ids) => new Map(ids.map((id) => [id, id])),
      logger,
    });
  const inspections = createInspectionService({ store: createPrismaInspectionStore(prisma), timeZone: TZ, now: nowFn, ports: makePorts() });
  const schedules = createInspectionScheduleService({
    source: createPrismaInspectionScheduleSource(prisma, { workingDays: async () => [0, 1, 2, 3, 4] }),
    canViewProject: (u, r, p) => access.canViewProject(u, r, p),
    userNames: async () => new Map(),
    timeZone: TZ,
    now: nowFn,
  });
  return { taskService, inspections, schedules, access, notices, lines, events, warnings, makePorts };
}

const member = () => ({ id: mateId, roles: ['EMPLOYEE'] });

async function checkFor(w: ReturnType<typeof world>, formId: string, over: Record<string, unknown> = {}) {
  return w.taskService.createTask({
    title: 'Daily rig check – Rig 3',
    projectId,
    columnId: todoId,
    createdById: mateId,
    dueDate: new Date('2026-10-01T00:00:00.000Z'),
    inspectionFormId: formId,
    inspectionPlace: 'Rig 3',
    assigneeIds: [mateId, ownerId],
    ...over,
  });
}
async function finishCheck(w: ReturnType<typeof world>, clock: { at: Date }, taskId: string, formId: string, finishId = 'fin-1') {
  const insp = await w.inspections.start(member(), projectId, { formId, taskId });
  await w.inspections.answer(member(), insp.id, [{ itemId: 'c1', result: 'PASS', reading: null, note: null, editedAt: new Date(clock.at.getTime() - 1000).toISOString() }]);
  const detail = await w.inspections.get(member(), insp.id);
  const body = { finishId, revision: detail.revision, seen: detail.answers.map((a) => ({ itemId: a.itemId, editedAt: a.editedAt })), signatures: [{ role: 'INSPECTOR', name: 'Mate Tester', method: 'TYPED', signedAt: clock.at.toISOString() }] };
  return { insp, body, done: await w.inspections.finish(member(), insp.id, body) };
}

describe('finishing a check’s inspection completes the task (MySQL)', () => {
  it('through the normal status path: Done column, completion time, one history line, the people told — once, however often the finish is sent', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const form = await newForm();
    const task = await checkFor(w, form.id);
    const { insp, body, done } = await finishCheck(w, clock, task.id, form.id);
    expect(done.taskCompleted).toEqual({ id: task.id, key: task.key, title: task.title });
    expect(done.taskOffer).toBeNull();
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.columnId).toBe(doneId);
    expect(row.completedAt?.toISOString()).toBe(clock.at.toISOString());
    // A replay (its reply was lost) and two more at once (the offline outbox and a retry): still once.
    const again = await w.inspections.finish(member(), insp.id, body);
    await Promise.all([w.inspections.finish(member(), insp.id, body), w.inspections.finish(member(), insp.id, body)]);
    expect(again.taskCompleted?.id).toBe(task.id);
    expect(w.lines.filter((l) => l.taskId === task.id && l.action === 'COMPLETED')).toEqual([{ taskId: task.id, userId: mateId, action: 'COMPLETED', meta: { from: 'To do', to: 'Done' } }]);
    expect(w.notices.filter((x) => x.entityId === task.id)).toEqual([{ userId: ownerId, title: 'Task moved to Done', entityId: task.id }]);
    expect(w.events.filter((e) => e.event === 'task:moved' && e.id === task.id)).toHaveLength(1);
  });

  it('a repeating check is always on schedule: finishing it makes no early copy; the next one comes on its date', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const form = await newForm();
    const task = await checkFor(w, form.id, { recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    expect(task.recurrenceRule).toMatchObject({ createNext: 'ON_SCHEDULE' });
    await finishCheck(w, clock, task.id, form.id);
    expect(await prisma.task.count({ where: { recurrenceSourceId: task.id } })).toBe(0);
    const later = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma, { timeZone: TZ, now: () => new Date('2026-10-08T06:00:00Z') }), timeZone: TZ, now: () => new Date('2026-10-08T06:00:00Z') });
    await later.runSchedule();
    const next = await prisma.task.findFirstOrThrow({ where: { recurrenceSourceId: task.id } });
    expect(next).toMatchObject({ inspectionFormId: form.id, inspectionPlace: 'Rig 3', dueDate: new Date('2026-10-08T00:00:00.000Z') });
  });

  it('done late is decided in the company time zone at the day boundary (23:59 vs 00:01 in Muscat)', async () => {
    const form = await newForm();
    const lateBy = async (finishAt: string, finishId: string) => {
      const clock = { at: new Date(finishAt) };
      const w = world(clock);
      const task = await checkFor(w, form.id);
      await finishCheck(w, clock, task.id, form.id, finishId);
      const rows = (await w.inspections.listForProject(member(), projectId)).inspections;
      return rows.find((r) => r.task?.id === task.id)!.task!.lateDays;
    };
    expect(await lateBy('2026-10-01T19:59:00Z', 'f-a')).toBe(0); // 23:59 on the 1st in Muscat
    expect(await lateBy('2026-10-01T20:01:00Z', 'f-b')).toBe(1); // 00:01 on the 2nd
  });

  it('a check whose form was deleted can still be started and finished', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const form = await newForm();
    const task = await checkFor(w, form.id);
    await w.inspections.deleteForm({ id: ownerId, roles: ['ADMIN'] }, form.id);
    const { done } = await finishCheck(w, clock, task.id, form.id);
    expect(done).toMatchObject({ status: 'FINISHED', taskCompleted: { id: task.id } });
  });
});

describe('deleting a form stops the schedules that use it (MySQL)', () => {
  it('in one step with the delete: every schedule’s repeat cleared, with the history line a person stopping it gets; other tasks untouched', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const form = await newForm();
    const other = await newForm('Weekly extinguisher check');
    // Due two days ago: the sweep would make today's check if they weren't stopped.
    const a = await checkFor(w, form.id, { recurrenceRule: DAILY, dueDate: new Date('2026-09-29T00:00:00.000Z') });
    const b = await checkFor(w, form.id, { recurrenceRule: DAILY, title: 'Daily rig check – Rig 4', dueDate: new Date('2026-09-29T00:00:00.000Z') });
    const oneOff = await checkFor(w, form.id, { title: 'One-off check' });
    const keeps = await checkFor(w, other.id, { recurrenceRule: DAILY });
    expect(await w.schedules.formUsage(form.id)).toEqual({ schedules: 2, openChecks: 3 });
    await w.inspections.deleteForm({ id: ownerId, roles: ['ADMIN'] }, form.id);
    expect((await prisma.inspectionForm.findUniqueOrThrow({ where: { id: form.id } })).deletedAt).not.toBeNull();
    for (const t of [a, b]) {
      const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.recurrenceRule).toBeNull();
      expect(row.version).toBe(t.version + 1);
      // The form stays on the task: the checks already made can still be done.
      expect(row.inspectionFormId).toBe(form.id);
      expect(w.lines.find((l) => l.taskId === t.id && l.action === 'UPDATED')).toEqual({
        taskId: t.id,
        userId: ownerId,
        action: 'UPDATED',
        meta: { changes: [{ field: 'repeat', from: 'Repeats every day · new copy on each date', to: null }] },
      });
    }
    expect((await prisma.task.findUniqueOrThrow({ where: { id: keeps.id } })).recurrenceRule).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: oneOff.id } })).version).toBe(oneOff.version);
    expect(w.events.filter((e) => e.event === 'task:updated').map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
    // Nothing more is made for them, and their open checks are still listed.
    await recurrence.runSchedule();
    expect(await prisma.task.count({ where: { recurrenceSourceId: { in: [a.id, b.id] } } })).toBe(0);
    expect((await w.schedules.dueChecks(member(), projectId)).checks.map((c) => c.taskId)).toEqual(expect.arrayContaining([a.id, b.id, oneOff.id]));
  });
});

describe('who may see and set up schedules (MySQL, the app’s access rules)', () => {
  it('the project team (and administrators) set up, change and stop a schedule and read the lists; anyone else is refused', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const outsider = await person('outsider');
    const form = await newForm();
    // The task routes allow a create in a project the person can see, and an edit of a task they can see.
    expect(await w.access.accessibleProjectIds(mateId, ['EMPLOYEE'])).toContain(projectId);
    expect(await w.access.accessibleProjectIds(outsider.id, ['EMPLOYEE'])).not.toContain(projectId);
    const s = await checkFor(w, form.id, { recurrenceRule: DAILY });
    expect(await w.access.canViewTask(mateId, ['EMPLOYEE'], s.id)).toBe(true);
    expect(await w.access.canViewTask(outsider.id, ['EMPLOYEE'], s.id)).toBe(false);
    const edited = await w.taskService.updateTask(s.id, { inspectionPlace: 'Rig 4', recurrenceRule: { ...DAILY, interval: 2 } }, undefined, 'one', mateId);
    expect(edited).toMatchObject({ inspectionPlace: 'Rig 4', recurrenceRule: { interval: 2 } });
    expect((await w.schedules.schedules(member(), projectId)).schedules.map((x) => x.taskId)).toEqual([s.id]);
    expect((await w.schedules.schedules({ id: ownerId, roles: ['ADMIN'] }, projectId)).schedules).toHaveLength(1);
    const refused = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as { status?: number } | null)?.status;
    expect(await refused(w.schedules.schedules({ id: outsider.id, roles: ['EMPLOYEE'] }, projectId))).toBe(404);
    expect(await refused(w.schedules.dueChecks({ id: outsider.id, roles: ['EMPLOYEE'] }, projectId))).toBe(404);
    await w.taskService.updateTask(s.id, { recurrenceRule: null }, undefined, 'one', mateId);
    expect((await w.schedules.schedules(member(), projectId)).schedules).toEqual([]);
  });
});

describe('completing a check: repeats, two at once, and failures after the move (MySQL)', () => {
  it('a finish sent again after someone reopened the task by hand leaves it open: one COMPLETED line', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const form = await newForm();
    const task = await checkFor(w, form.id);
    const { insp, body } = await finishCheck(w, clock, task.id, form.id);
    clock.at = new Date('2026-10-01T09:00:00Z');
    await w.taskService.moveTask(task.id, todoId, undefined, ownerId); // the supervisor: "redo it"
    const again = await w.inspections.finish(member(), insp.id, body);
    expect(again).toMatchObject({ status: 'FINISHED', taskCompleted: null, taskOffer: null });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.columnId).toBe(todoId);
    expect(row.completedAt).toBeNull();
    expect(await prisma.activity.count({ where: { taskId: task.id, action: 'COMPLETED' } })).toBe(1);
  });

  it('two completions at once (two server processes) make one move, one history line, one notice', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const form = await newForm();
    const task = await checkFor(w, form.id);
    // Both have read the task (open, at its version) before either moves it.
    let arrived = 0;
    let release!: () => void;
    const together = new Promise<void>((r) => (release = r));
    const racing = {
      ...w.taskService,
      createTask: w.taskService.createTask,
      getTask: w.taskService.getTask,
      moveTask: async (...a: Parameters<typeof w.taskService.moveTask>) => {
        if (++arrived === 2) release();
        await together;
        return w.taskService.moveTask(...a);
      },
    };
    const [a, b] = [w.makePorts(racing), w.makePorts(racing)];
    const results = await Promise.all([a.completeTask!(task.id, mateId), b.completeTask!(task.id, mateId)]);
    expect(results.sort()).toEqual([false, true]);
    expect(await prisma.activity.count({ where: { taskId: task.id, action: 'COMPLETED' } })).toBe(1);
    expect(w.notices.filter((n) => n.entityId === task.id)).toHaveLength(1);
    expect(w.events.filter((e) => e.event === 'task:moved' && e.id === task.id)).toHaveLength(1);
  });

  it('a step after the move fails (a notice): the task is done, the page is told so, boards are told, the history line is kept and the failure logged', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock, { noticesFail: true });
    const form = await newForm();
    const task = await checkFor(w, form.id);
    const { done } = await finishCheck(w, clock, task.id, form.id);
    expect(done.taskCompleted).toEqual({ id: task.id, key: task.key, title: task.title });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).columnId).toBe(doneId);
    expect(w.events.filter((e) => e.event === 'task:moved' && e.id === task.id)).toHaveLength(1);
    expect(await prisma.activity.count({ where: { taskId: task.id, action: 'COMPLETED' } })).toBe(1);
    expect(w.warnings.some((x) => /after the move/.test(x.msg))).toBe(true);
  });
});

describe('a schedule row that is out of date (MySQL)', () => {
  it('when the repeat moves on to the next copy, the old copy’s version goes up: a Stop or Edit sent for it is refused (409), not applied to the wrong copy', async () => {
    const clock = { at: new Date('2026-10-01T08:00:00Z') };
    const w = world(clock);
    const form = await newForm();
    const head = await checkFor(w, form.id, { recurrenceRule: DAILY, dueDate: new Date('2026-09-30T00:00:00.000Z') });
    const row = (await w.schedules.schedules(member(), projectId)).schedules[0]!;
    expect(row).toMatchObject({ taskId: head.id, version: head.version });
    await recurrence.runSchedule(); // the next check is made: the repeat moves to it
    expect((await prisma.task.findUniqueOrThrow({ where: { id: head.id } })).version).toBe(head.version + 1);
    const refused = await w.taskService.updateTask(head.id, { recurrenceRule: null }, row.version, 'one', mateId).then(() => null, (e: { status?: number; code?: string }) => e);
    expect(refused).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    const fresh = (await w.schedules.schedules(member(), projectId)).schedules[0]!;
    expect(fresh.taskId).not.toBe(head.id);
  });
});
