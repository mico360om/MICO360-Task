import type { Refresh } from './refresh';

/** How long realtime events are gathered before one refresh pass. */
export const REALTIME_BATCH_MS = 300;

/**
 * The All projects board's window (final review A11): an administrator's board hears every open
 * project's events, and each pass reads the whole board again — gathered for 2 s, not 300 ms.
 */
export const ALL_BOARD_BATCH_MS = 2_000;

export interface RefreshBatchOptions {
  windowMs?: number;
  /**
   * Refresh the first event at once and gather only the ones that follow it within the window
   * (chat: a single new message shows without waiting; a burst still costs two passes, not dozens).
   */
  leading?: boolean;
  /**
   * A reading still on its way (the All projects board's — final review A11): while it is, the pass
   * waits another window, keeping what it gathered, so a refresh never calls it off to start again.
   */
  busy?: () => boolean;
}

/**
 * Gather refresh targets from realtime events and apply them together, once per short window
 * (a carry-forward or a bulk move sends dozens of events; one at a time, each refetch cancelled the
 * last). The window starts with the first event and doesn't restart with later ones, so a steady
 * stream still refreshes every 300 ms. Each target is applied once per pass, in the order first seen.
 */
export function createRefreshBatcher(apply: (targets: Refresh[]) => void, { windowMs = REALTIME_BATCH_MS, leading = false, busy }: RefreshBatchOptions = {}) {
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

  /** The window ended: refresh — or, while a reading is still on its way, wait another window. */
  function due(): void {
    timer = null;
    if (waiting.size && busy?.()) {
      timer = setTimeout(due, windowMs);
      return;
    }
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
      timer = setTimeout(due, windowMs);
    },
    /** Refresh what is waiting now (the screen is closing). */
    flush,
  };
}

export type RefreshBatcher = ReturnType<typeof createRefreshBatcher>;
