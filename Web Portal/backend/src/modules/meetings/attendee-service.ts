import { NotFoundError, ValidationError, ConflictError } from '../../lib/http-errors';
import type {
  AttendeeRepository,
  AttendeeRecord,
  AttendeeRole,
  AttendanceStatus,
} from './attendee-repository';
import type { CanEditMeeting } from './meeting-access';

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
  /** Fired after an attendee is removed (server.ts retracts their calendar invitation). */
  onRemoved?: (meetingId: string, attendee: AttendeeRecord) => void;
  /** Who may change the roster (organizer / creator / project manager / admin). Open when not wired. */
  canEditMeeting?: CanEditMeeting;
}

export interface AttendeeService {
  /** May this user change the meeting's roster? */
  canEditMeeting: CanEditMeeting;
  listAttendees(meetingId: string): Promise<AttendeeRecord[]>;
  getAttendee(meetingId: string, attendeeId: string): Promise<AttendeeRecord>;
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
    canEditMeeting: (userId, roles, meetingId) => (deps.canEditMeeting ? deps.canEditMeeting(userId, roles, meetingId) : Promise.resolve(true)),

    async listAttendees(meetingId) {
      return attendees.listByMeeting(meetingId);
    },

    async getAttendee(meetingId, attendeeId) {
      return requireInMeeting(meetingId, attendeeId);
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
      const rec = await requireInMeeting(meetingId, attendeeId);
      await attendees.remove(attendeeId);
      deps.onChanged?.(meetingId);
      deps.onRemoved?.(meetingId, rec);
    },

    async suggestAttendees(meetingId, previousMeetingIds) {
      if (previousMeetingIds.length === 0) return [];
      const seen = await attendees.distinctUserIdsForMeetings(previousMeetingIds);
      const current = new Set((await attendees.listByMeeting(meetingId)).map((a) => a.userId).filter(Boolean));
      return seen.filter((u) => !current.has(u));
    },
  };
}
