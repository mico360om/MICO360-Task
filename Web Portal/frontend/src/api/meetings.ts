import type { ApiClient } from '../lib/api-client';

export type MeetingStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type AttendeeRole = 'REQUIRED' | 'OPTIONAL';
export type AttendanceStatus = 'INVITED' | 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export type MeetingNoteType = 'DISCUSSION' | 'DECISION' | 'ACTION' | 'ISSUE' | 'QUESTION' | 'INFORMATION';

export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  interval: number;
  count?: number | null;
  until?: string | null;
  weekdays?: number[];
  dayOfMonth?: number;
  paused?: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: MeetingStatus;
  projectId: string | null;
  organizerId: string;
  location: string | null;
  onlineLink: string | null;
  startAt: string;
  endAt: string | null;
  timeZone: string | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
  templateId: string | null;
  transcript: string | null;
  invitesSentAt: string | null;
  reminderSentAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attendee {
  id: string;
  meetingId: string;
  userId: string | null;
  externalName: string | null;
  externalEmail: string | null;
  role: AttendeeRole;
  attendance: AttendanceStatus;
  department: string | null;
  createdAt: string;
}

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type ActionItemStatus = 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'COMPLETED' | 'CANCELLED';

export const ACTION_STATUS_LABELS: Record<ActionItemStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export interface ActionItem {
  id: string;
  meetingId: string | null;
  agendaItemId: string | null;
  sourceNoteId: string | null;
  projectId: string | null;
  description: string;
  assigneeId: string | null;
  priority: Priority;
  status: ActionItemStatus;
  dueDate: string | null;
  progress: number;
  completedAt: string | null;
  taskId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  /** Computed by the server: past due and still actionable. */
  overdue: boolean;
}

export interface NewActionItemInput {
  description: string;
  assigneeId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
}

export interface ActionItemPatch {
  description?: string;
  assigneeId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  progress?: number;
  status?: ActionItemStatus;
}

export interface CreateTaskFromNoteInput {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  columnId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
  assigneeId?: string | null;
}

export interface NoteTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
}

export interface MeetingNote {
  id: string;
  meetingId: string;
  agendaItemId: string | null;
  authorId: string;
  type: MeetingNoteType;
  body: string;
  highlighted: boolean;
  taskId: string | null;
  actionItemId: string | null;
  decisionId: string | null;
  createdAt: string;
  editedAt: string | null;
}

export interface NewNoteInput {
  body: string;
  type?: MeetingNoteType;
  agendaItemId?: string | null;
  highlighted?: boolean;
}

export interface NotePatch {
  body?: string;
  type?: MeetingNoteType;
  agendaItemId?: string | null;
  highlighted?: boolean;
}

export const NOTE_TYPE_LABELS: Record<MeetingNoteType, string> = {
  DISCUSSION: 'Discussion',
  DECISION: 'Decision',
  ACTION: 'Action Item',
  ISSUE: 'Issue',
  QUESTION: 'Question',
  INFORMATION: 'Information',
};

export interface AgendaItem {
  id: string;
  meetingId: string;
  title: string;
  ownerId: string | null;
  expectedMinutes: number | null;
  position: number;
  completed: boolean;
  linkedPrevActionId: string | null;
  createdAt: string;
}

export interface NewAgendaInput {
  title: string;
  ownerId?: string | null;
  expectedMinutes?: number | null;
}

export interface AgendaPatch {
  title?: string;
  ownerId?: string | null;
  expectedMinutes?: number | null;
  completed?: boolean;
}

export interface NewMeetingInput {
  title: string;
  description?: string | null;
  category?: string | null;
  status?: MeetingStatus;
  projectId?: string | null;
  organizerId?: string;
  location?: string | null;
  onlineLink?: string | null;
  startAt: string;
  endAt?: string | null;
  timeZone?: string | null;
  recurrenceRule?: RecurrenceRule | null;
}

export type MeetingPatch = Partial<Omit<NewMeetingInput, 'startAt'>> & { startAt?: string };

export interface NewAttendeeInput {
  userId?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  role?: AttendeeRole;
  attendance?: AttendanceStatus;
  department?: string | null;
}

export interface MeetingListFilter {
  projectId?: string;
  status?: MeetingStatus;
  mine?: boolean;
}

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  INVITED: 'Invited',
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
};

function queryString(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function meetingsApi(client: ApiClient) {
  return {
    list: (filter: MeetingListFilter = {}) =>
      client
        .get<{ data: Meeting[] }>(
          `/meetings${queryString({ projectId: filter.projectId, status: filter.status, mine: filter.mine ? 'true' : undefined })}`,
        )
        .then((r) => r.data),
    get: (id: string) => client.get<{ data: Meeting }>(`/meetings/${id}`).then((r) => r.data),
    create: (input: NewMeetingInput) => client.post<{ data: Meeting }>('/meetings', input).then((r) => r.data),
    update: (id: string, patch: MeetingPatch) => client.put<{ data: Meeting }>(`/meetings/${id}`, patch).then((r) => r.data),
    cancel: (id: string) => client.post<{ data: Meeting }>(`/meetings/${id}/cancel`).then((r) => r.data),
    duplicate: (id: string) => client.post<{ data: Meeting }>(`/meetings/${id}/duplicate`).then((r) => r.data),
    remove: (id: string) => client.del<void>(`/meetings/${id}`),

    // Attendees (sub-resource)
    listAttendees: (meetingId: string) => client.get<{ data: Attendee[] }>(`/meetings/${meetingId}/attendees`).then((r) => r.data),
    addAttendee: (meetingId: string, input: NewAttendeeInput) =>
      client.post<{ data: Attendee }>(`/meetings/${meetingId}/attendees`, input).then((r) => r.data),
    updateAttendee: (meetingId: string, attendeeId: string, patch: { role?: AttendeeRole; attendance?: AttendanceStatus; department?: string | null }) =>
      client.patch<{ data: Attendee }>(`/meetings/${meetingId}/attendees/${attendeeId}`, patch).then((r) => r.data),
    removeAttendee: (meetingId: string, attendeeId: string) => client.del<void>(`/meetings/${meetingId}/attendees/${attendeeId}`),
    suggestAttendees: (meetingId: string, previousMeetingIds: string[]) =>
      client.get<{ data: string[] }>(`/meetings/${meetingId}/attendees/suggestions${queryString({ from: previousMeetingIds.join(',') || undefined })}`).then((r) => r.data),

    // Agenda (sub-resource)
    listAgenda: (meetingId: string) => client.get<{ data: AgendaItem[] }>(`/meetings/${meetingId}/agenda`).then((r) => r.data),
    addAgendaItem: (meetingId: string, input: NewAgendaInput) =>
      client.post<{ data: AgendaItem }>(`/meetings/${meetingId}/agenda`, input).then((r) => r.data),
    updateAgendaItem: (meetingId: string, itemId: string, patch: AgendaPatch) =>
      client.patch<{ data: AgendaItem }>(`/meetings/${meetingId}/agenda/${itemId}`, patch).then((r) => r.data),
    removeAgendaItem: (meetingId: string, itemId: string) => client.del<void>(`/meetings/${meetingId}/agenda/${itemId}`),
    reorderAgenda: (meetingId: string, orderedIds: string[]) =>
      client.put<{ data: AgendaItem[] }>(`/meetings/${meetingId}/agenda/reorder`, { orderedIds }).then((r) => r.data),

    // Live meeting notes (sub-resource)
    listNotes: (meetingId: string) => client.get<{ data: MeetingNote[] }>(`/meetings/${meetingId}/notes`).then((r) => r.data),
    addNote: (meetingId: string, input: NewNoteInput) =>
      client.post<{ data: MeetingNote }>(`/meetings/${meetingId}/notes`, input).then((r) => r.data),
    updateNote: (meetingId: string, noteId: string, patch: NotePatch) =>
      client.patch<{ data: MeetingNote }>(`/meetings/${meetingId}/notes/${noteId}`, patch).then((r) => r.data),
    removeNote: (meetingId: string, noteId: string) => client.del<void>(`/meetings/${meetingId}/notes/${noteId}`),

    /** ⭐ Promote a note into a board task; returns the created task and the back-linked note. */
    createTaskFromNote: (meetingId: string, noteId: string, input: CreateTaskFromNoteInput) =>
      client.post<{ data: { task: NoteTask; note: MeetingNote } }>(`/meetings/${meetingId}/notes/${noteId}/task`, input).then((r) => r.data),

    /** Download the Minutes of Meeting as a PDF blob. */
    exportMinutesPdf: (meetingId: string) => client.getBlob(`/meetings/${meetingId}/minutes.pdf`),

    // Action items (register + cross-meeting "My Action Items")
    listActionItems: (meetingId: string) => client.get<{ data: ActionItem[] }>(`/meetings/${meetingId}/action-items`).then((r) => r.data),
    addActionItem: (meetingId: string, input: NewActionItemInput) => client.post<{ data: ActionItem }>(`/meetings/${meetingId}/action-items`, input).then((r) => r.data),
    updateActionItem: (id: string, patch: ActionItemPatch) => client.patch<{ data: ActionItem }>(`/action-items/${id}`, patch).then((r) => r.data),
    removeActionItem: (id: string) => client.del<void>(`/action-items/${id}`),
    listMyActionItems: (filter: { status?: ActionItemStatus; openOnly?: boolean } = {}) => {
      const qs = new URLSearchParams();
      if (filter.status) qs.set('status', filter.status);
      if (filter.openOnly) qs.set('openOnly', 'true');
      const s = qs.toString();
      return client.get<{ data: ActionItem[] }>(`/me/action-items${s ? `?${s}` : ''}`).then((r) => r.data);
    },

    /** Send calendar invitations (.ics) to the organizer + attendees. */
    sendInvites: (meetingId: string) => client.post<{ data: { sent: number } }>(`/meetings/${meetingId}/invites`).then((r) => r.data),
    /** Email the branded minutes PDF to the organizer + attendees. */
    sendMinutes: (meetingId: string) => client.post<{ data: { sent: number } }>(`/meetings/${meetingId}/minutes/send`).then((r) => r.data),
  };
}
