/** Presence updates pushed over the socket. */
export type PresenceEvent =
  | { type: 'state'; userIds: string[] } // full snapshot (sent on connect)
  | { type: 'online'; userId: string } // a user connected
  | { type: 'offline'; userId: string }; // a user's last socket disconnected

/** Fold a presence event into the set of online user ids (immutably). */
export function presenceReducer(state: Set<string>, ev: PresenceEvent): Set<string> {
  switch (ev.type) {
    case 'state':
      return new Set(ev.userIds);
    case 'online': {
      if (state.has(ev.userId)) return new Set(state);
      const next = new Set(state);
      next.add(ev.userId);
      return next;
    }
    case 'offline': {
      if (!state.has(ev.userId)) return new Set(state);
      const next = new Set(state);
      next.delete(ev.userId);
      return next;
    }
  }
}
