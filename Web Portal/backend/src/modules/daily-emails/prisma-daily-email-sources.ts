import { leafCounts } from '../tasks/checklist-tree';
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizePreferences } from '../notifications/notification-preferences';
import type { DailyMeeting, DailyTask } from './daily-email-content';
import type { DailyRecipient } from './daily-email-service';
import { liveProjectWhere } from '../companies/project-archive';
import { hasActiveCompany, sharedCompanyWhere } from '../companies/company-access';
import { managedProjectsWhere } from '../projects/project-managers';
import { buildTaskTimeline as buildTimeline } from '../activity/task-history-extra';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';

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

const nameSelect = { firstName: true, lastName: true, username: true } as const;
const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

/**
 * Not "the latest update" line: comments are read as comments, and blocker changes may name a task the
 * person can't see (the "Blocked" mark says enough).
 */
// Duplicate Task: "duplicated from / as" lines name another task (maybe in a project the reader can't open), as
// blocker lines do — never the email's latest update (review I1).
const NOT_AN_UPDATE = ['COMMENTED', 'comment.added', 'BLOCKER_ADDED', 'BLOCKER_REMOVED', 'DUPLICATED', 'DUPLICATED_FROM'];

const taskSelect = {
  id: true,
  key: true,
  title: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  approvalRequestedAt: true,
  // 1.22: the card's details.
  description: true,
  startDate: true,
  // Tasks scheduled for the future: a later day's board means it is "Coming up".
  boardDate: true,
  // 1.23.3: the live items; the count is of the real to-do items (no sub-items).
  checklist: { where: { deletedAt: null }, select: { id: true, parentId: true, done: true } },
  comments: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, createdAt: true, user: { select: nameSelect } } },
  activities: { where: { action: { notIn: NOT_AN_UPDATE } }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, action: true, meta: true, createdAt: true, user: { select: nameSelect } } },
  dependencies: { select: { dependsOn: { select: { completedAt: true, deletedAt: true, column: { select: { category: true } } } } } },
  // 1.24: its guests (name and company only) and categories.
  externalContacts: { select: { name: true, company: true }, orderBy: { position: 'asc' } },
  categories: { select: { category: { select: { name: true, position: true } } } },
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
      // Companies: the main company heads the project's section when an email is grouped.
      mainCompany: { select: { id: true, name: true } },
      companies: { select: { company: { select: { id: true, name: true } } }, orderBy: { addedAt: 'asc' }, take: 1 },
    },
  },
  column: { select: { name: true } },
} as const satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

/** The newest comment or change, whichever is newer, as one line ("Sara Ali: “…”", "Omar moved this task (To Do → Done)"). */
function latestOf(t: TaskRow): DailyTask['latest'] {
  const c = t.comments[0];
  const comment = c ? { text: `${nameOf(c.user)}: “${c.body.slice(0, 400).replace(/\s+/g, ' ').trim()}”`, at: c.createdAt } : null;
  const a = t.activities[0];
  const item = a ? buildTimeline([{ id: a.id, action: a.action, actorName: nameOf(a.user), createdAt: a.createdAt.toISOString(), meta: (a.meta as Record<string, unknown> | null) ?? null }])[0] : undefined;
  const change = a && item ? { text: `${item.actorName} ${item.text}${item.path ? ` (${item.path.join(' → ')})` : ''}`, at: a.createdAt } : null;
  if (comment && change) return comment.at >= change.at ? comment : change;
  return comment ?? change;
}

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
    company: t.project.mainCompany ?? t.project.companies[0]?.company ?? null,
  },
  priority: t.priority,
  dueDate: t.dueDate,
  statusLabel: t.column.name,
  completedAt: t.completedAt,
  waitingSince: t.approvalRequestedAt,
  description: t.description,
  startDate: t.startDate,
  // Board days are noon-UTC anchors: their UTC date is the day.
  boardDay: t.boardDate ? t.boardDate.toISOString().slice(0, 10) : null,
  checklist: t.checklist.length ? leafCounts(t.checklist) : null,
  latest: latestOf(t),
  // Blocked: a task it depends on isn't done yet.
  blocked: t.dependencies.some((d) => !d.dependsOn.deletedAt && !d.dependsOn.completedAt && d.dependsOn.column.category !== 'DONE'),
  guests: t.externalContacts.map((g) => ({ name: g.name, company: g.company })),
  categories: t.categories.map((c) => c.category).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'en')).map((c) => c.name),
});

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
  const isAdmin = async (userId: string) => (await prisma.userRole.count({ where: { userId, role: { name: 'ADMIN' } } })) > 0;
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
            deletedAt: null,
            completedAt: null,
            assignees: { some: { userId } },
            column: { category: { not: 'DONE' } },
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
            deletedAt: null,
            completedAt: null,
            column: { category: { not: 'DONE' } },
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
    },
  };
}
