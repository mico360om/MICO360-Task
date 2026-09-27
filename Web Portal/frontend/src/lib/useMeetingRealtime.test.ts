import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMeetingRealtime } from './useMeetingRealtime';
import { useAuthStore } from '../stores/auth-store';

type Handler = (...a: unknown[]) => void;
const handlers: Record<string, Handler> = {};
const socket = {
  on: vi.fn((ev: string, cb: Handler) => { handlers[ev] = cb; }),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
const ioMock = vi.fn((..._args: unknown[]) => socket);
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  socket.emit.mockClear();
  socket.disconnect.mockClear();
  ioMock.mockClear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }));

describe('useMeetingRealtime', () => {
  it('joins the meeting’s project room and reports which part changed', () => {
    const onChange = vi.fn();
    renderHook(() => useMeetingRealtime('m1', 'p1', onChange));
    handlers['connect']!();
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });

    handlers['meeting:notes']!({ id: 'm1' });
    handlers['meeting:agenda']!({ id: 'm1' });
    handlers['meeting:attendees']!({ id: 'm1' });
    handlers['meeting:action-items']!({ id: 'm1' });
    handlers['meeting:updated']!({ id: 'm1' });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['notes', 'agenda', 'attendees', 'action-items', 'meeting']);
  });

  it('ignores events for other meetings in the same project', () => {
    const onChange = vi.fn();
    renderHook(() => useMeetingRealtime('m1', 'p1', onChange));
    handlers['meeting:notes']!({ id: 'other' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('asks for a full refresh after a reconnect', () => {
    const onChange = vi.fn();
    renderHook(() => useMeetingRealtime('m1', 'p1', onChange));
    handlers['connect']!();
    handlers['connect']!();
    expect(onChange).toHaveBeenCalledWith('reconnect');
  });

  it('opens no socket for a standalone meeting (no project room to join)', () => {
    renderHook(() => useMeetingRealtime('m1', null, vi.fn()));
    expect(ioMock).not.toHaveBeenCalled();
  });
});
