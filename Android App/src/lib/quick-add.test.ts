import { describe, it, expect } from 'vitest';
import { buildCreateTaskInput, parseTags } from './quick-add';

const form = { title: 'Ship it', projectId: 'p1', columnId: 'c1' };

describe('buildCreateTaskInput (A4.3 quick add)', () => {
  it('builds a create payload, trimming the title and defaulting priority', () => {
    const r = buildCreateTaskInput({ ...form, title: '  Ship it  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ title: 'Ship it', projectId: 'p1', columnId: 'c1', priority: 'NORMAL' });
  });

  it('passes through priority, dueDate and description when provided', () => {
    const r = buildCreateTaskInput({ ...form, priority: 'HIGH', dueDate: '2026-09-10', description: 'do it' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.priority).toBe('HIGH');
      expect(r.value.dueDate).toBe('2026-09-10');
      expect(r.value.description).toBe('do it');
    }
  });

  it('includes a positive estimated time and drops zero/negative/blank ones', () => {
    const r = buildCreateTaskInput({ ...form, estimatedHours: 2.5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.estimatedHours).toBe(2.5);

    for (const bad of [0, -1, NaN]) {
      const rr = buildCreateTaskInput({ ...form, estimatedHours: bad });
      expect(rr.ok).toBe(true);
      if (rr.ok) expect(rr.value.estimatedHours).toBeUndefined();
    }
  });

  it('includes cleaned tags and omits the field when there are none', () => {
    const r = buildCreateTaskInput({ ...form, tags: [' urgent ', 'urgent', '', 'backend'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tags).toEqual(['urgent', 'backend']);

    const none = buildCreateTaskInput({ ...form, tags: ['  ', ''] });
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.value.tags).toBeUndefined();
  });

  it('includes de-duplicated assigneeIds and omits the field when empty', () => {
    const r = buildCreateTaskInput({ ...form, assigneeIds: ['u1', 'u1', 'u2'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assigneeIds).toEqual(['u1', 'u2']);

    const none = buildCreateTaskInput({ ...form, assigneeIds: [] });
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.value.assigneeIds).toBeUndefined();
  });

  it('rejects an empty title', () => {
    const r = buildCreateTaskInput({ ...form, title: '   ' });
    expect(r).toEqual({ ok: false, error: 'A task title is required.' });
  });

  it('rejects when no project or column is selected', () => {
    expect(buildCreateTaskInput({ ...form, projectId: '' }).ok).toBe(false);
    expect(buildCreateTaskInput({ ...form, columnId: '' }).ok).toBe(false);
  });
});

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(parseTags('urgent, Backend ,urgent,, UX Review')).toEqual(['urgent', 'Backend', 'UX Review']);
  });
  it('returns an empty array for blank input', () => {
    expect(parseTags('   ')).toEqual([]);
    expect(parseTags('')).toEqual([]);
  });
});
