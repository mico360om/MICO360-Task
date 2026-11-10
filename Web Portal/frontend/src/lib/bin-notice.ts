import { create } from 'zustand';

/**
 * Recycle Bin: "RIG-12 moved to the Recycle Bin · Undo" at the foot of the window for a few seconds after
 * a delete (the task panel has closed by then, so the app shell shows it: BinUndoToast). Undo restores
 * what that delete took — a whole series when it went as one. The newest replaces the one before.
 */
export interface BinNotice {
  text: string;
  /** The task deleted (the copy asked for; with `wholeBatch` its series comes back with it). */
  taskId: string;
  key: string;
  wholeBatch: boolean;
}

export const useBinNotice = create<{ notice: BinNotice | null }>(() => ({ notice: null }));

export function showBinNotice(notice: BinNotice): void {
  useBinNotice.setState({ notice });
}

export function clearBinNotice(): void {
  useBinNotice.setState({ notice: null });
}

/**
 * "RIG-12 moved to the Recycle Bin"; its entire series (`series`: how many tasks, 0 when not known):
 * "RIG-12 and its series (12 tasks) moved to the Recycle Bin". Null: just this task.
 */
export function binNoticeFor(task: { id: string; key: string }, series: number | null): BinNotice {
  const what = series !== null && series > 1 ? `${task.key} and its series (${series} tasks)` : series !== null ? `${task.key} and its series` : task.key;
  return { text: `${what} moved to the Recycle Bin`, taskId: task.id, key: task.key, wholeBatch: series !== null };
}
