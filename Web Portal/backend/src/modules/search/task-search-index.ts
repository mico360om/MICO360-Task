import { Prisma, type PrismaClient } from '@prisma/client';
import { SEARCH_INDEX_VERSION, buildSearchDocument } from './task-search-text';
import type { TaskSearchLive } from './task-search-matches';

/**
 * Keeps the task search index (task_search_index) up to date: one normalised text per task, written
 * after every change the services make (`taskChanged`), healed by sweeps for any change made another
 * way, and rebuilt on demand. Each refresh reads the task as it is now, so a refresh is always safe
 * to repeat. Changes made without a refresh are found by the heals: `healRecent` (often, cheap: tasks
 * with no row, an older version, or edited since) and `healAll` (at startup and every few hours:
 * compares each task's sources with the fingerprint — `stamp` — they had when indexed, so a removed
 * comment or a renamed person or tag is caught too).
 */

export interface SearchIndexLogger {
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Tasks read and written per round. */
const CHUNK = 200;
/** A round's INSERT stays under this many bytes (MariaDB's default packet limit is 16 MB). */
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const HEAL_BATCH = 500;
const STAMP_BATCH = 1000;

/**
 * A fingerprint of everything a task is indexed under, for task `t` (MySQL and MariaDB alike): its
 * key/title/description, and for each list a count plus a checksum of what identifies its items —
 * comments (id and last edit; deleted ones left out), checklist texts, assignees with their names,
 * external contacts (id and last change), tags with their names, file names and former keys.
 */
export const stampSql = Prisma.sql`CONCAT_WS('|',
  CRC32(CONCAT(t.\`key\`, '/', t.title, '/', COALESCE(t.description, ''))),
  (SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT(c.id, '/', COALESCE(c.editedAt, c.createdAt)))), 0)) FROM task_comments c WHERE c.taskId = t.id AND c.deletedAt IS NULL),
  (SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT(i.id, '/', i.text))), 0)) FROM task_checklists i WHERE i.taskId = t.id),
  (SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT(a.userId, '/', u.firstName, '/', u.lastName, '/', u.username))), 0)) FROM task_assignees a JOIN users u ON u.id = a.userId WHERE a.taskId = t.id),
  (SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT(x.id, '/', x.updatedAt))), 0)) FROM task_external_contacts x WHERE x.taskId = t.id),
  (SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT(g.id, '/', g.name))), 0)) FROM task_tags tt JOIN tags g ON g.id = tt.tagId WHERE tt.taskId = t.id),
  (SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT(f.id, '/', f.filename))), 0)) FROM task_attachments f WHERE f.taskId = t.id),
  (SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(k.\`key\`)), 0)) FROM task_key_aliases k WHERE k.taskId = t.id)
)`;

const person = { select: { firstName: true, lastName: true, username: true } } as const;

/**
 * Live tasks as they are now — everything they can be found by (comments newest first, live ones
 * only). Deleted or missing tasks are left out. Shared by the index and the results.
 */
export async function loadTaskSearchLive(prisma: PrismaClient, ids: string[]): Promise<Map<string, TaskSearchLive>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.task.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      key: true,
      title: true,
      description: true,
      keyAliases: { select: { key: true }, orderBy: { createdAt: 'asc' } },
      comments: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, parentId: true, body: true, createdAt: true, user: person } },
      checklist: { orderBy: { position: 'asc' }, select: { text: true, done: true } },
      assignees: { orderBy: { assignedAt: 'asc' }, select: { user: person } },
      externalContacts: { orderBy: { position: 'asc' }, select: { name: true, company: true, designation: true, email: true, phone: true, remarks: true } },
      tags: { select: { tag: { select: { name: true } } } },
      attachments: { orderBy: { createdAt: 'asc' }, select: { filename: true } },
    },
  });
  return new Map(
    rows.map((t) => [
      t.id,
      {
        key: t.key,
        formerKeys: t.keyAliases.map((a) => a.key),
        title: t.title,
        description: t.description,
        comments: t.comments.map((c) => ({ id: c.id, parentId: c.parentId, body: c.body, createdAt: c.createdAt, author: c.user ?? null })),
        checklist: t.checklist,
        assignees: t.assignees.map((a) => a.user),
        contacts: t.externalContacts,
        tags: t.tags.map((x) => x.tag).sort((a, b) => a.name.localeCompare(b.name)),
        files: t.attachments,
      },
    ]),
  );
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export function createTaskSearchIndex({ prisma, logger, now = () => new Date() }: { prisma: PrismaClient; logger?: SearchIndexLogger; now?: () => Date }) {
  async function readStamps(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.$queryRaw<{ id: string; stamp: string }[]>`SELECT t.id AS id, ${stampSql} AS stamp FROM tasks t WHERE t.id IN (${Prisma.join(ids)}) AND t.deletedAt IS NULL`;
    return new Map(rows.map((r) => [r.id, String(r.stamp)]));
  }

  async function write(rows: Prisma.Sql[]): Promise<void> {
    if (rows.length === 0) return;
    await prisma.$executeRaw`INSERT INTO task_search_index (taskId, head, doc, stamp, version, indexedAt) VALUES ${Prisma.join(rows)}
      ON DUPLICATE KEY UPDATE head = VALUES(head), doc = VALUES(doc), stamp = VALUES(stamp), version = VALUES(version), indexedAt = VALUES(indexedAt)`;
  }

  /** Re-index these tasks from what they hold now (a deleted or missing one leaves the index). Returns how many were written. */
  async function refresh(ids: string[]): Promise<number> {
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
    let written = 0;
    for (const chunk of chunks(unique, CHUNK)) {
      // Read the fingerprint first: a change made while the text is read leaves a stale stamp, which
      // the next heal sees — never a new stamp over old text.
      const at = now();
      const stamps = await readStamps(chunk);
      const live = await loadTaskSearchLive(prisma, [...stamps.keys()]);
      const gone = chunk.filter((id) => !live.has(id));
      if (gone.length) await prisma.taskSearchIndex.deleteMany({ where: { taskId: { in: gone } } });
      let rows: Prisma.Sql[] = [];
      let bytes = 0;
      for (const [id, task] of live) {
        const { head, doc } = buildSearchDocument(task);
        const h = Buffer.from(head, 'utf8');
        const d = Buffer.from(doc, 'utf8');
        if (rows.length && bytes + h.length + d.length > MAX_WRITE_BYTES) {
          await write(rows);
          rows = [];
          bytes = 0;
        }
        rows.push(Prisma.sql`(${id}, ${h}, ${d}, ${stamps.get(id) ?? ''}, ${SEARCH_INDEX_VERSION}, ${at})`);
        bytes += h.length + d.length;
        written += 1;
      }
      await write(rows);
    }
    return written;
  }

  // One refresh at a time per task, in the order asked: the last one always reads the newest text.
  const queues = new Map<string, Promise<void>>();
  /** After a change to a task: re-index it. Never throws (a failure is logged; the heal catches up). */
  function taskChanged(taskId: string): Promise<void> {
    const previous = queues.get(taskId) ?? Promise.resolve();
    const next = previous
      .then(() => refresh([taskId]))
      .then(
        () => undefined,
        (err: unknown) => logger?.error('task search: indexing a task failed', { err, taskId }),
      );
    queues.set(taskId, next);
    void next.then(() => {
      if (queues.get(taskId) === next) queues.delete(taskId);
    });
    return next;
  }

  /** Never throws: re-index several tasks (an edit to a whole repeating series, a person renamed…). */
  async function tasksChanged(ids: string[]): Promise<void> {
    await refresh(ids).catch((err: unknown) => logger?.error('task search: indexing tasks failed', { err, count: ids.length }));
  }

  /** The tasks a person is assigned to: their name is in those tasks' text. */
  async function refreshForUser(userId: string): Promise<number> {
    const rows = await prisma.taskAssignee.findMany({ where: { userId, task: { deletedAt: null } }, select: { taskId: true } });
    return refresh(rows.map((r) => r.taskId));
  }

  /** Every live copy of a repeating series (an edit to the whole series changes them all). */
  async function refreshSeries(rootId: string): Promise<number> {
    const rows = await prisma.task.findMany({ where: { deletedAt: null, OR: [{ id: rootId }, { recurrenceParentId: rootId }] }, select: { id: true } });
    return refresh(rows.map((r) => r.id));
  }

  /** Every live task of a project (tasks made in bulk, from a template). */
  async function refreshProject(projectId: string): Promise<number> {
    const rows = await prisma.task.findMany({ where: { projectId, deletedAt: null }, select: { id: true } });
    return refresh(rows.map((r) => r.id));
  }

  /** The quick heal: tasks with no row, a row of an older version, or edited since they were indexed. */
  async function healRecent(): Promise<number> {
    let after = '';
    let healed = 0;
    for (;;) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT t.id AS id FROM tasks t LEFT JOIN task_search_index si ON si.taskId = t.id
        WHERE t.deletedAt IS NULL AND t.id > ${after} AND (si.taskId IS NULL OR si.version <> ${SEARCH_INDEX_VERSION} OR t.updatedAt > si.indexedAt)
        ORDER BY t.id LIMIT ${HEAL_BATCH}`;
      if (rows.length === 0) break;
      healed += await refresh(rows.map((r) => r.id));
      after = rows[rows.length - 1]!.id;
      if (rows.length < HEAL_BATCH) break;
    }
    return healed;
  }

  async function dropDeleted(): Promise<void> {
    await prisma.$executeRaw`DELETE si FROM task_search_index si JOIN tasks t ON t.id = si.taskId WHERE t.deletedAt IS NOT NULL`;
  }

  /** The full heal: every task whose sources changed since it was indexed; deleted tasks' rows go. */
  async function healAll(): Promise<number> {
    let after = '';
    let healed = 0;
    for (;;) {
      const rows = await prisma.$queryRaw<{ id: string; stamp: string; indexed: string | null; version: number | null }[]>`SELECT t.id AS id, ${stampSql} AS stamp, si.stamp AS indexed, si.version AS version
        FROM tasks t LEFT JOIN task_search_index si ON si.taskId = t.id
        WHERE t.deletedAt IS NULL AND t.id > ${after} ORDER BY t.id LIMIT ${STAMP_BATCH}`;
      if (rows.length === 0) break;
      const stale = rows.filter((r) => r.indexed === null || Number(r.version) !== SEARCH_INDEX_VERSION || String(r.stamp) !== r.indexed).map((r) => r.id);
      healed += await refresh(stale);
      after = rows[rows.length - 1]!.id;
      if (rows.length < STAMP_BATCH) break;
    }
    await dropDeleted();
    return healed;
  }

  /** Re-index every live task (the search:rebuild command). */
  async function rebuildAll(): Promise<number> {
    let after = '';
    let written = 0;
    for (;;) {
      const rows = await prisma.task.findMany({ where: { deletedAt: null, id: { gt: after } }, select: { id: true }, orderBy: { id: 'asc' }, take: HEAL_BATCH });
      if (rows.length === 0) break;
      written += await refresh(rows.map((r) => r.id));
      after = rows[rows.length - 1]!.id;
    }
    await dropDeleted();
    return written;
  }

  return { refresh, taskChanged, tasksChanged, refreshForUser, refreshSeries, refreshProject, healRecent, healAll, rebuildAll };
}

export type TaskSearchIndex = ReturnType<typeof createTaskSearchIndex>;
