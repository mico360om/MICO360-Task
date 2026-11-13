import type { PrismaClient } from '@prisma/client';

/**
 * 1.23.29 Private file links (design §7.2): what a stored file under /uploads is, and whether a person may
 * open it now.
 *
 *   protected  a task's or a chat's file (any task_attachments or chat_attachments row keeps its name):
 *              only through a signed link, for someone who can see that task or conversation now
 *   public     the current value of someone's photo, a project's picture or a company's logo (emails and
 *              the share-link page show them): served as before, no link asked for
 *   unknown    anything else — a replaced photo, an erased file, an orphan: 404
 *
 * Protected wins if a name were ever in both places. Names are remembered for a minute (most 10,000), and
 * each "may this person open files of this task / conversation" for 10 seconds, the API's own account
 * cache window: a page of 50 pictures is a handful of database reads.
 */
export interface FileChatRow {
  conversationId: string;
  /** The message was deleted (its files are refused, even before the rows are purged). */
  deleted: boolean;
}

export type FileClass = { kind: 'unknown' } | { kind: 'public' } | { kind: 'protected'; taskIds: string[]; chats: FileChatRow[] };

export interface FileRowsStore {
  /** The task and chat rows that keep this stored file (none: not a task's or a chat's file). */
  rowsOf(storageKey: string): Promise<{ taskIds: string[]; chats: FileChatRow[] }>;
  /** Is this '/uploads/<key>' someone's current photo, a project's picture or a company's logo? */
  isPublicPicture(url: string): Promise<boolean>;
  /** The task is not in the Recycle Bin and its project is not deleted. */
  taskIsLive(taskId: string): Promise<boolean>;
}

export interface FileAccessDeps {
  store: FileRowsStore;
  /** The API's own task rule (project-access.ts). It lets administrators through binned tasks: `taskIsLive` is asked too. */
  canViewTask: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** The chat's own rule: a project channel's live project and its people (or an administrator); a direct chat's participants. */
  canSeeConversation: (conversationId: string, userId: string) => Promise<boolean>;
  now?: () => number;
  /** How long a name's kind is remembered. Default a minute. */
  classifyTtlMs?: number;
  /** How long a person's "may open" is remembered, per task or conversation. Default 10 seconds. */
  decisionTtlMs?: number;
  /** Most entries in each memory. Default 10,000. */
  maxEntries?: number;
}

/** A small memory with a time limit per entry; the least recently used go first when it is full. */
function ttlCache<V>(ttlMs: number, max: number, now: () => number) {
  const entries = new Map<string, { at: number; value: Promise<V> }>();
  return {
    get(key: string, load: () => Promise<V>): Promise<V> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) {
        entries.delete(key);
        entries.set(key, hit);
        return hit.value;
      }
      if (hit) entries.delete(key);
      while (entries.size >= max) entries.delete(entries.keys().next().value!);
      const value = load();
      entries.set(key, { at: now(), value });
      value.catch(() => entries.delete(key));
      return value;
    },
  };
}

export function createFileAccess(deps: FileAccessDeps) {
  const now = deps.now ?? (() => Date.now());
  const max = deps.maxEntries ?? 10_000;
  const kinds = ttlCache<FileClass>(deps.classifyTtlMs ?? 60_000, max, now);
  const decisions = ttlCache<boolean>(deps.decisionTtlMs ?? 10_000, max, now);

  function classify(storageKey: string): Promise<FileClass> {
    return kinds.get(storageKey, async () => {
      const rows = await deps.store.rowsOf(storageKey);
      if (rows.taskIds.length > 0 || rows.chats.length > 0) return { kind: 'protected', taskIds: [...new Set(rows.taskIds)], chats: rows.chats };
      return (await deps.store.isPublicPicture(`/uploads/${storageKey}`)) ? { kind: 'public' } : { kind: 'unknown' };
    });
  }

  /** May this person open a protected file now: any row that keeps it lets them in. */
  async function mayOpen(person: { id: string; roles: string[] }, file: FileClass): Promise<boolean> {
    if (file.kind !== 'protected') return false;
    for (const taskId of file.taskIds) {
      // Both checks: canViewTask lets an administrator through a binned task; the Bin shows names and sizes only.
      const ok = await decisions.get(`${person.id}|t|${taskId}`, async () => (await deps.store.taskIsLive(taskId)) && (await deps.canViewTask(person.id, person.roles, taskId)));
      if (ok) return true;
    }
    for (const chat of file.chats) {
      if (chat.deleted) continue;
      const ok = await decisions.get(`${person.id}|c|${chat.conversationId}`, () => deps.canSeeConversation(chat.conversationId, person.id));
      if (ok) return true;
    }
    return false;
  }

  return { classify, mayOpen };
}

export type FileAccess = ReturnType<typeof createFileAccess>;

/** The rows behind stored files, read from the database (exact-value reads; storageKey is indexed). */
export function createPrismaFileRowsStore(prisma: PrismaClient): FileRowsStore {
  return {
    async rowsOf(storageKey) {
      const [tasks, chats] = await Promise.all([
        prisma.attachment.findMany({ where: { storageKey }, select: { taskId: true } }),
        prisma.chatAttachment.findMany({ where: { storageKey }, select: { message: { select: { conversationId: true, deletedAt: true } } } }),
      ]);
      return {
        taskIds: tasks.map((t) => t.taskId),
        chats: chats.map((c) => ({ conversationId: c.message.conversationId, deleted: c.message.deletedAt !== null })),
      };
    },
    async isPublicPicture(url) {
      // Three small tables, an exact value each: no index needed (design §7.2).
      const [user, project, company] = await Promise.all([
        prisma.user.findFirst({ where: { avatarUrl: url }, select: { id: true } }),
        prisma.project.findFirst({ where: { imageUrl: url }, select: { id: true } }),
        prisma.company.findFirst({ where: { logoUrl: url }, select: { id: true } }),
      ]);
      return user !== null || project !== null || company !== null;
    },
    async taskIsLive(taskId) {
      const live = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } }, select: { id: true } });
      return live !== null;
    },
  };
}
