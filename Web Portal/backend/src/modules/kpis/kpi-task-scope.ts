/**
 * Which tasks the KPIs count — the one place the releases before this one plug in:
 *   - Recycle Bin and Merge tasks: binned and merged tasks are deleted rows (deletedAt set); the source
 *     never reads them (KPI_TASK_WHERE).
 *   - Task archive (bulk release): an archived Done task still counts as done in every figure; an archived
 *     open task leaves all figures (countsInKpis).
 *   - Guests are not users: they are never assignees, so they never count as people. Client accounts are
 *     never on a team (client-kind): the people lists leave them out with STAFF_ONLY_WHERE.
 */
import type { Prisma } from '@prisma/client';

/** Tasks the KPIs read: never binned or merged ones. */
export const KPI_TASK_WHERE = { deletedAt: null } as const satisfies Prisma.TaskWhereInput;

/**
 * Open work the KPIs count ("Open blocked", a person's open tasks): when the task archive merges, add
 * `archivedAt: null` here — an archived open task leaves every figure.
 */
export const KPI_OPEN_TASK_WHERE = { ...KPI_TASK_WHERE } as const satisfies Prisma.TaskWhereInput;

/** Archived open tasks leave every figure; archived done ones count. */
export function countsInKpis(t: { archivedAt?: Date | null }, done: boolean): boolean {
  return !t.archivedAt || done;
}
