import { Prisma, type PrismaClient } from '@prisma/client';
import { escapeLike, parseTaskQuery } from './task-search-query';
import { describeMatches, personLabel, type TaskMatch } from './task-search-matches';
import { loadTaskSearchLive } from './task-search-index';
import { visibleTasksSql, type TaskSearchScope } from './task-search-scope';
import type { TextRange } from './task-search-text';

/** Column categories — a task's status, as the All projects board shows them. */
export const TASK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A first page counts its results up to this many ("1000+" beyond). */
export const TOTAL_CAP = 1000;

export interface TaskSearchInput {
  q: string;
  scope: TaskSearchScope;
  projectId?: string;
  /** Column categories to keep. */
  statuses?: string[];
  assigneeId?: string;
  /** true: finished tasks only; false: open ones only. */
  done?: boolean;
  /** Tasks of archived projects too. */
  includeArchived?: boolean;
  limit: number;
  offset?: number;
  /** Count the results (capped at TOTAL_CAP + 1: `totalCapped`). */
  withTotal?: boolean;
}

export interface TaskSearchHit {
  id: string;
  key: string;
  formerKeys: string[];
  title: string;
  /** Where the words are in the title (highlighted there). */
  titleRanges: TextRange[];
  projectId: string;
  project: { id: string; code: string; name: string; archived: boolean };
  status: { columnId: string; name: string; category: string };
  done: boolean;
  /** ISO instant, or null. */
  dueDate: string | null;
  /** The first three people it is assigned to, and how many there are. */
  assignees: { id: string; name: string }[];
  assigneeCount: number;
  /** Up to 3 other places it matched (comment, checklist, external contact…). */
  matches: TaskMatch[];
  /** Its external contacts' names and companies (older clients show which one matched). */
  external: string[];
}

export interface TaskSearchResult {
  hits: TaskSearchHit[];
  /** Where the next page starts, or null at the end. */
  nextOffset: number | null;
  total?: number;
  totalCapped?: boolean;
}

const like = (term: string) => Buffer.from(`%${escapeLike(term)}%`, 'utf8');

/**
 * Task search over the index (task_search_index): every word (or "phrase") must be somewhere in the
 * task — LIKE '%…%' on the normalised text, so part of a word matches — among the tasks the person
 * may find (task-search-scope), with the filters asked for. A task whose key is the query comes
 * first, then open tasks before finished ones, those matching in the title or key first, the most
 * recently changed first. Each result is then read as it is now to say where it matched; one the
 * index was behind on (a word no longer there) is left out and re-indexed.
 */
export function createTaskSearchEngine({
  prisma,
  index,
  timeZone,
  matchesPerTask = 3,
}: {
  prisma: PrismaClient;
  index?: { taskChanged(taskId: string): Promise<void> };
  timeZone: string;
  matchesPerTask?: number;
}) {
  async function search(input: TaskSearchInput): Promise<TaskSearchResult> {
    const { terms, whole } = parseTaskQuery(input.q);
    const limit = Math.max(1, Math.min(100, Math.floor(input.limit)));
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    if (terms.length === 0 || (input.scope.projectIds && input.scope.projectIds.length === 0)) return { hits: [], nextOffset: null, ...(input.withTotal ? { total: 0, totalCapped: false } : {}) };

    // A task's exact number finds it, in an archived project too ("open RIG-4"); otherwise archived
    // projects' tasks are found only when asked for.
    const exactKey = whole && !/\s/.test(whole) ? Prisma.sql`si.head LIKE ${Buffer.from(`%\n${escapeLike(whole)}\n%`, 'utf8')} ESCAPE '!'` : null;
    const visible = visibleTasksSql(input.scope, { includeArchived: input.includeArchived, ...(exactKey ? { archivedWhen: exactKey } : {}) });
    const where: Prisma.Sql[] = [visible, ...terms.map((term) => Prisma.sql`si.doc LIKE ${like(term)} ESCAPE '!'`)];
    if (input.projectId) where.push(Prisma.sql`t.projectId = ${input.projectId}`);
    if (input.statuses?.length) where.push(Prisma.sql`c.category IN (${Prisma.join(input.statuses)})`);
    if (input.assigneeId) where.push(Prisma.sql`EXISTS (SELECT 1 FROM task_assignees a WHERE a.taskId = t.id AND a.userId = ${input.assigneeId})`);
    if (input.done === true) where.push(Prisma.sql`(t.completedAt IS NOT NULL OR c.category = 'DONE')`);
    if (input.done === false) where.push(Prisma.sql`(t.completedAt IS NULL AND c.category <> 'DONE')`);
    const from = Prisma.sql`FROM task_search_index si
      JOIN tasks t ON t.id = si.taskId
      JOIN projects p ON p.id = t.projectId
      JOIN kanban_columns c ON c.id = t.columnId
      WHERE ${Prisma.join(where, ' AND ')}`;
    const inHead = Prisma.join(terms.map((term) => Prisma.sql`si.head LIKE ${like(term)} ESCAPE '!'`), ' AND ');

    const [rows, counted] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`SELECT t.id AS id ${from}
        ORDER BY (${exactKey ?? Prisma.sql`FALSE`}) DESC, (t.completedAt IS NOT NULL OR c.category = 'DONE') ASC, (${inHead}) DESC, t.updatedAt DESC, t.id DESC
        LIMIT ${limit + 1} OFFSET ${offset}`,
      input.withTotal ? prisma.$queryRaw<{ n: bigint | number }[]>`SELECT COUNT(*) AS n FROM (SELECT 1 AS one ${from} LIMIT ${TOTAL_CAP + 1}) x` : Promise.resolve(null),
    ]);
    const page = rows.slice(0, limit).map((r) => r.id);
    const hits = await describe(page, terms);
    const total = counted ? Number(counted[0]?.n ?? 0) : undefined;
    return {
      hits,
      nextOffset: rows.length > limit ? offset + limit : null,
      ...(total !== undefined ? { total, totalCapped: total > TOTAL_CAP } : {}),
    };
  }

  /** The tasks as they are now, in this order, with where they matched (stale ones left out and re-indexed). */
  async function describe(ids: string[], terms: string[]): Promise<TaskSearchHit[]> {
    if (ids.length === 0) return [];
    const [live, meta] = await Promise.all([
      loadTaskSearchLive(prisma, ids),
      prisma.task.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          projectId: true,
          dueDate: true,
          completedAt: true,
          column: { select: { id: true, name: true, category: true } },
          project: { select: { id: true, code: true, name: true, status: true } },
          assignees: { orderBy: { assignedAt: 'asc' }, select: { user: { select: { id: true, firstName: true, lastName: true, username: true } } } },
        },
      }),
    ]);
    const metaById = new Map(meta.map((m) => [m.id, m]));
    const hits: TaskSearchHit[] = [];
    for (const id of ids) {
      const task = live.get(id);
      const m = metaById.get(id);
      if (!task || !m) continue;
      const found = describeMatches(task, terms, { timeZone, max: matchesPerTask });
      if (!found.complete) {
        void index?.taskChanged(id);
        continue;
      }
      hits.push({
        id,
        key: task.key,
        formerKeys: task.formerKeys,
        title: task.title,
        titleRanges: found.titleRanges,
        projectId: m.projectId,
        project: { id: m.project.id, code: m.project.code, name: m.project.name, archived: m.project.status === 'ARCHIVED' },
        status: { columnId: m.column.id, name: m.column.name, category: m.column.category },
        done: m.column.category === 'DONE' || m.completedAt !== null,
        dueDate: m.dueDate ? m.dueDate.toISOString() : null,
        assignees: m.assignees.slice(0, 3).map((a) => ({ id: a.user.id, name: personLabel(a.user) })),
        assigneeCount: m.assignees.length,
        matches: found.matches,
        external: task.contacts.flatMap((c) => [c.name, c.company]).filter((v): v is string => Boolean(v)),
      });
    }
    return hits;
  }

  return { search };
}

export type TaskSearchEngine = ReturnType<typeof createTaskSearchEngine>;
