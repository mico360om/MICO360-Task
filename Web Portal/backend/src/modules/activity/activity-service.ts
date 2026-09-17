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
  async function listRecent(limit?: number): Promise<ActivityRecord[]> {
    return activities.listRecent(limit);
  }
  return { record, listForTask, listRecent };
}

export type ActivityService = ReturnType<typeof createActivityService>;
