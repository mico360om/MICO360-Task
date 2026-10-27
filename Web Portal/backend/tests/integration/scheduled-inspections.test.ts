import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaRecurrencePort } from '../../src/modules/tasks/prisma-recurrence-port';
import { createRecurrenceService } from '../../src/modules/tasks/recurrence-service';
import type { RecurrenceRule } from '../../src/modules/tasks/recurrence';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';

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
