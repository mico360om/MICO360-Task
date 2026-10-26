import type { PrismaClient } from '@prisma/client';
import type { TaskRecord } from '../tasks/task-repository';
import type { ClientMinutesFlags, ClientTaskFlags } from './client-view-routes';
import { peopleNames, readMinutesContent } from './client-view-source';

/** The "Show to client" switches on tasks and on approved final minutes, in the database. */
export function createPrismaClientFlags(prisma: PrismaClient, getTask: (taskId: string) => Promise<TaskRecord>): { tasks: ClientTaskFlags; minutes: ClientMinutesFlags } {
  return {
    tasks: {
      async projectOf(taskId) {
        const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } }, select: { projectId: true } });
        return t?.projectId ?? null;
      },
      async setClientVisible(taskId, visible) {
        // A switch, not an edit: the task's version (what edits are checked against) stays as it is.
        const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { clientVisible: true } });
        if (before.clientVisible !== visible) await prisma.task.updateMany({ where: { id: taskId, deletedAt: null }, data: { clientVisible: visible } });
        return { before: before.clientVisible, task: await getTask(taskId) };
      },
    },
    minutes: {
      async projectOf(meetingId) {
        const m = await prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, select: { projectId: true } });
        return m ? m.projectId : undefined;
      },
      async state(meetingId) {
        const r = await prisma.meetingMinutes.findUnique({ where: { meetingId }, select: { status: true, clientVisible: true, clientShowRisks: true } });
        return r ? { approved: r.status === 'APPROVED', clientVisible: r.clientVisible, includeRisks: r.clientVisible && r.clientShowRisks } : null;
      },
      async set(meetingId, visible, opts) {
        if (!visible) {
          await prisma.meetingMinutes.updateMany({ where: { meetingId }, data: { clientVisible: false, clientVisibleProjectId: null, clientShowRisks: false } });
          return true;
        }
        // Shown only while approved and only for the project the meeting is filed under now: both are
        // part of the write, so a reopen or a move can't slip between.
        return prisma.$transaction(async (tx) => {
          const m = await tx.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, select: { projectId: true } });
          if (!m?.projectId) return false;
          const { count } = await tx.meetingMinutes.updateMany({
            where: { meetingId, status: 'APPROVED', meeting: { projectId: m.projectId } },
            data: { clientVisible: true, clientVisibleProjectId: m.projectId, clientShowRisks: opts.includeRisks },
          });
          return count === 1;
        });
      },
      async preview(meetingId) {
        const r = await prisma.meetingMinutes.findFirst({ where: { meetingId, status: 'APPROVED', meeting: { deletedAt: null } }, select: { content: true, meeting: { select: { projectId: true } } } });
        if (!r) return null;
        const names = (await peopleNames(prisma, r.meeting.projectId, [meetingId])).get(meetingId) ?? [];
        return { content: readMinutesContent(r.content), names };
      },
    },
  };
}
