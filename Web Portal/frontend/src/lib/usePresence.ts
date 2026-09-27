import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { presenceReducer } from './presence';
import { openAuthedSocket } from './authedSocket';

/**
 * Live online presence. Opens a socket, receives the current online set on connect
 * (`presence:state`) plus deltas (`presence:online` / `presence:offline`), and returns the set
 * of currently-online user ids. The server tracks presence by counting each user's live sockets.
 *
 * The socket authenticates with the current access token on every (re)connect and refreshes the
 * session if a reconnect is rejected, so presence keeps working after the access token expires.
 * The server re-sends `presence:state` on each connect, which resynchronises the set.
 */
export function usePresence(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(() => new Set());
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));

  useEffect(() => {
    if (!signedIn) return;
    const { socket, close } = openAuthedSocket();
    socket.on('presence:state', (p: { userIds?: string[] }) => setOnline((s) => presenceReducer(s, { type: 'state', userIds: p?.userIds ?? [] })));
    socket.on('presence:online', (p: { userId: string }) => setOnline((s) => presenceReducer(s, { type: 'online', userId: p.userId })));
    socket.on('presence:offline', (p: { userId: string }) => setOnline((s) => presenceReducer(s, { type: 'offline', userId: p.userId })));
    return close;
  }, [signedIn]);

  return online;
}
