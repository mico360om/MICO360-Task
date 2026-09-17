import { NotFoundError, ValidationError, ConflictError } from '../../lib/http-errors';
import type {
  AttendeeRepository,
  AttendeeRecord,
  AttendeeRole,
  AttendanceStatus,
} from './attendee-repository';

const ROLES: AttendeeRole[] = ['REQUIRED', 'OPTIONAL'];
const STATUSES: AttendanceStatus[] = ['INVITED', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

export interface AddAttendeeInput {
  userId?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  role?: AttendeeRole;
  attendance?: AttendanceStatus;
  department?: string | null;
}

export interface AttendeeServiceDeps {
  attendees: AttendeeRepository;
  /** Fired after the attendee roster changes, so the meeting aggregate can broadcast. */
  onChanged?: (meetingId: string) => void;
}

export interface AttendeeService {
  listAttendees(meetingId: string): Promise<AttendeeRecord[]>;
  addAttendee(meetingId: string, input: AddAttendeeInput): Promise<AttendeeRecord>;
  setAttendance(meetingId: string, attendeeId: string, attendance: AttendanceStatus): Promise<AttendeeRecord>;
  updateAttendee(meetingId: string, attendeeId: string, patch: { role?: AttendeeRole; department?: string | null }): Promise<AttendeeRecord>;
  removeAttendee(meetingId: string, attendeeId: string): Promise<void>;
  /** Internal users seen on the given previous meetings, minus those already on this meeting. */
  suggestAttendees(meetingId: string, previousMeetingIds: string[]): Promise<string[]>;
}

const trim = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

export function createAttendeeService(deps: AttendeeServiceDeps): AttendeeService {
  const { attendees } = deps;

  async function requireInMeeting(meetingId: string, attendeeId: string): Promise<AttendeeRecord> {
    const rec = await attendees.findById(attendeeId);
    if (!rec || rec.meetingId !== meetingId) throw new NotFoundError('Attendee not found.');
    return rec;
  }

  return {
    async listAttendees(meetingId) {
      return attendees.listByMeeting(meetingId);
    },

    async addAttendee(meetingId, input) {
      const userId = trim(input.userId);
      const externalName = trim(input.externalName);
      if (!userId && !externalName) {
        throw new ValidationError('An attendee needs either a user or an external name.');
      }
      if (input.role && !ROLES.includes(input.role)) throw new ValidationError('Invalid attendee role.');
      if (input.attendance && !STATUSES.includes(input.attendance)) throw new ValidationError('Invalid attendance status.');
      if (userId) {
        const existing = await attendees.listByMeeting(meetingId);
        if (existing.some((a) => a.userId === userId)) {
          throw new ConflictError('This person is already an attendee.');
        }
      }
      const rec = await attendees.add({
        meetingId,
        userId,
        externalName,
        externalEmail: trim(input.externalEmail),
        role: input.role ?? 'REQUIRED',
        attendance: input.attendance ?? 'INVITED',
        department: trim(input.department),
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async setAttendance(meetingId, attendeeId, attendance) {
      if (!STATUSES.includes(attendance)) throw new ValidationError('Invalid attendance status.');
      await requireInMeeting(meetingId, attendeeId);
      const rec = await attendees.update(attendeeId, { attendance });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async updateAttendee(meetingId, attendeeId, patch) {
      if (patch.role && !ROLES.includes(patch.role)) throw new ValidationError('Invalid attendee role.');
      await requireInMeeting(meetingId, attendeeId);
      const rec = await attendees.update(attendeeId, {
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.department !== undefined ? { department: trim(patch.department) } : {}),
      });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async removeAttendee(meetingId, attendeeId) {
      await requireInMeeting(meetingId, attendeeId);
      await attendees.remove(attendeeId);
      deps.onChanged?.(meetingId);
    },

    async suggestAttendees(meetingId, previousMeetingIds) {
      if (previousMeetingIds.length === 0) return [];
      const seen = await attendees.distinctUserIdsForMeetings(previousMeetingIds);
      const current = new Set((await attendees.listByMeeting(meetingId)).map((a) => a.userId).filter(Boolean));
      return seen.filter((u) => !current.has(u));
    },
  };
}
