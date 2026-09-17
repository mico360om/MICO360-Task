/** Recurrence rule for a meeting — same shape as a task's (reused engine). */
export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  interval: number;
  count?: number | null;
  until?: string | null;
  weekdays?: number[];
  dayOfMonth?: number;
  paused?: boolean;
}

export type MeetingStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface MeetingRecord {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: MeetingStatus;
  projectId: string | null;
  organizerId: string;
  location: string | null;
  onlineLink: string | null;
  startAt: Date;
  endAt: Date | null;
  timeZone: string | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
  templateId: string | null;
  transcript: string | null;
  /** When calendar invitations were last sent to attendees (null = never). */
  invitesSentAt: Date | null;
  /** When the pre-meeting reminder was sent (null = not yet). */
  reminderSentAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMeetingData {
  title: string;
  description?: string | null;
  category?: string | null;
  status?: MeetingStatus;
  projectId?: string | null;
  organizerId: string;
  location?: string | null;
  onlineLink?: string | null;
  startAt: Date;
  endAt?: Date | null;
  timeZone?: string | null;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceParentId?: string | null;
  templateId?: string | null;
  createdById: string;
}

export type UpdateMeetingData = Partial<Omit<CreateMeetingData, 'createdById'>>;

export interface MeetingListFilter {
  projectId?: string;
  status?: MeetingStatus;
  /** Restrict to meetings the user organizes or attends, or in these project ids (null = no scope). */
  scope?: { userId: string; projectIds: string[] | null };
}

/** Minimal facts the access layer needs to decide who can see a meeting. */
export interface MeetingAccessCore {
  organizerId: string;
  createdById: string;
  projectId: string | null;
  attendeeUserIds: string[];
}

export interface MeetingRepository {
  create(data: CreateMeetingData): Promise<MeetingRecord>;
  findById(id: string): Promise<MeetingRecord | null>;
  list(filter: MeetingListFilter): Promise<MeetingRecord[]>;
  update(id: string, patch: UpdateMeetingData): Promise<MeetingRecord>;
  softDelete(id: string): Promise<void>;
  /** Access facts (organizer/creator/project + attendee user ids) for authorization. */
  accessCore(id: string): Promise<MeetingAccessCore | null>;
  /** Stamp when invitations / a reminder were sent (for status + reminder dedup). */
  markInvitesSent(id: string, at: Date): Promise<void>;
  markReminderSent(id: string, at: Date): Promise<void>;
  /** Active meetings starting within [now, now+leadMs] whose reminder hasn't been sent (for the sweep). */
  listUpcomingWithoutReminder(now: Date, leadMs: number): Promise<MeetingRecord[]>;
}
