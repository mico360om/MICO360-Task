import type { QueuedMutation } from './sync-queue';
import type { ApiChecklistItem } from './types';

/**
 * Subtask ticks while they are being saved (2c review). Ticks of different subtasks go at once
 * (item-lanes), and each answer reloads the checklist: a tick still on its way is kept over the
 * reload — not flipped back until its own answer — and one kept on this phone (offline) is shown
 * over the server's checklist until it is sent. Pure, so it is tested here.
 */

/** The ticks still shown over a reloaded checklist: those whose save hasn't finished (`saving` counts them per subtask). */
export function ticksAfterReload(ticks: Record<string, boolean>, saving: ReadonlyMap<string, number>): Record<string, boolean> {
  const kept = Object.entries(ticks).filter(([id]) => (saving.get(id) ?? 0) > 0);
  return kept.length === Object.keys(ticks).length ? ticks : Object.fromEntries(kept);
}

type ChecklistPayload = { id?: unknown; itemId?: unknown; patch?: { done?: unknown; text?: unknown } };

/** The task's subtask changes kept on this phone, laid over the server's checklist (the latest of each wins). */
export function withQueuedTicks(items: ApiChecklistItem[], pending: readonly QueuedMutation[], taskId: string): ApiChecklistItem[] {
  const changes = new Map<string, Partial<Pick<ApiChecklistItem, 'done' | 'text'>>>();
  for (const m of pending) {
    if (m.kind !== 'checklist.update') continue;
    const p = (m.payload ?? {}) as ChecklistPayload;
    if (p.id !== taskId || typeof p.itemId !== 'string' || !p.patch) continue;
    const change = { ...changes.get(p.itemId) };
    if (typeof p.patch.done === 'boolean') change.done = p.patch.done;
    if (typeof p.patch.text === 'string') change.text = p.patch.text;
    changes.set(p.itemId, change);
  }
  if (changes.size === 0) return items;
  return items.map((i) => (changes.has(i.id) ? { ...i, ...changes.get(i.id) } : i));
}
