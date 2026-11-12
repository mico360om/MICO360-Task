import { Prisma } from '@prisma/client';

/**
 * Task archive (bulk lane; owner, 10 Nov 2026) — the where fragments every read uses:
 *
 * - **Views and sweeps** (boards, lists, My Tasks, calendar, Timeline, Workload, dashboards, reminders,
 *   the daily email, open/late/waiting lists and counts): never an archived task — NOT_ARCHIVED.
 * - **Figures** (completion %, health, milestones, Management, client-visible counts, progress): an archived
 *   Done task still counts as done; an archived open task leaves every figure, its totals too — COUNTED_TASK.
 *   On an open-only query the two are the same (an open archived task is never counted).
 * - **Search** finds archived tasks (marked); **reports** add them only when asked (includeArchived).
 * - Single-task reads (a task's details, its PDF) keep them: liveTaskWhere is not changed.
 */

/** A task that is not archived (Prisma). */
export const NOT_ARCHIVED = { archivedAt: null } as const satisfies Prisma.TaskWhereInput;

/** An archived task (Prisma) — a project's "Archived tasks" list. */
export const ARCHIVED_ONLY = { archivedAt: { not: null } } as const satisfies Prisma.TaskWhereInput;

/**
 * Counted in figures (Prisma): not archived, or done (a Done column or a completion time — the shared
 * rule). Put it inside `AND: [...]` where the query already has a top-level `OR`.
 */
export const COUNTED_TASK = {
  OR: [{ archivedAt: null }, { completedAt: { not: null } }, { column: { is: { category: 'DONE' } } }],
} as const satisfies Prisma.TaskWhereInput;

/** SQL: task `t` is not archived. */
export function notArchivedSql(t = 't'): Prisma.Sql {
  return Prisma.raw(`${t}.archivedAt IS NULL`);
}

/** SQL: task `t` (joined to its column `c`) is counted in figures — not archived, or done. */
export function countedSql(t = 't', c = 'c'): Prisma.Sql {
  return Prisma.raw(`(${t}.archivedAt IS NULL OR ${c}.category = 'DONE' OR ${t}.completedAt IS NOT NULL)`);
}

/** Which archived tasks a task list has (TaskListFilter.archived). */
export type ArchivedListing = 'exclude' | 'only' | 'counted' | 'include';

/** The Prisma fragment for a listing (`{}` for include). */
export function archivedWhere(listing: ArchivedListing = 'exclude'): Prisma.TaskWhereInput {
  switch (listing) {
    case 'only':
      return ARCHIVED_ONLY;
    case 'counted':
      return COUNTED_TASK;
    case 'include':
      return {};
    default:
      return NOT_ARCHIVED;
  }
}

/** In memory, for a row read with its column and completion: is it counted in figures? */
export function isCountedTask(t: { archivedAt?: Date | null; completedAt?: Date | null; columnCategory?: string | null }): boolean {
  return !t.archivedAt || !!t.completedAt || t.columnCategory === 'DONE';
}
