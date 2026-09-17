import type { PrismaClient, MeetingAttendee } from '@prisma/client';
import type {
  AttendeeRepository,
  AttendeeRecord,
  CreateAttendeeData,
  UpdateAttendeeData,
} from './attendee-repository';

type Row = MeetingAttendee;

function toRecord(r: Row): AttendeeRecord {
  return {
    id: r.id,
    meetingId: r.meetingId,
    userId: r.userId,
    externalName: r.externalName,
    externalEmail: r.externalEmail,
    role: r.role,
    attendance: r.attendance,
    department: r.department,
    createdAt: r.createdAt,
  };
}

export function createPrismaAttendeeRepository(prisma: PrismaClient): AttendeeRepository {
  return {
    async add(data: CreateAttendeeData) {
      const row = await prisma.meetingAttendee.create({
        data: {
          meetingId: data.meetingId,
          userId: data.userId ?? null,
          externalName: data.externalName ?? null,
          externalEmail: data.externalEmail ?? null,
          role: data.role ?? 'REQUIRED',
          attendance: data.attendance ?? 'INVITED',
          department: data.department ?? null,
        },
      });
      return toRecord(row);
    },

    async findById(id) {
      const row = await prisma.meetingAttendee.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    },

    async listByMeeting(meetingId) {
      const rows = await prisma.meetingAttendee.findMany({ where: { meetingId }, orderBy: { createdAt: 'asc' } });
      return rows.map(toRecord);
    },

    async distinctUserIdsForMeetings(meetingIds) {
      if (meetingIds.length === 0) return [];
      const rows = await prisma.meetingAttendee.findMany({
        where: { meetingId: { in: meetingIds }, userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      });
      return rows.map((r) => r.userId).filter((u): u is string => !!u);
    },

    async update(id, patch: UpdateAttendeeData) {
      const row = await prisma.meetingAttendee.update({
        where: { id },
        data: {
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.attendance !== undefined ? { attendance: patch.attendance } : {}),
          ...(patch.department !== undefined ? { department: patch.department } : {}),
        },
      });
      return toRecord(row);
    },

    async remove(id) {
      await prisma.meetingAttendee.delete({ where: { id } });
    },
  };
}
