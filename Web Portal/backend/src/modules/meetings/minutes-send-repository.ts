import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

/** One address on a sent minutes email's To or Cc line. */
export interface MinutesSendAddress {
  email: string;
  /** The name shown beside it (none for a typed address). */
  name: string | null;
  /** Their account, when they have one. */
  userId?: string | null;
  /** The shared email, or their own (someone from another company). */
  copy: 'shared' | 'own';
}

/** What happened to one address of a send. */
export interface MinutesSendResult {
  email: string;
  ok: boolean;
  error?: string;
}

/** One emailing of a meeting's minutes: who, when, draft or final, To, Cc and each address's result. */
export interface MinutesSendRecord {
  id: string;
  meetingId: string;
  sentById: string | null;
  sentAt: Date;
  final: boolean;
  to: MinutesSendAddress[];
  cc: MinutesSendAddress[];
  results: MinutesSendResult[];
}

export type NewMinutesSend = Omit<MinutesSendRecord, 'id' | 'sentAt'> & { sentAt?: Date };

/** An address offered again (the Cc picker's suggestions). */
export interface SuggestedAddress {
  email: string;
  name: string | null;
  userId?: string;
}

export interface MinutesSendRepository {
  create(send: NewMinutesSend): Promise<MinutesSendRecord>;
  /** A meeting's sends, newest first (the newest `limit`). */
  listByMeeting(meetingId: string, limit?: number): Promise<MinutesSendRecord[]>;
  /**
   * Addresses used in earlier sends of the meeting's project's meetings (a meeting without a project:
   * its own sends), the most recently used first — see suggestedAddresses.
   */
  recentAddresses(meetingId: string, limit?: number): Promise<SuggestedAddress[]>;
}

/** How many sends a meeting's log shows, and how far back suggestions look. */
const LOG_LIMIT = 50;
const SUGGESTION_SENDS = 50;
const SUGGESTION_LIMIT = 20;

/**
 * The addresses of some sends (newest first), each once (case aside), the most recently used first —
 * never someone who was sent their own copy (another company: their address isn't offered around).
 */
export function suggestedAddresses(sends: readonly MinutesSendRecord[], limit = SUGGESTION_LIMIT): SuggestedAddress[] {
  const seen = new Set<string>();
  const out: SuggestedAddress[] = [];
  for (const s of sends) {
    for (const a of [...(Array.isArray(s.to) ? s.to : []), ...(Array.isArray(s.cc) ? s.cc : [])]) {
      if (!a || typeof a.email !== 'string' || !a.email || a.copy === 'own') continue;
      const key = a.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ email: key, name: typeof a.name === 'string' && a.name ? a.name : null, ...(typeof a.userId === 'string' && a.userId ? { userId: a.userId } : {}) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const newestFirst = (a: MinutesSendRecord, b: MinutesSendRecord) => b.sentAt.getTime() - a.sentAt.getTime();

/** In-memory storage, for tests. `projectOf`: a meeting's project (suggestions follow it). */
export function createMemoryMinutesSendRepository(opts: { now?: () => Date; projectOf?: (meetingId: string) => Promise<string | null> } = {}): MinutesSendRepository {
  const rows: MinutesSendRecord[] = [];
  const now = opts.now ?? (() => new Date());
  const projectOf = opts.projectOf ?? (async () => null);
  return {
    async create(send) {
      const record: MinutesSendRecord = { ...send, id: randomUUID(), sentAt: send.sentAt ?? now() };
      rows.push(record);
      return record;
    },
    async listByMeeting(meetingId, limit = LOG_LIMIT) {
      return rows.filter((r) => r.meetingId === meetingId).sort(newestFirst).slice(0, limit);
    },
    async recentAddresses(meetingId, limit) {
      const project = await projectOf(meetingId);
      const mine: MinutesSendRecord[] = [];
      for (const r of rows) if (r.meetingId === meetingId || (project && (await projectOf(r.meetingId)) === project)) mine.push(r);
      return suggestedAddresses(mine.sort(newestFirst).slice(0, SUGGESTION_SENDS), limit);
    },
  };
}

type Row = { id: string; meetingId: string; sentById: string | null; sentAt: Date; final: boolean; toAddresses: unknown; ccAddresses: unknown; results: unknown };
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const toRecord = (r: Row): MinutesSendRecord => ({
  id: r.id,
  meetingId: r.meetingId,
  sentById: r.sentById,
  sentAt: r.sentAt,
  final: r.final,
  to: list<MinutesSendAddress>(r.toAddresses),
  cc: list<MinutesSendAddress>(r.ccAddresses),
  results: list<MinutesSendResult>(r.results),
});

/** The sent log in meeting_minutes_sends (To, Cc and the results as JSON). */
export function createPrismaMinutesSendRepository(prisma: PrismaClient): MinutesSendRepository {
  return {
    async create(send) {
      const row = await prisma.meetingMinutesSend.create({
        data: {
          meetingId: send.meetingId,
          sentById: send.sentById,
          final: send.final,
          toAddresses: send.to as unknown as Prisma.InputJsonValue,
          ccAddresses: send.cc as unknown as Prisma.InputJsonValue,
          results: send.results as unknown as Prisma.InputJsonValue,
          ...(send.sentAt ? { sentAt: send.sentAt } : {}),
        },
      });
      return toRecord(row);
    },
    async listByMeeting(meetingId, limit = LOG_LIMIT) {
      const rows = await prisma.meetingMinutesSend.findMany({ where: { meetingId }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: limit });
      return rows.map(toRecord);
    },
    async recentAddresses(meetingId, limit) {
      const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { projectId: true } });
      if (!meeting) return [];
      const rows = await prisma.meetingMinutesSend.findMany({
        where: meeting.projectId ? { meeting: { projectId: meeting.projectId, deletedAt: null } } : { meetingId },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        take: SUGGESTION_SENDS,
      });
      return suggestedAddresses(rows.map(toRecord), limit);
    },
  };
}
