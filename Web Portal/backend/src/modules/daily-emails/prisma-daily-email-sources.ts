import { leafCounts } from '../tasks/checklist-tree';
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizePreferences } from '../notifications/notification-preferences';
import { waitsDays, type DailyMeeting, type DailyProjectFigures, type DailyTask, type DailyWeek } from './daily-email-content';
import type { DailyRecipient } from './daily-email-service';
import { liveProjectWhere } from '../companies/project-archive';
import { hasActiveCompany, sharedCompanyWhere } from '../companies/company-access';
import { managedProjectsWhere } from '../projects/project-managers';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';
import { healthReads } from '../project-health/prisma-health-source';
import { completionOf, type CompletionMode } from '../project-health/completion';
import { daysUntilDue, zonedDayKey } from '../../lib/due-date';

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  preferredTimeZone: true,
  weekStart: true,
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
  weekStart: u.weekStart ?? null,
  prefs: normalizePreferences(u.notificationPrefs),
  createdAt: u.createdAt,
});

const nameSelect = { firstName: true, lastName: true, username: true } as const;
const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

/**
 * The redesign (Nov 2026): which tasks count. A task in the Recycle Bin or merged into another carries
 * `deletedAt` and counts nowhere. WIRE AFTER MERGE (bulk + task archive): an archived OPEN task leaves
 * every list and figure (add `archivedAt: null` to OPEN_TASK and to the open side of COUNTED_TASK); an
 * archived DONE task still counts as done in the week's figures and the projects' bars (owner, 10 Nov).
 */
const OPEN_TASK = { deletedAt: null, completedAt: null, column: { category: { not: 'DONE' as const } } } satisfies Prisma.TaskWhereInput;
/** Tasks a figure counts, done or not (archived done ones too, once the archive exists). */
const COUNTED_TASK = { deletedAt: null } satisfies Prisma.TaskWhereInput;

/** The project as the email names it. */
const projectSelect = {
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
  // Companies: the main company heads the project's group when an email is grouped.
  mainCompany: { select: { id: true, name: true } },
  companies: { select: { company: { select: { id: true, name: true } } }, orderBy: { addedAt: 'asc' }, take: 1 },
} as const satisfies Prisma.ProjectSelect;
type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;
const toProject = (p: ProjectRow): DailyTask['project'] => ({
  id: p.id,
  code: p.code,
  name: p.name,
  number: p.number,
  clientName: p.clientName,
  managerName: p.manager ? [p.manager.firstName, p.manager.lastName].filter(Boolean).join(' ') || p.manager.username : null,
  status: p.status,
  color: p.color,
  imageUrl: p.imageUrl,
  targetDate: p.targetDate,
  company: p.mainCompany ?? p.companies[0]?.company ?? null,
});

const taskSelect = {
  id: true,
  key: true,
  title: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  approvalRequestedAt: true,
  startDate: true,
  // The redesign: the day it is on the board — a later day means it waits for that day (Coming up).
  boardDate: true,
  // 1.23.3: the live items; the count is of the real to-do items (no sub-items).
  checklist: { where: { deletedAt: null }, select: { id: true, parentId: true, done: true } },
  dependencies: { select: { dependsOn: { select: { completedAt: true, deletedAt: true, column: { select: { category: true } } } } } },
  project: { select: projectSelect },
  // The redesign: its column's kind (in progress or not started) as well as its name.
  column: { select: { name: true, category: true } },
} as const satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

const toTask = (t: TaskRow): DailyTask => ({
  id: t.id,
  key: t.key,
  title: t.title,
  project: toProject(t.project),
  priority: t.priority,
  dueDate: t.dueDate,
  statusLabel: t.column.name,
  statusKind: t.column.category,
  completedAt: t.completedAt,
  waitingSince: t.approvalRequestedAt,
  startDate: t.startDate,
  boardDate: t.boardDate,
  checklist: t.checklist.length ? leafCounts(t.checklist) : null,
  // Blocked: a task it depends on isn't done yet.
  blocked: t.dependencies.some((d) => !d.dependsOn.deletedAt && !d.dependsOn.completedAt && d.dependsOn.column.category !== 'DONE'),
  // WIRE AFTER MERGE (guests + categories): `categories` [{ name, color }] and `guests` ["Name (Company)"].
});

/**
 * At most this many projects read for Your projects (the email shows the first few, most in need first;
 * the read is by name, so the cap is well above what anyone runs).
 */
const PROJECTS_AT_MOST = 300;

/** At most this many meetings in one person's day. */
const MEETINGS_A_DAY = 60;

/**
 * Who gets the daily email, and what is in it: the person's own tasks, their day's meetings and, for
 * people who run a project, its overdue and waiting tasks. Always within their companies, and never
 * archived projects. ("Show my projects only" doesn't apply to emails: lane S's ruling.)
 */
export function createPrismaDailyEmailSources(prisma: PrismaClient) {
  // 1.23: client accounts never get the morning emails.
  const active = { status: 'ACTIVE', deletedAt: null, ...STAFF_ONLY_WHERE } as const;
  // Asked several times while one person's email is built: kept for a few seconds (review: once per build).
  const adminCache = new Map<string, { at: number; admin: Promise<boolean> }>();
  const isAdmin = (userId: string): Promise<boolean> => {
    const hit = adminCache.get(userId);
    if (hit && Date.now() - hit.at < 5_000) return hit.admin;
    const admin = prisma.userRole.count({ where: { userId, role: { name: 'ADMIN' } } }).then((n) => n > 0);
    adminCache.set(userId, { at: Date.now(), admin });
    if (adminCache.size > 500) adminCache.clear();
    return admin;
  };
  /**
   * Companies: someone who isn't an administrator only hears of tasks in projects that share an active
   * company with them (losing a company takes its tasks out of the next email). Administrators: as before.
   */
  const companyScope = async (userId: string): Promise<Prisma.ProjectWhereInput> => ((await isAdmin(userId)) ? {} : sharedCompanyWhere(userId));
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
            ...OPEN_TASK,
            assignees: { some: { userId } },
            // companies: archived by its own status or by all its companies (liveProjectWhere), and in the person's company scope.
            project: liveProjectWhere({ deletedAt: null, status: { not: 'COMPLETED' }, AND: [await companyScope(userId)] }),
          },
          select: taskSelect,
          take: 500,
        });
        return rows.map(toTask);
      },
      /** Assigned to them and completed in [from, to), whoever completed them — never in an archived project. */
      async completedBetween(userId: string, from: Date, to: Date): Promise<DailyTask[]> {
        const rows = await prisma.task.findMany({
          where: { deletedAt: null, assignees: { some: { userId } }, completedAt: { gte: from, lt: to }, project: liveProjectWhere({ deletedAt: null, AND: [await companyScope(userId)] }) },
          select: taskSelect,
          orderBy: { completedAt: 'asc' },
          take: 500,
        });
        return rows.map(toTask);
      },

      /**
       * 1.22: their meetings starting in [from, to) — they organize it, or are invited and haven't
       * declined; scheduled, under way or finished (not drafts, not cancelled); never in an archived
       * project or a closed company. A meeting of another company's project they are invited to is
       * theirs too (as a guest). Archived means no access: no active company of their own, none.
       */
      async meetingsBetween(userId: string, from: Date, to: Date): Promise<DailyMeeting[]> {
        if (!(await isAdmin(userId)) && !(await hasActiveCompany(prisma, userId))) return [];
        const rows = await prisma.meeting.findMany({
          where: {
            deletedAt: null,
            status: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] },
            startAt: { gte: from, lt: to },
            OR: [{ organizerId: userId }, { attendees: { some: { userId, response: { not: 'DECLINED' } } } }],
            AND: [{ OR: [{ companyId: null }, { company: { status: 'ACTIVE' } }] }],
          },
          select: { id: true, title: true, startAt: true, endAt: true, location: true, onlineLink: true, status: true, projectId: true, organizerId: true, attendees: { where: { userId }, select: { response: true }, take: 1 } },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
          take: MEETINGS_A_DAY,
        });
        const projectIds = [...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id))];
        const live = projectIds.length ? await prisma.project.findMany({ where: liveProjectWhere({ id: { in: projectIds }, deletedAt: null }), select: { id: true, name: true } }) : [];
        const names = new Map(live.map((p) => [p.id, p.name] as const));
        return rows
          .filter((r) => !r.projectId || names.has(r.projectId))
          .map((r) => {
            const organizer = r.organizerId === userId;
            return {
              id: r.id,
              title: r.title,
              startAt: r.startAt,
              endAt: r.endAt,
              location: r.location?.trim() || null,
              online: Boolean(r.onlineLink?.trim()),
              projectName: r.projectId ? names.get(r.projectId)! : null,
              organizer,
              response: organizer ? null : (r.attendees[0]?.response ?? null),
              status: r.status,
            };
          });
      },

      /**
       * 1.22: not-done tasks of the projects they run (owner, named manager or MANAGER member), in their
       * companies and not archived, assigned to others (theirs are in their own parts), that wait for
       * approval or are due by tomorrow (the email keeps the overdue ones in their time zone) — with
       * who they are assigned to.
       */
      async managed(userId: string, now: Date): Promise<DailyTask[]> {
        const rows = await prisma.task.findMany({
          where: {
            ...OPEN_TASK,
            assignees: { none: { userId } },
            project: liveProjectWhere({ deletedAt: null, status: { not: 'COMPLETED' }, AND: [managedProjectsWhere(userId), await companyScope(userId)] }),
            OR: [{ approvalRequestedAt: { not: null } }, { dueDate: { lt: new Date(now.getTime() + 864e5) } }],
          },
          select: { ...taskSelect, assignees: { select: { user: { select: nameSelect } } } },
          orderBy: [{ dueDate: 'asc' }, { key: 'asc' }],
          take: 200,
        });
        return rows.map((r) => ({ ...toTask(r), assignees: r.assignees.map((a) => nameOf(a.user)) }));
      },

      /**
       * The redesign: the person's week — their tasks due in [dueFrom, dueTo), done or not (a Done column
       * or a completion), and when their tasks were completed in [doneFrom, now]. Within their companies,
       * never archived projects (as Completed yesterday).
       */
      async weekFigures(userId: string, r: { dueFrom: Date; dueTo: Date; doneFrom: Date; now: Date }): Promise<DailyWeek> {
        const project = liveProjectWhere({ deletedAt: null, AND: [await companyScope(userId)] });
        const mine = { ...COUNTED_TASK, assignees: { some: { userId } }, project };
        const [due, done] = await Promise.all([
          prisma.task.findMany({
            // An open task of a completed project is in no list: left out (its done ones still count).
            where: { ...mine, dueDate: { gte: r.dueFrom, lt: r.dueTo }, OR: [{ project: { status: { not: 'COMPLETED' } } }, { completedAt: { not: null } }, { column: { category: 'DONE' } }] },
            select: { dueDate: true, completedAt: true, column: { select: { category: true } } },
            take: 2000,
          }),
          prisma.task.findMany({ where: { ...mine, completedAt: { gte: r.doneFrom, lte: r.now } }, select: { completedAt: true }, take: 5000 }),
        ]);
        return {
          due: due.map((t) => ({ dueDate: t.dueDate!, done: t.completedAt !== null || t.column.category === 'DONE' })),
          completions: done.map((t) => t.completedAt!),
        };
      },

      /**
       * The redesign, Your projects: the projects the person runs (owner, named manager or MANAGER member)
       * — administrators too, only theirs, never the whole site — still going (not completed or archived),
       * within their companies (a project they run in a company they left is not theirs to see). Each with
       * its completion as the Projects page counts it (its own mode: tasks or weight), its open tasks, those
       * overdue by the person's day (not waiting for approval or for a later start day), and those waiting
       * for approval.
       */
      async projectFigures(userId: string, o: { now: Date; timeZone: string; companyTimeZone?: string }): Promise<DailyProjectFigures[]> {
        const projects = await prisma.project.findMany({
          where: liveProjectWhere({ deletedAt: null, status: { not: 'COMPLETED' }, AND: [managedProjectsWhere(userId), await companyScope(userId)] }),
          select: { ...projectSelect, completionMode: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: PROJECTS_AT_MOST,
        });
        if (projects.length === 0) return [];
        const ids = projects.map((p) => p.id);
        const [figures, open, waiting, maybeLate] = await Promise.all([
          healthReads(prisma).figures(ids),
          prisma.task.groupBy({ by: ['projectId'], where: { ...OPEN_TASK, projectId: { in: ids } }, _count: { _all: true } }),
          prisma.task.groupBy({ by: ['projectId'], where: { ...OPEN_TASK, approvalRequestedAt: { not: null }, projectId: { in: ids } }, _count: { _all: true } }),
          // Due by tomorrow at the latest (a day either side of any time zone); the person's day decides.
          prisma.task.findMany({
            where: { ...OPEN_TASK, approvalRequestedAt: null, projectId: { in: ids }, dueDate: { lt: new Date(o.now.getTime() + 864e5) } },
            select: { projectId: true, dueDate: true, boardDate: true },
            take: 20000,
          }),
        ]);
        // Board days are the company's days: a task waits for a later one by the company's today.
        const companyToday = zonedDayKey(o.now, o.companyTimeZone ?? o.timeZone);
        const count = (rows: Array<{ projectId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.projectId, r._count._all] as const));
        const openOf = count(open);
        const waitingOf = count(waiting);
        const lateOf = new Map<string, number>();
        for (const t of maybeLate) {
          // Waiting for a later start day: not today's work, so not late today.
          if (waitsDays(t.boardDate, companyToday) > 0) continue;
          if ((daysUntilDue(t.dueDate, o.timeZone, o.now) ?? 0) < 0) lateOf.set(t.projectId, (lateOf.get(t.projectId) ?? 0) + 1);
        }
        const figuresOf = new Map(figures.map((f) => [f.projectId, f] as const));
        return projects.map((p) => {
          const f = figuresOf.get(p.id);
          const n = { total: Number(f?.total ?? 0), done: Number(f?.done ?? 0), weightTotal: Number(f?.weightTotal ?? 0), weightDone: Number(f?.weightDone ?? 0) };
          return {
            project: toProject(p),
            pct: completionOf(n, p.completionMode as CompletionMode).pct,
            done: n.done,
            total: n.total,
            open: openOf.get(p.id) ?? 0,
            overdue: lateOf.get(p.id) ?? 0,
            waiting: waitingOf.get(p.id) ?? 0,
          };
        });
      },
    },
  };
}
