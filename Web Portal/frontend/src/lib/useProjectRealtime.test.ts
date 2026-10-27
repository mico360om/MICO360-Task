import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProjectRealtime } from './useProjectRealtime';
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
  ioMock.mockClear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }));

describe('useProjectRealtime', () => {
  it('joins the project room and says whether tasks or meetings changed', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useProjectRealtime('p1', onChange));
    expect(result.current.live).toBe(false);
    act(() => handlers['connect']!());
    expect(result.current.live).toBe(true);
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    handlers['task:moved']!({ id: 't1' });
    handlers['task:created']!({ id: 't2' });
    handlers['meeting:created']!({ id: 'm1' });
    handlers['meeting:action-items']!({ id: 'm1' });
    handlers['meeting:deleted']!({ id: 'm1' });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['tasks', 'tasks', 'meetings', 'meetings', 'meetings']);
  });

  it('says when one of its inspections changed (started, answered, finished, reopened, deleted)', () => {
    const onChange = vi.fn();
    renderHook(() => useProjectRealtime('p1', onChange));
    handlers['inspection:changed']!({ id: 'i1', projectId: 'p1' });
    expect(onChange).toHaveBeenCalledWith('inspections');
  });

  it('refreshes everything after a reconnect, and reports a lost connection', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useProjectRealtime('p1', onChange));
    act(() => handlers['connect']!());
    act(() => handlers['disconnect']!('transport close'));
    expect(result.current.live).toBe(false);
    act(() => handlers['connect']!());
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('says when the signed-in person is taken off the project', () => {
    const onChange = vi.fn();
    renderHook(() => useProjectRealtime('p1', onChange));
    handlers['project:removed']!({ projectId: 'p1' });
    expect(onChange).toHaveBeenCalledWith('removed');
  });
});
