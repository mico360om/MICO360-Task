import type { Prisma, PrismaClient } from '@prisma/client';
import { meetingViewsOf } from '../companies/company-access';
import { meetingListScope } from '../meetings/meeting-repository';
import { meetingScopeWhere } from '../meetings/prisma-meeting-repository';
import type { SearchViewer } from './task-search-scope';

/**
 * 1.23 Search everything — what a person may find, from the rules the rest of the site uses (never a
 * looser copy):
 * - tasks, task files, projects and inspections: the projects of their lists (`accessibleProjectIds`
 *   with the picked company — companies, team, "Show my projects only" — null for an administrator's
 *   every project);
 * - meetings: those of the plain meetings list (meetingListScope + meetingScopeWhere, the very query of
 *   GET /meetings), each with how they see it — the full view, or the invitee view of someone invited
 *   from another company (meetingViewsOf, the batched meetingView): the meeting, its people and agenda,
 *   and its final minutes once approved, never its notes, decisions or action items;
 * - draft final minutes: only meetings they may change (organizer, creator, whoever runs the project,
 *   an administrator — canEditMeetingRecord's rule, with projectAuthz's batched manageableProjectIds).
 */
export interface SearchScopeAll {
  /** Projects whose tasks, files, inspections and the projects themselves may be found; null = every one. */
  projectIds: string[] | null;
  /** 1.23.6: client portal accounts may be found (administrators only). */
  clientAccounts?: boolean;
  meetings: {
    /**
     * Meetings seen in full, one by one (the person's own meetings outside `fullProjects`); null = every
     * meeting (an administrator listing everything).
     */
    full: string[] | null;
    /**
     * Review I2: projects every meeting of which the list shows, in full (the person's projects; an
     * administrator's picked company's) — said once per project instead of once per meeting, so a
     * person on busy projects never makes a query too big for the database.
     */
    fullProjects?: string[];
    /** And every meeting without a project filed under this company (an administrator's pick). */
    fullStandaloneCompany?: string;
    /** Meetings seen as an invitee from another company. */
    invitee: string[];
    /** Meetings whose draft minutes may be seen, one by one; null = every one. */
    editable: string[] | null;
    /** …and every meeting seen in full of these projects (the person runs them)… */
    editableProjects?: string[];
    /** …and every meeting seen in full that this person organizes or created (canEditMeetingRecord). */
    editor?: string;
  };
}

/** May this person see the meeting's draft minutes (the scope's editable rule, for a meeting read)? */
export function canSeeDraft(meetings: SearchScopeAll['meetings'], m: { id: string; projectId: string | null; organizerId: string; createdById: string }): boolean {
  if (meetings.invitee.includes(m.id)) return false;
  if (meetings.editable === null) return true;
  return meetings.editable.includes(m.id) || (!!m.projectId && !!meetings.editableProjects?.includes(m.projectId)) || (!!meetings.editor && (m.organizerId === meetings.editor || m.createdById === meetings.editor));
}

export interface SearchScopeDeps {
  prisma: Pick<PrismaClient, 'meeting' | 'projectCompany' | 'companyMember'>;
  /** The projects a person's lists show (with a pick, that company's); null = an administrator's every project. */
  accessibleProjectIds: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /** Of these projects, which the person runs (projectAuthz.manageableProjectIds). */
  manageableProjectIds: (userId: string, roles: string[], projectIds: string[]) => Promise<Set<string>>;
  /** 1.22: an administrator's "Show my projects only". Absent: never. */
  myProjectsOnly?: (viewer: SearchViewer) => Promise<boolean>;
}

export function createSearchScope(deps: SearchScopeDeps) {
  async function forViewer(viewer: SearchViewer, pick: string | null = null): Promise<SearchScopeAll> {
    const admin = viewer.roles.includes('ADMIN');
    // A list: the pick named (even null), so an administrator's "Show my projects only" applies.
    const [projectIds, mineOnly] = await Promise.all([deps.accessibleProjectIds(viewer.id, viewer.roles, pick), admin && deps.myProjectsOnly ? deps.myProjectsOnly(viewer) : Promise.resolve(false)]);
    const where = await meetingScopeWhere(deps.prisma, meetingListScope({ userId: viewer.id, projectIds, pick, admin, mineOnly }));
    if (!where.OR) return { projectIds, ...(admin ? { clientAccounts: true } : {}), meetings: { full: null, invitee: [], editable: admin ? null : [] } };
    // Every meeting of these projects is in the list, and seen in full: the person's projects (a
    // visible project shares one of their active companies) — and an administrator's picked company's
    // projects and its meetings without a project (meetingScopeWhere's `everyone`).
    const everyone = admin && !!pick && !mineOnly;
    const fullProjects = new Set(projectIds ?? []);
    if (everyone) for (const r of await deps.prisma.projectCompany.findMany({ where: { companyId: pick! }, select: { projectId: true } })) fullProjects.add(r.projectId);
    // The rest of the list one by one: the person's own meetings elsewhere (few). Spelled out, so a
    // meeting without a project (a NULL project) is never lost to NOT IN.
    const rest: Prisma.MeetingWhereInput = {
      OR: [
        { projectId: null, ...(everyone ? { OR: [{ companyId: null }, { companyId: { not: pick! } }] } : {}) },
        fullProjects.size ? { projectId: { notIn: [...fullProjects] } } : { projectId: { not: null } },
      ],
    };
    const rows = await deps.prisma.meeting.findMany({
      where: { AND: [{ deletedAt: null }, where, rest] },
      select: { id: true, projectId: true, organizerId: true, createdById: true, attendees: { where: { userId: viewer.id }, select: { userId: true } } },
    });
    // Seen by an administrator, or through a project they can see: the full view. Otherwise as one of
    // its people — the full view, an invitee's, or none (meetingViewsOf, the batched meetingView).
    const views = admin
      ? new Map(rows.map((m) => [m.id, 'full' as const]))
      : await meetingViewsOf(deps.prisma, viewer, rows.map((m) => ({ id: m.id, projectId: m.projectId, organizerId: m.organizerId, createdById: m.createdById, attendeeUserIds: m.attendees.map((a) => a.userId).filter((u): u is string => !!u) })));
    const full: string[] = [];
    const invitee: string[] = [];
    for (const m of rows) {
      const view = views.get(m.id);
      if (view === 'full') full.push(m.id);
      else if (view === 'invitee') invitee.push(m.id);
    }
    const base = { full, fullProjects: [...fullProjects], ...(everyone ? { fullStandaloneCompany: pick! } : {}), invitee };
    if (admin) return { projectIds, clientAccounts: true, meetings: { ...base, editable: null } };
    // Drafts: whoever may change the meeting — its organizer or creator, or whoever runs its project.
    const projectsOf = [...new Set([...fullProjects, ...rows.map((m) => m.projectId).filter((p): p is string => !!p)])];
    const runs = await deps.manageableProjectIds(viewer.id, viewer.roles, projectsOf);
    return { projectIds, meetings: { ...base, editable: [], editableProjects: [...runs], editor: viewer.id } };
  }
  return { forViewer };
}

export type SearchScopeResolver = ReturnType<typeof createSearchScope>;
