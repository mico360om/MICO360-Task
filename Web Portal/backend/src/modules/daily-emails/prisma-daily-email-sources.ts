import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizePreferences } from '../notifications/notification-preferences';
import type { DailyTask } from './daily-email-content';
import type { DailyRecipient } from './daily-email-service';

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  preferredTimeZone: true,
  notificationPrefs: true,
  createdAt: true,
} as const;

type PersonRow = Prisma.UserGetPayload<{ select: typeof personSelect }>;
const toRecipient = (u: PersonRow): DailyRecipient => ({
  id: u.id,
  name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
  username: u.username,
  email: u.email || null,
  timeZone: u.preferredTimeZone ?? null,
  prefs: normalizePreferences(u.notificationPrefs),
  createdAt: u.createdAt,
});

const taskSelect = {
  id: true,
  key: true,
  title: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  project: {
    select: {
      id: true,
      code: true,
      name: true,
      number: true,
      clientName: true,
      status: true,
      color: true,
      imageUrl: true,
      targetDate: true,
      manager: { select: { firstName: true, lastName: true, username: true } },
    },
  },
  column: { select: { name: true } },
} as const;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
const toTask = (t: TaskRow): DailyTask => ({
  id: t.id,
  key: t.key,
  title: t.title,
  project: {
    id: t.project.id,
    code: t.project.code,
    name: t.project.name,
    number: t.project.number,
    clientName: t.project.clientName,
    managerName: t.project.manager ? [t.project.manager.firstName, t.project.manager.lastName].filter(Boolean).join(' ') || t.project.manager.username : null,
    status: t.project.status,
    color: t.project.color,
    imageUrl: t.project.imageUrl,
    targetDate: t.project.targetDate,
  },
  priority: t.priority,
  dueDate: t.dueDate,
  statusLabel: t.column.name,
  completedAt: t.completedAt,
});

/** Who gets the morning emails, and their tasks — always only tasks assigned to that person. */
export function createPrismaDailyEmailSources(prisma: PrismaClient) {
  const active = { status: 'ACTIVE', deletedAt: null } as const;
  return {
    people: {
      async list(): Promise<DailyRecipient[]> {
        return (await prisma.user.findMany({ where: active, select: personSelect })).map(toRecipient);
      },
      async find(id: string): Promise<DailyRecipient | null> {
        const u = await prisma.user.findFirst({ where: { id, ...active }, select: personSelect });
        return u ? toRecipient(u) : null;
      },
    },
    tasks: {
      /** Assigned to them and not done, in projects still going (not finished or archived). */
      async pending(userId: string): Promise<DailyTask[]> {
        const rows = await prisma.task.findMany({
          where: {
            deletedAt: null,
            completedAt: null,
            assignees: { some: { userId } },
            column: { category: { not: 'DONE' } },
            project: { deletedAt: null, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
          },
          select: taskSelect,
          take: 500,
        });
        return rows.map(toTask);
      },
      /** Assigned to them and completed in [from, to), whoever completed them. */
      async completedBetween(userId: string, from: Date, to: Date): Promise<DailyTask[]> {
        const rows = await prisma.task.findMany({
          where: { deletedAt: null, assignees: { some: { userId } }, completedAt: { gte: from, lt: to } },
          select: taskSelect,
          orderBy: { completedAt: 'asc' },
          take: 500,
        });
        return rows.map(toTask);
      },
    },
  };
}
