import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_FILTERS,
  BUILT_IN_VIEWS,
  loadCustomViews,
  saveView,
  deleteView,
  filtersEqual,
  hasActiveFilters,
  type TaskFilters,
} from './savedViews';

const filters = (over: Partial<TaskFilters> = {}): TaskFilters => ({ ...EMPTY_FILTERS, ...over });

describe('savedViews', () => {
  beforeEach(() => localStorage.clear());

  it('ships "My overdue" and "This sprint" built-in presets', () => {
    const names = BUILT_IN_VIEWS.map((v) => v.name);
    expect(names).toContain('My overdue');
    expect(names).toContain('This sprint');
    expect(BUILT_IN_VIEWS.find((v) => v.name === 'My overdue')!.filters.due).toBe('overdue');
    expect(BUILT_IN_VIEWS.find((v) => v.name === 'This sprint')!.filters.due).toBe('week');
    expect(BUILT_IN_VIEWS.every((v) => v.builtIn)).toBe(true);
  });

  it('saves a custom view and reads it back across a fresh load', () => {
    const saved = saveView('High priority', filters({ priority: 'HIGH', sort: 'priority' }));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe('High priority');
    expect(saved[0]!.builtIn).toBeUndefined();
    const reloaded = loadCustomViews();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.filters.priority).toBe('HIGH');
  });

  it('replaces a view saved under an existing name rather than duplicating', () => {
    saveView('Mine', filters({ priority: 'HIGH' }));
    const after = saveView('Mine', filters({ priority: 'LOW' }));
    expect(after).toHaveLength(1);
    expect(after[0]!.filters.priority).toBe('LOW');
  });

  it('deletes a custom view by id', () => {
    const saved = saveView('Temp', filters({ status: 'DONE' }));
    const remaining = deleteView(saved[0]!.id);
    expect(remaining).toHaveLength(0);
    expect(loadCustomViews()).toHaveLength(0);
  });

  it('filtersEqual compares every field', () => {
    expect(filtersEqual(filters({ due: 'overdue' }), filters({ due: 'overdue' }))).toBe(true);
    expect(filtersEqual(filters({ due: 'overdue' }), filters({ due: 'week' }))).toBe(false);
  });

  it('hasActiveFilters ignores the sort field', () => {
    expect(hasActiveFilters(filters({ sort: 'priority' }))).toBe(false);
    expect(hasActiveFilters(filters({ status: 'DONE' }))).toBe(true);
  });

  it('survives corrupt storage without throwing', () => {
    localStorage.setItem('mico360.mytasks.views', '{not json');
    expect(loadCustomViews()).toEqual([]);
  });
});
