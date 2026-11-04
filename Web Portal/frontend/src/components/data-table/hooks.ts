import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/auth-store';
import { readTableMemory, saveFailureText, writeTableMemory, type SortState, type TableFilters, type TableMemory } from '../../lib/data-table';
import { readUserValue, writeUserValue } from '../../lib/user-storage';

/**
 * A table's sort, filters and shown columns, remembered for the signed-in person on this page on this
 * device (lib/data-table's memory; cleared at sign-out like the other per-person choices).
 */
export function useTableMemory(page: string, defaults: { shown: string[] }, { remember = true }: { remember?: boolean } = {}) {
  const userId = useAuthStore((s) => s.user?.id);
  const [memory, setMemory] = useState<TableMemory>(() => {
    const m = remember ? readTableMemory(useAuthStore.getState().user?.id, page) : readTableMemory(null, page);
    return { ...m, shown: m.shown ?? defaults.shown };
  });
  useEffect(() => {
    // Not remembering: the page keeps the table's state itself (My Tasks); this one must not overwrite it.
    if (remember) writeTableMemory(userId, page, memory);
  }, [userId, page, memory, remember]);
  const setSort = useCallback((sort: SortState | null) => setMemory((m) => ({ ...m, sort })), []);
  const setFilters = useCallback((filters: TableFilters) => setMemory((m) => ({ ...m, filters })), []);
  const setShown = useCallback((shown: string[]) => setMemory((m) => ({ ...m, shown })), []);
  return { sort: memory.sort, filters: memory.filters, shown: memory.shown ?? defaults.shown, setSort, setFilters, setShown };
}

/**
 * A page's view choice (List or Table, Board or Table…), remembered for the signed-in person on this
 * device under `name` — the way My Tasks has always remembered Grid or List.
 */
export function useViewChoice<V extends string>(name: string, choices: readonly V[], fallback: V): [V, (v: V) => void] {
  const userId = useAuthStore((s) => s.user?.id);
  const [view, setView] = useState<V>(() => {
    const saved = readUserValue(useAuthStore.getState().user?.id, name) as V | null;
    return saved && choices.includes(saved) ? saved : fallback;
  });
  useEffect(() => {
    writeUserValue(userId, name, view);
  }, [userId, name, view]);
  return [view, setView];
}

type Override<Row> = { base: Row; patch: Partial<Row>; tokens: Map<keyof Row, number> };

/**
 * Quick edits that show at once (1.23.0): a change is laid over its row straight away; once saved,
 * what the server confirmed stays over it until fresh data for the row arrives (a new row object);
 * refused, or never reaching the server, the row shows its old value again and `error` says why, in
 * the site's words ("Couldn’t save — …"). Two edits of one row are each undone on their own.
 */
export function useRowEdits<Row>() {
  const [overrides, setOverrides] = useState<Map<string, Override<Row>>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const apply = useCallback(
    (rows: readonly Row[], idOf: (row: Row) => string): Row[] =>
      rows.map((r) => {
        const o = overrides.get(idOf(r));
        return o && o.base === r ? { ...r, ...o.patch } : r;
      }),
    [overrides],
  );

  const lay = useCallback((id: string, base: Row, patch: Partial<Row>, token: number) => {
    setOverrides((m) => {
      const next = new Map(m);
      const cur = next.get(id);
      const keep = cur && cur.base === base ? cur : { base, patch: {}, tokens: new Map<keyof Row, number>() };
      const tokens = new Map(keep.tokens);
      for (const k of Object.keys(patch) as (keyof Row)[]) tokens.set(k, token);
      next.set(id, { base, patch: { ...keep.patch, ...patch }, tokens });
      return next;
    });
  }, []);

  const edit = useCallback(
    async (id: string, base: Row, patch: Partial<Row>, save: () => Promise<Partial<Row> | void>): Promise<boolean> => {
      const token = ++seq.current;
      setError(null);
      lay(id, base, patch, token);
      try {
        const confirmed = await save();
        if (confirmed && Object.keys(confirmed).length) {
          // What the server confirmed, for the fields no newer edit has changed since.
          setOverrides((m) => {
            const cur = m.get(id);
            if (!cur || cur.base !== base) return m;
            const mine = (Object.keys(confirmed) as (keyof Row)[]).filter((k) => cur.tokens.get(k) === token);
            if (!mine.length) return m;
            const next = new Map(m);
            next.set(id, { ...cur, patch: { ...cur.patch, ...Object.fromEntries(mine.map((k) => [k, confirmed[k]])) } });
            return next;
          });
        }
        return true;
      } catch (err) {
        setOverrides((m) => {
          const cur = m.get(id);
          if (!cur || cur.base !== base) return m;
          const next = new Map(m);
          const kept: Partial<Row> = { ...cur.patch };
          const tokens = new Map(cur.tokens);
          for (const k of Object.keys(patch) as (keyof Row)[]) {
            if (tokens.get(k) === token) {
              delete kept[k];
              tokens.delete(k);
            }
          }
          if (tokens.size === 0) next.delete(id);
          else next.set(id, { base, patch: kept, tokens });
          return next;
        });
        setError(saveFailureText(err));
        return false;
      }
    },
    [lay],
  );

  const clearError = useCallback(() => setError(null), []);
  return { apply, edit, error, clearError, setError };
}
