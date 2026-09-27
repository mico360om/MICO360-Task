import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBoardRealtime } from './useBoardRealtime';
import { useAuthStore } from '../stores/auth-store';

const handlers: Record<string, (...a: unknown[]) => void> = {};
const socket = {
  on: vi.fn((ev: string, cb: (...a: unknown[]) => void) => { handlers[ev] = cb; }),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
const ioMock = vi.fn((..._args: unknown[]) => socket);
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));
const refreshSession = vi.fn(async () => true);
vi.mock('../api/client', () => ({ refreshSession: () => refreshSession() }));

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  socket.on.mockClear();
  socket.emit.mockClear();
  socket.connect.mockClear();
  socket.disconnect.mockClear();
  ioMock.mockClear();
  refreshSession.mockClear();
});

describe('useBoardRealtime', () => {
  it('connects, joins the project room on connect, and refreshes on task events', () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useBoardRealtime('p1', onTaskEvent));

    expect(ioMock).toHaveBeenCalledTimes(1);
    // join is emitted once the socket connects
    handlers['connect']?.();
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });

    // a broadcast task event triggers the refresh callback
    handlers['task:moved']?.();
    handlers['task:created']?.();
    expect(onTaskEvent).toHaveBeenCalledTimes(2);
  });

  it('also reacts to deletions and reassignments, passing the payload through', () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useBoardRealtime('p1', onTaskEvent));
    handlers['task:deleted']?.({ id: 't9' });
    handlers['task:assignees']?.({ taskId: 't3', assignees: [] });
    expect(onTaskEvent).toHaveBeenCalledWith('task:deleted', { id: 't9' });
    expect(onTaskEvent).toHaveBeenCalledWith('task:assignees', { taskId: 't3', assignees: [] });
  });

  it('reads the current access token for every handshake (not the one at mount)', () => {
    useAuthStore.setState({ accessToken: 'first' });
    renderHook(() => useBoardRealtime('p1', vi.fn()));
    const opts = ioMock.mock.calls[0]![1] as { auth: (cb: (d: unknown) => void) => void };
    expect(typeof opts.auth).toBe('function');
    useAuthStore.setState({ accessToken: 'rotated' });
    const send = vi.fn();
    opts.auth(send);
    expect(send).toHaveBeenCalledWith({ token: 'rotated' });
  });

  it('asks the board to resync after a reconnect (events may have been missed)', () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useBoardRealtime('p1', onTaskEvent));
    handlers['connect']?.();
    expect(onTaskEvent).not.toHaveBeenCalled();
    handlers['connect']?.(); // reconnect
    expect(onTaskEvent).toHaveBeenCalledWith('resync');
    expect(socket.emit).toHaveBeenCalledTimes(2); // re-joins the room too
  });

  it('refreshes the session and reconnects when the handshake is rejected as unauthorized', async () => {
    renderHook(() => useBoardRealtime('p1', vi.fn()));
    handlers['connect_error']?.(new Error('unauthorized'));
    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(refreshSession).toHaveBeenCalledTimes(1);
    // other connection errors are left to socket.io's own retry
    handlers['connect_error']?.(new Error('xhr poll error'));
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not connect without a project', () => {
    renderHook(() => useBoardRealtime(undefined, vi.fn()));
    expect(ioMock).not.toHaveBeenCalled();
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useBoardRealtime('p1', vi.fn()));
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('passes project:removed through so the board can leave a project the user was removed from', () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useBoardRealtime('p1', onTaskEvent));
    handlers['project:removed']?.({ projectId: 'p1' });
    expect(onTaskEvent).toHaveBeenCalledWith('project:removed', { projectId: 'p1' });
  });

  it('reconnects after the server closes the socket (expired token), with the current token', () => {
    renderHook(() => useBoardRealtime('p1', vi.fn()));
    handlers['disconnect']?.('io server disconnect');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    handlers['disconnect']?.('transport close'); // socket.io handles its own transport reconnects
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('signs the user out when a freshly refreshed token is still rejected (session revoked)', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@x', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    renderHook(() => useBoardRealtime('p1', vi.fn()));
    handlers['connect_error']?.(new Error('unauthorized'));
    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    handlers['connect_error']?.(new Error('unauthorized')); // rejected again right after the refresh
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});
