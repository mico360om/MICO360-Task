import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTaskCommentsRealtime } from './useTaskCommentsRealtime';
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

describe('useTaskCommentsRealtime (comments live)', () => {
  it('joins the task’s project room and reports a comment added, changed or deleted on this task', () => {
    const onChange = vi.fn();
    renderHook(() => useTaskCommentsRealtime('p1', 't1', onChange));
    act(() => handlers['connect']!());
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    handlers['comment:created']!({ taskId: 't1', comment: { id: 'c1' } });
    handlers['comment:updated']!({ taskId: 't1', comment: { id: 'c1' } });
    handlers['comment:deleted']!({ taskId: 't1', id: 'c1' });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('ignores comments on other tasks of the project', () => {
    const onChange = vi.fn();
    renderHook(() => useTaskCommentsRealtime('p1', 't1', onChange));
    handlers['comment:created']!({ taskId: 't2', comment: { id: 'c9' } });
    handlers['comment:deleted']!({ taskId: 't2', id: 'c9' });
    handlers['comment:created']!(undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports this task changing (a send-back reason is a comment), not others', () => {
    const onChange = vi.fn();
    renderHook(() => useTaskCommentsRealtime('p1', 't1', onChange));
    handlers['task:updated']!({ id: 't2' });
    expect(onChange).not.toHaveBeenCalled();
    handlers['task:updated']!({ id: 't1' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('a bulk change naming this task among its ids: the comments and the task itself are read again', () => {
    const onChange = vi.fn();
    const onBulk = vi.fn();
    renderHook(() => useTaskCommentsRealtime('p1', 't1', onChange, onBulk));
    handlers['task:updated']!({ bulk: true, ids: ['t7', 't8'] });
    expect(onChange).not.toHaveBeenCalled();
    expect(onBulk).not.toHaveBeenCalled();
    handlers['task:updated']!({ bulk: true, ids: ['t7', 't1'] });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onBulk).toHaveBeenCalledTimes(1);
    // A single change (the board refreshes the task for it): no extra read here.
    handlers['task:updated']!({ id: 't1' });
    expect(onBulk).toHaveBeenCalledTimes(1);
  });

  it('reads again after a reconnect (events may have been missed), not on the first connect', () => {
    const onChange = vi.fn();
    renderHook(() => useTaskCommentsRealtime('p1', 't1', onChange));
    act(() => handlers['connect']!());
    expect(onChange).not.toHaveBeenCalled();
    act(() => handlers['disconnect']!('transport close'));
    act(() => handlers['connect']!());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('opens no connection without a project or when signed out, and closes it on unmount', () => {
    renderHook(() => useTaskCommentsRealtime(undefined, 't1', vi.fn()));
    expect(ioMock).not.toHaveBeenCalled();
    const { unmount } = renderHook(() => useTaskCommentsRealtime('p1', 't1', vi.fn()));
    expect(ioMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
    ioMock.mockClear();
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    renderHook(() => useTaskCommentsRealtime('p1', 't1', vi.fn()));
    expect(ioMock).not.toHaveBeenCalled();
  });
});
