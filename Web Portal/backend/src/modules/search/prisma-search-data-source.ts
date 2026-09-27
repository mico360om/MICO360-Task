import type { Prisma, PrismaClient } from '@prisma/client';
import { taskMatches, type SearchDataSource, type SearchableMeeting } from './search-service';
import { normalizeForSearch, prefilterTerms } from './text-normalize';

/** Rows fetched per task search before the exact (normalised) match narrows them down. */
const TASK_CANDIDATES = 500;

/**
 * The database side of a task search: live tasks in live projects the caller may see, whose title
 * contains every pre-filter term (a superset of the normalised match — see prefilterTerms) or
 * whose key contains the query. Exported for tests.
 */
export function taskSearchWhere(query: string, allowedProjectIds: string[] | null): Prisma.TaskWhereInput {
  const terms = prefilterTerms(query);
  const keyTerm = normalizeForSearch(query);
  return {
    deletedAt: null,
    project: { is: { deletedAt: null } },
    ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
    OR: [{ AND: terms.map((t) => ({ title: { contains: t } })) }, { key: { contains: keyTerm } }],
  };
}

export function createPrismaSearchDataSource(prisma: PrismaClient): SearchDataSource {
  return {
    async getSearchData() {
      const [projects, users, meetings, agenda, notes, decisions, attendees] = await Promise.all([
        prisma.project.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } }),
        // Email is deliberately not selected — it must never reach search clients.
        prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, username: true, firstName: true, lastName: true } }),
        // Meeting Knowledge Base: meetings + their agenda / notes / decisions, indexed for search.
        prisma.meeting.findMany({ where: { deletedAt: null }, select: { id: true, title: true, projectId: true, organizerId: true, description: true }, take: 500 }),
        prisma.agendaItem.findMany({ select: { meetingId: true, title: true }, take: 4000 }),
        prisma.meetingNote.findMany({ select: { meetingId: true, body: true }, take: 8000 }),
        prisma.decision.findMany({ select: { meetingId: true, title: true, description: true }, take: 4000 }),
        prisma.meetingAttendee.findMany({ select: { meetingId: true, userId: true }, take: 8000 }),
      ]);

      // Group meeting content + attendees by meeting id.
      const contentById = new Map<string, string[]>();
      const push = (mid: string | null, ...parts: (string | null)[]) => {
        if (!mid) return;
        const arr = contentById.get(mid) ?? [];
        for (const p of parts) if (p) arr.push(p);
        contentById.set(mid, arr);
      };
      for (const g of agenda) push(g.meetingId, g.title);
      for (const n of notes) push(n.meetingId, n.body);
      for (const d of decisions) push(d.meetingId, d.title, d.description);

      const attendeesById = new Map<string, string[]>();
      for (const a of attendees) {
        if (!a.userId) continue;
        const arr = attendeesById.get(a.meetingId) ?? [];
        arr.push(a.userId);
        attendeesById.set(a.meetingId, arr);
      }

      const searchableMeetings: SearchableMeeting[] = meetings.map((m) => ({
        id: m.id,
        title: m.title,
        projectId: m.projectId,
        organizerId: m.organizerId,
        attendeeUserIds: attendeesById.get(m.id) ?? [],
        content: [m.description, ...(contentById.get(m.id) ?? [])].filter(Boolean).join(' — '),
      }));

      // Tasks are searched per request in the database (searchTasks), not from this snapshot.
      return { tasks: [], projects, users, meetings: searchableMeetings };
    },

    async searchTasks(query, allowedProjectIds, limit) {
      const q = normalizeForSearch(query);
      if (!q || (allowedProjectIds && allowedProjectIds.length === 0)) return [];
      const candidates = await prisma.task.findMany({
        where: taskSearchWhere(query, allowedProjectIds),
        select: { id: true, key: true, title: true, projectId: true },
        orderBy: { updatedAt: 'desc' },
        take: TASK_CANDIDATES,
      });
      return candidates.filter((t) => taskMatches(t, q)).slice(0, limit);
    },
  };
}
