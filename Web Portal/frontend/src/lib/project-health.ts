/**
 * 1.23.5 Project overview & health on the website: a task's weight (its own, else its project's default for
 * its priority — the server's rule, modules/project-health/completion.ts), whether a project counts by
 * weight, completion in words, and the health badge's words. The server decides the health itself.
 */
import type { Priority } from '../api/tasks';
import type { ApiProject, ProjectCompletion } from '../api/projects';
import type { Rag, RagReason } from '../api/management';
import { RAG_WORD } from './management';

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 10;
export const WEIGHT_DEFAULTS: Readonly<Record<Priority, number>> = { URGENT: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

type WeightProject = Partial<Pick<ApiProject, 'completionMode' | 'weightUrgent' | 'weightHigh' | 'weightNormal' | 'weightLow'>>;

/** A project's defaults by priority (an older server sends none: 4/3/2/1). */
export function projectWeights(p: WeightProject | null | undefined): Record<Priority, number> {
  return {
    URGENT: p?.weightUrgent ?? WEIGHT_DEFAULTS.URGENT,
    HIGH: p?.weightHigh ?? WEIGHT_DEFAULTS.HIGH,
    NORMAL: p?.weightNormal ?? WEIGHT_DEFAULTS.NORMAL,
    LOW: p?.weightLow ?? WEIGHT_DEFAULTS.LOW,
  };
}

/** The weight a task counts with. */
export function effectiveWeight(task: { weight?: number | null; priority: Priority }, project: WeightProject | null | undefined): number {
  return typeof task.weight === 'number' ? task.weight : projectWeights(project)[task.priority];
}

/** Only a project counting by weight shows weights (the task form, the panel, the table). */
export const countsByWeight = (p: WeightProject | null | undefined): boolean => p?.completionMode === 'WEIGHT';

const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/** A weight picker's choices: "Default (3)" (no weight of its own), then 1–10 points. */
export function weightChoices(defaultWeight: number): { value: string; label: string }[] {
  return [{ value: '', label: `Default (${defaultWeight})` }, ...Array.from({ length: WEIGHT_MAX - WEIGHT_MIN + 1 }, (_, i) => ({ value: String(i + WEIGHT_MIN), label: points(i + WEIGHT_MIN) }))];
}

/** "62% by weight · 70% by count", or "70% done" for a project counting by number. */
export function completionText(c: ProjectCompletion): string {
  return c.mode === 'WEIGHT' ? `${c.weightPct}% by weight · ${c.countPct}% by count` : `${c.countPct}% done`;
}

/** The badge in words for screen readers and its hover: "Health: Amber — 1 task blocked for over 7 days; 2 late tasks". */
export function healthSummary(h: { rag: Rag; reasons: RagReason[] }): string {
  return `Health: ${RAG_WORD[h.rag]} — ${h.reasons.map((r) => r.text).join('; ')}`;
}

/**
 * A project's completion worked out from its live tasks (the project page, kept live as tasks change):
 * finished ÷ all, by number and by weight, the project's own mode first. "Finished" is the shared rule (a
 * Done column or a completion time); the server's figure for the cards and Management is the same.
 */
export function projectCompletion(
  tasks: readonly { columnCategory?: string | null; completedAt?: string | null; weight?: number | null; priority: Priority }[],
  project: WeightProject | null | undefined,
): ProjectCompletion {
  let done = 0;
  let weightTotal = 0;
  let weightDone = 0;
  for (const t of tasks) {
    const w = effectiveWeight(t, project);
    weightTotal += w;
    if (t.columnCategory === 'DONE' || t.completedAt) {
      done += 1;
      weightDone += w;
    }
  }
  // Rounded, but 100% only once all of it is finished (as the Projects page shows it).
  const share = (part: number, whole: number) => (whole <= 0 ? 0 : part >= whole ? 100 : Math.min(99, Math.round((part / whole) * 100)));
  const countPct = share(done, tasks.length);
  const weightPct = share(weightDone, weightTotal);
  const mode = countsByWeight(project) ? 'WEIGHT' : 'COUNT';
  return { mode, pct: mode === 'WEIGHT' ? weightPct : countPct, countPct, weightPct };
}
