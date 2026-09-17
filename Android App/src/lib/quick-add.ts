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
}

export type BuildResult = { ok: true; value: CreateTaskInput } | { ok: false; error: string };

/**
 * Split a comma-separated tag string into clean names: trimmed, non-empty, and
 * de-duplicated case-insensitively (first spelling wins). Used by the tag field.
 */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(',')) {
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
  return { ok: true, value };
}
