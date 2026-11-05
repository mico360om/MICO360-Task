import type { Prisma, PrismaClient } from '@prisma/client';
import { CompanyNotAvailableError } from './company-pick';

/**
 * Companies: the query pieces every project and people query is built from, and the access service.
 *
 * A non-admin sees a project when it is not deleted, today's team rule holds (owner, named manager or
 * team member) AND it belongs to an ACTIVE company the person belongs to. Admins see every project —
 * and, 1.22, an administrator who turned on "Show my projects only" LISTS like a team member: the
 * projects they own, manage or are on the team of (no company condition), still opening any by its link.
 * Nothing here is cached: membership and project companies are read inside each query, so a change
 * takes effect on the next request.
 */

/** A signed-in person as a request knows them. */
export interface Viewer {
  id: string;
  roles: string[];
}

export const isAdminRoles = (roles: readonly string[]): boolean => roles.includes('ADMIN');

/** Today's team rule: the owner, the named manager, or a team member. */
export function teamWhere(userId: string): Prisma.ProjectWhereInput {
  return { OR: [{ ownerId: userId }, { managerId: userId }, { members: { some: { userId } } }] };
}

/** The project belongs to an active company the person belongs to. */
export function sharedCompanyWhere(userId: string): Prisma.ProjectWhereInput {
  return { companies: { some: { company: { status: 'ACTIVE', members: { some: { userId } } } } } };
}

/** The projects a non-admin may see: not deleted, on its team, and inside one of their active companies. */
export function visibleProjectWhere(userId: string): Prisma.ProjectWhereInput {
  return { deletedAt: null, AND: [teamWhere(userId), sharedCompanyWhere(userId)] };
}

/** The project belongs to this company (any status). */
export function inCompanyWhere(companyId: string): Prisma.ProjectWhereInput {
  return { companies: { some: { companyId } } };
}

/**
 * A non-admin's pick: the project belongs to that company, and it is one of the person's own active
 * companies — so a stale or foreign pick matches nothing instead of widening.
 */
export function pickedCompanyWhere(userId: string, companyId: string): Prisma.ProjectWhereInput {
  return { companies: { some: { companyId, company: { status: 'ACTIVE', members: { some: { userId } } } } } };
}

/** People who belong to an active company of this project (with the team rule: who may see it). */
export function sharesProjectCompanyWhere(projectId: string): Prisma.UserWhereInput {
  return { companies: { some: { company: { status: 'ACTIVE', projects: { some: { projectId } } } } } };
}

/**
 * A live project: its own status isn't ARCHIVED and at least one of its companies is active — the
 * opposite of isProjectArchived, so a project with no company (never on a migrated site) isn't
 * archived by companies either (companies: the one rule, see project-archive.ts).
 */
export const LIVE_PROJECT_WHERE: Prisma.ProjectWhereInput = {
  status: { not: 'ARCHIVED' },
  OR: [{ companies: { none: {} } }, { companies: { some: { company: { status: 'ACTIVE' } } } }],
};

/**
 * The person belongs to at least one ACTIVE company. Owner, 3 Nov 2026: "archived means no access" —
 * someone whose companies are all archived sees nothing of the meetings they are one of the people of
 * (the invitation exception needs an active company of their own). Admins are checked by the callers.
 */
export async function hasActiveCompany(db: Pick<PrismaClient, 'companyMember'>, userId: string): Promise<boolean> {
  return (await db.companyMember.count({ where: { userId, company: { status: 'ACTIVE' } } })) > 0;
}

/**
 * 1.22 "Show my projects only" (an administrator's own setting, users.myProjectsOnly): is it on? Read
 * on every call, never cached, like the rest of access. Only administrators' lists change with it —
 * see CompanyAccess.myProjectsOnly.
 */
export async function readMyProjectsOnly(db: Pick<PrismaClient, 'user'>, userId: string): Promise<boolean> {
  return (await db.user.findUnique({ where: { id: userId }, select: { myProjectsOnly: true } }))?.myProjectsOnly === true;
}

/** People who share an active company with the viewer (the viewer included; callers leave them out). */
export function colleagueWhere(viewerId: string): Prisma.UserWhereInput {
  return { companies: { some: { company: { status: 'ACTIVE', members: { some: { userId: viewerId } } } } } };
}

type CompanyDb = Pick<PrismaClient, 'company' | 'companyMember'>;

/** The one active company, when the site has exactly one (else null: there is a choice to make). */
export async function onlyActiveCompanyId(db: CompanyDb): Promise<string | null> {
  const active = await db.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, take: 2 });
  return active.length === 1 ? active[0]!.id : null;
}

/**
 * A person's default company when nothing names one: their primary company (while it is active and
 * they belong to it), else the site's only active company, else none. A meeting without a project
 * uses it for its organizer (Ruling 11; new projects and people get theirs from the companies rules).
 */
export async function fallbackProjectCompanyId(db: CompanyDb, creatorId: string): Promise<string | null> {
  const primary = await db.companyMember.findFirst({
    where: { userId: creatorId, company: { status: 'ACTIVE', primaryOf: { some: { id: creatorId } } } },
    select: { companyId: true },
  });
  return primary?.companyId ?? onlyActiveCompanyId(db);
}

/**
 * CompanyAccess.meetingView for many meetings at once (1.23 search): the same rule — not one of its
 * people: null; none of their own companies active: null; no project: 'full'; a project sharing an
 * active company with them: 'full', else 'invitee'; administrators 'full' — read with two queries
 * instead of one per meeting. tests/integration/search-scope.test.ts checks it against meetingView.
 */
export async function meetingViewsOf(
  db: Pick<PrismaClient, 'companyMember' | 'projectCompany'>,
  viewer: Viewer,
  meetings: readonly { id: string; projectId: string | null; organizerId: string; createdById: string; attendeeUserIds: readonly string[] }[],
): Promise<Map<string, 'full' | 'invitee' | null>> {
  const out = new Map<string, 'full' | 'invitee' | null>();
  if (isAdminRoles(viewer.roles)) {
    for (const m of meetings) out.set(m.id, 'full');
    return out;
  }
  const own = meetings.filter((m) => m.organizerId === viewer.id || m.createdById === viewer.id || m.attendeeUserIds.includes(viewer.id));
  for (const m of meetings) out.set(m.id, null);
  if (own.length === 0) return out;
  const mine = (await db.companyMember.findMany({ where: { userId: viewer.id, company: { status: 'ACTIVE' } }, select: { companyId: true } })).map((r) => r.companyId);
  // Archived means no access (owner, 3 Nov 2026): no active company of their own, no meeting.
  if (mine.length === 0) return out;
  const projectIds = [...new Set(own.map((m) => m.projectId).filter((p): p is string => !!p))];
  const shared = new Set(
    projectIds.length
      ? (await db.projectCompany.findMany({ where: { projectId: { in: projectIds }, companyId: { in: mine }, company: { status: 'ACTIVE' } }, select: { projectId: true } })).map((r) => r.projectId)
      : [],
  );
  for (const m of own) out.set(m.id, !m.projectId || shared.has(m.projectId) ? 'full' : 'invitee');
  return out;
}

export interface CompanyAccess {
  /** The person's ACTIVE companies, oldest membership first. */
  activeCompanyIds(userId: string): Promise<string[]>;
  /** The pick if the person may use it (one of their active companies; for admins any company); otherwise CompanyNotAvailableError. */
  checkPick(viewer: Viewer, pick: string | null): Promise<string | null>;
  /**
   * 1.22: does this person's every LIST use the team rule although they are an administrator ("Show
   * my projects only" on)? Always false for anyone else (their lists use it anyway). Object routes
   * (one thing by its link) and the admin pages never ask.
   */
  myProjectsOnly(viewer: Viewer): Promise<boolean>;
  /**
   * The projects a list shows: admins every project (in the picked company) — or, with "Show my
   * projects only", the ones they own, manage or are on the team of; others their visible ones (in the pick).
   */
  projectScope(viewer: Viewer, pick: string | null): Promise<Prisma.ProjectWhereInput>;
  /** The ids of projectScope — null only for an admin without a pick ("every project"). */
  visibleProjectIds(viewer: Viewer, pick: string | null): Promise<string[] | null>;
  /**
   * The projects (deleted ones too) in the person's active companies, in the pick when given — null only
   * for an admin without a pick. The bell's scope: companies add this one condition to what 1.20 showed
   * (a task's notices reach its assignee even off the project's team). 1.22 (owner, 4 Nov — "always
   * show my own"): "Show my projects only" never narrows it — every notice is the person's own.
   */
  companyProjectIds(viewer: Viewer, pick: string | null): Promise<string[] | null>;
  /** May this person open the project (an object check: administrators always — the setting never applies)? */
  canSeeProject(viewer: Viewer, projectId: string): Promise<boolean>;
  /** Of these people, who may see the project now: active admins, and team members sharing an active company with it. */
  whoCanSeeProject(projectId: string, userIds: readonly string[]): Promise<Set<string>>;
  /** Do they share an active company? Always true when either one is an admin. */
  isColleague(viewer: Viewer, otherId: string): Promise<boolean>;
  /** Colleagues (colleague: true), plus teammates on projects the viewer sees and direct-chat partners; 'everyone' for admins. */
  knownPeople(viewer: Viewer): Promise<Map<string, { colleague: boolean }> | 'everyone'>;
  /** Active people in any of these ACTIVE companies. */
  projectCompanyPeople(companyIds: readonly string[]): Promise<string[]>;
  /**
   * How an attendee (or the organizer / creator) sees a meeting: 'full', or 'invitee' when it has a
   * project and they share no active company with it. null when they aren't one of its people (team
   * access to a project meeting is decided by canViewMeeting, as today) — or when none of their own
   * companies is active (archived means no access). Admins: 'full'.
   */
  meetingView(viewer: Viewer, m: { projectId: string | null; organizerId: string; createdById: string; attendeeUserIds: readonly string[] }): Promise<'full' | 'invitee' | null>;
}

export function createCompanyAccess(prisma: PrismaClient): CompanyAccess {
  async function activeCompanyIds(userId: string): Promise<string[]> {
    const rows = await prisma.companyMember.findMany({
      where: { userId, company: { status: 'ACTIVE' } },
      select: { companyId: true },
      orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }],
    });
    return rows.map((r) => r.companyId);
  }

  async function checkPick(viewer: Viewer, pick: string | null): Promise<string | null> {
    if (pick === null) return null;
    const usable = isAdminRoles(viewer.roles)
      ? (await prisma.company.count({ where: { id: pick } })) > 0
      : (await prisma.companyMember.count({ where: { userId: viewer.id, companyId: pick, company: { status: 'ACTIVE' } } })) > 0;
    if (!usable) throw new CompanyNotAvailableError();
    return pick;
  }

  async function myProjectsOnly(viewer: Viewer): Promise<boolean> {
    return isAdminRoles(viewer.roles) && (await readMyProjectsOnly(prisma, viewer.id));
  }

  /** An administrator's projects: every one — or, `mine`, the ones they own, manage or are on the team of — in the pick. */
  const adminWhere = (viewer: Viewer, pick: string | null, mine: boolean): Prisma.ProjectWhereInput => ({
    AND: [...(pick ? [inCompanyWhere(pick)] : []), ...(mine ? [teamWhere(viewer.id)] : [])],
  });

  /** `list`: a list asks, so "Show my projects only" applies; otherwise an object check (admin-wide). */
  async function scopeOf(viewer: Viewer, pick: string | null, list: boolean): Promise<Prisma.ProjectWhereInput> {
    if (isAdminRoles(viewer.roles)) return { deletedAt: null, ...adminWhere(viewer, pick, list && (await myProjectsOnly(viewer))) };
    if (!pick) return visibleProjectWhere(viewer.id);
    return { AND: [visibleProjectWhere(viewer.id), pickedCompanyWhere(viewer.id, pick)] };
  }

  const projectScope = (viewer: Viewer, pick: string | null) => scopeOf(viewer, pick, true);

  async function visibleProjectIds(viewer: Viewer, pick: string | null): Promise<string[] | null> {
    if (isAdminRoles(viewer.roles) && !pick && !(await myProjectsOnly(viewer))) return null;
    const rows = await prisma.project.findMany({ where: await projectScope(viewer, pick), select: { id: true } });
    return rows.map((r) => r.id);
  }

  async function companyProjectIds(viewer: Viewer, pick: string | null): Promise<string[] | null> {
    const admin = isAdminRoles(viewer.roles);
    // 1.22 (owner, 4 Nov): an administrator's notices are their own — "Show my projects only" doesn't
    // narrow them (as a non-admin's reach them off the team); the pick still does.
    if (admin && !pick) return null;
    const where: Prisma.ProjectWhereInput = admin ? adminWhere(viewer, pick, false) : pick ? pickedCompanyWhere(viewer.id, pick) : sharedCompanyWhere(viewer.id);
    return (await prisma.project.findMany({ where, select: { id: true } })).map((p) => p.id);
  }

  async function canSeeProject(viewer: Viewer, projectId: string): Promise<boolean> {
    return (await prisma.project.count({ where: { AND: [{ id: projectId }, await scopeOf(viewer, null, false)] } })) > 0;
  }

  async function whoCanSeeProject(projectId: string, userIds: readonly string[]): Promise<Set<string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Set();
    const project = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { ownerId: true, managerId: true, members: { where: { userId: { in: ids } }, select: { userId: true } } },
    });
    if (!project) return new Set(); // a deleted project notifies no one
    const team = new Set([project.ownerId, project.managerId, ...project.members.map((m) => m.userId)].filter((id): id is string => !!id && ids.includes(id)));
    const [admins, sharing] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null, roles: { some: { role: { name: 'ADMIN' } } } }, select: { id: true } }),
      team.size ? prisma.user.findMany({ where: { id: { in: [...team] }, ...sharesProjectCompanyWhere(projectId) }, select: { id: true } }) : Promise.resolve([] as { id: string }[]),
    ]);
    return new Set([...admins.map((u) => u.id), ...sharing.map((u) => u.id)]);
  }

  async function isColleague(viewer: Viewer, otherId: string): Promise<boolean> {
    if (isAdminRoles(viewer.roles)) return true;
    if ((await prisma.user.count({ where: { id: otherId, roles: { some: { role: { name: 'ADMIN' } } } } })) > 0) return true;
    const shared = await prisma.company.count({
      where: { status: 'ACTIVE', AND: [{ members: { some: { userId: viewer.id } } }, { members: { some: { userId: otherId } } }] },
    });
    return shared > 0;
  }

  async function knownPeople(viewer: Viewer): Promise<Map<string, { colleague: boolean }> | 'everyone'> {
    if (isAdminRoles(viewer.roles)) return 'everyone';
    const me = viewer.id;
    const [colleagues, projects, partners] = await Promise.all([
      prisma.user.findMany({ where: { AND: [colleagueWhere(me), { id: { not: me } }] }, select: { id: true } }),
      prisma.project.findMany({ where: visibleProjectWhere(me), select: { ownerId: true, managerId: true, members: { select: { userId: true } } } }),
      prisma.conversationParticipant.findMany({
        where: { userId: { not: me }, conversation: { kind: 'DIRECT', participants: { some: { userId: me } } } },
        select: { userId: true },
      }),
    ]);
    const known = new Map<string, { colleague: boolean }>();
    for (const c of colleagues) known.set(c.id, { colleague: true });
    const others = [...projects.flatMap((p) => [p.ownerId, p.managerId, ...p.members.map((m) => m.userId)]), ...partners.map((p) => p.userId)];
    for (const id of others) if (id && id !== me && !known.has(id)) known.set(id, { colleague: false });
    return known;
  }

  async function projectCompanyPeople(companyIds: readonly string[]): Promise<string[]> {
    if (companyIds.length === 0) return [];
    const rows = await prisma.user.findMany({
      where: { status: 'ACTIVE', deletedAt: null, companies: { some: { companyId: { in: [...companyIds] }, company: { status: 'ACTIVE' } } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async function meetingView(
    viewer: Viewer,
    m: { projectId: string | null; organizerId: string; createdById: string; attendeeUserIds: readonly string[] },
  ): Promise<'full' | 'invitee' | null> {
    if (isAdminRoles(viewer.roles)) return 'full';
    const own = m.organizerId === viewer.id || m.createdById === viewer.id || m.attendeeUserIds.includes(viewer.id);
    if (!own) return null;
    // Archived means no access (owner, 3 Nov 2026): no active company of their own, no meeting.
    if (!(await hasActiveCompany(prisma, viewer.id))) return null;
    if (!m.projectId) return 'full';
    const shares = await prisma.companyMember.count({
      where: { userId: viewer.id, company: { status: 'ACTIVE', projects: { some: { projectId: m.projectId } } } },
    });
    return shares > 0 ? 'full' : 'invitee';
  }

  return { activeCompanyIds, checkPick, myProjectsOnly, projectScope, visibleProjectIds, companyProjectIds, canSeeProject, whoCanSeeProject, isColleague, knownPeople, projectCompanyPeople, meetingView };
}
