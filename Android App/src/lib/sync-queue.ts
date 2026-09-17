import type { KeyValueStore } from './storage';

const QUEUE_KEY = 'mico360.mutations';

export interface QueuedMutation {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
}

export interface FlushResult {
  synced: number;
  /** Mutations abandoned because they can never succeed (permanent failures). */
  dropped: QueuedMutation[];
  /** Mutations still queued (a transient failure stopped the flush). */
  remaining: number;
}

export interface SyncQueueOptions {
  store: KeyValueStore;
  /** Send one mutation to the server. Resolves on success, rejects on failure. */
  perform: (mutation: QueuedMutation) => Promise<void>;
  /** True when an error is permanent (drop the mutation); false when transient (retry later). */
  shouldDrop?: (error: unknown) => boolean;
  now?: () => number;
  genId?: () => string;
}

/** True for permanent 4xx failures (except 408 Request Timeout / 429 Too Many Requests). */
function defaultShouldDrop(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (typeof status !== 'number') return false; // network/unknown → transient
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Durable FIFO queue of mutations made while offline (A8). Mutations persist to
 * storage and are replayed in order on reconnect; a transient failure pauses the
 * flush (order preserved) while a permanent failure is dropped so it can't wedge
 * the queue.
 */
export function createSyncQueue(options: SyncQueueOptions) {
  const { store, perform } = options;
  const shouldDrop = options.shouldDrop ?? defaultShouldDrop;
  const now = options.now ?? Date.now;
  const genId = options.genId ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  let queue: QueuedMutation[] = [];

  const persist = () => store.setItem(QUEUE_KEY, JSON.stringify(queue));

  async function load(): Promise<QueuedMutation[]> {
    try {
      const raw = await store.getItem(QUEUE_KEY);
      queue = raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
    } catch {
      queue = [];
    }
    return [...queue];
  }

  async function enqueue(kind: string, payload: unknown): Promise<QueuedMutation> {
    const mutation: QueuedMutation = { id: genId(), kind, payload, createdAt: now() };
    queue.push(mutation);
    await persist();
    return mutation;
  }

  async function flush(): Promise<FlushResult> {
    let synced = 0;
    const dropped: QueuedMutation[] = [];

    while (queue.length > 0) {
      const mutation = queue[0]!;
      try {
        await perform(mutation);
        queue.shift();
        synced += 1;
      } catch (error) {
        if (shouldDrop(error)) {
          queue.shift();
          dropped.push(mutation);
          continue;
        }
        break; // transient — keep this and the rest for the next reconnect
      }
    }

    await persist();
    return { synced, dropped, remaining: queue.length };
  }

  return {
    load,
    enqueue,
    flush,
    pending: () => [...queue],
  };
}

export type SyncQueue = ReturnType<typeof createSyncQueue>;
