import { Prisma, type PrismaClient } from '@prisma/client';
import type { MeetingRecord, MeetingStatus } from '../../meetings/meeting-repository';

/**
 * The Teams side of meetings (1.23): which meetings carry a Teams link, the Teams meeting's id and whose
 * account made it. Kept on the meetings rows; only the Teams service reads the id and the owner (they are
 * never part of a meeting answer).
 */
export interface TeamsLinkRow {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  status: MeetingStatus;
  organizerId: string;
  onlineLink: string | null;
  provider: 'TEAMS' | null;
  teamsId: string | null;
  ownerId: string | null;
  /** The repeating family's first meeting (null for a one-off). */
  rootId: string | null;
  deletedAt: Date | null;
}

export interface TeamsLinkFields {
  onlineLink?: string | null;
  provider?: 'TEAMS' | null;
  teamsId?: string | null;
  ownerId?: string | null;
}

export interface TeamsLinkStore {
  /** A meeting, deleted ones included. */
  get(meetingId: string): Promise<TeamsLinkRow | null>;
  /** A repeating family's meetings that aren't deleted (its first meeting included). */
  family(rootId: string): Promise<TeamsLinkRow[]>;
  /** The meetings (not deleted) that carry this Teams meeting. */
  using(teamsId: string): Promise<TeamsLinkRow[]>;
  write(ids: string[], fields: TeamsLinkFields): Promise<void>;
  /** Make these meetings' links plain again: no Teams marker; the link itself goes where it is still `joinUrl`. */
  clear(ids: string[], joinUrl: string | null): Promise<void>;
  /** The Teams meeting is deleted: every meeting that held it (deleted ones too) forgets it. */
  forget(teamsId: string, joinUrl: string | null): Promise<void>;
  /** Teams meetings still held by cancelled or deleted meetings (the daily sweep checks each). */
  leftovers(): Promise<Array<{ teamsId: string; ownerId: string | null; organizerId: string; joinUrl: string | null }>>;
}

const SELECT = {
  id: true, title: true, startAt: true, endAt: true, status: true, organizerId: true, onlineLink: true,
  onlineMeetingProvider: true, onlineMeetingId: true, onlineMeetingOwnerId: true, recurrenceParentId: true, recurrenceRule: true, deletedAt: true,
} as const;

type Selected = Prisma.MeetingGetPayload<{ select: typeof SELECT }>;

function toRow(r: Selected): TeamsLinkRow {
  return {
    id: r.id,
    title: r.title,
    startAt: r.startAt,
    endAt: r.endAt,
    status: r.status,
    organizerId: r.organizerId,
    onlineLink: r.onlineLink,
    provider: r.onlineMeetingProvider === 'TEAMS' ? 'TEAMS' : null,
    teamsId: r.onlineMeetingId,
    ownerId: r.onlineMeetingOwnerId,
    rootId: r.recurrenceParentId ?? (r.recurrenceRule !== null ? r.id : null),
    deletedAt: r.deletedAt,
  };
}

function data(f: TeamsLinkFields): Prisma.MeetingUncheckedUpdateManyInput {
  return {
    ...(f.onlineLink !== undefined ? { onlineLink: f.onlineLink } : {}),
    ...(f.provider !== undefined ? { onlineMeetingProvider: f.provider } : {}),
    ...(f.teamsId !== undefined ? { onlineMeetingId: f.teamsId } : {}),
    ...(f.ownerId !== undefined ? { onlineMeetingOwnerId: f.ownerId } : {}),
  };
}

export function createPrismaTeamsLinkStore(prisma: PrismaClient): TeamsLinkStore {
  return {
    async get(meetingId) {
      const r = await prisma.meeting.findUnique({ where: { id: meetingId }, select: SELECT });
      return r ? toRow(r) : null;
    },
    async family(rootId) {
      return (await prisma.meeting.findMany({ where: { deletedAt: null, OR: [{ id: rootId }, { recurrenceParentId: rootId }] }, select: SELECT, orderBy: { startAt: 'asc' } })).map(toRow);
    },
    async using(teamsId) {
      return (await prisma.meeting.findMany({ where: { deletedAt: null, onlineMeetingId: teamsId }, select: SELECT, orderBy: { startAt: 'asc' }, take: 2000 })).map(toRow);
    },
    async write(ids, fields) {
      if (ids.length) await prisma.meeting.updateMany({ where: { id: { in: ids } }, data: data(fields) });
    },
    async clear(ids, joinUrl) {
      if (!ids.length) return;
      await prisma.$transaction([
        ...(joinUrl ? [prisma.meeting.updateMany({ where: { id: { in: ids }, onlineLink: joinUrl }, data: { onlineLink: null } })] : []),
        prisma.meeting.updateMany({ where: { id: { in: ids } }, data: { onlineMeetingProvider: null, onlineMeetingId: null, onlineMeetingOwnerId: null } }),
      ]);
    },
    async forget(teamsId, joinUrl) {
      await prisma.$transaction([
        ...(joinUrl ? [prisma.meeting.updateMany({ where: { onlineMeetingId: teamsId, onlineLink: joinUrl }, data: { onlineLink: null } })] : []),
        prisma.meeting.updateMany({ where: { onlineMeetingId: teamsId }, data: { onlineMeetingProvider: null, onlineMeetingId: null, onlineMeetingOwnerId: null } }),
      ]);
    },
    async leftovers() {
      const rows = await prisma.meeting.findMany({
        where: { onlineMeetingId: { not: null }, OR: [{ deletedAt: { not: null } }, { status: 'CANCELLED' }] },
        select: { onlineMeetingId: true, onlineMeetingOwnerId: true, organizerId: true, onlineLink: true },
        take: 500,
      });
      const byId = new Map<string, { teamsId: string; ownerId: string | null; organizerId: string; joinUrl: string | null }>();
      for (const r of rows) if (r.onlineMeetingId && !byId.has(r.onlineMeetingId)) byId.set(r.onlineMeetingId, { teamsId: r.onlineMeetingId, ownerId: r.onlineMeetingOwnerId, organizerId: r.organizerId, joinUrl: r.onlineLink });
      return [...byId.values()];
    },
  };
}

/** Tests: the Teams side kept beside an in-memory meeting store's rows (provider and link live on the rows). */
export function memoryTeamsLinkStore(rows: Map<string, MeetingRecord>): TeamsLinkStore & { ids: Map<string, { teamsId: string | null; ownerId: string | null }> } {
  const ids = new Map<string, { teamsId: string | null; ownerId: string | null }>();
  const toRowM = (m: MeetingRecord): TeamsLinkRow => ({
    id: m.id,
    title: m.title,
    startAt: m.startAt,
    endAt: m.endAt,
    status: m.status,
    organizerId: m.organizerId,
    onlineLink: m.onlineLink,
    provider: m.onlineMeetingProvider === 'TEAMS' ? 'TEAMS' : null,
    teamsId: ids.get(m.id)?.teamsId ?? null,
    ownerId: ids.get(m.id)?.ownerId ?? null,
    rootId: m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null),
    deletedAt: m.deletedAt ?? null,
  });
  const set = (id: string, f: TeamsLinkFields) => {
    const m = rows.get(id);
    if (!m) return;
    const next = { ...m };
    if (f.onlineLink !== undefined) next.onlineLink = f.onlineLink;
    if (f.provider !== undefined) next.onlineMeetingProvider = f.provider;
    const own = { teamsId: ids.get(id)?.teamsId ?? null, ownerId: ids.get(id)?.ownerId ?? null };
    if (f.teamsId !== undefined) own.teamsId = f.teamsId;
    if (f.ownerId !== undefined) own.ownerId = f.ownerId;
    ids.set(id, own);
    next.teamsLinkPending = next.onlineMeetingProvider === 'TEAMS' && !own.teamsId;
    rows.set(id, next);
  };
  return {
    ids,
    async get(id) {
      const m = rows.get(id);
      return m ? toRowM(m) : null;
    },
    async family(rootId) {
      return [...rows.values()].filter((m) => !m.deletedAt && (m.id === rootId || m.recurrenceParentId === rootId)).sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).map(toRowM);
    },
    async using(teamsId) {
      return [...rows.values()].filter((m) => !m.deletedAt && ids.get(m.id)?.teamsId === teamsId).sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).map(toRowM);
    },
    async write(list, fields) {
      for (const id of list) set(id, fields);
    },
    async clear(list, joinUrl) {
      for (const id of list) {
        const m = rows.get(id);
        if (!m) continue;
        set(id, { provider: null, teamsId: null, ownerId: null, ...(joinUrl && m.onlineLink === joinUrl ? { onlineLink: null } : {}) });
      }
    },
    async forget(teamsId, joinUrl) {
      const holders = [...rows.values()].filter((m) => ids.get(m.id)?.teamsId === teamsId).map((m) => m.id);
      await this.clear(holders, joinUrl);
    },
    async leftovers() {
      const out = new Map<string, { teamsId: string; ownerId: string | null; organizerId: string; joinUrl: string | null }>();
      for (const m of rows.values()) {
        const own = ids.get(m.id);
        if (!own?.teamsId || (!m.deletedAt && m.status !== 'CANCELLED') || out.has(own.teamsId)) continue;
        out.set(own.teamsId, { teamsId: own.teamsId, ownerId: own.ownerId, organizerId: m.organizerId, joinUrl: m.onlineLink });
      }
      return [...out.values()];
    },
  };
}
