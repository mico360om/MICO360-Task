import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type {
  MeetingRecord,
  CreateMeetingData,
  UpdateMeetingData,
  MeetingListFilter,
  MeetingRepository,
  MeetingStatus,
} from './meeting-repository';

export interface MeetingServiceDeps {
  meetings: MeetingRepository;
  /** Fired after a meeting is created/updated (activity, calendar refresh, reminders). */
  onChanged?: (meeting: MeetingRecord, event: 'created' | 'updated' | 'cancelled') => void | Promise<void>;
}

const VALID_STATUS: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export function createMeetingService({ meetings, onChanged }: MeetingServiceDeps) {
  async function getMeeting(id: string): Promise<MeetingRecord> {
    const m = await meetings.findById(id);
    if (!m) throw new NotFoundError('Meeting not found.');
    return m;
  }

  async function createMeeting(input: CreateMeetingData): Promise<MeetingRecord> {
    if (!input.title.trim()) throw new ValidationError('A meeting title is required.');
    if (input.endAt && input.endAt < input.startAt) throw new ValidationError('The meeting cannot end before it starts.');
    const created = await meetings.create({ ...input, title: input.title.trim() });
    await onChanged?.(created, 'created');
    return created;
  }

  async function updateMeeting(id: string, patch: UpdateMeetingData): Promise<MeetingRecord> {
    const current = await getMeeting(id);
    if (patch.status && !VALID_STATUS.includes(patch.status)) throw new ValidationError('Invalid meeting status.');
    const start = patch.startAt ?? current.startAt;
    const end = patch.endAt !== undefined ? patch.endAt : current.endAt;
    if (end && end < start) throw new ValidationError('The meeting cannot end before it starts.');
    const updated = await meetings.update(id, patch);
    await onChanged?.(updated, patch.status === 'CANCELLED' ? 'cancelled' : 'updated');
    return updated;
  }

  async function cancelMeeting(id: string): Promise<MeetingRecord> {
    await getMeeting(id);
    const updated = await meetings.update(id, { status: 'CANCELLED' });
    await onChanged?.(updated, 'cancelled');
    return updated;
  }

  /** Duplicate a meeting's core details into a fresh DRAFT (attendees/agenda copied by the caller). */
  async function duplicateMeeting(id: string, actorId: string): Promise<MeetingRecord> {
    const src = await getMeeting(id);
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
      timeZone: src.timeZone,
      // A duplicate is a one-off draft — it does not inherit the recurrence.
      createdById: actorId,
    });
    await onChanged?.(copy, 'created');
    return copy;
  }

  async function listMeetings(filter: MeetingListFilter): Promise<MeetingRecord[]> {
    return meetings.list(filter);
  }

  async function deleteMeeting(id: string): Promise<void> {
    await getMeeting(id);
    await meetings.softDelete(id);
  }

  return { getMeeting, createMeeting, updateMeeting, cancelMeeting, duplicateMeeting, listMeetings, deleteMeeting };
}

export type MeetingService = ReturnType<typeof createMeetingService>;
