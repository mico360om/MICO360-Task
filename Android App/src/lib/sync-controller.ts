import type { FlushResult, QueuedMutation } from './sync-queue';

export interface SyncControllerDeps {
  queue: {
    pendingFor: (userId: string | null | undefined) => QueuedMutation[];
    flush: (userId: string, opts?: { shouldContinue?: () => boolean }) => Promise<FlushResult>;
  };
  /** The signed-in user's id, or null when signed out. Only their own changes are replayed. */
  getUserId: () => string | null | undefined;
  /** Called after each flush that did something (e.g. refresh screens, report failures). */
  onFlushed?: (result: FlushResult) => void;
}

/**
 * Drives the offline mutation queue (A8 / XP-06): call `trigger()` whenever connectivity may be
 * back — app launch, app foreground, sign-in, any successful request, a socket reconnect, and a
 * short interval while changes are waiting. Skips when signed out or when the signed-in user has
 * nothing queued, and runs at most one flush at a time (the single place replays happen).
 */
export function createSyncController({ queue, getUserId, onFlushed }: SyncControllerDeps) {
  let flushing = false;

  async function trigger(): Promise<FlushResult | null> {
    const userId = getUserId();
    if (flushing || !userId || queue.pendingFor(userId).length === 0) return null;
    flushing = true;
    try {
      const result = await queue.flush(userId, { shouldContinue: () => getUserId() === userId });
      if (result.synced > 0 || result.failed.length > 0) onFlushed?.(result);
      return result;
    } finally {
      flushing = false;
    }
  }

  return { trigger, isFlushing: () => flushing };
}

export type SyncController = ReturnType<typeof createSyncController>;
