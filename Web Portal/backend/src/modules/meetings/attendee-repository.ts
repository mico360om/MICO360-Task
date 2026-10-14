export type AttendeeRole = 'REQUIRED' | 'OPTIONAL';
export type AttendanceStatus = 'INVITED' | 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
/** The answer to the invitation — separate from the role (required/optional) and from attendance on the day. */
export type InvitationResponse = 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';

export interface AttendeeRecord {
  id: string;
  meetingId: string;
  /** Internal attendee (a platform user); null for an external/guest attendee. */
  userId: string | null;
  externalName: string | null;
  externalEmail: string | null;
  role: AttendeeRole;
  attendance: AttendanceStatus;
  response: InvitationResponse;
  respondedAt: Date | null;
  /** When this person's own invitation was delivered (null = not invited yet). */
  invitedAt: Date | null;
  department: string | null;
  createdAt: Date;
}

export interface CreateAttendeeData {
  meetingId: string;
  userId?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  role?: AttendeeRole;
  attendance?: AttendanceStatus;
  department?: string | null;
}

export interface UpdateAttendeeData {
  role?: AttendeeRole;
  attendance?: AttendanceStatus;
  department?: string | null;
  response?: InvitationResponse;
  respondedAt?: Date | null;
}

export interface AttendeeRepository {
  add(data: CreateAttendeeData): Promise<AttendeeRecord>;
  findById(id: string): Promise<AttendeeRecord | null>;
  listByMeeting(meetingId: string): Promise<AttendeeRecord[]>;
  /** Internal user ids that attended (any status) across the given meetings — for "suggest from previous". */
  distinctUserIdsForMeetings(meetingIds: string[]): Promise<string[]>;
  update(id: string, patch: UpdateAttendeeData): Promise<AttendeeRecord>;
  remove(id: string): Promise<void>;
  /** Stamp these attendees as invited (their invitation was delivered at `at`). */
  markInvited?(ids: string[], at: Date): Promise<void>;
}
