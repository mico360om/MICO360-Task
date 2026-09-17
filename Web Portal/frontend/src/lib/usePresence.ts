import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../stores/auth-store';
import { presenceReducer } from './presence';

/** Socket origin (without the /api/v1 prefix). */
const SOCKET_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

/**
 * Live online presence. Opens a socket, receives the current online set on connect
 * (`presence:state`) plus deltas (`presence:online` / `presence:offline`), and returns the set
 * of currently-online user ids. The server tracks presence by counting each user's live sockets.
 */
export function usePresence(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    const socket = io(SOCKET_URL, { auth: { token } });
    socket.on('presence:state', (p: { userIds?: string[] }) => setOnline((s) => presenceReducer(s, { type: 'state', userIds: p?.userIds ?? [] })));
    socket.on('presence:online', (p: { userId: string }) => setOnline((s) => presenceReducer(s, { type: 'online', userId: p.userId })));
    socket.on('presence:offline', (p: { userId: string }) => setOnline((s) => presenceReducer(s, { type: 'offline', userId: p.userId })));
    return () => {
      socket.disconnect();
    };
  }, []);

  return online;
}
