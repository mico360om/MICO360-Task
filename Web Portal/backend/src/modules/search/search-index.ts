import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizeFinalMinutes, type FinalMinutesContent } from '../meetings/final-minutes';
import { personLabel } from './task-search-matches';
import {
  INDEX_KINDS,
  SEARCH_DOC_VERSION,
  fileDoc,
  inspectionDoc,
  meetingDoc,
  minutesDoc,
  noteDoc,
  projectDoc,
  vocabularyWords,
  type IndexKind,
  type SearchDoc,
} from './search-docs';

/**
 * 1.23 Search everything — keeps search_index up to date for every kind but tasks (projects, meetings,
 * meeting notes, final minutes, task files and inspections), the way the task index is kept (see
 * task-search-index): each refresh reads the items as they are now (a gone one leaves the index), so
 * repeating one is always safe; the services' change hooks ask for one (`meetingChanged`…); the quick
 * heal (every minute) catches items with no row, an older version or a change since; the full heal (at
 * startup and every few hours) compares each item's fingerprint (`stamp`) with the one it had.
 */

export interface SearchIndexLogger {
  error(message: string, meta?: Record<string, unknown>): void;
}

interface Meta {
  projectId: string | null;
  meetingId: string | null;
  taskId: string | null;
  personId: string | null;
  status: string | null;
  at: Date | null;
}

interface Built {
  doc: SearchDoc;
  meta: Meta;
}

const CHUNK = 200;
const HEAL_BATCH = 500;
const STAMP_BATCH = 1000;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;

const sum = (expr: Prisma.Sql, from: Prisma.Sql) => Prisma.sql`(SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(${expr})), 0)) ${from})`;

/** Where each kind's items live, what makes one live, its fingerprint and its last change. */
interface KindSql {
  /** FROM … (alias x), joins included. */
  from: Prisma.Sql;
  /** x's id column as the index's recordId. */
  id: Prisma.Sql;
  live: Prisma.Sql;
  stamp: Prisma.Sql;
  changedAt: Prisma.Sql;
}

const KIND_SQL: Record<IndexKind, KindSql> = {
  project: {
    from: Prisma.sql`FROM projects x`,
    id: Prisma.sql`x.id`,
    live: Prisma.sql`x.deletedAt IS NULL`,
    stamp: Prisma.sql`CONCAT_WS('|', CRC32(CONCAT_WS('/', x.code, x.name, COALESCE(x.number, ''), COALESCE(x.clientName, ''), COALESCE(x.description, ''), COALESCE(x.notes, ''), x.status)))`,
    changedAt: Prisma.sql`x.updatedAt`,
  },
  meeting: {
    from: Prisma.sql`FROM meetings x`,
    id: Prisma.sql`x.id`,
    live: Prisma.sql`x.deletedAt IS NULL`,
    stamp: Prisma.sql`CONCAT_WS('|',
      CRC32(CONCAT_WS('/', x.title, COALESCE(x.description, ''), COALESCE(x.location, ''), COALESCE(x.category, ''), x.status, x.startAt, x.organizerId)),
      ${sum(Prisma.sql`CONCAT(a.id, '/', a.title)`, Prisma.sql`FROM agenda_items a WHERE a.meetingId = x.id`)},
      ${sum(Prisma.sql`CONCAT(d.id, '/', d.updatedAt)`, Prisma.sql`FROM decisions d WHERE d.meetingId = x.id`)},
      ${sum(Prisma.sql`CONCAT(i.id, '/', i.updatedAt)`, Prisma.sql`FROM action_items i WHERE i.meetingId = x.id`)},
      ${sum(Prisma.sql`CONCAT(t.id, '/', COALESCE(t.externalName, ''), '/', COALESCE(u.firstName, ''), '/', COALESCE(u.lastName, ''), '/', COALESCE(u.username, ''))`, Prisma.sql`FROM meeting_attendees t LEFT JOIN users u ON u.id = t.userId WHERE t.meetingId = x.id`)})`,
    changedAt: Prisma.sql`x.updatedAt`,
  },
  note: {
    from: Prisma.sql`FROM meeting_notes x JOIN meetings xm ON xm.id = x.meetingId`,
    id: Prisma.sql`x.id`,
    live: Prisma.sql`x.deletedAt IS NULL AND xm.deletedAt IS NULL`,
    stamp: Prisma.sql`CONCAT_WS('|', CRC32(CONCAT(x.type, '/', x.authorId, '/', x.body)), COALESCE(x.editedAt, ''),
      ${sum(Prisma.sql`CONCAT(c.id, '/', c.body)`, Prisma.sql`FROM meeting_note_comments c WHERE c.noteId = x.id`)},
      ${sum(Prisma.sql`CONCAT(k.id, '/', k.text)`, Prisma.sql`FROM meeting_note_checklist_items k WHERE k.noteId = x.id`)})`,
    changedAt: Prisma.sql`COALESCE(x.editedAt, x.createdAt)`,
  },
  minutes: {
    from: Prisma.sql`FROM meeting_minutes x JOIN meetings xm ON xm.id = x.meetingId`,
    id: Prisma.sql`x.meetingId`,
    live: Prisma.sql`xm.deletedAt IS NULL`,
    stamp: Prisma.sql`CONCAT_WS('|', CRC32(x.content), x.status, COALESCE(x.approvedAt, ''))`,
    changedAt: Prisma.sql`x.generatedAt`,
  },
  file: {
    from: Prisma.sql`FROM task_attachments x LEFT JOIN search_file_texts xt ON xt.fileId = x.id`,
    id: Prisma.sql`x.id`,
    live: Prisma.sql`TRUE`,
    stamp: Prisma.sql`CONCAT_WS('|', CRC32(CONCAT(x.filename, '/', x.uploadedById, '/', x.taskId)), COALESCE(xt.status, ''), COALESCE(xt.readAt, ''))`,
    changedAt: Prisma.sql`COALESCE(xt.readAt, x.createdAt)`,
  },
  inspection: {
    from: Prisma.sql`FROM inspections x`,
    id: Prisma.sql`x.id`,
    live: Prisma.sql`x.deletedAt IS NULL`,
    stamp: Prisma.sql`CONCAT_WS('|', CRC32(CONCAT_WS('/', x.title, COALESCE(x.description, ''), COALESCE(x.place, ''), x.status, COALESCE(x.taskId, ''), x.inspectorId)), x.updatedAt,
      ${sum(Prisma.sql`CONCAT(a.id, '/', a.updatedAt)`, Prisma.sql`FROM inspection_answers a WHERE a.inspectionId = x.id`)},
      (SELECT COALESCE(CRC32(CONCAT(t.\`key\`, '/', t.title)), 0) FROM tasks t WHERE t.id = x.taskId))`,
    changedAt: Prisma.sql`x.updatedAt`,
  },
};

const person = { select: { firstName: true, lastName: true, username: true } } as const;

/** Final minutes content as stored (JSON; older plain text is the summary). */
export function readMinutesContent(raw: string): FinalMinutesContent {
  try {
    return normalizeFinalMinutes(JSON.parse(raw));
  } catch {
    return normalizeFinalMinutes({ summary: raw });
  }
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export function createSearchIndex({
  prisma,
  logger,
  words,
  now = () => new Date(),
}: {
  prisma: PrismaClient;
  logger?: SearchIndexLogger;
  /** The vocabulary of the spelling-mistake pass gets each indexed item's words. */
  words?: { add(list: readonly string[]): Promise<void> };
  now?: () => Date;
}) {
  /** The items of one kind as they are now (gone ones are missing). */
  async function load(kind: IndexKind, ids: string[]): Promise<Map<string, Built>> {
    const out = new Map<string, Built>();
    if (ids.length === 0) return out;
    const meta = (m: Partial<Meta>): Meta => ({ projectId: null, meetingId: null, taskId: null, personId: null, status: null, at: null, ...m });
    switch (kind) {
      case 'project': {
        const rows = await prisma.project.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, code: true, number: true, name: true, description: true, clientName: true, notes: true, status: true, createdAt: true } });
        for (const p of rows) out.set(p.id, { doc: projectDoc(p), meta: meta({ projectId: p.id, status: p.status, at: p.createdAt }) });
        break;
      }
      case 'meeting': {
        const rows = await prisma.meeting.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: {
            id: true,
            title: true,
            description: true,
            location: true,
            category: true,
            status: true,
            startAt: true,
            organizerId: true,
            agendaItems: { orderBy: { position: 'asc' }, select: { title: true } },
            decisions: { select: { title: true, description: true } },
            actionItems: { select: { description: true } },
            attendees: { select: { userId: true, externalName: true } },
          },
        });
        const userIds = [...new Set(rows.flatMap((m) => [m.organizerId, ...m.attendees.map((a) => a.userId)]).filter((u): u is string => !!u))];
        const names = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, ...person.select } })).map((u) => [u.id, personLabel(u)]));
        for (const m of rows) {
          const people = [...new Set([names.get(m.organizerId), ...m.attendees.map((a) => (a.userId ? names.get(a.userId) : a.externalName))].filter((n): n is string => !!n))];
          out.set(m.id, {
            doc: meetingDoc({ title: m.title, description: m.description, location: m.location, category: m.category, agenda: m.agendaItems.map((a) => a.title), people, decisions: m.decisions, actionItems: m.actionItems.map((a) => a.description) }),
            meta: meta({ meetingId: m.id, personId: m.organizerId, status: m.status, at: m.startAt }),
          });
        }
        break;
      }
      case 'note': {
        const rows = await prisma.meetingNote.findMany({
          where: { id: { in: ids }, deletedAt: null, meeting: { deletedAt: null } },
          select: { id: true, meetingId: true, authorId: true, type: true, body: true, bodyFormat: true, createdAt: true, comments: { select: { body: true } }, checklist: { orderBy: { position: 'asc' }, select: { text: true } } },
        });
        for (const n of rows) {
          out.set(n.id, {
            doc: noteDoc({ body: n.body, bodyFormat: n.bodyFormat, comments: n.comments.map((c) => c.body), checklist: n.checklist.map((c) => c.text) }),
            meta: meta({ meetingId: n.meetingId, personId: n.authorId, status: n.type, at: n.createdAt }),
          });
        }
        break;
      }
      case 'minutes': {
        const rows = await prisma.meetingMinutes.findMany({ where: { meetingId: { in: ids }, meeting: { deletedAt: null } }, select: { meetingId: true, content: true, status: true, approvedAt: true, generatedAt: true } });
        for (const r of rows) {
          out.set(r.meetingId, {
            doc: minutesDoc(readMinutesContent(r.content)),
            meta: meta({ meetingId: r.meetingId, status: r.status === 'APPROVED' ? 'APPROVED' : 'DRAFT', at: r.approvedAt ?? r.generatedAt }),
          });
        }
        break;
      }
      case 'file': {
        const rows = await prisma.attachment.findMany({ where: { id: { in: ids } }, select: { id: true, taskId: true, filename: true, uploadedById: true, createdAt: true, searchText: { select: { text: true, status: true } } } });
        for (const f of rows) {
          out.set(f.id, { doc: fileDoc({ filename: f.filename, text: f.searchText?.text ?? null }), meta: meta({ taskId: f.taskId, personId: f.uploadedById, status: f.searchText?.status ?? 'PENDING', at: f.createdAt }) });
        }
        break;
      }
      case 'inspection': {
        const rows = await prisma.inspection.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: { id: true, projectId: true, title: true, description: true, place: true, structure: true, status: true, inspectorId: true, startedAt: true, answers: { select: { note: true, reading: true } }, task: { select: { key: true, title: true } } },
        });
        for (const i of rows) out.set(i.id, { doc: inspectionDoc(i), meta: meta({ projectId: i.projectId, personId: i.inspectorId, status: i.status, at: i.startedAt }) });
        break;
      }
    }
    return out;
  }

  async function readStamps(kind: IndexKind, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const k = KIND_SQL[kind];
    const rows = await prisma.$queryRaw<{ id: string; stamp: string }[]>`SELECT ${k.id} AS id, ${k.stamp} AS stamp ${k.from} WHERE ${k.id} IN (${Prisma.join(ids)}) AND ${k.live}`;
    return new Map(rows.map((r) => [r.id, String(r.stamp)]));
  }

  async function write(rows: Prisma.Sql[]): Promise<void> {
    if (rows.length === 0) return;
    // The newer read wins (as in the task index): indexedAt, which the others compare, goes last.
    await prisma.$executeRaw`INSERT INTO search_index (kind, recordId, projectId, meetingId, taskId, personId, status, at, head, \`lead\`, doc, limited, stamp, version, indexedAt) VALUES ${Prisma.join(rows)}
      ON DUPLICATE KEY UPDATE
        projectId = IF(VALUES(indexedAt) >= indexedAt, VALUES(projectId), projectId),
        meetingId = IF(VALUES(indexedAt) >= indexedAt, VALUES(meetingId), meetingId),
        taskId = IF(VALUES(indexedAt) >= indexedAt, VALUES(taskId), taskId),
        personId = IF(VALUES(indexedAt) >= indexedAt, VALUES(personId), personId),
        status = IF(VALUES(indexedAt) >= indexedAt, VALUES(status), status),
        at = IF(VALUES(indexedAt) >= indexedAt, VALUES(at), at),
        head = IF(VALUES(indexedAt) >= indexedAt, VALUES(head), head),
        \`lead\` = IF(VALUES(indexedAt) >= indexedAt, VALUES(\`lead\`), \`lead\`),
        doc = IF(VALUES(indexedAt) >= indexedAt, VALUES(doc), doc),
        limited = IF(VALUES(indexedAt) >= indexedAt, VALUES(limited), limited),
        stamp = IF(VALUES(indexedAt) >= indexedAt, VALUES(stamp), stamp),
        version = IF(VALUES(indexedAt) >= indexedAt, VALUES(version), version),
        indexedAt = GREATEST(indexedAt, VALUES(indexedAt))`;
  }

  /** Re-index these items of a kind from what they hold now (a gone one leaves the index). Returns how many were written. */
  async function refresh(kind: IndexKind, ids: string[]): Promise<number> {
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
    let written = 0;
    for (const chunk of chunks(unique, CHUNK)) {
      const at = now();
      // The fingerprint first: a change made while the text is read leaves a stale stamp for the heal.
      const stamps = await readStamps(kind, chunk);
      const live = await load(kind, [...stamps.keys()]);
      const gone = chunk.filter((id) => !live.has(id));
      if (gone.length) await prisma.searchIndex.deleteMany({ where: { kind, recordId: { in: gone } } });
      let rows: Prisma.Sql[] = [];
      let bytes = 0;
      const found: string[] = [];
      for (const [id, { doc, meta }] of live) {
        const h = Buffer.from(doc.head, 'utf8');
        const l = Buffer.from(doc.lead, 'utf8');
        const d = Buffer.from(doc.doc, 'utf8');
        const lim = doc.limited === undefined ? null : Buffer.from(doc.limited, 'utf8');
        const size = h.length + l.length + d.length + (lim?.length ?? 0);
        if (rows.length && bytes + size > MAX_WRITE_BYTES) {
          await write(rows);
          rows = [];
          bytes = 0;
        }
        rows.push(Prisma.sql`(${kind}, ${id}, ${meta.projectId}, ${meta.meetingId}, ${meta.taskId}, ${meta.personId}, ${meta.status}, ${meta.at}, ${h}, ${l}, ${d}, ${lim}, ${stamps.get(id) ?? ''}, ${SEARCH_DOC_VERSION}, ${at})`);
        bytes += size;
        written += 1;
        if (words) found.push(...vocabularyWords(doc.doc));
      }
      await write(rows);
      if (words && found.length) await words.add(found).catch((err: unknown) => logger?.error('search: keeping new words failed', { err }));
    }
    return written;
  }

  // One refresh at a time per thing, in the order asked: the last one always reads the newest text.
  const queues = new Map<string, Promise<void>>();
  function queued(key: string, run: () => Promise<unknown>): Promise<void> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(run).then(
      () => undefined,
      (err: unknown) => logger?.error('search: indexing failed', { err, key }),
    );
    queues.set(key, next);
    void next.then(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
    return next;
  }

  /** A project changed (or was made, archived, deleted). Never throws. */
  const projectChanged = (projectId: string) => queued(`project:${projectId}`, () => refresh('project', [projectId]));

  /** A meeting or anything of it changed: the meeting, its notes and its final minutes are read again. Never throws. */
  function meetingChanged(meetingId: string): Promise<void> {
    return queued(`meeting:${meetingId}`, async () => {
      await refresh('meeting', [meetingId]);
      const notes = (await prisma.meetingNote.findMany({ where: { meetingId }, select: { id: true } })).map((n) => n.id);
      const indexed = (await prisma.searchIndex.findMany({ where: { kind: 'note', meetingId }, select: { recordId: true } })).map((r) => r.recordId);
      await refresh('note', [...new Set([...notes, ...indexed])]);
      await refresh('minutes', [meetingId]);
    });
  }

  /** A task's files changed (one added or removed): its files are read again. Never throws. */
  function taskFilesChanged(taskId: string): Promise<void> {
    return queued(`files:${taskId}`, async () => {
      const files = (await prisma.attachment.findMany({ where: { taskId }, select: { id: true } })).map((f) => f.id);
      const indexed = (await prisma.searchIndex.findMany({ where: { kind: 'file', taskId }, select: { recordId: true } })).map((r) => r.recordId);
      await refresh('file', [...new Set([...files, ...indexed])]);
    });
  }

  /** One file's text was read. Never throws. */
  const fileChanged = (fileId: string) => queued(`file:${fileId}`, () => refresh('file', [fileId]));
  /** An inspection changed. Never throws. */
  const inspectionChanged = (inspectionId: string) => queued(`inspection:${inspectionId}`, () => refresh('inspection', [inspectionId]));

  /** Rows whose item is gone (deleted, or no longer live). */
  async function dropGone(kind: IndexKind): Promise<void> {
    const k = KIND_SQL[kind];
    await prisma.$executeRaw`DELETE FROM search_index WHERE kind = ${kind} AND recordId NOT IN (SELECT id FROM (SELECT ${k.id} AS id ${k.from} WHERE ${k.live}) live)`;
  }

  /** The quick heal: items with no row, a row of an older version, or changed since they were indexed. */
  async function healRecent(): Promise<number> {
    let healed = 0;
    for (const kind of INDEX_KINDS) {
      const k = KIND_SQL[kind];
      let after = '';
      for (;;) {
        const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT ${k.id} AS id ${k.from} LEFT JOIN search_index si ON si.kind = ${kind} AND si.recordId = ${k.id}
          WHERE ${k.live} AND ${k.id} > ${after} AND (si.recordId IS NULL OR si.version <> ${SEARCH_DOC_VERSION} OR ${k.changedAt} > si.indexedAt)
          ORDER BY ${k.id} LIMIT ${HEAL_BATCH}`;
        if (rows.length === 0) break;
        healed += await refresh(kind, rows.map((r) => r.id));
        after = rows[rows.length - 1]!.id;
        if (rows.length < HEAL_BATCH) break;
      }
      await dropGone(kind);
    }
    return healed;
  }

  /** The full heal: every item whose sources changed since it was indexed; gone items' rows go. */
  async function healAll(): Promise<number> {
    let healed = 0;
    for (const kind of INDEX_KINDS) {
      const k = KIND_SQL[kind];
      let after = '';
      for (;;) {
        const rows = await prisma.$queryRaw<{ id: string; stamp: string; indexed: string | null; version: number | null }[]>`SELECT ${k.id} AS id, ${k.stamp} AS stamp, si.stamp AS indexed, si.version AS version
          ${k.from} LEFT JOIN search_index si ON si.kind = ${kind} AND si.recordId = ${k.id}
          WHERE ${k.live} AND ${k.id} > ${after} ORDER BY ${k.id} LIMIT ${STAMP_BATCH}`;
        if (rows.length === 0) break;
        const stale = rows.filter((r) => r.indexed === null || Number(r.version) !== SEARCH_DOC_VERSION || String(r.stamp) !== r.indexed).map((r) => r.id);
        healed += await refresh(kind, stale);
        after = rows[rows.length - 1]!.id;
        if (rows.length < STAMP_BATCH) break;
      }
      await dropGone(kind);
    }
    return healed;
  }

  /** Re-index every item (the search:rebuild command). */
  async function rebuildAll(): Promise<number> {
    let written = 0;
    for (const kind of INDEX_KINDS) {
      const k = KIND_SQL[kind];
      let after = '';
      for (;;) {
        const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT ${k.id} AS id ${k.from} WHERE ${k.live} AND ${k.id} > ${after} ORDER BY ${k.id} LIMIT ${HEAL_BATCH}`;
        if (rows.length === 0) break;
        written += await refresh(kind, rows.map((r) => r.id));
        after = rows[rows.length - 1]!.id;
      }
      await dropGone(kind);
    }
    return written;
  }

  return { refresh, projectChanged, meetingChanged, taskFilesChanged, fileChanged, inspectionChanged, healRecent, healAll, rebuildAll };
}

export type SearchIndex = ReturnType<typeof createSearchIndex>;
