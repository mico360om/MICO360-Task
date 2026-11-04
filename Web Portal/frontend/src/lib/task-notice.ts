import { create } from 'zustand';

/**
 * 1.22.3: the app's one notice about a task just made — "Task MICO-143 created" (the task form, from
 * anywhere) or "Task MICO-143 saved" (one made offline, once it syncs) — with Open, which opens it in
 * the task panel. A sentence, so the number is plain text in it. The app shell shows it
 * (TaskNoticeToast); the newest replaces the one before.
 */
export interface TaskNotice {
  text: string;
  /** The task Open opens, and its number (null: several tasks, no Open). */
  taskId: string | null;
  key: string | null;
}

export const useTaskNotice = create<{ notice: TaskNotice | null }>(() => ({ notice: null }));

export function showTaskNotice(notice: TaskNotice | null): void {
  if (notice) useTaskNotice.setState({ notice });
}

export function clearTaskNotice(): void {
  useTaskNotice.setState({ notice: null });
}

type Made = { id: string; key: string };

/** "Task MICO-143 created". */
export function taskCreatedNotice(task: Made): TaskNotice {
  return { text: `Task ${task.key} created`, taskId: task.id, key: task.key };
}

/** "Task MICO-143 saved"; several at once: "Tasks MICO-143 and MICO-144 saved" (no Open). Nothing synced: none. */
export function taskSavedNotice(tasks: Made[]): TaskNotice | null {
  if (tasks.length === 0) return null;
  if (tasks.length === 1) return { text: `Task ${tasks[0]!.key} saved`, taskId: tasks[0]!.id, key: tasks[0]!.key };
  const keys = tasks.map((t) => t.key);
  return { text: `Tasks ${keys.slice(0, -1).join(', ')} and ${keys.at(-1)} saved`, taskId: null, key: null };
}
