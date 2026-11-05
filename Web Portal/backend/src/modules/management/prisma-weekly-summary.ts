import { Prisma, type PrismaClient, type WeeklySummaryEmail } from '@prisma/client';
import { normalizePreferences } from '../notifications/notification-preferences';
import type { WeeklyRecipient } from './weekly-summary-service';
import type { WeeklySummaryRecord, WeeklySummaryRepository } from './weekly-summary-repository';
import { visibleProjectWhere } from '../companies/company-access';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';

const toRecord = (r: WeeklySummaryEmail): WeeklySummaryRecord => ({
  id: r.id,
  userId: r.userId,
  week: r.week,
  status: r.status,
  attempts: r.attempts,
  projectCount: r.projectCount,
  nextAttemptAt: r.nextAttemptAt,
  lastError: r.lastError,
  sentAt: r.sentAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** The weekly summary's records: one per person and week (a unique key), retried as the daily emails are. */
export function createPrismaWeeklySummaryRepository(prisma: PrismaClient): WeeklySummaryRepository {
  return {
    async claim(userId, week) {
      try {
        return toRecord(await prisma.weeklySummaryEmail.create({ data: { userId, week, status: 'SENDING', attempts: 1 } }));
      } catch (err) {
        // The unique (person, week) row exists: it was sent, or another sweep is sending it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
        throw err;
      }
    },
    async forWeeks(weeks) {
      if (weeks.length === 0) return [];
      return (await prisma.weeklySummaryEmail.findMany({ where: { week: { in: weeks } } })).map(toRecord);
    },
    async dueForRetry(now, staleBefore) {
      const rows = await prisma.weeklySummaryEmail.findMany({
        where: { OR: [{ status: 'RETRY', nextAttemptAt: { lte: now } }, { status: 'SENDING', updatedAt: { lt: staleBefore } }] },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      return rows.map(toRecord);
    },
    async retake(row) {
      const { count } = await prisma.weeklySummaryEmail.updateMany({
        where: { id: row.id, status: row.status, attempts: row.attempts },
        data: { status: 'SENDING', attempts: row.attempts + 1, nextAttemptAt: null },
      });
      if (count !== 1) return null;
      const taken = await prisma.weeklySummaryEmail.findUnique({ where: { id: row.id } });
      return taken ? toRecord(taken) : null;
    },
    async finish(taken, patch) {
      const { count } = await prisma.weeklySummaryEmail.updateMany({
        where: { id: taken.id, status: 'SENDING', attempts: taken.attempts },
        data: {
          status: patch.status,
          ...(patch.projectCount !== undefined ? { projectCount: patch.projectCount } : {}),
          ...(patch.nextAttemptAt !== undefined ? { nextAttemptAt: patch.nextAttemptAt } : {}),
          ...(patch.lastError !== undefined ? { lastError: patch.lastError?.slice(0, 2000) ?? null } : {}),
          ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt } : {}),
        },
      });
      return count === 1;
    },
  };
}

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  preferredTimeZone: true,
  notificationPrefs: true,
  createdAt: true,
  roles: { select: { role: { select: { name: true } } } },
} as const;
type PersonRow = Prisma.UserGetPayload<{ select: typeof personSelect }>;

/** Who may get the weekly summary: active staff, with their roles and whether they run a live project. */
export function createPrismaWeeklySummaryPeople(prisma: PrismaClient) {
  // 1.23: client accounts never get the weekly summary.
  const active = { status: 'ACTIVE', deletedAt: null, ...STAFF_ONLY_WHERE } as const;
  /**
   * Of these people, those who run a live project (owner, named manager or a MANAGER member) that
   * they can see: one of its active companies is theirs (companies: the managedVisibleWhere rule).
   */
  async function runners(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const projects = await prisma.project.findMany({
      where: { deletedAt: null, OR: [{ ownerId: { in: ids } }, { managerId: { in: ids } }, { members: { some: { userId: { in: ids }, role: 'MANAGER' } } }] },
      select: {
        ownerId: true,
        managerId: true,
        members: { where: { role: 'MANAGER', userId: { in: ids } }, select: { userId: true } },
        companies: { where: { company: { status: 'ACTIVE' } }, select: { company: { select: { members: { where: { userId: { in: ids } }, select: { userId: true } } } } } },
      },
    });
    return new Set(
      projects.flatMap((p) => {
        const sharing = new Set(p.companies.flatMap((c) => c.company.members.map((m) => m.userId)));
        return [p.ownerId, p.managerId, ...p.members.map((m) => m.userId)].filter((id): id is string => !!id && sharing.has(id));
      }),
    );
  }
  const toRecipient = (u: PersonRow, runs: Set<string>): WeeklyRecipient => ({
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username,
    email: u.email || null,
    timeZone: u.preferredTimeZone ?? null,
    prefs: normalizePreferences(u.notificationPrefs),
    createdAt: u.createdAt,
    roles: u.roles.map((r) => r.role.name),
    runsProjects: runs.has(u.id),
  });
  return {
    async list(): Promise<WeeklyRecipient[]> {
      const users = await prisma.user.findMany({ where: active, select: personSelect });
      const runs = await runners(users.map((u) => u.id));
      return users.map((u) => toRecipient(u, runs));
    },
    async find(id: string): Promise<WeeklyRecipient | null> {
      const u = await prisma.user.findFirst({ where: { id, ...active }, select: personSelect });
      return u ? toRecipient(u, await runners([u.id])) : null;
    },
  };
}

/**
 * Companies (MC1 Task 16): the projects a person may see (administrators: every project), grouped by
 * main company (a project with none recorded: its first company), companies in name order. The
 * weekly summary gives each company of these with figures in it a section of its own.
 */
export function createPrismaCompanyGroups(prisma: PrismaClient) {
  return async (viewer: { id: string; roles: string[] }): Promise<Array<{ company: { id: string; name: string }; projectIds: string[] }>> => {
    const rows = await prisma.project.findMany({
      where: viewer.roles.includes('ADMIN') ? { deletedAt: null } : visibleProjectWhere(viewer.id),
      select: {
        id: true,
        mainCompany: { select: { id: true, name: true } },
        companies: { select: { company: { select: { id: true, name: true } } }, orderBy: { addedAt: 'asc' }, take: 1 },
      },
    });
    const groups = new Map<string, { company: { id: string; name: string }; projectIds: string[] }>();
    for (const p of rows) {
      const company = p.mainCompany ?? p.companies[0]?.company;
      if (!company) continue;
      const g = groups.get(company.id) ?? { company, projectIds: [] };
      g.projectIds.push(p.id);
      groups.set(company.id, g);
    }
    const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    return [...groups.values()].sort((a, b) => byName.compare(a.company.name, b.company.name));
  };
}
