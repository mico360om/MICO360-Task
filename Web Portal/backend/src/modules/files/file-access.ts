import type { PrismaClient } from '@prisma/client';
import { parseUploadKey } from './upload-paths';
import { PROJECT_COMPANY_SELECT } from './upload-places';

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
 * Protected wins if a name were ever in both places. Photos and unknown names are remembered for a minute,
 * a task's or chat's file's rows for 10 seconds (most 10,000 names), and
 * each "yes, this person may open this task's / conversation's files" for 10 seconds, the API's own account
 * cache window (a "no" is asked again each time; a removal from a project forgets the person's "yes" at
 * once): a page of 50 pictures is a handful of database reads.
 */
export interface FileChatRow {
  conversationId: string;
  /** The message was deleted (its files are refused, even before the rows are purged). */
  deleted: boolean;
}

export type FileClass =
  | { kind: 'unknown' }
  | { kind: 'public' }
  | {
      kind: 'protected';
      taskIds: string[];
      chats: FileChatRow[];
      /** 1.23.38: the companies of the projects behind the file's rows (absent: not read). */
      companyIds?: string[];
    };

export interface FileRowsStore {
  /** The task and chat rows that keep this stored file (none: not a task's or a chat's file). */
  rowsOf(storageKey: string): Promise<{ taskIds: string[]; chats: FileChatRow[]; companyIds?: string[] }>;
  /** 1.23.38 Upload folders: the key an old name moved to (file_key_aliases), or null. */
  aliasOf?(storageKey: string): Promise<string | null>;
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
  /** How long a photo's or an unknown name's kind is remembered. Default a minute. */
  classifyTtlMs?: number;
  /**
   * How long a task's or chat's file's rows are remembered (never longer than classifyTtlMs). Default 10
   * seconds, as the decisions: an undone merge moves a file's rows back, an erase removes them (review, 1.23.29).
   */
  protectedTtlMs?: number;
  /**
   * 1.23.38 Upload folders: the person's active companies, for the company in a file's path (absent: none,
   * so only the file's own projects' companies and administrators pass).
   */
  companiesOf?: (userId: string) => Promise<string[]>;
  /** How long a person's "may open" is remembered, per task or conversation. Default 10 seconds. */
  decisionTtlMs?: number;
  /** Most entries in each memory. Default 10,000. */
  maxEntries?: number;
}

/** How many times an old name is followed through file_key_aliases. */
const MAX_ALIAS_HOPS = 5;

/** A small memory with a time limit per entry; the least recently used go first when it is full. */
function ttlCache<V>(ttlMs: number, max: number, now: () => number) {
  const entries = new Map<string, { at: number; ttl: number; value: Promise<V> }>();
  return {
    /**
     * `keep`: whether an answer is remembered (one it says no to is dropped once known; asked again next time).
     * `ttlOf`: a shorter time for some answers.
     */
    get(key: string, load: () => Promise<V>, keep?: (value: V) => boolean, ttlOf?: (value: V) => number): Promise<V> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < hit.ttl) {
        entries.delete(key);
        entries.set(key, hit);
        return hit.value;
      }
      if (hit) entries.delete(key);
      while (entries.size >= max) entries.delete(entries.keys().next().value!);
      const value = load();
      const entry = { at: now(), ttl: ttlMs, value };
      entries.set(key, entry);
      const drop = () => {
        if (entries.get(key) === entry) entries.delete(key);
      };
      value.then((v) => {
        if (keep && !keep(v)) drop();
        else if (ttlOf) entry.ttl = Math.min(ttlMs, ttlOf(v));
      }, drop);
      return value;
    },
    /** Forget the entries whose key starts with this (all of them without one). */
    forget(prefix?: string): void {
      if (prefix === undefined) entries.clear();
      else for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    },
  };
}

export function createFileAccess(deps: FileAccessDeps) {
  const now = deps.now ?? (() => Date.now());
  const max = deps.maxEntries ?? 10_000;
  const kinds = ttlCache<FileClass>(deps.classifyTtlMs ?? 60_000, max, now);
  const decisions = ttlCache<boolean>(deps.decisionTtlMs ?? 10_000, max, now);
  /** Only a "yes" is remembered: a refusal is asked again next time (someone just added back opens at once). */
  const yes = (ok: boolean) => ok;
  const protectedTtl = deps.protectedTtlMs ?? 10_000;
  const kindTtl = (c: FileClass) => (c.kind === 'protected' ? protectedTtl : Number.POSITIVE_INFINITY);

  function classify(storageKey: string): Promise<FileClass> {
    return kinds.get(storageKey, async () => {
      const rows = await deps.store.rowsOf(storageKey);
      if (rows.taskIds.length > 0 || rows.chats.length > 0) {
        return { kind: 'protected', taskIds: [...new Set(rows.taskIds)], chats: rows.chats, ...(rows.companyIds ? { companyIds: [...new Set(rows.companyIds)] } : {}) };
      }
      return (await deps.store.isPublicPicture(`/uploads/${storageKey}`)) ? { kind: 'public' } : { kind: 'unknown' };
    }, undefined, kindTtl);
  }

  /**
   * 1.23.38 Upload folders (design "Old links"): the file a name stands for — itself, or, for a name nobody
   * keeps, the key it moved to (followed at most a few times: a file re-filed after its project moved).
   */
  async function resolve(storageKey: string): Promise<{ file: string; kind: FileClass }> {
    const seen = new Set<string>();
    let key = storageKey;
    for (let hop = 0; hop < MAX_ALIAS_HOPS; hop++) {
      seen.add(key);
      const kind = await classify(key);
      if (kind.kind !== 'unknown' || !deps.store.aliasOf) return { file: key, kind };
      const next = await deps.store.aliasOf(key);
      if (!next || seen.has(next) || !parseUploadKey(next)) break;
      key = next;
    }
    return { file: storageKey, kind: { kind: 'unknown' } };
  }

  /**
   * 1.23.38 Upload folders (design "Access"): the company in the path is one this person may see — an
   * administrator; `shared` or a plain name; one of their active companies; or one of the companies of the
   * project behind the file (a team member from a second company of a shared project).
   */
  async function companyAllowed(person: { id: string; roles: string[] }, file: FileClass & { kind: 'protected' }, fileKey: string): Promise<boolean> {
    const parsed = parseUploadKey(fileKey);
    if (!parsed) return false;
    if (parsed.companyId === null || person.roles.includes('ADMIN')) return true;
    if (file.companyIds?.includes(parsed.companyId)) return true;
    const mine = deps.companiesOf ? await deps.companiesOf(person.id) : [];
    return mine.includes(parsed.companyId);
  }

  /**
   * May this person open a protected file now: any row that keeps it lets them in — and (1.23.38, when the
   * file's key is given) the company in its path is one they may see.
   */
  async function mayOpen(person: { id: string; roles: string[] }, file: FileClass, fileKey?: string): Promise<boolean> {
    if (file.kind !== 'protected') return false;
    if (!(await rowAllows(person, file))) return false;
    return fileKey === undefined ? true : companyAllowed(person, file, fileKey);
  }

  async function rowAllows(person: { id: string; roles: string[] }, file: FileClass & { kind: 'protected' }): Promise<boolean> {
    for (const taskId of file.taskIds) {
      // Both checks: canViewTask lets an administrator through a binned task; the Bin shows names and sizes only.
      const ok = await decisions.get(`${person.id}|t|${taskId}`, async () => (await deps.store.taskIsLive(taskId)) && (await deps.canViewTask(person.id, person.roles, taskId)), yes);
      if (ok) return true;
    }
    for (const chat of file.chats) {
      if (chat.deleted) continue;
      const ok = await decisions.get(`${person.id}|c|${chat.conversationId}`, () => deps.canSeeConversation(chat.conversationId, person.id), yes);
      if (ok) return true;
    }
    return false;
  }

  /**
   * Forget what was remembered about a person (removed from a project: their links stop at once rather
   * than within 10 seconds), or about everyone (a project's companies changed).
   */
  function forget(userId?: string): void {
    decisions.forget(userId === undefined ? undefined : `${userId}|`);
  }

  return { classify, resolve, mayOpen, forget };
}

export type FileAccess = ReturnType<typeof createFileAccess>;

/** The rows behind stored files, read from the database (exact-value reads; storageKey is indexed). */
export function createPrismaFileRowsStore(prisma: PrismaClient): FileRowsStore {
  return {
    async rowsOf(storageKey) {
      const [tasks, chats] = await Promise.all([
        prisma.attachment.findMany({ where: { storageKey }, select: { taskId: true, task: { select: { projectId: true } } } }),
        prisma.chatAttachment.findMany({
          where: { storageKey },
          select: { message: { select: { conversationId: true, deletedAt: true, conversation: { select: { projectId: true } } } } },
        }),
      ]);
      // 1.23.38: the companies of the projects behind the rows (the company check in the path).
      const projectIds = [
        ...new Set([...tasks.map((t) => t.task?.projectId), ...chats.map((c) => c.message.conversation?.projectId)].filter((id): id is string => !!id)),
      ];
      const projects = projectIds.length ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: PROJECT_COMPANY_SELECT }) : [];
      const companyIds = new Set<string>();
      for (const p of projects) {
        if (p.mainCompanyId) companyIds.add(p.mainCompanyId);
        for (const c of p.companies) companyIds.add(c.companyId);
      }
      return {
        taskIds: tasks.map((t) => t.taskId),
        chats: chats.map((c) => ({ conversationId: c.message.conversationId, deleted: c.message.deletedAt !== null })),
        companyIds: [...companyIds],
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
    async aliasOf(storageKey) {
      const row = await prisma.fileKeyAlias.findFirst({ where: { area: 'uploads', oldKey: storageKey }, select: { newKey: true } });
      return row?.newKey ?? null;
    },
    async taskIsLive(taskId) {
      const live = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } }, select: { id: true } });
      return live !== null;
    },
  };
}
