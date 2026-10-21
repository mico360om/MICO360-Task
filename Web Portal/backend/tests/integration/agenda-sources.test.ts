import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createPrismaAgendaSources } from '../../src/modules/meetings/prisma-agenda-sources';

// Requires a running MySQL (TEST_DATABASE_URL) with migrations applied.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const store = createPrismaAgendaSources(prisma);
const EMAIL = 'as-owner@mico360.test';
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+04:00`);
let owner = '';
let projectId = '';

async function cleanup() {
  const projects = await prisma.project.findMany({ where: { code: { in: ['ASRC'] } }, select: { id: true } });
  const ids = projects.map((p) => p.id);
  await prisma.actionItem.deleteMany({ where: { meeting: { projectId: { in: ids } } } });
  await prisma.meeting.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.task.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.kanbanColumn.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
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
  owner = (await prisma.user.create({ data: { email: EMAIL, username: 'as-owner', passwordHash: 'x', firstName: 'Agenda', lastName: 'Owner' } })).id;
  projectId = (await prisma.project.create({ data: { code: 'ASRC', name: 'Agenda sources', status: 'ACTIVE', createdById: owner, ownerId: owner } })).id;
});

const meeting = (title: string, start: string, extra: Record<string, unknown> = {}) =>
  prisma.meeting.create({ data: { title, status: 'SCHEDULED', startAt: at(start), organizerId: owner, createdById: owner, projectId, ...extra } });

describe('Prisma agenda sources (integration)', () => {
  it('open tasks: blocked, or due by the date given — never done, completed or deleted ones', async () => {
    const col = async (name: string, category: 'IN_PROGRESS' | 'BLOCKED' | 'DONE', position: number) => (await prisma.kanbanColumn.create({ data: { projectId, name, category, position } })).id;
    const doing = await col('Doing', 'IN_PROGRESS', 0);
    const blocked = await col('Blocked', 'BLOCKED', 1);
    const done = await col('Done', 'DONE', 2);
    let n = 0;
    const task = (columnId: string, extra: Record<string, unknown> = {}) =>
      prisma.task.create({ data: { key: `ASRC-${++n}`, title: `Task ${n}`, projectId, columnId, createdById: owner, ...extra } });
    await task(doing, { dueDate: new Date('2026-10-20T00:00:00Z') }); // 1: overdue
    await task(blocked); // 2: blocked, no due date
    await task(doing, { dueDate: new Date('2026-11-01T00:00:00Z') }); // 3: due within the week after
    await task(doing, { dueDate: new Date('2026-12-01T00:00:00Z') }); // 4: too far ahead
    await task(doing); // 5: no date, not blocked
    await task(done, { dueDate: new Date('2026-10-20T00:00:00Z') }); // 6: done
    await task(doing, { dueDate: new Date('2026-10-20T00:00:00Z'), completedAt: new Date() }); // 7: completed
    await task(blocked, { deletedAt: new Date() }); // 8: deleted
    const out = await store.openTasks(projectId, new Date('2026-11-02T00:00:00Z'));
    expect(out.map((t) => t.key).sort()).toEqual(['ASRC-1', 'ASRC-2', 'ASRC-3']);
    expect(out.find((t) => t.key === 'ASRC-2')).toEqual({ key: 'ASRC-2', title: 'Task 2', dueDate: null, blocked: true });
  });

  it('the previous meeting of a series, and the project’s last meeting before a time', async () => {
    const root = await meeting('Weekly 1', '2026-10-05 10:00', { recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
    const second = await meeting('Weekly 2', '2026-10-12 10:00', { recurrenceParentId: root.id, recurrenceStart: at('2026-10-12 10:00') });
    await meeting('Weekly 3 (cancelled)', '2026-10-19 10:00', { recurrenceParentId: root.id, recurrenceStart: at('2026-10-19 10:00'), status: 'CANCELLED' });
    const fourth = await meeting('Weekly 4', '2026-10-26 10:00', { recurrenceParentId: root.id, recurrenceStart: at('2026-10-26 10:00') });
    const oneOff = await meeting('One-off', '2026-10-14 09:00');
    expect(await store.previousInSeries(fourth.id)).toBe(second.id);
    expect(await store.previousInSeries(second.id)).toBe(root.id);
    expect(await store.previousInSeries(root.id)).toBeNull();
    expect(await store.previousInSeries(oneOff.id)).toBeNull();
    expect(await store.lastProjectMeetingBefore(projectId, at('2026-10-26 10:00'), fourth.id)).toBe(oneOff.id);
    expect(await store.lastProjectMeetingBefore(projectId, at('2026-10-13 00:00'))).toBe(second.id);
  });

  it('leftovers: open action items and unfinished agenda items', async () => {
    const m = await meeting('Review', '2026-10-12 10:00');
    for (const [description, status] of [['Order spare seals', 'OPEN'], ['Book the crane', 'IN_PROGRESS'], ['Sent the report', 'COMPLETED'], ['Dropped idea', 'CANCELLED']] as const) {
      await prisma.actionItem.create({ data: { meetingId: m.id, description, status, createdById: owner } });
    }
    await prisma.agendaItem.create({ data: { meetingId: m.id, title: 'Budget', position: 0, completed: true } });
    await prisma.agendaItem.create({ data: { meetingId: m.id, title: 'Valve spares', position: 1 } });
    const out = await store.leftovers(m.id);
    expect(out).toEqual([
      { title: 'Order spare seals', kind: 'action' },
      { title: 'Book the crane', kind: 'action' },
      { title: 'Valve spares', kind: 'agenda' },
    ]);
  });
});
