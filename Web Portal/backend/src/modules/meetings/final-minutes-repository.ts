import type { PrismaClient } from '@prisma/client';
import { normalizeFinalMinutes, type FinalMinutesContent } from './final-minutes';

/** A meeting's final minutes as stored: a draft being written, or approved (final). */
export interface FinalMinutesRecord {
  content: FinalMinutesContent;
  status: 'DRAFT' | 'APPROVED';
  approvedById: string | null;
  approvedAt: Date | null;
  /** When it was last saved. */
  savedAt: Date;
}

export type FinalMinutesWrite = Omit<FinalMinutesRecord, 'savedAt'>;

export interface FinalMinutesRepository {
  get(meetingId: string): Promise<FinalMinutesRecord | null>;
  save(meetingId: string, minutes: FinalMinutesWrite): Promise<FinalMinutesRecord>;
  /** Take the meeting's final minutes out again (Undo of a first draft); nothing to remove is fine. */
  remove(meetingId: string): Promise<void>;
}

/** In-memory storage, for tests. */
export function createMemoryFinalMinutesRepository(now: () => Date = () => new Date()): FinalMinutesRepository {
  const rows = new Map<string, FinalMinutesRecord>();
  return {
    async get(meetingId) {
      return rows.get(meetingId) ?? null;
    },
    async save(meetingId, minutes) {
      const record = { ...minutes, savedAt: now() };
      rows.set(meetingId, record);
      return record;
    },
    async remove(meetingId) {
      rows.delete(meetingId);
    },
  };
}

/** Content written before this format (plain text) is kept as the summary. */
function readContent(raw: string): FinalMinutesContent {
  try {
    return normalizeFinalMinutes(JSON.parse(raw));
  } catch {
    return normalizeFinalMinutes({ summary: raw });
  }
}

/**
 * Final minutes in the meeting_minutes table (one row per meeting): the content as JSON, APPROVED
 * once final (anything else reads as a draft), who approved it and when; generatedAt is the last save.
 */
export function createPrismaFinalMinutesRepository(prisma: PrismaClient, now: () => Date = () => new Date()): FinalMinutesRepository {
  const toRecord = (row: { content: string; status: string; approvedById: string | null; approvedAt: Date | null; generatedAt: Date }): FinalMinutesRecord => ({
    content: readContent(row.content),
    status: row.status === 'APPROVED' ? 'APPROVED' : 'DRAFT',
    approvedById: row.approvedById,
    approvedAt: row.approvedAt,
    savedAt: row.generatedAt,
  });
  return {
    async get(meetingId) {
      const row = await prisma.meetingMinutes.findUnique({ where: { meetingId } });
      return row ? toRecord(row) : null;
    },
    async save(meetingId, minutes) {
      const data = {
        content: JSON.stringify(minutes.content),
        status: minutes.status,
        approvedById: minutes.approvedById,
        approvedAt: minutes.approvedAt,
        generatedAt: now(),
      };
      const row = await prisma.meetingMinutes.upsert({ where: { meetingId }, create: { meetingId, ...data }, update: data });
      return toRecord(row);
    },
    async remove(meetingId) {
      await prisma.meetingMinutes.deleteMany({ where: { meetingId } });
    },
  };
}
