import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who a change was made through, for the history it writes: while MICO AI carries out a change the
 * person confirmed, every history line the app's own services write is marked "via MICO AI" — the
 * same services and the same lines as a change made by hand, with only this mark added. The mark
 * follows the work through awaits and timers, and never leaks into other requests.
 */
export type Via = 'mico-ai';

const store = new AsyncLocalStorage<Via>();

/** Run `fn` with everything it writes marked as made via `via`. */
export function actingVia<T>(via: Via, fn: () => Promise<T>): Promise<T> {
  return store.run(via, fn);
}

/** What the current work is being made through, or null (made by hand). */
export function currentVia(): Via | null {
  return store.getStore() ?? null;
}
