/**
 * Whether the server can be reached, as far as the app can tell (there is no network-state
 * package): any answer from the server, or a live socket connecting, means online; a request that
 * got no answer at all, or a live socket losing its connection, means offline. TanStack Query
 * follows it (query-client followConnectivity), so coming back online refreshes what is out of date.
 */
export function createConnectivity() {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();

  function set(next: boolean): void {
    if (next === online) return;
    online = next;
    for (const listener of [...listeners]) listener(next);
  }

  return {
    isOnline: () => online,
    /** The server answered (any status), or a socket connected. */
    reachable: () => set(true),
    /** A request got no answer at all, or a live socket lost its connection. */
    unreachable: () => set(false),
    /** Hear each change (not every request); returns a function that stops listening. */
    subscribe(listener: (online: boolean) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type Connectivity = ReturnType<typeof createConnectivity>;

/**
 * Did a live socket close because the connection went (socket.io's disconnect reasons), rather
 * than being closed on purpose by the app or the server?
 */
export function isConnectionDrop(reason: string): boolean {
  return reason === 'transport close' || reason === 'transport error' || reason === 'ping timeout';
}
