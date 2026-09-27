import type { Priority } from './types';

export interface QuickAddForm {
  title: string;
  projectId: string;
  columnId: string;
  priority?: Priority;
  dueDate?: string | null;
  description?: string;
  estimatedHours?: number | null;
  tags?: string[];
  assigneeIds?: string[];
  /** Per-date boards: the board day the task is created on (YYYY-MM-DD). */
  boardDate?: string;
}

export interface CreateTaskInput {
  title: string;
  projectId: string;
  columnId: string;
  priority: Priority;
  dueDate?: string | null;
  description?: string;
  estimatedHours?: number;
  tags?: string[];
  assigneeIds?: string[];
  boardDate?: string;
}

export type BuildResult = { ok: true; value: CreateTaskInput } | { ok: false; error: string };

/**
 * Tag separators: ASCII comma, the Arabic comma "،" (what Arabic keyboards type), semicolons
 * (ASCII and Arabic "؛") and new lines (ARB-04).
 */
const TAG_SEPARATORS = /[,،;؛\n]/;

/**
 * Split a tag string into clean names: trimmed, non-empty, and de-duplicated case-insensitively
 * (first spelling wins). "عاجل، مالية" is two tags, not one merged tag. Used by the tag field.
 */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(TAG_SEPARATORS)) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Clean an array of tag names the same way (used when a caller already has an array). */
function cleanTags(tags: string[]): string[] {
  return parseTags(tags.join(','));
}

/** Validate + shape the Quick Add form into a task-create payload (A4.3). */
export function buildCreateTaskInput(form: QuickAddForm): BuildResult {
  const title = form.title.trim();
  if (!title) return { ok: false, error: 'A task title is required.' };
  if (!form.projectId) return { ok: false, error: 'Pick a project.' };
  if (!form.columnId) return { ok: false, error: 'Pick a column.' };

  const value: CreateTaskInput = {
    title,
    projectId: form.projectId,
    columnId: form.columnId,
    priority: form.priority ?? 'NORMAL',
  };
  if (form.dueDate) value.dueDate = form.dueDate;
  if (form.description && form.description.trim()) value.description = form.description.trim();
  if (typeof form.estimatedHours === 'number' && Number.isFinite(form.estimatedHours) && form.estimatedHours > 0) {
    value.estimatedHours = form.estimatedHours;
  }
  if (form.tags && form.tags.length > 0) {
    const tags = cleanTags(form.tags);
    if (tags.length > 0) value.tags = tags;
  }
  if (form.assigneeIds && form.assigneeIds.length > 0) {
    const ids = [...new Set(form.assigneeIds.filter((id) => id && id.trim()))];
    if (ids.length > 0) value.assigneeIds = ids;
  }
  if (form.boardDate) value.boardDate = form.boardDate;
  return { ok: true, value };
}
