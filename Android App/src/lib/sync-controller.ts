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
 * nothing queued, and runs at most one flush at a time (the single place replays happen). A trigger
 * while one runs ("Sync now") runs one more right after it, rather than nothing (4a review); every
 * trigger meanwhile shares that one.
 */
export function createSyncController({ queue, getUserId, onFlushed }: SyncControllerDeps) {
  let running: Promise<FlushResult | null> | null = null;
  let again = false;

  async function once(): Promise<FlushResult | null> {
    const userId = getUserId();
    if (!userId || queue.pendingFor(userId).length === 0) return null;
    const result = await queue.flush(userId, { shouldContinue: () => getUserId() === userId });
    if (result.synced > 0 || result.failed.length > 0) onFlushed?.(result);
    return result;
  }

  async function run(): Promise<FlushResult | null> {
    let result: FlushResult | null = null;
    do {
      again = false;
      result = (await once()) ?? result;
    } while (again);
    return result;
  }

  function trigger(): Promise<FlushResult | null> {
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = null;
    });
    return running;
  }

  return { trigger, isFlushing: () => running !== null };
}

export type SyncController = ReturnType<typeof createSyncController>;
