import type { MeetingAccessCore, MeetingRepository } from './meeting-repository';
import type { MeetingView } from './invitee-view';

/** Project-scope facts the meeting access layer borrows from the projects module. */
export interface ProjectAccessLike {
  canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
  /** Project ids the user may see; null = admin (no scoping). With a pick (companies): that company's (admins too). */
  accessibleProjectIds(userId: string, roles: string[], pick?: string | null): Promise<string[] | null>;
  /** Does the user manage this project (its manager / owner)? Managers may edit its meetings. */
  canManageProject?(userId: string, roles: string[], projectId: string): Promise<boolean>;
}

export interface MeetingAccessDeps {
  meetings: Pick<MeetingRepository, 'accessCore'>;
  projectAccess?: ProjectAccessLike;
  /**
   * companies (CompanyAccess.meetingView): how the meeting's own people (organizer, creator,
   * attendees) see it — 'invitee' when it has a project they share no active company with.
   * Absent: they all have the full view, as before.
   */
  meetingView?: (viewer: { id: string; roles: string[] }, m: MeetingAccessCore) => Promise<'full' | 'invitee' | null>;
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
 *
 * companies (spec §8.8): someone invited (or organizing) from outside the project's companies gets
 * the invitee view of that one meeting (`viewOf` → 'invitee'); `canViewMeeting` is the full view.
 */
export function createMeetingAccess({ meetings, projectAccess, meetingView }: MeetingAccessDeps) {
  /** How this person sees the meeting: 'full', 'invitee' (invited from another company) or not at all. */
  async function viewOf(userId: string, roles: string[], meetingId: string): Promise<MeetingView> {
    if (isAdmin(roles)) return 'full';
    const core = await meetings.accessCore(meetingId);
    if (!core) return null;
    if (core.organizerId === userId || core.createdById === userId || core.attendeeUserIds.includes(userId)) {
      // companies: 'full', 'invitee', or none at all (all their companies archived).
      return meetingView ? await meetingView({ id: userId, roles }, core) : 'full';
    }
    if (core.projectId && projectAccess) return (await projectAccess.canViewProject(userId, roles, core.projectId)) ? 'full' : null;
    return null;
  }

  /**
   * The minutes email (1.22): how this person would see the meeting if they were one of its people —
   * the companies rule asked as if they were on it ('invitee': another company, their own copy; null:
   * no access). Without the rule: 'full' for anyone (the email is the sender's to address).
   */
  async function recipientViewOf(userId: string, roles: string[], meetingId: string): Promise<MeetingView> {
    if (isAdmin(roles)) return 'full';
    const core = await meetings.accessCore(meetingId);
    if (!core) return null;
    if (!meetingView) return 'full';
    const onIt = core.attendeeUserIds.includes(userId) ? core : { ...core, attendeeUserIds: [...core.attendeeUserIds, userId] };
    return meetingView({ id: userId, roles }, onIt);
  }

  /** The full view: everything of the meeting the person's rights allow (not an invitee's view). */
  async function canViewMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean> {
    return (await viewOf(userId, roles, meetingId)) === 'full';
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

  /**
   * Project ids the user may see (null = admin) — used to scope meeting/search lists. companies:
   * with a picked company, that company's projects they may see (an admin: all of that company's).
   */
  async function accessibleProjectIds(userId: string, roles: string[], pick?: string | null): Promise<string[] | null> {
    if (isAdmin(roles) && !pick) return null;
    return projectAccess ? projectAccess.accessibleProjectIds(userId, roles, pick) : [];
  }

  return { canViewMeeting, viewOf, recipientViewOf, canEditMeeting, canEditMeetingRecord, accessibleProjectIds };
}

export type MeetingAccess = ReturnType<typeof createMeetingAccess>;

/** Signature shared by every "may this user change this meeting?" check handed to a service. */
export type CanEditMeeting = (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
