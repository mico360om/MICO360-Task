import { presenceReducer, type PresenceEvent } from './chat-model';

/** The socket events that carry presence (sent to every signed-in socket). */
export const PRESENCE_EVENTS = ['presence:state', 'presence:online', 'presence:offline'] as const;
export type PresenceSocketEvent = (typeof PRESENCE_EVENTS)[number];

/** One socket payload as a presence change, or null when it isn't one. */
export function presenceEvent(event: PresenceSocketEvent, payload: unknown): PresenceEvent | null {
  const p = (payload ?? {}) as { userIds?: unknown; userId?: unknown };
  if (event === 'presence:state') return { type: 'state', userIds: Array.isArray(p.userIds) ? p.userIds.filter((x): x is string => typeof x === 'string') : [] };
  if (typeof p.userId !== 'string' || !p.userId) return null;
  return { type: event === 'presence:online' ? 'online' : 'offline', userId: p.userId };
}

/**
 * Who is online right now (3b), as the website's usePresence: the snapshot the server sends on
 * connect, then each change. Nobody is known online while the socket is down. Pure, so it is tested.
 */
export function createPresenceStore() {
  let online: Set<string> = new Set();
  const listeners = new Set<() => void>();
  const set = (next: Set<string>) => {
    online = next;
    for (const l of [...listeners]) l();
  };
  return {
    apply: (ev: PresenceEvent) => set(presenceReducer(online, ev)),
    reset: () => {
      if (online.size) set(new Set());
    },
    online: (): ReadonlySet<string> => online,
    isOnline: (userId: string | null | undefined) => !!userId && online.has(userId),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type PresenceStore = ReturnType<typeof createPresenceStore>;

/** The app's one store (the socket feeds it). */
export const presence = createPresenceStore();
