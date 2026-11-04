import type { PrismaClient } from '@prisma/client';
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
  meetings: {
    /** Meetings seen in full; null = every meeting (an administrator listing everything). */
    full: string[] | null;
    /** Meetings seen as an invitee from another company. */
    invitee: string[];
    /** Meetings whose draft minutes may be seen; null = every one. */
    editable: string[] | null;
  };
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
    if (!where.OR) return { projectIds, meetings: { full: null, invitee: [], editable: admin ? null : [] } };
    const rows = await deps.prisma.meeting.findMany({
      where: { AND: [{ deletedAt: null }, where] },
      select: { id: true, projectId: true, organizerId: true, createdById: true, attendees: { where: { userId: viewer.id }, select: { userId: true } } },
    });
    const visible = projectIds ? new Set(projectIds) : null;
    // Seen through the project (its team): the full view. Otherwise as one of its people (or not at all).
    const throughProject = (m: { projectId: string | null }) => admin || (!!m.projectId && (!visible || visible.has(m.projectId)));
    const views = await meetingViewsOf(
      deps.prisma,
      viewer,
      rows.filter((m) => !throughProject(m)).map((m) => ({ id: m.id, projectId: m.projectId, organizerId: m.organizerId, createdById: m.createdById, attendeeUserIds: m.attendees.map((a) => a.userId).filter((u): u is string => !!u) })),
    );
    const full: string[] = [];
    const invitee: string[] = [];
    for (const m of rows) {
      const view = throughProject(m) ? 'full' : views.get(m.id);
      if (view === 'full') full.push(m.id);
      else if (view === 'invitee') invitee.push(m.id);
    }
    if (admin) return { projectIds, meetings: { full, invitee, editable: null } };
    const projectsOf = [...new Set(rows.map((m) => m.projectId).filter((p): p is string => !!p))];
    const runs = await deps.manageableProjectIds(viewer.id, viewer.roles, projectsOf);
    const fullSet = new Set(full);
    const editable = rows.filter((m) => fullSet.has(m.id) && (m.organizerId === viewer.id || m.createdById === viewer.id || (!!m.projectId && runs.has(m.projectId)))).map((m) => m.id);
    return { projectIds, meetings: { full, invitee, editable } };
  }
  return { forViewer };
}

export type SearchScopeResolver = ReturnType<typeof createSearchScope>;
