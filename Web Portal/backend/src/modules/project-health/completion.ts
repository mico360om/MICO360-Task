/**
 * 1.23.5 Project overview & health — completion counted by weight (owner answer 1).
 *
 * Each task may carry a weight of 1–10 points; a task without one counts its project's default for its
 * priority (read live, so a priority change moves it). A project counts its completion either by the
 * number of tasks (COUNT — as before, every project's default) or by weight (WEIGHT): finished weight ÷
 * the total weight of its live tasks. Merged and deleted tasks are never counted (no "cancelled" status
 * exists: a project's own "Cancelled" column filed under Done counts as finished, as today — call 5).
 */

export type CompletionMode = 'COUNT' | 'WEIGHT';
export const COMPLETION_MODES: readonly CompletionMode[] = ['COUNT', 'WEIGHT'];
export type WeightPriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
export type WeightDefaults = Record<WeightPriority, number>;

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 10;
/** What every project starts with (owner: "e.g. Urgent 4, High 3, Normal 2, Low 1"). */
export const DEFAULT_WEIGHTS: Readonly<WeightDefaults> = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

/** A project's four stored defaults, by priority. */
export function weightDefaultsOf(p: { weightUrgent: number; weightHigh: number; weightNormal: number; weightLow: number }): WeightDefaults {
  return { URGENT: p.weightUrgent, HIGH: p.weightHigh, NORMAL: p.weightNormal, LOW: p.weightLow };
}

/** The weight a task counts with: its own, else its project's default for its priority. */
export function effectiveWeight(task: { weight: number | null | undefined; priority: string }, defaults: Readonly<WeightDefaults>): number {
  if (typeof task.weight === 'number') return task.weight;
  return defaults[task.priority as WeightPriority] ?? defaults.NORMAL;
}

/** A project's live tasks, counted and weighed. */
export interface CompletionFigures {
  total: number;
  done: number;
  weightTotal: number;
  weightDone: number;
}

export interface Completion {
  mode: CompletionMode;
  /** The project's completion figure, in its own mode (0–100). */
  pct: number;
  /** Finished tasks ÷ live tasks, and finished weight ÷ total weight (the project page shows both). */
  countPct: number;
  weightPct: number;
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((Math.min(whole, Math.max(0, part)) / whole) * 100) : 0);

export function completionOf(f: CompletionFigures, mode: CompletionMode): Completion {
  const countPct = share(f.done, f.total);
  const weightPct = share(f.weightDone, f.weightTotal);
  return { mode, pct: mode === 'WEIGHT' ? weightPct : countPct, countPct, weightPct };
}
