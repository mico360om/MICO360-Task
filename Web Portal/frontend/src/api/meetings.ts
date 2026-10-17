import type { ApiClient } from '../lib/api-client';
import type { RecurrenceRule } from '../lib/recurrence';

export type { RecurrenceRule };

export type MeetingStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type AttendeeRole = 'REQUIRED' | 'OPTIONAL';
export type AttendanceStatus = 'INVITED' | 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export type MeetingNoteType = 'DISCUSSION' | 'DECISION' | 'ACTION' | 'ISSUE' | 'QUESTION' | 'INFORMATION';
/** The answer to the invitation — separate from the role (required/optional) and from attendance on the day. */
export type InvitationResponse = 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';

/** One meeting of a repeating series, or all its upcoming meetings. */
export type SeriesScope = 'one' | 'series';

/** A meeting's series: its first meeting, the rule and the zone the rule runs in. */
export interface MeetingSeries {
  id: string;
  rule: RecurrenceRule;
  timeZone: string;
}

/** The final minutes of a meeting (the "Final MOM"), as the organizer approves and sends them. */
export interface FinalMinutesContent {
  summary: string;
  /** What was discussed, per agenda item (and "Other points"). */
  discussion: Array<{ topic: string; text: string }>;
  decisions: string[];
  /** Risks, issues and open questions. */
  risks: string[];
  nextSteps: string[];
}

export interface FinalMinutes {
  /** NONE: not written (or, for an attendee, not final yet); DRAFT: being written; FINAL: approved. */
  status: 'NONE' | 'DRAFT' | 'FINAL';
  content: FinalMinutesContent | null;
  savedAt: string | null;
  approvedBy: { id: string; name: string | null } | null;
  approvedAt: string | null;
  /** The signed-in person may write, approve and reopen them. */
  canEdit: boolean;
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
  /** On the first meeting of a series: the series' rule. */
  recurrenceRule: RecurrenceRule | null;
  /** On the other meetings of a series: the first meeting's id. */
  recurrenceParentId: string | null;
  /** A series meeting's place in its series (the start its rule gave it). */
  recurrenceStart?: string | null;
  /** The meeting's series (single-meeting responses; null for a one-off; older servers leave it out). */
  series?: MeetingSeries | null;
  templateId: string | null;
  transcript: string | null;
  invitesSentAt: string | null;
  reminderSentAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Whether the signed-in user may manage this meeting (edit, cancel, delete, invitations, minutes
   * email, attendees, agenda). Missing on older servers — treat that as `true`.
   */
  canEdit?: boolean;
  /** List only: how many people are on the meeting (older servers leave it out). */
  attendeeCount?: number;
  /** List only: action items still to do. */
  openActionItemCount?: number;
  /** List only: the first few attendees' names (older servers leave it out). */
  attendees?: string[];
  /** List only: how far the minutes are. */
  minutes?: MinutesState;
  /** List only: notes recorded as decisions. */
  decisionCount?: number;
}

export interface Attendee {
  id: string;
  meetingId: string;
  userId: string | null;
  externalName: string | null;
  externalEmail: string | null;
  role: AttendeeRole;
  attendance: AttendanceStatus;
  /** Older servers leave these out (treat as no answer / not invited). */
  response?: InvitationResponse;
  respondedAt?: string | null;
  /** When this person's own invitation was delivered (null = not invited yet). */
  invitedAt?: string | null;
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
  /** Board key of the linked task (null when there is none). */
  taskKey?: string | null;
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
  /** RICH: `body` is formatted text (a safe, fixed HTML form — shown with RichNoteView). PLAIN when absent. */
  bodyFormat?: 'PLAIN' | 'RICH';
  highlighted: boolean;
  taskId: string | null;
  actionItemId: string | null;
  decisionId: string | null;
  createdAt: string;
  editedAt: string | null;
}

export interface NewNoteInput {
  body: string;
  /** RICH: `body` is the editor's HTML (the server cleans it). */
  format?: 'PLAIN' | 'RICH';
  type?: MeetingNoteType;
  agendaItemId?: string | null;
  highlighted?: boolean;
}

export interface NotePatch {
  body?: string;
  format?: 'PLAIN' | 'RICH';
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

export type RecipientKind = 'organizer' | 'member' | 'guest';

export interface Recipient {
  name: string;
  email: string;
  kind: RecipientKind;
  attendeeIds: string[];
  alreadyInvited: boolean;
}

export interface SendProblem {
  /** 'error' blocks sending; 'warning' can be sent anyway. */
  level: 'error' | 'warning';
  message: string;
}

export interface InvitePreview {
  recipients: Recipient[];
  missingEmail: { name: string; attendeeId: string }[];
  problems: SendProblem[];
  invitesSentAt: string | null;
}

export interface MinutesPreview {
  subject: string;
  html: string;
  text: string;
  attachmentName: string;
  recipients: Recipient[];
  missingEmail: { name: string; attendeeId: string }[];
}

/** What happened to each email of a send. Older servers answer with the totals only. */
export interface SendReport {
  sent: number;
  failed?: number;
  recipients?: { name: string; email: string; kind: RecipientKind; ok: boolean; error?: string }[];
  skipped?: { name: string; reason: string }[];
}

export interface MeetingListFilter {
  projectId?: string;
  status?: MeetingStatus;
  mine?: boolean;
  /** A calendar range: meetings starting in [from, to) (ISO instants). */
  from?: string;
  to?: string;
}

/** The id of a meeting's series (its first meeting), or null for a one-off meeting. */
export function seriesIdOf(m: Pick<Meeting, 'id' | 'recurrenceParentId' | 'recurrenceRule'>): string | null {
  return m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null);
}

export type MeetingPhase = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';
/** How far a meeting's minutes are: none, notes taken, final minutes drafted, final minutes approved. */
export type MinutesState = 'NONE' | 'NOTES' | 'DRAFT' | 'FINAL';

export interface ProjectMeeting {
  id: string;
  title: string;
  status: MeetingStatus;
  startAt: string;
  endAt: string | null;
  timeZone: string | null;
  location: string | null;
  onlineLink: string | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
  organizerId: string;
  seriesId: string | null;
  phase: MeetingPhase;
  attendeeCount: number;
  /** The first few attendees' names. */
  attendees: string[];
  minutes: MinutesState;
  decisionCount: number;
  openActionItemCount: number;
}

/** A project's meetings for its dashboard. */
export interface ProjectMeetingsOverview {
  meetings: ProjectMeeting[];
  decisions: Array<{ id: string; text: string; meetingId: string; meetingTitle: string | null; at: string }>;
  actionItems: Array<{
    id: string;
    description: string;
    status: ActionItemStatus;
    priority: Priority;
    dueDate: string | null;
    overdue: boolean;
    assignee: { id: string; name: string } | null;
    meetingId: string | null;
    meetingTitle: string | null;
  }>;
  /** Each repeating series once; `firstStartAt` is when it started (the day a weekly repeat follows). */
  series: Array<{ id: string; title: string; rule: RecurrenceRule; firstStartAt?: string; nextMeetingId: string | null; nextStartAt: string | null; upcoming: number }>;
  stats: {
    upcoming: number;
    ongoing: number;
    completed: number;
    cancelled: number;
    nextMeetingId: string | null;
    openActionItems: number;
    overdueActionItems: number;
    decisions: number;
  };
}

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const RESPONSE_LABELS: Record<InvitationResponse, string> = {
  PENDING: 'No response',
  ACCEPTED: 'Accepted',
  TENTATIVE: 'Maybe',
  DECLINED: 'Declined',
};

/** Attendance on the day. INVITED is simply "not recorded yet" — the invitation itself is the response. */
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  INVITED: 'Not recorded',
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
          `/meetings${queryString({ projectId: filter.projectId, status: filter.status, mine: filter.mine ? 'true' : undefined, from: filter.from, to: filter.to })}`,
        )
        .then((r) => r.data),
    get: (id: string) => client.get<{ data: Meeting }>(`/meetings/${id}`).then((r) => r.data),
    create: (input: NewMeetingInput) => client.post<{ data: Meeting }>('/meetings', input).then((r) => r.data),
    /** `scope: 'series'` changes every upcoming meeting of the meeting's series. */
    update: (id: string, patch: MeetingPatch, scope: SeriesScope = 'one') =>
      client.put<{ data: Meeting }>(`/meetings/${id}${scope === 'series' ? '?scope=series' : ''}`, patch).then((r) => r.data),
    cancel: (id: string, scope: SeriesScope = 'one') =>
      client.post<{ data: Meeting }>(`/meetings/${id}/cancel${scope === 'series' ? '?scope=series' : ''}`).then((r) => r.data),
    duplicate: (id: string) => client.post<{ data: Meeting }>(`/meetings/${id}/duplicate`).then((r) => r.data),
    remove: (id: string, scope: SeriesScope = 'one') => client.del<void>(`/meetings/${id}${scope === 'series' ? '?scope=series' : ''}`),
    /** A project's meetings, decisions and action items (its dashboard). */
    projectOverview: (projectId: string) =>
      client.get<{ data: ProjectMeetingsOverview }>(`/projects/${projectId}/meetings-overview`).then((r) => r.data),

    // Attendees (sub-resource)
    listAttendees: (meetingId: string) => client.get<{ data: Attendee[] }>(`/meetings/${meetingId}/attendees`).then((r) => r.data),
    addAttendee: (meetingId: string, input: NewAttendeeInput) =>
      client.post<{ data: Attendee }>(`/meetings/${meetingId}/attendees`, input).then((r) => r.data),
    updateAttendee: (meetingId: string, attendeeId: string, patch: { role?: AttendeeRole; attendance?: AttendanceStatus; response?: InvitationResponse; department?: string | null }) =>
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
    /** Undo a note delete (notes are soft-deleted on the server). */
    restoreNote: (meetingId: string, noteId: string) =>
      client.post<{ data: MeetingNote }>(`/meetings/${meetingId}/notes/${noteId}/restore`, {}).then((r) => r.data),

    /** ⭐ Promote a note into a board task; returns the created task and the back-linked note. */
    createTaskFromNote: (meetingId: string, noteId: string, input: CreateTaskFromNoteInput) =>
      // `assigneeError`: the task was created, but assigning it failed (e.g. the person can't see the project).
      // `actionItem`: an action note is also tracked as an action item linked to the task.
      client.post<{ data: { task: NoteTask; note: MeetingNote; assigneeError?: string; actionItem?: ActionItem; actionItemError?: string } }>(`/meetings/${meetingId}/notes/${noteId}/task`, input).then((r) => r.data),

    /** Download the Minutes of Meeting as a PDF blob: the working minutes, or the approved final minutes. */
    exportMinutesPdf: (meetingId: string, version: 'working' | 'final' = 'working') =>
      client.getBlob(`/meetings/${meetingId}/minutes.pdf${version === 'final' ? '?version=final' : ''}`),

    // Final minutes (Final MOM): drafted (AI or notes), edited, then marked final.
    getFinalMinutes: (meetingId: string) => client.get<{ data: FinalMinutes }>(`/meetings/${meetingId}/final-minutes`).then((r) => r.data),
    /** A first draft to edit (not kept until saved). */
    draftFinalMinutes: (meetingId: string, source: 'ai' | 'notes') =>
      client.post<{ data: { content: FinalMinutesContent; source: 'ai' | 'notes' } }>(`/meetings/${meetingId}/final-minutes/draft`, { source }).then((r) => r.data),
    saveFinalMinutes: (meetingId: string, content: FinalMinutesContent) =>
      client.put<{ data: FinalMinutes }>(`/meetings/${meetingId}/final-minutes`, { content }).then((r) => r.data),
    /** Mark them final: with the content on screen, or what was saved. */
    approveFinalMinutes: (meetingId: string, content?: FinalMinutesContent) =>
      client.post<{ data: FinalMinutes }>(`/meetings/${meetingId}/final-minutes/approve`, content ? { content } : {}).then((r) => r.data),
    reopenFinalMinutes: (meetingId: string) => client.post<{ data: FinalMinutes }>(`/meetings/${meetingId}/final-minutes/reopen`, {}).then((r) => r.data),

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

    /** Who an invitation would go to, and anything to fix first (sends nothing). */
    previewInvites: (meetingId: string) => client.get<{ data: InvitePreview }>(`/meetings/${meetingId}/invites/preview`).then((r) => r.data),
    /**
     * Send calendar invitations (.ics): to everyone, or only to people not invited yet. Once
     * invitations went out, sending everyone again needs `resend` (the server answers 409 otherwise).
     */
    sendInvites: (meetingId: string, opts: { onlyNew?: boolean; resend?: boolean } = {}) =>
      client.post<{ data: SendReport }>(`/meetings/${meetingId}/invites`, opts).then((r) => r.data),
    /** The minutes email as it will be sent, and to whom (sends nothing). */
    previewMinutes: (meetingId: string) => client.get<{ data: MinutesPreview }>(`/meetings/${meetingId}/minutes/preview`).then((r) => r.data),
    /** Email the branded minutes PDF — to everyone, or to the chosen people's addresses. */
    sendMinutes: (meetingId: string, recipients?: string[]) =>
      client.post<{ data: SendReport }>(`/meetings/${meetingId}/minutes/send`, recipients ? { recipients } : {}).then((r) => r.data),
  };
}
