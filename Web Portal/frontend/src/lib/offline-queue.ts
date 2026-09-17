/**
 * Durable offline mutation queue for the web app (Epic C). Task actions taken while the
 * network is down are queued here and replayed in FIFO order on reconnect. Mirrors the
 * extension's proven queue: a replay error marked `.permanent` (a real 4xx rejection) drops
 * the item; any other error keeps it for a later retry. Backed by an injectable store so it's
 * unit-testable; the default store persists to localStorage (guarded for private mode).
 */
export interface QueuedMutation {
  id: string;
  kind: string; // e.g. 'task.create' | 'task.move'
  payload: unknown;
  queuedAt: number;
}

export interface QueueStore {
  read(): QueuedMutation[];
  write(q: QueuedMutation[]): void;
}

const KEY = 'mico360.syncQueue';

/** Default store backed by localStorage; degrades to an empty queue where storage is unavailable. */
export const localStorageQueueStore: QueueStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedMutation[];
    } catch {
      return [];
    }
  },
  write(q) {
    try {
      localStorage.setItem(KEY, JSON.stringify(q));
    } catch {
      /* storage unavailable — the queue simply won't persist this session */
    }
  },
};

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueue(store: QueueStore, mutation: { kind: string; payload: unknown }): QueuedMutation {
  const item: QueuedMutation = { id: genId(), queuedAt: Date.now(), kind: mutation.kind, payload: mutation.payload };
  store.write([...store.read(), item]);
  return item;
}

export function queueSize(store: QueueStore): number {
  return store.read().length;
}

export function getQueue(store: QueueStore): QueuedMutation[] {
  return store.read();
}

export function clearQueue(store: QueueStore): void {
  store.write([]);
}

/**
 * Replay queued mutations in FIFO order. `perform(item)` sends one mutation and resolves on
 * success; a rejection with `permanent === true` drops the item (it can never succeed), any
 * other rejection keeps it for a later retry. Returns { synced, dropped, remaining }.
 */
export async function flushQueue(
  store: QueueStore,
  perform: (m: QueuedMutation) => Promise<void>,
): Promise<{ synced: number; dropped: number; remaining: number }> {
  const q = store.read();
  const remaining: QueuedMutation[] = [];
  let synced = 0;
  let dropped = 0;
  for (const item of q) {
    try {
      await perform(item);
      synced += 1;
    } catch (e) {
      if (e && (e as { permanent?: boolean }).permanent) dropped += 1;
      else remaining.push(item);
    }
  }
  store.write(remaining);
  return { synced, dropped, remaining: remaining.length };
}
