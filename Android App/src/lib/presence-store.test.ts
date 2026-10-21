import { describe, it, expect, vi } from 'vitest';
import { createPresenceStore, presenceEvent } from './presence-store';

describe('who is online (3b, the server’s presence events)', () => {
  it('follows the snapshot sent on connect, then who comes and goes; listeners hear each change', () => {
    const store = createPresenceStore();
    const heard = vi.fn();
    store.subscribe(heard);
    store.apply({ type: 'state', userIds: ['a', 'b'] });
    store.apply({ type: 'online', userId: 'c' });
    store.apply({ type: 'offline', userId: 'a' });
    expect([...store.online()].sort()).toEqual(['b', 'c']);
    expect(store.isOnline('c')).toBe(true);
    expect(store.isOnline('a')).toBe(false);
    expect(heard).toHaveBeenCalledTimes(3);
    // A stable snapshot between changes (React's useSyncExternalStore).
    expect(store.online()).toBe(store.online());
    // Disconnected (or signed out): nobody is known to be online.
    store.reset();
    expect(store.online().size).toBe(0);
  });

  it('reads the socket’s payloads, ignoring what isn’t one', () => {
    expect(presenceEvent('presence:state', { userIds: ['a', 7] })).toEqual({ type: 'state', userIds: ['a'] });
    expect(presenceEvent('presence:online', { userId: 'b' })).toEqual({ type: 'online', userId: 'b' });
    expect(presenceEvent('presence:offline', { userId: 'b' })).toEqual({ type: 'offline', userId: 'b' });
    expect(presenceEvent('presence:online', {})).toBeNull();
    expect(presenceEvent('presence:state', null)).toEqual({ type: 'state', userIds: [] });
  });
});
