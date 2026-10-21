import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaTaskExportSource } from '../../src/modules/tasks/task-export';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const source = createPrismaTaskExportSource(prisma, 'Asia/Muscat');
const EMAILS = ['tx-ada@mico360.test', 'tx-bo@mico360.test', 'tx-out@mico360.test'];
const CODE = 'TXPDF';
let taskId = '';
let meetingId = '';

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: CODE }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.meeting.deleteMany({ where: { title: { startsWith: 'TX export' } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await cleanup();
  const user = (email: string, firstName: string) =>
    prisma.user.create({ data: { email, username: email.slice(0, email.indexOf('@')), passwordHash: 'x', firstName, lastName: 'Test' } });
  const ada = await user(EMAILS[0]!, 'Ada');
  const bo = await user(EMAILS[1]!, 'Bo');
  await user(EMAILS[2]!, 'Outsider');
  const project = await prisma.project.create({
    data: { code: CODE, number: 'PDO-2026-014', name: 'TX Export Project', color: '#1E5A8B', icon: 'rocket', imageUrl: '/uploads/projects/tx.png', createdById: ada.id, ownerId: ada.id, members: { create: [{ userId: bo.id }] } },
  });
  const column = await prisma.kanbanColumn.create({ data: { projectId: project.id, name: 'Doing', category: 'IN_PROGRESS', position: 0 } });
  const meeting = await prisma.meeting.create({ data: { title: 'TX export weekly sync', organizerId: ada.id, createdById: ada.id, startAt: new Date('2026-09-27T06:00:00Z'), projectId: project.id } });
  meetingId = meeting.id;
  const task = await prisma.task.create({
    data: { key: `${CODE}-1`, title: 'Export me', projectId: project.id, columnId: column.id, createdById: ada.id, isMilestone: true, meetingId: meeting.id },
  });
  taskId = task.id;
  const first = await prisma.comment.create({ data: { taskId, userId: ada.id, body: 'Please check @tx-bo', createdAt: new Date('2026-09-28T05:00:00Z') } });
  await prisma.comment.create({ data: { taskId, userId: bo.id, body: 'Done', parentId: first.id, editedAt: new Date(), createdAt: new Date('2026-09-28T06:00:00Z') } });
  await prisma.comment.create({ data: { taskId, userId: bo.id, body: 'Removed', deletedAt: new Date(), createdAt: new Date('2026-09-28T07:00:00Z') } });
  await prisma.attachment.create({ data: { taskId, uploadedById: bo.id, filename: 'site.jpg', mimeType: 'image/jpeg', sizeBytes: 1234, storageKey: 'abc.jpg', url: '/uploads/abc.jpg' } });
  await prisma.activity.createMany({
    data: Array.from({ length: 505 }, (_, i) => ({ taskId, userId: ada.id, action: `STEP_${i + 1}`, createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)) })),
  });
});

describe('Task export source (integration)', () => {
  it('reads the project’s badge, number, the milestone flag and the meeting the task came from', async () => {
    const t = (await source.load(taskId))!;
    expect(t).toMatchObject({
      projectName: 'TX Export Project',
      projectCode: CODE,
      projectNumber: 'PDO-2026-014',
      projectColor: '#1E5A8B',
      projectIcon: 'rocket',
      projectImageUrl: '/uploads/projects/tx.png',
      isMilestone: true,
      meeting: { title: 'TX export weekly sync', startAt: new Date('2026-09-27T06:00:00Z') },
    });
  });

  it('leaves out a meeting that was deleted', async () => {
    await prisma.meeting.update({ where: { id: meetingId }, data: { deletedAt: new Date() } });
    expect((await source.load(taskId))!.meeting).toBeNull();
  });

  it('reads comments with the one each answers and whether it was edited, and who can be @mentioned', async () => {
    const t = (await source.load(taskId))!;
    expect(t.comments.map((c) => [c.body, c.parentId === null ? null : t.comments.find((p) => p.id === c.parentId)?.body, c.edited])).toEqual([
      ['Please check @tx-bo', null, false],
      ['Done', 'Please check @tx-bo', true],
    ]);
    expect(t.mentionable).toEqual(expect.arrayContaining(['tx-ada', 'tx-bo']));
    expect(t.mentionable).not.toContain('tx-out');
  });

  it('reads each attachment’s type and where it is stored', async () => {
    expect((await source.load(taskId))!.attachments).toEqual([
      expect.objectContaining({ filename: 'site.jpg', mimeType: 'image/jpeg', storageKey: 'abc.jpg', sizeBytes: 1234, uploadedBy: 'Bo Test' }),
    ]);
  });

  it('reads the latest 500 changes, oldest first, and how many there are in all', async () => {
    const t = (await source.load(taskId))!;
    expect(t.activity).toHaveLength(500);
    expect(t.activityTotal).toBe(505);
    expect(t.activity[0]!.action).toBe('STEP_6');
    expect(t.activity[499]!.action).toBe('STEP_505');
  });
});
