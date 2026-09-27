import { NotFoundError, ValidationError } from '../../lib/http-errors';
import { createMeetingAccess, type MeetingEditFacts } from './meeting-access';
import type {
  MeetingRecord,
  CreateMeetingData,
  UpdateMeetingData,
  MeetingListFilter,
  MeetingRepository,
  MeetingStatus,
} from './meeting-repository';

export type MeetingChangeKind = 'created' | 'updated' | 'cancelled' | 'deleted';

export interface MeetingServiceDeps {
  meetings: MeetingRepository;
  /** Fired after a meeting is created/updated/cancelled/deleted (realtime refresh, activity). */
  onChanged?: (meeting: MeetingRecord, event: MeetingChangeKind) => void | Promise<void>;
  /**
   * Who may change a meeting. Defaults to organizer / creator / admin; server.ts passes the full
   * check (which also lets the meeting's project manager edit it).
   */
  access?: {
    canEditMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean>;
    canEditMeetingRecord(meeting: MeetingEditFacts, userId: string, roles: string[]): Promise<boolean>;
  };
  /** Company time zone: stored on new meetings that don't name one, and shown for legacy ones. */
  defaultTimeZone?: string;
  /** Is this an existing, active user? Guards the organizer field (no organizer can be invented). */
  isActiveUser?: (userId: string) => Promise<boolean>;
}

const VALID_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export function createMeetingService({ meetings, onChanged, access, defaultTimeZone, isActiveUser }: MeetingServiceDeps) {
  const permissions = access ?? createMeetingAccess({ meetings });
  const withZone = (m: MeetingRecord): MeetingRecord => (m.timeZone || !defaultTimeZone ? m : { ...m, timeZone: defaultTimeZone });

  async function load(id: string): Promise<MeetingRecord> {
    const m = await meetings.findById(id);
    if (!m) throw new NotFoundError('Meeting not found.');
    return m;
  }

  async function getMeeting(id: string): Promise<MeetingRecord> {
    return withZone(await load(id));
  }

  async function assertOrganizer(organizerId: string): Promise<void> {
    if (isActiveUser && !(await isActiveUser(organizerId))) {
      throw new ValidationError('The organizer must be an active user.');
    }
  }

  async function createMeeting(input: CreateMeetingData): Promise<MeetingRecord> {
    if (!input.title.trim()) throw new ValidationError('A meeting title is required.');
    if (input.endAt && input.endAt < input.startAt) throw new ValidationError('The meeting cannot end before it starts.');
    await assertOrganizer(input.organizerId);
    const created = await meetings.create({
      ...input,
      title: input.title.trim(),
      timeZone: input.timeZone || defaultTimeZone || null,
    });
    await onChanged?.(created, 'created');
    return withZone(created);
  }

  async function updateMeeting(id: string, patch: UpdateMeetingData): Promise<MeetingRecord> {
    const current = await load(id);
    if (patch.status && !VALID_STATUS.includes(patch.status)) throw new ValidationError('Invalid meeting status.');
    if (patch.title !== undefined && !patch.title.trim()) throw new ValidationError('A meeting title is required.');
    const start = patch.startAt ?? current.startAt;
    const end = patch.endAt !== undefined ? patch.endAt : current.endAt;
    if (end && end < start) throw new ValidationError('The meeting cannot end before it starts.');
    if (patch.organizerId !== undefined && patch.organizerId !== current.organizerId) await assertOrganizer(patch.organizerId);
    let updated = await meetings.update(id, {
      ...patch,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    });
    // A rescheduled meeting needs a fresh reminder for its new time.
    const rescheduled = patch.startAt !== undefined && patch.startAt.getTime() !== current.startAt.getTime();
    if (rescheduled && current.reminderSentAt) {
      await meetings.markReminderSent(id, null);
      updated = { ...updated, reminderSentAt: null };
    }
    const cancelled = patch.status === 'CANCELLED' && current.status !== 'CANCELLED';
    await onChanged?.(updated, cancelled ? 'cancelled' : 'updated');
    return withZone(updated);
  }

  async function cancelMeeting(id: string): Promise<MeetingRecord> {
    await load(id);
    const updated = await meetings.update(id, { status: 'CANCELLED' });
    await onChanged?.(updated, 'cancelled');
    return withZone(updated);
  }

  /** Duplicate a meeting's core details into a fresh DRAFT (attendees/agenda copied by the caller). */
  async function duplicateMeeting(id: string, actorId: string): Promise<MeetingRecord> {
    const src = await load(id);
    const copy = await meetings.create({
      title: `Copy of ${src.title}`,
      description: src.description,
      category: src.category,
      status: 'DRAFT',
      projectId: src.projectId,
      organizerId: src.organizerId,
      location: src.location,
      onlineLink: src.onlineLink,
      startAt: src.startAt,
      endAt: src.endAt,
      timeZone: src.timeZone || defaultTimeZone || null,
      // A duplicate is a one-off draft — it does not inherit the recurrence.
      createdById: actorId,
    });
    await onChanged?.(copy, 'created');
    return withZone(copy);
  }

  async function listMeetings(filter: MeetingListFilter): Promise<MeetingRecord[]> {
    return (await meetings.list(filter)).map(withZone);
  }

  /** Soft-delete a meeting; returns the record as it was, so callers can notify its invitees. */
  async function deleteMeeting(id: string): Promise<MeetingRecord> {
    const current = await load(id);
    await meetings.softDelete(id);
    await onChanged?.(current, 'deleted');
    return withZone(current);
  }

  /** May this user change the meeting (edit, cancel, delete, invite, attendees, agenda, minutes)? */
  function canEditMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean> {
    return permissions.canEditMeeting(userId, roles, meetingId);
  }

  /** The same check for a meeting that's already loaded — used to add `canEdit` to responses. */
  function canEditMeetingRecord(meeting: MeetingEditFacts, userId: string, roles: string[]): Promise<boolean> {
    return permissions.canEditMeetingRecord(meeting, userId, roles);
  }

  return {
    getMeeting,
    createMeeting,
    updateMeeting,
    cancelMeeting,
    duplicateMeeting,
    listMeetings,
    deleteMeeting,
    canEditMeeting,
    canEditMeetingRecord,
  };
}

export type MeetingService = ReturnType<typeof createMeetingService>;
