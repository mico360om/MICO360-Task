import type { MeetingRepository } from './meeting-repository';

/** Project-scope facts the meeting access layer borrows from the projects module. */
export interface ProjectAccessLike {
  canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** Project ids the user may see; null = admin (no scoping). */
  accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null>;
}

export interface MeetingAccessDeps {
  meetings: Pick<MeetingRepository, 'accessCore'>;
  projectAccess?: ProjectAccessLike;
}

const isAdmin = (roles: string[]): boolean => roles.includes('ADMIN');

/**
 * Object-level authorization for meetings:
 * - admin sees everything;
 * - the organizer, the creator, and any attendee may view a meeting;
 * - a project meeting is additionally visible to that project's members.
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

  /** Project ids the user may see (null = admin) — used to scope meeting/search lists. */
  async function accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null> {
    if (isAdmin(roles)) return null;
    return projectAccess ? projectAccess.accessibleProjectIds(userId, roles) : [];
  }

  return { canViewMeeting, accessibleProjectIds };
}

export type MeetingAccess = ReturnType<typeof createMeetingAccess>;
