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
  /** companies: the company of a meeting without a project (a project meeting's is its project's: null). */
  companyId?: string | null;
  organizerId: string;
  location: string | null;
  onlineLink: string | null;
  /** 1.23: 'TEAMS' when the online link was made (or is to be made) by Microsoft Teams; null for a hand-pasted link. */
  onlineMeetingProvider?: 'TEAMS' | null;
  /** 1.23: a Teams link was asked for but couldn't be made yet (the meeting page offers "Make Teams link"). */
  teamsLinkPending?: boolean;
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
  /** When the old one-hour reminder email was sent (no longer stamped: reminders are in meeting_reminder_sends). */
  reminderSentAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  /** Set only on records read with their deleted series meetings (series bookkeeping). */
  deletedAt?: Date | null;
  /**
   * 1.23: the named series it is in ("Monthly site review", named-series.ts), or null — not its repeat
   * family (that is recurrenceParentId / the `series` the routes add).
   */
  seriesId?: string | null;
}

export interface CreateMeetingData {
  title: string;
  description?: string | null;
  category?: string | null;
  status?: MeetingStatus;
  projectId?: string | null;
  /** companies: a meeting without a project belongs to a company. */
  companyId?: string | null;
  organizerId: string;
  location?: string | null;
  onlineLink?: string | null;
  /** 1.23: a repeat copies its family's Teams marker (the Teams service links the Teams meeting itself). */
  onlineMeetingProvider?: 'TEAMS' | null;
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
  /** 1.23: the named series it joins (checked by the caller: same project or company). */
  seriesId?: string | null;
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
  /**
   * Restrict to meetings the user organizes or attends, or in these project ids (null = no scope).
   * companies — `pick`: only the picked company's meetings: those of `projectIds` (the person's
   * projects in that company), and their own meetings (organizer or attendee) of any project of that
   * company or without a project but filed under it — every one of those for an administrator
   * (`everyone`). A meeting someone was only invited to (its project shares none of their companies)
   * shows under "All my companies" only.
   */
  scope?: {
    userId: string;
    projectIds: string[] | null;
    pick?: { companyId: string; everyone: boolean };
    /** 1.22: an administrator listing like a team member ("Show my projects only"): their own meetings count without an active company. */
    admin?: boolean;
  };
}

export type MeetingListScope = NonNullable<MeetingListFilter['scope']>;

/**
 * The scope of the plain meetings list (GET /meetings) — and of search's meetings (1.23), so the two
 * never differ: `projectIds` are the person's projects for a list (with the pick; null = an
 * administrator's every project); with a pick, that company's meetings (every one of them for an
 * administrator, unless "Show my projects only" is on); `mineOnly`: an administrator with that setting on.
 */
export function meetingListScope(a: { userId: string; projectIds: string[] | null; pick: string | null; admin: boolean; mineOnly: boolean }): MeetingListScope {
  return a.pick
    ? { userId: a.userId, projectIds: a.projectIds, pick: { companyId: a.pick, everyone: a.admin && !a.mineOnly } }
    : { userId: a.userId, projectIds: a.projectIds, ...(a.mineOnly ? { admin: true } : {}) };
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
  /** Stamp when invitations were sent (status + cancellation notices); markReminderSent clears the old one-hour reminder's stamp. */
  markInvitesSent(id: string, at: Date): Promise<void>;
  markReminderSent(id: string, at: Date | null): Promise<void>;
}

/** What a repeating series needs on top of the plain meeting store. Records carry `deletedAt`. */
export interface MeetingSeriesStore {
  /** A meeting even when it was deleted (a series' first meeting still holds the rule). */
  findAnyById(id: string): Promise<MeetingRecord | null>;
  /** The first meeting and every other meeting of a series, deleted ones included, in series order. */
  listSeries(rootId: string): Promise<MeetingRecord[]>;
  /** First meetings of series whose rule may still have meetings to create. */
  listSeriesRoots(): Promise<MeetingRecord[]>;
  /**
   * Change several meetings of a series in one transaction: the places being changed or freed are
   * cleared first (so swaps can't collide), `remove` is deleted and taken out of the series, then
   * the changes are written.
   */
  applySeriesChanges(changes: Array<{ id: string; patch: UpdateMeetingData }>, remove?: string[]): Promise<void>;
  /** Delete meetings; `detach` also takes them out of their series (their places can be used again). */
  removeMany(ids: string[], opts?: { detach?: boolean }): Promise<void>;
}

/** Closes meetings that are over (the sweep that keeps statuses true; only the database store has it). */
export interface EndedMeetingSweep {
  /**
   * Marks Completed every scheduled or started meeting that has ended by `now` (a meeting without
   * an end lasts an hour, as the app shows it); returns their ids. Drafts and cancelled ones stay.
   */
  completeEnded(now: Date): Promise<string[]>;
}

/** At most this many busy meetings are read for one window of free times. */
export const BUSY_ROWS_LIMIT = 2000;

/** The meetings that make people busy (free times; only the database store has it). */
export interface BusyMeetingsStore {
  /**
   * Non-cancelled, non-deleted meetings overlapping [from, to) that any of `userIds` organizes or
   * attends, with which of those people are in each. A meeting without an end lasts an hour.
   * At most BUSY_ROWS_LIMIT, earliest first.
   */
  busyBetween(userIds: string[], from: Date, to: Date, excludeMeetingId?: string): Promise<Array<{ meetingId: string; start: Date; end: Date; title: string; userIds: string[] }>>;
  /**
   * Which of these meetings the person may see, in one look-up: theirs (organizer, creator or
   * invited) or in a project they can see. `projectIds` null means every project (an admin).
   */
  visibleTo?(meetingIds: string[], userId: string, projectIds: string[] | null): Promise<Set<string>>;
}
