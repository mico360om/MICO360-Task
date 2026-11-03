import { useCallback, useEffect, useRef, useState } from 'react';

export interface PendingRemoval {
  ids: string[];
  /** The toast's words ("Removed", "Removed 3 notifications"). */
  label: string;
}

export interface DeferredRemovalOptions {
  /** How long Undo is offered before the removal is sent (ms). */
  delayMs: number;
  /** Send the removal to the server. */
  commit: (ids: string[]) => Promise<unknown>;
  /** The server refused: the rows come back, and the page says so. */
  onFailed: (ids: string[]) => void;
}

/**
 * Remove with Undo, without a server-side undo: the rows are hidden at once and the removal is sent
 * when the Undo time is up. A second removal sends the first at once (one Undo at a time). Leaving
 * the page (or the tab closing) sends what is waiting straight away, so nothing is left behind.
 */
export function useDeferredRemoval({ delayMs, commit, onFailed }: DeferredRemovalOptions) {
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  /** Hidden from the list: waiting for their time, or sent (until the list is read again without them). */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef<PendingRemoval | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const deps = useRef({ commit, onFailed });
  deps.current = { commit, onFailed };

  const send = useCallback(() => {
    const p = pendingRef.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!p) return;
    pendingRef.current = null;
    if (mounted.current) setPending(null);
    deps.current.commit(p.ids).catch(() => {
      if (!mounted.current) return;
      setHidden((h) => new Set([...h].filter((id) => !p.ids.includes(id))));
      deps.current.onFailed(p.ids);
    });
  }, []);

  const remove = useCallback(
    (ids: string[], label: string) => {
      if (ids.length === 0) return;
      send();
      const p = { ids, label };
      pendingRef.current = p;
      setPending(p);
      setHidden((h) => new Set([...h, ...ids]));
      timer.current = setTimeout(send, delayMs);
    },
    [delayMs, send],
  );

  const undo = useCallback(() => {
    const p = pendingRef.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
    if (p) setHidden((h) => new Set([...h].filter((id) => !p.ids.includes(id))));
  }, []);

  useEffect(() => {
    mounted.current = true;
    window.addEventListener('pagehide', send);
    return () => {
      window.removeEventListener('pagehide', send);
      mounted.current = false;
      send();
    };
  }, [send]);

  return { pending, hidden, remove, undo, sendNow: send };
}
