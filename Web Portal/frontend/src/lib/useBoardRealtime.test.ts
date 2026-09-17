import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBoardRealtime } from './useBoardRealtime';

const handlers: Record<string, (...a: unknown[]) => void> = {};
const socket = {
  on: vi.fn((ev: string, cb: (...a: unknown[]) => void) => { handlers[ev] = cb; }),
  emit: vi.fn(),
  disconnect: vi.fn(),
};
const ioMock = vi.fn((..._args: unknown[]) => socket);
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  socket.on.mockClear();
  socket.emit.mockClear();
  socket.disconnect.mockClear();
  ioMock.mockClear();
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

  it('does not connect without a project', () => {
    renderHook(() => useBoardRealtime(undefined, vi.fn()));
    expect(ioMock).not.toHaveBeenCalled();
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useBoardRealtime('p1', vi.fn()));
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
