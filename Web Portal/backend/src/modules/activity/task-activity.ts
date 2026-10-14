/** One line of a task's activity timeline, as a route reports it (the server adds the project). */
export interface TaskActivityEvent {
  taskId: string;
  userId: string;
  action: string;
  meta?: Record<string, unknown>;
}

export type RecordTaskActivity = (event: TaskActivityEvent) => Promise<void>;

/**
 * Record a timeline line without ever failing the change it describes: the change has already
 * happened, and a missing line is not worth an error for the user.
 */
export async function noteActivity(record: RecordTaskActivity | undefined, event: TaskActivityEvent): Promise<void> {
  if (!record) return;
  try {
    await record(event);
  } catch {
    /* the change itself succeeded */
  }
}
