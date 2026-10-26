import type { PrismaClient } from '@prisma/client';
import type { TaskRecord } from '../tasks/task-repository';
import type { ClientMinutesFlags, ClientTaskFlags } from './client-view-routes';

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
        const r = await prisma.meetingMinutes.findUnique({ where: { meetingId }, select: { status: true, clientVisible: true } });
        return r ? { approved: r.status === 'APPROVED', clientVisible: r.clientVisible } : null;
      },
      async set(meetingId, visible) {
        // Shown only while approved: the condition is part of the write, so a reopen can't slip between.
        const { count } = await prisma.meetingMinutes.updateMany({ where: { meetingId, ...(visible ? { status: 'APPROVED' as const } : {}) }, data: { clientVisible: visible } });
        return visible ? count === 1 : true;
      },
    },
  };
}
