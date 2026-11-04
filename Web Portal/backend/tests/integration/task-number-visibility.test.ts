import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildCompanyWorld, dropCompanyWorld, type CompanyWorld } from './company-world';
import { buildPeopleApp } from './company-people-app';
import { createNotificationService } from '../../src/modules/notifications/notification-service';
import { createPrismaNotificationRepository } from '../../src/modules/notifications/prisma-notification-repository';
import { createPrismaTaskKeyResolver } from '../../src/modules/tasks/prisma-task-keys';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
// 1.22.3 review: a task's number now (the chip on a notice, a meeting note, an action item) is shown
// only to someone who may open that task — through the routes as server.ts wires them, where the bell's
// list follows the reader's whole company (no team rule). Ana is on PA, not on "HR" (company A too, Amy's
// team); a task moved from PA to HR keeps its old notices, note and action items in Ana's lists, but its
// new number isn't hers to see. An administrator sees every number — not one of a project in the trash.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let w: CompanyWorld;
let h: Awaited<ReturnType<typeof buildPeopleApp>>;
let hr: string;
let binned: string;
let binnedTask: string;
let hrKey: string;
let ta2Key: string;
let anaOwnItem: string;

type Row = { id: string; entityId?: string | null; taskId?: string | null; taskKey: string | null };
const keyOf = (rows: Row[], pick: (r: Row) => boolean) => rows.find(pick)?.taskKey;

beforeAll(async () => {
  await prisma.$connect();
  w = await buildCompanyWorld(prisma);
  h = await buildPeopleApp(prisma, {
    notificationService: createNotificationService({ notifications: createPrismaNotificationRepository(prisma) }),
    resolveTaskKeys: createPrismaTaskKeyResolver(prisma),
  });
  const T = w.tag.toUpperCase();
  const project = async (code: string, data: { members: string[]; deletedAt?: Date }) => {
    const p = await prisma.project.create({
      data: {
        code: `${code}${T}`,
        name: `Project ${code} ${w.tag}`,
        status: 'ACTIVE',
        createdById: w.people.admin,
        mainCompanyId: w.companies.A,
        companies: { create: [{ companyId: w.companies.A }] },
        members: { create: data.members.map((userId) => ({ userId, role: 'MEMBER' as const })) },
        ...(data.deletedAt ? { deletedAt: data.deletedAt } : {}),
      },
    });
    const column = await prisma.kanbanColumn.create({ data: { projectId: p.id, name: 'To Do', category: 'TODO', position: 0 } });
    return { id: p.id, column: column.id };
  };
  hr = (await project('HR', { members: [w.people.amy] })).id;
  const bin = await project('BIN', { members: [w.people.ana], deletedAt: new Date() });
  binned = bin.id;
  binnedTask = (await prisma.task.create({ data: { key: `BIN${T}-3`, title: 'In the trash', projectId: binned, columnId: bin.column, createdById: w.people.admin } })).id;

  // The meeting's note and Ana's action item point at TA1; another note and item at TA2 (still on PA).
  await prisma.meetingNote.update({ where: { id: w.notes.MA }, data: { taskId: w.tasks.TA1 } });
  await prisma.meetingNote.create({ data: { meetingId: w.meetings.MA, authorId: w.people.ana, body: 'ZZALPHA second note', taskId: w.tasks.TA2 } });
  await prisma.actionItem.update({ where: { id: w.actionItems.MA_ana }, data: { taskId: w.tasks.TA1 } });
  anaOwnItem = (await prisma.actionItem.create({ data: { meetingId: w.meetings.MA, projectId: w.projects.PA, description: 'ZZALPHA second action', assigneeId: w.people.ana, createdById: w.people.ana, taskId: w.tasks.TA2 } })).id;
  ta2Key = (await prisma.task.findUniqueOrThrow({ where: { id: w.tasks.TA2 } })).key;

  // Notices about TA1 and TA2 (filed under PA when they were made), and one about a task in the trash.
  const notice = (userId: string, entityId: string, projectId: string, title: string) =>
    prisma.notification.create({ data: { userId, type: 'TASK_ASSIGNED', title, entityType: 'task', entityId, projectId } });
  await notice(w.people.ana, w.tasks.TA1, w.projects.PA, 'TA1 for ana');
  await notice(w.people.ana, w.tasks.TA2, w.projects.PA, 'TA2 for ana');
  await notice(w.people.admin, w.tasks.TA1, w.projects.PA, 'TA1 for admin');
  await notice(w.people.admin, binnedTask, binned, 'binned for admin');

  // Sara (here: an administrator) moves TA1 to HR, taking Ana off it: a new number, HR-…
  const moved = await h.post(w.as.admin, `/tasks/${w.tasks.TA1}/move-to-project`, { projectId: hr, assignees: 'UNASSIGN' });
  expect(moved.status, moved.body).toBe(200);
  hrKey = moved.data.to.key;
  expect(hrKey).toMatch(new RegExp(`^HR${T}-\\d+$`));
});

afterAll(async () => {
  await h?.close();
  if (w) await dropCompanyWorld(prisma, { ...w, projects: { ...w.projects, HR: hr, BIN: binned } as CompanyWorld['projects'] });
  await prisma.$disconnect();
});

describe('a moved task’s new number is shown only to people who can see its new project (1.22.3 review)', () => {
  it('the bell: Ana’s notice about the moved task keeps its place but shows no number; the one still on PA does', async () => {
    const res = await h.get(w.as.ana, '/notifications');
    expect(res.status).toBe(200);
    const rows = res.data as Row[];
    expect(rows.map((n) => (n as unknown as { title: string }).title)).toEqual(expect.arrayContaining(['TA1 for ana', 'TA2 for ana']));
    expect(keyOf(rows, (n) => n.entityId === w.tasks.TA1)).toBeNull();
    expect(keyOf(rows, (n) => n.entityId === w.tasks.TA2)).toBe(ta2Key);
    // The task itself is closed to her too (what the chip would have opened).
    expect((await h.get(w.as.ana, `/tasks/${w.tasks.TA1}`)).status).toBe(404);
  });

  it('an administrator sees the new number — but none for a task whose project is in the trash', async () => {
    const rows = (await h.get(w.as.admin, '/notifications')).data as Row[];
    expect(keyOf(rows, (n) => n.entityId === w.tasks.TA1)).toBe(hrKey);
    expect(rows.some((n) => n.entityId === binnedTask)).toBe(true);
    expect(keyOf(rows, (n) => n.entityId === binnedTask)).toBeNull();
  });

  it('meeting notes: the note whose task moved away shows no number to Ana (the plain “Task”), the other its number', async () => {
    const res = await h.get(w.as.ana, `/meetings/${w.meetings.MA}/notes`);
    expect(res.status).toBe(200);
    const rows = res.data as Row[];
    expect(keyOf(rows, (n) => n.taskId === w.tasks.TA1)).toBeNull();
    expect(keyOf(rows, (n) => n.taskId === w.tasks.TA2)).toBe(ta2Key);
    const admin = (await h.get(w.as.admin, `/meetings/${w.meetings.MA}/notes`)).data as Row[];
    expect(keyOf(admin, (n) => n.taskId === w.tasks.TA1)).toBe(hrKey);
  });

  it('action items — the meeting’s and My Action Items: no chip for the task Ana can’t open', async () => {
    for (const path of [`/meetings/${w.meetings.MA}/action-items`, '/me/action-items']) {
      const res = await h.get(w.as.ana, path);
      expect(res.status, path).toBe(200);
      const rows = res.data as Row[];
      expect(keyOf(rows, (i) => i.id === w.actionItems.MA_ana), path).toBeNull();
      expect(keyOf(rows, (i) => i.id === anaOwnItem), path).toBe(ta2Key);
    }
    const admin = (await h.get(w.as.admin, `/meetings/${w.meetings.MA}/action-items`)).data as Row[];
    expect(keyOf(admin, (i) => i.id === w.actionItems.MA_ana)).toBe(hrKey);
  });
});
