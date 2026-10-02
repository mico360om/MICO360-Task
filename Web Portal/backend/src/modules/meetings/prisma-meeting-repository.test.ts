import { describe, it, expect } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createPrismaMeetingRepository } from './prisma-meeting-repository';
import { createPrismaActionItemRepository } from './prisma-action-item-repository';
import { createPrismaNoteRepository } from './prisma-note-repository';

/** A Prisma stand-in that records every call and answers with canned rows. */
function recorder(answers: Record<string, unknown> = {}) {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => async (args: Record<string, unknown>) => {
        calls.push({ op: `${name}.${op}`, args });
        return answers[`${name}.${op}`] ?? {};
      },
    });
  const prisma = { meeting: model('meeting'), actionItem: model('actionItem'), meetingNote: model('meetingNote') } as unknown as PrismaClient;
  return { prisma, calls };
}

const meetingRow = {
  id: 'm1', title: 'Weekly', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'u1',
  location: null, onlineLink: null, startAt: new Date(), endAt: null, timeZone: 'Asia/Muscat', recurrenceRule: null,
  recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
  createdById: 'u1', createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
};

describe('Prisma meeting repository', () => {
  it('clears a recurrence rule with DbNull, and leaves it alone when not given (MTG-09)', async () => {
    const { prisma, calls } = recorder({ 'meeting.update': meetingRow });
    const repo = createPrismaMeetingRepository(prisma);
    await repo.update('m1', { recurrenceRule: null });
    await repo.update('m1', { title: 'Renamed' });
    expect((calls[0]!.args.data as Record<string, unknown>).recurrenceRule).toBe(Prisma.DbNull);
    expect(calls[1]!.args.data).not.toHaveProperty('recurrenceRule');
  });

  it('filters "organized by me" on the organizer column (WEB-19)', async () => {
    const { prisma, calls } = recorder({ 'meeting.findMany': [] });
    await createPrismaMeetingRepository(prisma).list({ organizerId: 'u5', scope: { userId: 'u5', projectIds: [] } });
    expect(calls[0]!.args.where).toMatchObject({ deletedAt: null, organizerId: 'u5' });
  });

  it('can clear the reminder marker', async () => {
    const { prisma, calls } = recorder();
    await createPrismaMeetingRepository(prisma).markReminderSent('m1', null);
    expect(calls[0]!.args).toEqual({ where: { id: 'm1' }, data: { reminderSentAt: null } });
  });
});

describe('Prisma action item repository', () => {
  it('leaves items of deleted meetings out of "My Action Items" (MTG-05)', async () => {
    const { prisma, calls } = recorder({ 'actionItem.findMany': [] });
    await createPrismaActionItemRepository(prisma).listForAssignee('u2', { openOnly: true });
    expect(calls[0]!.args.where).toEqual({
      assigneeId: 'u2',
      OR: [{ meetingId: null }, { meeting: { is: { deletedAt: null } } }],
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
    });
  });
});

describe('Prisma note repository', () => {
  it('claims a note for task conversion only while it has no task (MTG-04)', async () => {
    const free = recorder({ 'meetingNote.updateMany': { count: 1 } });
    expect(await createPrismaNoteRepository(free.prisma).claimTask('n1', 'pending:x')).toBe(true);
    expect(free.calls[0]!.args).toEqual({ where: { id: 'n1', taskId: null, deletedAt: null }, data: { taskId: 'pending:x' } });
    const taken = recorder({ 'meetingNote.updateMany': { count: 0 } });
    expect(await createPrismaNoteRepository(taken.prisma).claimTask('n1', 'pending:y')).toBe(false);
  });
});
