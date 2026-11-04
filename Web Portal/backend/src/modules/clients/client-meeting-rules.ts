import type { PrismaClient } from '@prisma/client';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { CLIENT_ROLE } from './client-kind';

/**
 * 1.23 Client accounts and a meeting's emails (security review): a client attendee hears of a meeting
 * only while they may see it in the portal — an active client with the Meetings module on the
 * meeting's live project. The minutes go to them only as the client copy of approved minutes shown
 * to clients of that project, in an email of its own. Read fresh on every send.
 */
export interface ClientMeetingRules {
  /** May this user attendee be emailed about the meeting? Staff: yes; a client: only with access. */
  reach(meetingId: string, userId: string): Promise<boolean>;
  minutes: {
    /** A client with access, and the meeting's approved minutes are shown to clients of its project. */
    mayHave(meetingId: string, userId: string): Promise<boolean>;
    /** Their client copy of those minutes (null when they may not have it). */
    pdf(meetingId: string, userId: string): Promise<Buffer | null>;
  };
}

export function createClientMeetingRules(
  prisma: PrismaClient,
  deps: { clientMinutesPdf: (projectId: string, meetingId: string) => Promise<{ pdf: Buffer } | null> },
): ClientMeetingRules {
  const isClient = async (userId: string) => (await prisma.userRole.count({ where: { userId, role: { name: CLIENT_ROLE } } })) > 0;

  /** The meeting's project, when this client may see its meetings there (null otherwise). */
  async function accessibleProject(meetingId: string, userId: string): Promise<string | null> {
    const m = await prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, select: { projectId: true } });
    if (!m?.projectId) return null;
    const grant = await prisma.clientProjectGrant.findFirst({
      where: { userId, projectId: m.projectId, meetings: true, user: { deletedAt: null, status: 'ACTIVE' }, project: { deletedAt: null } },
      select: { project: { select: ARCHIVE_SELECT } },
    });
    if (!grant || archivedOf(grant.project)) return null;
    return m.projectId;
  }

  async function shownMinutesProject(meetingId: string, userId: string): Promise<string | null> {
    const projectId = await accessibleProject(meetingId, userId);
    if (!projectId) return null;
    const shown = await prisma.meetingMinutes.count({ where: { meetingId, status: 'APPROVED', clientVisible: true, clientVisibleProjectId: projectId } });
    return shown > 0 ? projectId : null;
  }

  return {
    async reach(meetingId, userId) {
      if (!(await isClient(userId))) return true;
      return (await accessibleProject(meetingId, userId)) !== null;
    },
    minutes: {
      async mayHave(meetingId, userId) {
        return (await isClient(userId)) && (await shownMinutesProject(meetingId, userId)) !== null;
      },
      async pdf(meetingId, userId) {
        if (!(await isClient(userId))) return null;
        const projectId = await shownMinutesProject(meetingId, userId);
        if (!projectId) return null;
        return (await deps.clientMinutesPdf(projectId, meetingId))?.pdf ?? null;
      },
    },
  };
}
