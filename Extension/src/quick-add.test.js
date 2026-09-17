import { describe, it, expect } from 'vitest';
import { buildQuickAddPayload, parseTags } from './quick-add.js';

describe('buildQuickAddPayload', () => {
  const defaults = { projectId: 'p1', columnId: 'c1' };

  it('builds a minimal payload from defaults, trimming + defaulting priority', () => {
    expect(buildQuickAddPayload({ title: '  Ship it  ' }, defaults)).toEqual({
      title: 'Ship it',
      projectId: 'p1',
      columnId: 'c1',
      priority: 'NORMAL',
    });
  });

  it('includes description, a chosen column, priority, due date, estimate and tags', () => {
    const p = buildQuickAddPayload(
      { title: 'X', columnId: 'c2', priority: 'HIGH', description: ' do it ', dueDate: '2026-09-10', estimatedHours: '2.5', tags: 'urgent, Urgent , backend' },
      defaults,
    );
    expect(p).toEqual({
      title: 'X',
      projectId: 'p1',
      columnId: 'c2',
      priority: 'HIGH',
      description: 'do it',
      dueDate: '2026-09-10',
      estimatedHours: 2.5,
      tags: ['urgent', 'backend'],
    });
  });

  it('includes de-duplicated assigneeIds and omits the field when empty', () => {
    const p = buildQuickAddPayload({ title: 'X', assigneeIds: ['u1', 'u1', 'u2'] }, defaults);
    expect(p.assigneeIds).toEqual(['u1', 'u2']);
    expect(buildQuickAddPayload({ title: 'X', assigneeIds: [] }, defaults).assigneeIds).toBeUndefined();
    expect(buildQuickAddPayload({ title: 'X' }, defaults).assigneeIds).toBeUndefined();
  });

  it('drops a zero/blank/negative estimate', () => {
    expect(buildQuickAddPayload({ title: 'X', estimatedHours: '0' }, defaults).estimatedHours).toBeUndefined();
    expect(buildQuickAddPayload({ title: 'X', estimatedHours: '' }, defaults).estimatedHours).toBeUndefined();
    expect(buildQuickAddPayload({ title: 'X', estimatedHours: '-4' }, defaults).estimatedHours).toBeUndefined();
  });

  it('returns null when the title, project or column is missing', () => {
    expect(buildQuickAddPayload({ title: '   ' }, defaults)).toBeNull();
    expect(buildQuickAddPayload({ title: 'X' }, {})).toBeNull();
    expect(buildQuickAddPayload({ title: 'X', projectId: 'p1' }, {})).toBeNull();
  });
});

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(parseTags('urgent, Backend ,urgent,, UX Review')).toEqual(['urgent', 'Backend', 'UX Review']);
  });
  it('returns an empty array for blank/undefined input', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});
