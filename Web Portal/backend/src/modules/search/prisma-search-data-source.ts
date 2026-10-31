import type { PrismaClient } from '@prisma/client';
import type { SearchDataSource, SearchableMeeting } from './search-service';
import { noteText } from '../../lib/rich-text';

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
        prisma.meetingNote.findMany({ where: { deletedAt: null }, select: { meetingId: true, body: true, bodyFormat: true }, take: 8000 }),
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
      for (const n of notes) push(n.meetingId, noteText(n));
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

      // Tasks are searched per request (task-search-engine), not from this snapshot.
      return { tasks: [], projects, users, meetings: searchableMeetings };
    }
  };
}
