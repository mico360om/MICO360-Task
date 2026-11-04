import { create } from 'zustand';

/**
 * Previous / Next in the task panel (1.22): the list a task was opened from — a board (column by
 * column, top to bottom), My Tasks (its sort and filters), the Search results, a calendar day — kept
 * here when it opens (lib/useOpenTask), so the panel can step through it. A task opened from
 * anywhere else (a notification, a shared link) has no list, and the panel shows no steps.
 */
export type StepDirection = 'previous' | 'next';

export interface TaskStepsState {
  /** The list's task ids, in the order shown; null = none. */
  ids: string[] | null;
  /** The page the list belongs to (its pathname): leaving it leaves the list behind. */
  path: string | null;
  /** The way the person last stepped, so focus stays on that button in the next task's panel. */
  stepped: StepDirection | null;
  /** A task opened from this list (null: from no list). */
  open: (ids: string[] | null, path: string) => void;
  step: (direction: StepDirection) => void;
  /** The panel closed: the list stays (Back reopens its last task with its steps); the step taken doesn't. */
  settle: () => void;
  clear: () => void;
}

export const useTaskSteps = create<TaskStepsState>((set) => ({
  ids: null,
  path: null,
  stepped: null,
  open: (ids, path) => set({ ids: ids && ids.length ? [...ids] : null, path, stepped: null }),
  step: (direction) => set({ stepped: direction }),
  settle: () => set({ stepped: null }),
  clear: () => set({ ids: null, path: null, stepped: null }),
}));

/**
 * The task's place in the list it was opened from, as the panel shows it: "3 of 18", and the steps
 * to the tasks before and after it (missing at the ends). `focus`: the step just taken, whose button
 * keeps focus in the next task's panel.
 */
export interface TaskStepper {
  position: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  focus?: StepDirection | null;
}

export interface TaskStepPlace {
  /** 1-based: "3 of 18". */
  position: number;
  total: number;
  previous: string | null;
  next: string | null;
}

/** The task's place in the list, or null when there is nothing to step through. Each task counts once. */
export function stepsAt(ids: string[] | null | undefined, taskId: string): TaskStepPlace | null {
  if (!ids) return null;
  const list = [...new Set(ids)];
  const at = list.indexOf(taskId);
  if (at < 0 || list.length < 2) return null;
  return { position: at + 1, total: list.length, previous: list[at - 1] ?? null, next: list[at + 1] ?? null };
}
