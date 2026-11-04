import { useCallback, useEffect, useRef, useState } from 'react';

export interface PendingRemoval {
  ids: string[];
  /** The toast's words ("Removed", "Removed 3 notifications"). */
  label: string;
}

export interface DeferredRemovalOptions {
  /** How long Undo is offered before the removal is sent (ms). */
  delayMs: number;
  /** Send the removal to the server; resolves to the ids it could not remove (none = all done). */
  commit: (ids: string[]) => Promise<string[] | void>;
  /** The server refused some: those rows come back, and the page says so. */
  onFailed: (ids: string[]) => void;
}

/** Why the Undo time is waiting: the toast is pointed at, or has the keyboard. */
export type HoldReason = 'pointer' | 'focus';

/**
 * Remove with Undo, without a server-side undo: the rows are hidden at once and the removal is sent
 * when the Undo time is up. A second removal sends the first at once (one Undo at a time). The time
 * waits while the toast is pointed at or has the keyboard, and starts again after. Leaving the page,
 * the tab closing or the tab going to the background sends what is waiting straight away.
 */
export function useDeferredRemoval({ delayMs, commit, onFailed }: DeferredRemovalOptions) {
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  /** Hidden from the list: waiting for their time, or sent (they are gone on the server). */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef<PendingRemoval | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holds = useRef(new Set<HoldReason>());
  const mounted = useRef(true);
  const deps = useRef({ commit, onFailed, delayMs });
  deps.current = { commit, onFailed, delayMs };

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const unhide = (ids: readonly string[]) => setHidden((h) => new Set([...h].filter((id) => !ids.includes(id))));

  const send = useCallback(() => {
    const p = pendingRef.current;
    stopTimer();
    holds.current.clear();
    if (!p) return;
    pendingRef.current = null;
    if (mounted.current) setPending(null);
    const failedOnly = (failed: string[]) => {
      if (!mounted.current || failed.length === 0) return;
      unhide(failed);
      deps.current.onFailed(failed);
    };
    deps.current.commit(p.ids).then((failed) => failedOnly(failed ?? []), () => failedOnly(p.ids));
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    if (pendingRef.current && holds.current.size === 0) timer.current = setTimeout(send, deps.current.delayMs);
  }, [send]);

  const remove = useCallback(
    (ids: string[], label: string) => {
      if (ids.length === 0) return;
      send();
      const p = { ids, label };
      pendingRef.current = p;
      setPending(p);
      setHidden((h) => new Set([...h, ...ids]));
      startTimer();
    },
    [send, startTimer],
  );

  const undo = useCallback(() => {
    const p = pendingRef.current;
    stopTimer();
    holds.current.clear();
    pendingRef.current = null;
    setPending(null);
    if (p) unhide(p.ids);
  }, []);

  /** The toast is pointed at, or has the keyboard: the Undo time waits. */
  const hold = useCallback((reason: HoldReason) => {
    holds.current.add(reason);
    stopTimer();
  }, []);
  /** …and starts again (in full) once neither is so. */
  const release = useCallback(
    (reason: HoldReason) => {
      holds.current.delete(reason);
      startTimer();
    },
    [startTimer],
  );

  useEffect(() => {
    mounted.current = true;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') send();
    };
    window.addEventListener('pagehide', send);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', send);
      document.removeEventListener('visibilitychange', onHidden);
      mounted.current = false;
      send();
    };
  }, [send]);

  return { pending, hidden, remove, undo, hold, release };
}
