import { NotFoundError, ValidationError } from '../../lib/http-errors';
import type { ChecklistItemRecord, ChecklistRepository } from './checklist-repository';
import type { TaskLookup } from './assignee-repository';

/** Completion percentage of a checklist (0 when empty), rounded to the nearest percent. */
export function progressFromItems(items: { done: boolean }[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.done).length;
  return Math.round((done / items.length) * 100);
}

/** Full progress summary: X of Y done + percentage. */
export function summaryFromItems(items: { done: boolean }[]): { done: number; total: number; percent: number } {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, percent: progressFromItems(items) };
}

export interface ChecklistServiceDeps {
  repo: ChecklistRepository;
  taskLookup: TaskLookup;
}

export function createChecklistService({ repo, taskLookup }: ChecklistServiceDeps) {
  async function ensureTask(taskId: string): Promise<void> {
    if (!(await taskLookup.exists(taskId))) throw new NotFoundError('Task not found.');
  }

  async function addItem(taskId: string, text: string): Promise<ChecklistItemRecord> {
    await ensureTask(taskId);
    const items = await repo.list(taskId);
    return repo.add(taskId, text, items.length);
  }

  async function toggleItem(itemId: string, done: boolean): Promise<ChecklistItemRecord> {
    return repo.toggle(itemId, done);
  }

  async function editItem(itemId: string, text: string): Promise<ChecklistItemRecord> {
    const clean = text.trim();
    if (!clean) throw new ValidationError('Checklist item text cannot be empty.');
    return repo.editText(itemId, clean);
  }

  async function reorderItems(taskId: string, orderedIds: string[]): Promise<ChecklistItemRecord[]> {
    await ensureTask(taskId);
    return repo.reorder(taskId, orderedIds);
  }

  async function listItems(taskId: string): Promise<ChecklistItemRecord[]> {
    await ensureTask(taskId);
    return repo.list(taskId);
  }

  async function removeItem(itemId: string): Promise<{ taskId: string } | null> {
    return repo.remove(itemId);
  }

  async function progress(taskId: string): Promise<number> {
    const items = await repo.list(taskId);
    return progressFromItems(items);
  }

  /** X of Y done + percentage for a task's checklist. */
  async function summary(taskId: string): Promise<{ done: number; total: number; percent: number }> {
    const items = await repo.list(taskId);
    return summaryFromItems(items);
  }

  return { addItem, toggleItem, editItem, reorderItems, listItems, removeItem, progress, summary };
}

export type ChecklistService = ReturnType<typeof createChecklistService>;
