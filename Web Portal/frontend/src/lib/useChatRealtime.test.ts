import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatRealtime } from './useChatRealtime';
import { usePresence } from './usePresence';
import { useAuthStore } from '../stores/auth-store';

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
const socket = {
  connected: false,
  on: vi.fn((ev: string, cb: Handler) => { handlers[ev] = cb; }),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
const ioMock = vi.fn((..._args: unknown[]) => socket);
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  socket.connected = false;
  socket.on.mockClear();
  socket.emit.mockClear();
  socket.disconnect.mockClear();
  ioMock.mockClear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at-1', refreshToken: 'rt' });
});
afterEach(() => useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }));

describe('useChatRealtime', () => {
  it('authenticates with a token callback, joins project rooms and forwards chat events', () => {
    const onEvent = vi.fn();
    renderHook(() => useChatRealtime(['p2', 'p1'], onEvent));
    expect(ioMock).toHaveBeenCalledTimes(1);
    const opts = ioMock.mock.calls[0]![1] as { auth: unknown };
    expect(typeof opts.auth).toBe('function');

    handlers['connect']!();
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p2' });

    handlers['chat:message']!({ conversationId: 'c1' });
    expect(onEvent).toHaveBeenCalledWith('chat:message', { conversationId: 'c1' });
  });

  it('reports the connection: connecting, connected, reconnecting after a drop, offline, and back', () => {
    const { result } = renderHook(() => useChatRealtime(['p1'], vi.fn()));
    expect(result.current).toBe('connecting');
    act(() => handlers['connect']!());
    expect(result.current).toBe('connected');
    act(() => handlers['disconnect']!('transport close'));
    expect(result.current).toBe('reconnecting');
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current).toBe('offline');
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(result.current).toBe('reconnecting');
    act(() => handlers['connect']!());
    expect(result.current).toBe('connected');
  });

  it('re-joins rooms and asks the page to refetch after a reconnect', () => {
    const onReconnect = vi.fn();
    renderHook(() => useChatRealtime(['p1'], vi.fn(), onReconnect));
    handlers['connect']!();
    expect(onReconnect).not.toHaveBeenCalled();
    socket.emit.mockClear();
    handlers['connect']!(); // reconnected after a drop
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the same socket when the access token is refreshed', () => {
    renderHook(() => useChatRealtime(['p1'], vi.fn()));
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at-2', refreshToken: 'rt2' });
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('keeps the same socket when the project list arrives later, joining and leaving rooms on it', () => {
    // The list of projects loads after the page: that must not drop the connection and open a new one.
    const { rerender } = renderHook(({ ids }: { ids: string[] }) => useChatRealtime(ids, vi.fn()), { initialProps: { ids: [] as string[] } });
    socket.connected = true;
    handlers['connect']!();
    socket.emit.mockClear();

    rerender({ ids: ['p1', 'p2'] });
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p2' });

    socket.emit.mockClear();
    rerender({ ids: ['p2'] });
    expect(socket.emit).toHaveBeenCalledWith('leave', { projectId: 'p1' });
    expect(socket.emit).not.toHaveBeenCalledWith('join', { projectId: 'p2' }); // already in that room
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('joins rooms that arrived before the connection was up, once it connects', () => {
    const { rerender } = renderHook(({ ids }: { ids: string[] }) => useChatRealtime(ids, vi.fn()), { initialProps: { ids: [] as string[] } });
    rerender({ ids: ['p1'] });
    expect(socket.emit).not.toHaveBeenCalled(); // not connected yet: nothing to send
    socket.connected = true;
    handlers['connect']!();
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    expect(socket.emit).toHaveBeenCalledTimes(1);
  });

  it('does not connect when signed out', () => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    renderHook(() => useChatRealtime(['p1'], vi.fn()));
    expect(ioMock).not.toHaveBeenCalled();
  });
});

describe('usePresence', () => {
  it('connects with a token callback and tracks the online set', async () => {
    const { result } = renderHook(() => usePresence());
    const opts = ioMock.mock.calls[0]![1] as { auth: unknown };
    expect(typeof opts.auth).toBe('function');
    handlers['presence:state']!({ userIds: ['a', 'b'] });
    await vi.waitFor(() => expect([...result.current].sort()).toEqual(['a', 'b']));
    handlers['presence:offline']!({ userId: 'a' });
    await vi.waitFor(() => expect([...result.current]).toEqual(['b']));
  });
});
