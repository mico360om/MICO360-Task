import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  BULK_LIMIT_TEXT,
  BULK_MAX,
  DUPLICATE_LIMIT_TEXT,
  EMPTY_SELECTION,
  deselectIds,
  hiddenCount,
  limitReason,
  replaceWith,
  selectAllState,
  selectMany,
  selectedSpoken,
  selectedText,
  toggleRef,
  useBulkSelection,
  type SelRef,
} from './bulk-selection';

const ref = (n: number, projectId = 'p1'): SelRef => ({ id: `t${n}`, projectId, key: `RIG-${n}`, title: `Task ${n}` });
const ids = (s: { refs: ReadonlyMap<string, SelRef> }) => [...s.refs.keys()];
const list = [1, 2, 3, 4, 5, 6].map((n) => ref(n));

describe('bulk selection: toggle and range', () => {
  it('a click ticks a task, a second click unticks it', () => {
    let s = toggleRef(EMPTY_SELECTION, ref(1));
    expect(ids(s)).toEqual(['t1']);
    s = toggleRef(s, ref(1));
    expect(ids(s)).toEqual([]);
  });

  it('Shift-click ticks every task from the last one clicked to this one, in list order (either way)', () => {
    let s = toggleRef(EMPTY_SELECTION, ref(2));
    s = toggleRef(s, ref(5), { shift: true, order: list });
    expect(ids(s).sort()).toEqual(['t2', 't3', 't4', 't5']);
    // Upwards from the new anchor (t5) to t1.
    s = toggleRef(EMPTY_SELECTION, ref(5));
    s = toggleRef(s, ref(1), { shift: true, order: list });
    expect(ids(s).sort()).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('Shift-click with no anchor in this list (another board column) is a plain click', () => {
    let s = toggleRef(EMPTY_SELECTION, ref(9));
    s = toggleRef(s, ref(3), { shift: true, order: list });
    expect(ids(s).sort()).toEqual(['t3', 't9']);
  });

  it('the range keeps tasks ticked before', () => {
    let s = selectMany(EMPTY_SELECTION, [ref(6)]);
    s = toggleRef(s, ref(1));
    s = toggleRef(s, ref(2), { shift: true, order: list });
    expect(ids(s).sort()).toEqual(['t1', 't2', 't6']);
  });
});

describe('bulk selection: select all matching, filters, limits', () => {
  it('"Select all N matching" adds every matching task (not only the rows drawn); unticking it lets only those go', () => {
    let s = selectMany(EMPTY_SELECTION, [ref(9, 'p2')]);
    s = selectMany(s, list);
    expect(s.refs.size).toBe(7);
    expect(selectAllState(s, list.map((r) => r.id))).toBe('all');
    s = deselectIds(s, list.map((r) => r.id));
    expect(ids(s)).toEqual(['t9']);
    expect(selectAllState(s, list.map((r) => r.id))).toBe('none');
    expect(selectAllState(selectMany(s, [ref(1)]), list.map((r) => r.id))).toBe('some');
    expect(selectAllState(EMPTY_SELECTION, [])).toBe('none');
  });

  it('tasks filtered out stay selected and still count — "12 selected (3 hidden by filters)"', () => {
    const s = selectMany(EMPTY_SELECTION, list);
    expect(hiddenCount(s, ['t1', 't2', 't3'])).toBe(3);
    expect(selectedText(12, 3)).toBe('12 selected (3 hidden by filters)');
    expect(selectedText(1, 0)).toBe('1 selected');
    expect(selectedSpoken(12, 3)).toBe('12 tasks selected, 3 hidden by filters');
    expect(selectedSpoken(1, 0)).toBe('1 task selected');
  });

  it('"Select the skipped" replaces the selection, keeping what it knew about each task', () => {
    let s = selectMany(EMPTY_SELECTION, list);
    s = replaceWith(s, ['t2', 't4', 'zz']);
    expect(ids(s)).toEqual(['t2', 't4', 'zz']);
    expect(s.refs.get('t2')).toEqual(ref(2));
    expect(s.refs.get('zz')).toEqual({ id: 'zz', projectId: '' });
  });

  it('more than 500: every change is unavailable; Duplicate stops at 50', () => {
    expect(BULK_MAX).toBe(500);
    expect(limitReason(500, 'status')).toBeNull();
    expect(limitReason(501, 'status')).toBe(BULK_LIMIT_TEXT);
    expect(BULK_LIMIT_TEXT).toBe('Bulk changes take up to 500 tasks at a time');
    expect(limitReason(50, 'duplicate')).toBeNull();
    expect(limitReason(51, 'duplicate')).toBe(DUPLICATE_LIMIT_TEXT);
    expect(DUPLICATE_LIMIT_TEXT).toBe('Duplicate up to 50 tasks at a time');
    expect(limitReason(501, 'duplicate')).toBe(BULK_LIMIT_TEXT);
  });
});

describe('useBulkSelection', () => {
  it('keeps the ids, ranges, select all, clear', () => {
    const { result } = renderHook(() => useBulkSelection());
    act(() => result.current.toggle(ref(1)));
    act(() => result.current.toggle(ref(3), { shift: true, order: list }));
    expect([...result.current.selected].sort()).toEqual(['t1', 't2', 't3']);
    expect(result.current.count).toBe(3);
    expect(result.current.projectIds).toEqual(['p1']);
    act(() => result.current.selectAll([ref(8, 'p2')]));
    expect(result.current.projectIds.sort()).toEqual(['p1', 'p2']);
    expect(result.current.hiddenOf(['t1'])).toBe(3);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('a new scope (another board) starts empty', () => {
    const { result, rerender } = renderHook(({ scope }) => useBulkSelection(scope), { initialProps: { scope: 'a' } });
    act(() => result.current.toggle(ref(1)));
    expect(result.current.count).toBe(1);
    rerender({ scope: 'b' });
    expect(result.current.count).toBe(0);
  });
});
