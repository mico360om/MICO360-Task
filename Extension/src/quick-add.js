// Pure helpers for the popup's quick-add form. Kept framework-free so they can be
// unit-tested and reused by the create + offline-queue paths (same payload shape).

/** Split a comma-separated string into clean, de-duplicated (case-insensitive) tag names. */
export function parseTags(input) {
  const seen = new Set();
  const out = [];
  for (const raw of String(input ?? '').split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Build a POST /tasks payload from the quick-add form, filling project/column from
 * defaults. Returns null when the required title/project/column are missing so the
 * caller can surface a message instead of sending an invalid request.
 */
export function buildQuickAddPayload(form, defaults = {}) {
  const title = String(form.title ?? '').trim();
  const projectId = form.projectId || defaults.projectId;
  const columnId = form.columnId || defaults.columnId;
  if (!title || !projectId || !columnId) return null;

  const payload = { title, projectId, columnId, priority: form.priority || 'NORMAL' };

  const description = String(form.description ?? '').trim();
  if (description) payload.description = description;

  const dueDate = String(form.dueDate ?? '').trim();
  if (dueDate) payload.dueDate = dueDate;

  const est = typeof form.estimatedHours === 'number' ? form.estimatedHours : parseFloat(form.estimatedHours);
  if (Number.isFinite(est) && est > 0) payload.estimatedHours = est;

  const tags = Array.isArray(form.tags) ? parseTags(form.tags.join(',')) : parseTags(form.tags);
  if (tags.length > 0) payload.tags = tags;

  if (Array.isArray(form.assigneeIds)) {
    const ids = [...new Set(form.assigneeIds.filter((id) => id && String(id).trim()))];
    if (ids.length > 0) payload.assigneeIds = ids;
  }

  return payload;
}
