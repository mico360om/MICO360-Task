/**
 * Reference-counted online presence. A user can hold several sockets (tabs/devices); they are
 * "online" from their first socket until their last one disconnects. Pure and deterministic.
 */
export function createPresenceTracker() {
  const counts = new Map<string, number>();

  return {
    /** Register a new socket for a user. `nowOnline` is true only when they had none before. */
    connect(userId: string): { nowOnline: boolean } {
      const next = (counts.get(userId) ?? 0) + 1;
      counts.set(userId, next);
      return { nowOnline: next === 1 };
    },
    /** Drop one of a user's sockets. `nowOffline` is true only when it was their last. */
    disconnect(userId: string): { nowOffline: boolean } {
      const cur = counts.get(userId) ?? 0;
      if (cur <= 1) {
        counts.delete(userId);
        return { nowOffline: cur === 1 };
      }
      counts.set(userId, cur - 1);
      return { nowOffline: false };
    },
    /** The ids of all currently-online users. */
    online(): string[] {
      return [...counts.keys()];
    },
  };
}

export type PresenceTracker = ReturnType<typeof createPresenceTracker>;
