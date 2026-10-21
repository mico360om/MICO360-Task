import type { Refresh } from './refresh';

/** How long realtime events are gathered before one refresh pass. */
export const REALTIME_BATCH_MS = 300;

export interface RefreshBatchOptions {
  windowMs?: number;
  /**
   * Refresh the first event at once and gather only the ones that follow it within the window
   * (chat: a single new message shows without waiting; a burst still costs two passes, not dozens).
   */
  leading?: boolean;
}

/**
 * Gather refresh targets from realtime events and apply them together, once per short window
 * (a carry-forward or a bulk move sends dozens of events; one at a time, each refetch cancelled the
 * last). The window starts with the first event and doesn't restart with later ones, so a steady
 * stream still refreshes every 300 ms. Each target is applied once per pass, in the order first seen.
 */
export function createRefreshBatcher(apply: (targets: Refresh[]) => void, { windowMs = REALTIME_BATCH_MS, leading = false }: RefreshBatchOptions = {}) {
  const waiting = new Map<string, Refresh>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function run(): void {
    if (waiting.size === 0) return;
    const targets = [...waiting.values()];
    waiting.clear();
    apply(targets);
  }

  function flush(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    run();
  }

  return {
    /** Refresh these with the rest of this window's events. */
    add(targets: Refresh[]): void {
      for (const t of targets) {
        const id = JSON.stringify(t);
        if (!waiting.has(id)) waiting.set(id, t);
      }
      if (waiting.size === 0 || timer) return;
      if (leading) run();
      timer = setTimeout(flush, windowMs);
    },
    /** Refresh what is waiting now (the screen is closing). */
    flush,
  };
}

export type RefreshBatcher = ReturnType<typeof createRefreshBatcher>;
