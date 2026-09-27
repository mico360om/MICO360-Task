import type { MeetingAccessCore, MeetingRepository } from './meeting-repository';

/** Project-scope facts the meeting access layer borrows from the projects module. */
export interface ProjectAccessLike {
  canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** Project ids the user may see; null = admin (no scoping). */
  accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null>;
  /** Does the user manage this project (its manager / owner)? Managers may edit its meetings. */
  canManageProject?(userId: string, roles: string[], projectId: string): Promise<boolean>;
}

export interface MeetingAccessDeps {
  meetings: Pick<MeetingRepository, 'accessCore'>;
  projectAccess?: ProjectAccessLike;
}

const isAdmin = (roles: string[]): boolean => roles.includes('ADMIN');

/** The facts an edit decision needs — a full MeetingRecord or its access core both fit. */
export type MeetingEditFacts = Pick<MeetingAccessCore, 'organizerId' | 'createdById' | 'projectId'>;

/**
 * Object-level authorization for meetings:
 * - admin sees and edits everything;
 * - the organizer, the creator, and any attendee may view a meeting;
 * - a project meeting is additionally visible to that project's members;
 * - only the organizer, the creator, the project's manager or an admin may change it
 *   (edit, cancel, delete, invite, send minutes, change attendees or the agenda).
 * Standalone meetings are visible only to their organizer/creator/attendees.
 */
export function createMeetingAccess({ meetings, projectAccess }: MeetingAccessDeps) {
  async function canViewMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean> {
    if (isAdmin(roles)) return true;
    const core = await meetings.accessCore(meetingId);
    if (!core) return false;
    if (core.organizerId === userId || core.createdById === userId) return true;
    if (core.attendeeUserIds.includes(userId)) return true;
    if (core.projectId && projectAccess) return projectAccess.canViewProject(userId, roles, core.projectId);
    return false;
  }

  /** May this user change a meeting whose facts are already loaded (no extra meeting query)? */
  async function canEditMeetingRecord(meeting: MeetingEditFacts, userId: string, roles: string[]): Promise<boolean> {
    if (isAdmin(roles)) return true;
    if (meeting.organizerId === userId || meeting.createdById === userId) return true;
    if (meeting.projectId && projectAccess?.canManageProject) {
      return projectAccess.canManageProject(userId, roles, meeting.projectId);
    }
    return false;
  }

  async function canEditMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean> {
    const core = await meetings.accessCore(meetingId);
    if (!core) return false;
    return canEditMeetingRecord(core, userId, roles);
  }

  /** Project ids the user may see (null = admin) — used to scope meeting/search lists. */
  async function accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null> {
    if (isAdmin(roles)) return null;
    return projectAccess ? projectAccess.accessibleProjectIds(userId, roles) : [];
  }

  return { canViewMeeting, canEditMeeting, canEditMeetingRecord, accessibleProjectIds };
}

export type MeetingAccess = ReturnType<typeof createMeetingAccess>;

/** Signature shared by every "may this user change this meeting?" check handed to a service. */
export type CanEditMeeting = (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
