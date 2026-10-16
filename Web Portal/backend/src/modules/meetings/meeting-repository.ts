/** Recurrence rule for a meeting — same shape as a task's (reused engine). */
export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  interval: number;
  count?: number | null;
  until?: string | null;
  weekdays?: number[];
  dayOfMonth?: number;
  /** MONTHLY/QUARTERLY: "the 2nd Tuesday" (week 1–4 or -1 = last; day 0 = Sunday). */
  nthWeekday?: { week: 1 | 2 | 3 | 4 | -1; day: number };
  /** The first meeting's day of the month, kept so a 31st clamped to the 30th comes back. */
  anchorDay?: number;
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
  /** On the first meeting of a series: the series' rule (null on its other meetings and one-offs). */
  recurrenceRule: RecurrenceRule | null;
  /** On the other meetings of a series: the first meeting's id. */
  recurrenceParentId: string | null;
  /** A series meeting's place in the series — the start its rule gave it, kept if it's moved on its own. */
  recurrenceStart?: Date | null;
  templateId: string | null;
  transcript: string | null;
  /** When calendar invitations were last sent to attendees (null = never). */
  invitesSentAt: Date | null;
  /** When the pre-meeting reminder was sent (null = not yet). */
  reminderSentAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  /** Set only on records read with their deleted series meetings (series bookkeeping). */
  deletedAt?: Date | null;
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
  recurrenceStart?: Date | null;
  templateId?: string | null;
  /** A new meeting of an already-invited series is in attendees' calendars already. */
  invitesSentAt?: Date | null;
  createdById: string;
}

export type UpdateMeetingData = Partial<Omit<CreateMeetingData, 'createdById'>>;

export interface MeetingListFilter {
  projectId?: string;
  status?: MeetingStatus;
  /** Only meetings this user organizes ("Organized by me"). */
  organizerId?: string;
  /** Only meetings starting in [from, to) (the calendar's range). */
  from?: Date;
  to?: Date;
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
  /** Stamp when invitations / a reminder were sent (for status + reminder dedup); null clears it. */
  markInvitesSent(id: string, at: Date): Promise<void>;
  markReminderSent(id: string, at: Date | null): Promise<void>;
  /** Active meetings starting within [now, now+leadMs] whose reminder hasn't been sent (for the sweep). */
  listUpcomingWithoutReminder(now: Date, leadMs: number): Promise<MeetingRecord[]>;
}

/** What a repeating series needs on top of the plain meeting store. Records carry `deletedAt`. */
export interface MeetingSeriesStore {
  /** A meeting even when it was deleted (a series' first meeting still holds the rule). */
  findAnyById(id: string): Promise<MeetingRecord | null>;
  /** The first meeting and every other meeting of a series, deleted ones included, in series order. */
  listSeries(rootId: string): Promise<MeetingRecord[]>;
  /** First meetings of series whose rule may still have meetings to create. */
  listSeriesRoots(): Promise<MeetingRecord[]>;
  /** Re-time / regroup several meetings at once (their series places are cleared first, so swaps can't collide). */
  applySeriesChanges(changes: Array<{ id: string; patch: UpdateMeetingData }>): Promise<void>;
  /** Delete meetings; `detach` also takes them out of their series (their places can be used again). */
  removeMany(ids: string[], opts?: { detach?: boolean }): Promise<void>;
}
