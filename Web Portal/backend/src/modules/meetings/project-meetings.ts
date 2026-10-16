/**
 * A project's meetings for its dashboard: each meeting with where it stands (upcoming, under way,
 * held, cancelled), its people, minutes, decisions and action items, plus the project's
 * decisions and action items across its meetings and its repeating series.
 */
import { isOverdue } from '../../lib/due-date';
import type { MeetingStatus, RecurrenceRule } from './meeting-repository';

export interface ProjectMeetingsData {
  meetings: Array<{
    id: string;
    title: string;
    status: MeetingStatus;
    startAt: Date;
    endAt: Date | null;
    timeZone: string | null;
    location: string | null;
    onlineLink: string | null;
    recurrenceRule: RecurrenceRule | null;
    recurrenceParentId: string | null;
    /** A series meeting's place in its series (its first meeting's says the day the repeat follows). */
    recurrenceStart?: Date | null;
    organizerId: string;
  }>;
  /** First meetings of the series shown that aren't among `meetings` (older, or deleted on their own). */
  seriesRoots: Array<{ id: string; title: string; recurrenceRule: RecurrenceRule | null; recurrenceStart: Date | null; startAt: Date }>;
  /** Attendees by meeting, with their display names (guests too). */
  attendees: Array<{ meetingId: string; userId: string | null; name: string }>;
  /** Notes recorded as decisions (not deleted). */
  decisions: Array<{ id: string; meetingId: string; body: string; createdAt: Date }>;
  /** Notes taken per meeting (any kind, not deleted). */
  noteCounts: Record<string, number>;
  /** Final-minutes records by meeting (APPROVED = final). */
  minutes: Array<{ meetingId: string; status: string }>;
  actionItems: Array<{
    id: string;
    meetingId: string | null;
    description: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    assigneeId: string | null;
    assigneeName: string | null;
    completedAt: Date | null;
  }>;
}

export type MeetingPhase = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
/** How far the minutes are: none yet, notes taken, final minutes drafted, final minutes approved. */
export type MinutesState = 'NONE' | 'NOTES' | 'DRAFT' | 'FINAL';

const DONE_ITEMS = new Set(['COMPLETED', 'CANCELLED']);
const HOUR = 3_600_000;

/** Where a meeting stands now. A meeting without an end counts as an hour long. */
export function meetingPhase(m: { status: MeetingStatus; startAt: Date; endAt: Date | null }, now: Date): MeetingPhase {
  if (m.status === 'CANCELLED') return 'cancelled';
  if (m.status === 'COMPLETED') return 'completed';
  if (m.status === 'IN_PROGRESS') return 'ongoing';
  const end = (m.endAt ?? new Date(m.startAt.getTime() + HOUR)).getTime();
  const at = now.getTime();
  if (at < m.startAt.getTime()) return 'upcoming';
  return at < end ? 'ongoing' : 'completed';
}

export function buildProjectMeetingsOverview(data: ProjectMeetingsData, now: Date, timeZone: string) {
  const titleOf = new Map(data.meetings.map((m) => [m.id, m.title]));
  const minutesOf = new Map(data.minutes.map((x) => [x.meetingId, x.status]));
  const group = <T extends { meetingId: string | null }>(list: T[]) => {
    const out = new Map<string, T[]>();
    for (const x of list) if (x.meetingId) out.set(x.meetingId, [...(out.get(x.meetingId) ?? []), x]);
    return out;
  };
  const attendeesOf = group(data.attendees);
  const decisionsOf = group(data.decisions);
  const itemsOf = group(data.actionItems);
  const openItem = (x: ProjectMeetingsData['actionItems'][number]) => !DONE_ITEMS.has(x.status);

  const meetings = [...data.meetings]
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((m) => {
      const people = attendeesOf.get(m.id) ?? [];
      const minutesStatus = minutesOf.get(m.id);
      const final = minutesStatus === 'APPROVED' || minutesStatus === 'SENT';
      const minutes: MinutesState = final ? 'FINAL' : minutesStatus ? 'DRAFT' : (data.noteCounts[m.id] ?? 0) > 0 ? 'NOTES' : 'NONE';
      return {
        ...m,
        seriesId: m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null),
        phase: meetingPhase(m, now),
        attendeeCount: people.length,
        attendees: people.slice(0, 6).map((p) => p.name),
        minutes,
        decisionCount: (decisionsOf.get(m.id) ?? []).length,
        openActionItemCount: (itemsOf.get(m.id) ?? []).filter(openItem).length,
      };
    });

  const decisions = [...data.decisions]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((d) => ({ id: d.id, text: d.body, meetingId: d.meetingId, meetingTitle: titleOf.get(d.meetingId) ?? null, at: d.createdAt }));

  // Open items first (soonest due first, undated last), then the finished ones.
  const due = (x: ProjectMeetingsData['actionItems'][number]) => x.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const actionItems = [...data.actionItems]
    .sort((a, b) => Number(!openItem(a)) - Number(!openItem(b)) || due(a) - due(b))
    .map((x) => ({
      id: x.id,
      description: x.description,
      status: x.status,
      priority: x.priority,
      dueDate: x.dueDate,
      overdue: openItem(x) && isOverdue(x.dueDate, timeZone, now),
      assignee: x.assigneeId ? { id: x.assigneeId, name: x.assigneeName ?? 'A team member' } : null,
      meetingId: x.meetingId,
      meetingTitle: x.meetingId ? titleOf.get(x.meetingId) ?? null : null,
    }));

  // Each repeating series once: its title and rule, when it started (the day its weekly repeat
  // follows), and its next meeting.
  const series = [...new Set(meetings.map((m) => m.seriesId).filter((id): id is string => !!id))].flatMap((id) => {
    const own = meetings.filter((m) => m.seriesId === id);
    const loaded = data.meetings.find((m) => m.id === id);
    const root = loaded ? { ...loaded, recurrenceStart: loaded.recurrenceStart ?? null } : data.seriesRoots.find((r) => r.id === id);
    const coming = own.filter((m) => m.phase === 'upcoming');
    if (!root?.recurrenceRule) return [];
    return [{
      id,
      title: (coming[0] ?? own.at(-1) ?? root).title,
      rule: root.recurrenceRule,
      firstStartAt: root.recurrenceStart ?? root.startAt,
      nextMeetingId: coming[0]?.id ?? null,
      nextStartAt: coming[0]?.startAt ?? null,
      upcoming: coming.length,
    }];
  });

  const count = (p: MeetingPhase) => meetings.filter((m) => m.phase === p).length;
  const open = actionItems.filter((x) => !DONE_ITEMS.has(x.status));
  return {
    meetings,
    decisions,
    actionItems,
    series,
    stats: {
      upcoming: count('upcoming'),
      ongoing: count('ongoing'),
      completed: count('completed'),
      cancelled: count('cancelled'),
      nextMeetingId: meetings.find((m) => m.phase === 'upcoming')?.id ?? null,
      openActionItems: open.length,
      overdueActionItems: open.filter((x) => x.overdue).length,
      decisions: decisions.length,
    },
  };
}

export type ProjectMeetingsOverview = ReturnType<typeof buildProjectMeetingsOverview>;
