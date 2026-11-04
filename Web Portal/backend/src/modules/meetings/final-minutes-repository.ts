import { Prisma, type PrismaClient } from '@prisma/client';
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
  /**
   * 1.22 (§10): save only if nothing was written since `since` — the save the minutes had when the
   * AI's draft was asked for (null: they had none) — and they aren't final. In one step, so a save by
   * someone at the same moment is never written over. Null when it wasn't saved.
   */
  saveIfUnchanged(meetingId: string, since: Date | null, minutes: FinalMinutesWrite): Promise<FinalMinutesRecord | null>;
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
    // No await between the check and the save: nothing can come between them.
    async saveIfUnchanged(meetingId, since, minutes) {
      const current = rows.get(meetingId);
      const unchanged = since === null ? !current : !!current && current.status !== 'APPROVED' && current.savedAt.getTime() === since.getTime();
      if (!unchanged) return null;
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
  const dataOf = (minutes: FinalMinutesWrite) => ({
    content: JSON.stringify(minutes.content),
    status: minutes.status,
    approvedById: minutes.approvedById,
    approvedAt: minutes.approvedAt,
    generatedAt: now(),
    // Minutes going back to a draft (reopened) leave the client page; marking them final again
    // doesn't bring them back on its own: someone who runs the project shows them again.
    ...(minutes.status === 'DRAFT' ? { clientVisible: false } : {}),
  });
  return {
    async get(meetingId) {
      const row = await prisma.meetingMinutes.findUnique({ where: { meetingId } });
      return row ? toRecord(row) : null;
    },
    async save(meetingId, minutes) {
      const row = await prisma.meetingMinutes.upsert({ where: { meetingId }, create: { meetingId, ...dataOf(minutes) }, update: dataOf(minutes) });
      return toRecord(row);
    },
    async saveIfUnchanged(meetingId, since, minutes) {
      if (since === null) {
        // They had none: only a first save is made (someone else's first save wins the unique meeting id).
        try {
          return toRecord(await prisma.meetingMinutes.create({ data: { meetingId, ...dataOf(minutes) } }));
        } catch (err) {
          if ((err as { code?: string } | null)?.code === 'P2002' || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) return null;
          throw err;
        }
      }
      const { count } = await prisma.meetingMinutes.updateMany({ where: { meetingId, generatedAt: since, status: { not: 'APPROVED' } }, data: dataOf(minutes) });
      if (!count) return null;
      const row = await prisma.meetingMinutes.findUnique({ where: { meetingId } });
      return row ? toRecord(row) : null;
    },
    async remove(meetingId) {
      await prisma.meetingMinutes.deleteMany({ where: { meetingId } });
    },
  };
}
