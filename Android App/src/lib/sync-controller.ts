import type { FlushResult, QueuedMutation } from './sync-queue';

export interface SyncControllerDeps {
  queue: {
    pending: () => QueuedMutation[];
    flush: () => Promise<FlushResult>;
  };
}

/**
 * Drives the offline mutation queue (A8): call `trigger()` on reconnect / app
 * foreground to replay queued mutations. Skips when the queue is empty and
 * guards against overlapping flushes so a burst of triggers runs at most one
 * flush at a time.
 */
export function createSyncController({ queue }: SyncControllerDeps) {
  let flushing = false;

  async function trigger(): Promise<FlushResult | null> {
    if (flushing || queue.pending().length === 0) return null;
    flushing = true;
    try {
      return await queue.flush();
    } finally {
      flushing = false;
    }
  }

  return { trigger };
}

export type SyncController = ReturnType<typeof createSyncController>;
