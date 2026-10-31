import { Prisma, type PrismaClient } from '@prisma/client';
import { isMuted, normalizePreferences } from '../notifications/notification-preferences';
import { attendeeRecordOf } from './prisma-attendee-repository';
import { MEETING_REMINDER_TYPE, reminderKey, type MeetingReminderSource, type MeetingReminderStore } from './meeting-reminder-service';
import type { ReminderPerson } from './meeting-reminders';

/** At most this many meetings are reminded of in one sweep (it runs every minute). */
const DUE_MEETINGS_LIMIT = 500;

/** The meetings and people the reminder sweep needs, read from the database. */
export function createPrismaMeetingReminderSource(prisma: PrismaClient): MeetingReminderSource {
  return {
    async dueMeetings(windows) {
      if (windows.length === 0) return [];
      const rows = await prisma.meeting.findMany({
        where: {
          deletedAt: null,
          // Drafts aren't announced yet, cancelled ones won't happen, started ones are under way.
          status: 'SCHEDULED',
          OR: windows.map((w) => ({ startAt: { gt: w.from, lte: w.to } })),
        },
        include: { attendees: true },
        orderBy: { startAt: 'asc' },
        take: DUE_MEETINGS_LIMIT,
      });
      const projectIds = [...new Set(rows.map((r) => r.projectId).filter((id): id is string => !!id))];
      const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }) : [];
      const names = new Map(projects.map((p) => [p.id, p.name] as const));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        projectId: r.projectId,
        projectName: r.projectId ? names.get(r.projectId) ?? null : null,
        organizerId: r.organizerId,
        location: r.location,
        onlineLink: r.onlineLink,
        startAt: r.startAt,
        endAt: r.endAt,
        timeZone: r.timeZone,
        attendees: r.attendees.map(attendeeRecordOf),
      }));
    },

    async people(userIds) {
      if (userIds.length === 0) return new Map();
      const rows = await prisma.user.findMany({
        where: { id: { in: userIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, username: true, email: true, preferredTimeZone: true, notificationPrefs: true },
      });
      return new Map(
        rows.map((u): [string, ReminderPerson] => [
          u.id,
          {
            userId: u.id,
            name: `${u.firstName} ${u.lastName}`.trim() || u.username,
            email: u.email || null,
            timeZone: u.preferredTimeZone ?? null,
            muted: isMuted(normalizePreferences(u.notificationPrefs), MEETING_REMINDER_TYPE),
          },
        ]),
      );
    },
  };
}

/** The sends written down in meeting_reminder_sends (its unique key is the guard against a second send). */
export function createPrismaMeetingReminderStore(prisma: PrismaClient): MeetingReminderStore {
  return {
    async takenFor(meetingIds) {
      if (meetingIds.length === 0) return new Set();
      const rows = await prisma.meetingReminderSend.findMany({
        where: { meetingId: { in: meetingIds } },
        select: { meetingId: true, recipientKey: true, offsetMinutes: true, startAt: true, channel: true },
      });
      return new Set(rows.map(reminderKey));
    },

    async reserve(key) {
      try {
        const row = await prisma.meetingReminderSend.create({
          data: {
            meetingId: key.meetingId,
            recipientKey: key.recipientKey,
            userId: key.userId,
            email: key.email,
            offsetMinutes: key.offsetMinutes,
            startAt: key.startAt,
            channel: key.channel,
          },
          select: { id: true },
        });
        return row.id;
      } catch (err) {
        // Taken already (another sweep or server), or the meeting was deleted meanwhile.
        if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2002' || err.code === 'P2003')) return null;
        throw err;
      }
    },

    async finish(id, status, at) {
      await prisma.meetingReminderSend.updateMany({ where: { id }, data: { status, sentAt: status === 'SENT' ? at : null } });
    },

    async release(id) {
      // Only a send still being sent: one written down as sent or skipped stays.
      await prisma.meetingReminderSend.deleteMany({ where: { id, status: 'SENDING' } });
    },

    async prune(before) {
      return (await prisma.meetingReminderSend.deleteMany({ where: { startAt: { lt: before } } })).count;
    },
  };
}
