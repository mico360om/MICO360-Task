import { useCallback, useMemo, useState } from 'react';
import type { BulkActionType } from '../api/bulk';

/**
 * Bulk task changes: the one selection model of every place tasks are ticked (My Tasks, a project's
 * Tasks tab, the Table view, the Kanban board's Select mode). A selection is a set of task ids — each
 * with what the place knew of it (its project, number and title) so the bar can tell whether they are
 * all in one project and "Select the 2 skipped" can come back to them. It survives scrolling and filter
 * changes: a task filtered out stays selected and still counts ("12 selected (3 hidden by filters)").
 */

/** The most tasks one bulk change takes (the server's limit too). */
export const BULK_MAX = 500;
/** The most tasks one bulk Duplicate takes. */
export const DUPLICATE_MAX = 20;
export const BULK_LIMIT_TEXT = 'Bulk changes take up to 500 tasks at a time';
export const DUPLICATE_LIMIT_TEXT = 'Duplicate up to 20 tasks at a time';

/** A selected task, as the place it was ticked in knew it ('' project: not known — a task brought back by id). */
export interface SelRef {
  id: string;
  projectId: string;
  key?: string;
  title?: string;
}

/** A task as a selection keeps it. */
export const taskRef = (t: { id: string; projectId: string; key: string; title: string }): SelRef => ({ id: t.id, projectId: t.projectId, key: t.key, title: t.title });

/** A task's select box's name: "Select RIG-12 Pour the slab". */
export const selectBoxName = (t: { key: string; title: string }): string => `Select ${t.key} ${t.title}`;

export interface SelectionState {
  /** In the order they were ticked. */
  refs: ReadonlyMap<string, SelRef>;
  /** The task clicked last: a Shift-click selects from it. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { refs: new Map(), anchor: null };

export interface ToggleOptions {
  /** Shift was held: select the range from the last task clicked to this one. */
  shift?: boolean;
  /** The list as shown, for the range (on the board: the card's column). */
  order?: readonly SelRef[];
}

/**
 * A click on a task's box: ticks or unticks it. With Shift, every task between the last one clicked and
 * this one (in `order`, either way) is ticked — when the last one is in that list; otherwise a plain click.
 */
export function toggleRef(state: SelectionState, ref: SelRef, opts: ToggleOptions = {}): SelectionState {
  const order = opts.order ?? [];
  const from = opts.shift && state.anchor ? order.findIndex((r) => r.id === state.anchor) : -1;
  const to = order.findIndex((r) => r.id === ref.id);
  const refs = new Map(state.refs);
  if (from >= 0 && to >= 0) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (const r of order.slice(a, b + 1)) refs.set(r.id, r);
  } else if (refs.has(ref.id)) {
    refs.delete(ref.id);
  } else {
    refs.set(ref.id, ref);
  }
  return { refs, anchor: ref.id };
}

/** Tick all of these (already ticked ones stay as they are). */
export function selectMany(state: SelectionState, list: readonly SelRef[]): SelectionState {
  const refs = new Map(state.refs);
  for (const r of list) if (!refs.has(r.id)) refs.set(r.id, r);
  return { refs, anchor: state.anchor };
}

/** Untick these (the rest stay). */
export function deselectIds(state: SelectionState, ids: readonly string[]): SelectionState {
  const refs = new Map(state.refs);
  for (const id of ids) refs.delete(id);
  return { refs, anchor: state.anchor };
}

/**
 * Exactly these ids ("Select the 2 skipped"), keeping what was known of each — from the selection, or
 * from `known` (the selection the change was applied to, since cleared).
 */
export function replaceWith(state: SelectionState, ids: readonly string[], known: readonly SelRef[] = []): SelectionState {
  const refs = new Map<string, SelRef>();
  for (const id of ids) refs.set(id, state.refs.get(id) ?? known.find((r) => r.id === id) ?? { id, projectId: '' });
  return { refs, anchor: null };
}

/** How many selected tasks the current filters (or the day shown) leave off the screen. */
export function hiddenCount(state: SelectionState, visibleIds: Iterable<string>): number {
  const visible = new Set(visibleIds);
  let n = 0;
  for (const id of state.refs.keys()) if (!visible.has(id)) n += 1;
  return n;
}

/** The "Select all N matching" box: every matching task ticked, some, or none. */
export function selectAllState(state: SelectionState, matchingIds: readonly string[]): 'all' | 'some' | 'none' {
  let n = 0;
  for (const id of matchingIds) if (state.refs.has(id)) n += 1;
  if (n === 0) return 'none';
  return n === matchingIds.length ? 'all' : 'some';
}

/** "12 selected" — and "(3 hidden by filters)" when some of them aren't shown. */
export function selectedText(count: number, hidden: number): string {
  return hidden > 0 ? `${count} selected (${hidden} hidden by filters)` : `${count} selected`;
}

/** What a screen reader hears as the selection changes: "12 tasks selected, 3 hidden by filters". */
export function selectedSpoken(count: number, hidden: number): string {
  const head = `${count} task${count === 1 ? '' : 's'} selected`;
  return hidden > 0 ? `${head}, ${hidden} hidden by filters` : head;
}

/** Why a change can't be applied to this many tasks (null: it can). */
export function limitReason(count: number, type: BulkActionType | 'merge' | 'project'): string | null {
  if (count > BULK_MAX) return BULK_LIMIT_TEXT;
  if (type === 'duplicate' && count > DUPLICATE_MAX) return DUPLICATE_LIMIT_TEXT;
  return null;
}

export interface BulkSelection {
  selected: ReadonlySet<string>;
  /** The selected tasks as known, in the order they were ticked. */
  refs: SelRef[];
  count: number;
  /** The projects of the selected tasks (as known). */
  projectIds: string[];
  has: (id: string) => boolean;
  toggle: (ref: SelRef, opts?: ToggleOptions) => void;
  selectAll: (list: readonly SelRef[]) => void;
  deselect: (ids: readonly string[]) => void;
  replace: (ids: readonly string[], known?: readonly SelRef[]) => void;
  clear: () => void;
  hiddenOf: (visibleIds: Iterable<string>) => number;
  allState: (matchingIds: readonly string[]) => 'all' | 'some' | 'none';
}

/**
 * A place's selection. `scope` (e.g. the board's project): a new one starts empty — another board's
 * tasks are another selection.
 */
export function useBulkSelection(scope?: string): BulkSelection {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);
  const [shownScope, setShownScope] = useState(scope);
  let current = state;
  if (shownScope !== scope) {
    setShownScope(scope);
    setState(EMPTY_SELECTION);
    current = EMPTY_SELECTION;
  }
  const toggle = useCallback((ref: SelRef, opts?: ToggleOptions) => setState((s) => toggleRef(s, ref, opts)), []);
  const selectAll = useCallback((list: readonly SelRef[]) => setState((s) => selectMany(s, list)), []);
  const deselect = useCallback((ids: readonly string[]) => setState((s) => deselectIds(s, ids)), []);
  const replace = useCallback((ids: readonly string[], known?: readonly SelRef[]) => setState((s) => replaceWith(s, ids, known)), []);
  const clear = useCallback(() => setState(EMPTY_SELECTION), []);
  return useMemo(() => {
    const refs = [...current.refs.values()];
    const selected = new Set(current.refs.keys());
    return {
      selected,
      refs,
      count: refs.length,
      projectIds: [...new Set(refs.map((r) => r.projectId).filter(Boolean))],
      has: (id: string) => selected.has(id),
      toggle,
      selectAll,
      deselect,
      replace,
      clear,
      hiddenOf: (visibleIds: Iterable<string>) => hiddenCount(current, visibleIds),
      allState: (matchingIds: readonly string[]) => selectAllState(current, matchingIds),
    };
  }, [current, toggle, selectAll, deselect, replace, clear]);
}
