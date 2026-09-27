import type { ActivityRecord, ActivityRepository, CreateActivityData } from './activity-repository';

export interface ActivityServiceDeps {
  activities: ActivityRepository;
}

export function createActivityService({ activities }: ActivityServiceDeps) {
  async function record(input: CreateActivityData): Promise<ActivityRecord> {
    return activities.create(input);
  }
  async function listForTask(taskId: string): Promise<ActivityRecord[]> {
    return activities.listForTask(taskId);
  }
  /** Newest activity; `projectIds` (when given) scopes it to those projects in the query. */
  async function listRecent(limit?: number, projectIds?: string[] | null): Promise<ActivityRecord[]> {
    return activities.listRecent(limit, projectIds);
  }
  return { record, listForTask, listRecent };
}

export type ActivityService = ReturnType<typeof createActivityService>;
