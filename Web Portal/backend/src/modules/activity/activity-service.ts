import type { ActivityRecord, ActivityRepository, ActivityScope, CreateActivityData } from './activity-repository';
import { currentVia } from '../../lib/acting-via';
import { countPerDay, DAY_PAGE, dayBounds } from './activity-days';

export interface ActivityServiceDeps {
  activities: ActivityRepository;
}

export function createActivityService({ activities }: ActivityServiceDeps) {
  /** A line written while MICO AI carries out a confirmed change says so (meta.via: "mico-ai"). */
  async function record(input: CreateActivityData): Promise<ActivityRecord> {
    const via = currentVia();
    if (!via) return activities.create(input);
    const meta = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? (input.meta as Record<string, unknown>) : {};
    return activities.create({ ...input, meta: { ...meta, via } });
  }
  async function listForTask(taskId: string): Promise<ActivityRecord[]> {
    return activities.listForTask(taskId);
  }
  /** Newest activity; `projectIds` (when given) scopes it to those projects in the query. */
  async function listRecent(limit?: number, projectIds?: string[] | null): Promise<ActivityRecord[]> {
    return activities.listRecent(limit, projectIds);
  }
  /** How many changes in the scope fell on each day from `fromDay` to `toDay` (days of `timeZone`); quiet days left out. */
  async function countByDay(fromDay: string, toDay: string, timeZone: string, scope: ActivityScope): Promise<{ day: string; count: number }[]> {
    const { from, to } = dayBounds(fromDay, toDay, timeZone);
    return countPerDay(await activities.timesBetween(from, to, scope), timeZone);
  }
  /** One day's changes in the scope, newest first, a page at a time; `next` = where the next page starts (null: none). */
  async function listDay(day: string, timeZone: string, scope: ActivityScope, before?: string | null): Promise<{ rows: ActivityRecord[]; next: string | null }> {
    const { from, to } = dayBounds(day, day, timeZone);
    const rows = await activities.listBetween(from, to, scope, { limit: DAY_PAGE + 1, before: before ?? null });
    const page = rows.slice(0, DAY_PAGE);
    return { rows: page, next: rows.length > DAY_PAGE ? page[page.length - 1]!.id : null };
  }
  return { record, listForTask, listRecent, countByDay, listDay };
}

export type ActivityService = ReturnType<typeof createActivityService>;
