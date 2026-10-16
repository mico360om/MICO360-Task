import { NotFoundError, ValidationError, ConflictError } from '../../lib/http-errors';
import type {
  AttendeeRepository,
  AttendeeRecord,
  AttendeeRole,
  AttendanceStatus,
  InvitationResponse,
} from './attendee-repository';
import type { CanEditMeeting } from './meeting-access';

const ROLES: AttendeeRole[] = ['REQUIRED', 'OPTIONAL'];
const STATUSES: AttendanceStatus[] = ['INVITED', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const RESPONSES: InvitationResponse[] = ['PENDING', 'ACCEPTED', 'TENTATIVE', 'DECLINED'];

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
  /**
   * Fired after an attendee is removed (server.ts retracts their calendar invitation), with the
   * later meetings of the series they were taken off at the same time.
   */
  onRemoved?: (meetingId: string, attendee: AttendeeRecord, alsoFrom: string[]) => void;
  /** The upcoming meetings after this one in its series: people added or removed carry on to them. */
  laterMeetings?: (meetingId: string) => Promise<string[]>;
  /** Who may change the roster (organizer / creator / project manager / admin). Open when not wired. */
  canEditMeeting?: CanEditMeeting;
  now?: () => Date;
}

export interface AttendeeService {
  /** May this user change the meeting's roster? */
  canEditMeeting: CanEditMeeting;
  listAttendees(meetingId: string): Promise<AttendeeRecord[]>;
  getAttendee(meetingId: string, attendeeId: string): Promise<AttendeeRecord>;
  addAttendee(meetingId: string, input: AddAttendeeInput): Promise<AttendeeRecord>;
  setAttendance(meetingId: string, attendeeId: string, attendance: AttendanceStatus): Promise<AttendeeRecord>;
  /** Record the answer to the invitation (PENDING = no answer yet, which forgets when). */
  setResponse(meetingId: string, attendeeId: string, response: InvitationResponse): Promise<AttendeeRecord>;
  updateAttendee(meetingId: string, attendeeId: string, patch: { role?: AttendeeRole; department?: string | null }): Promise<AttendeeRecord>;
  removeAttendee(meetingId: string, attendeeId: string): Promise<void>;
  /** Internal users seen on the given previous meetings, minus those already on this meeting. */
  suggestAttendees(meetingId: string, previousMeetingIds: string[]): Promise<string[]>;
}

const trim = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t.length ? t : null;
};

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Is `a` the same person as `who` (the same user; a guest by email, or by name without one)? */
function samePerson(a: Pick<AttendeeRecord, 'userId' | 'externalEmail' | 'externalName'>, who: { userId: string | null; externalEmail: string | null; externalName: string | null }): boolean {
  if (who.userId) return a.userId === who.userId;
  if (a.userId) return false;
  return who.externalEmail ? same(a.externalEmail, who.externalEmail) : !a.externalEmail && same(a.externalName, who.externalName);
}

export function createAttendeeService(deps: AttendeeServiceDeps): AttendeeService {
  const { attendees } = deps;
  const now = deps.now ?? (() => new Date());

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
      // The same guest twice: same email, or — when no email was given — the same name.
      const who = { userId, externalName, externalEmail: trim(input.externalEmail) };
      const existing = await attendees.listByMeeting(meetingId);
      if (existing.some((a) => samePerson(a, who))) {
        throw new ConflictError(userId ? 'This person is already an attendee.' : 'This guest is already an attendee.');
      }
      const data = { ...who, role: input.role ?? 'REQUIRED', attendance: input.attendance ?? 'INVITED', department: trim(input.department) };
      const rec = await attendees.add({ meetingId, ...data });
      deps.onChanged?.(meetingId);
      // In a series they join the later meetings too (where they aren't already).
      for (const later of (await deps.laterMeetings?.(meetingId)) ?? []) {
        if ((await attendees.listByMeeting(later)).some((a) => samePerson(a, who))) continue;
        await attendees.add({ meetingId: later, ...data, attendance: 'INVITED' });
        deps.onChanged?.(later);
      }
      return rec;
    },

    async setAttendance(meetingId, attendeeId, attendance) {
      if (!STATUSES.includes(attendance)) throw new ValidationError('Invalid attendance status.');
      await requireInMeeting(meetingId, attendeeId);
      const rec = await attendees.update(attendeeId, { attendance });
      deps.onChanged?.(meetingId);
      return rec;
    },

    async setResponse(meetingId, attendeeId, response) {
      if (!RESPONSES.includes(response)) throw new ValidationError('Invalid invitation response.');
      await requireInMeeting(meetingId, attendeeId);
      const rec = await attendees.update(attendeeId, { response, respondedAt: response === 'PENDING' ? null : now() });
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
      // In a series they leave the later meetings too.
      const alsoFrom: string[] = [];
      for (const later of (await deps.laterMeetings?.(meetingId)) ?? []) {
        const match = (await attendees.listByMeeting(later)).find((a) => samePerson(a, rec));
        if (!match) continue;
        await attendees.remove(match.id);
        alsoFrom.push(later);
        deps.onChanged?.(later);
      }
      await attendees.remove(attendeeId);
      deps.onChanged?.(meetingId);
      deps.onRemoved?.(meetingId, rec, alsoFrom);
    },

    async suggestAttendees(meetingId, previousMeetingIds) {
      if (previousMeetingIds.length === 0) return [];
      const seen = await attendees.distinctUserIdsForMeetings(previousMeetingIds);
      const current = new Set((await attendees.listByMeeting(meetingId)).map((a) => a.userId).filter(Boolean));
      return seen.filter((u) => !current.has(u));
    },
  };
}
