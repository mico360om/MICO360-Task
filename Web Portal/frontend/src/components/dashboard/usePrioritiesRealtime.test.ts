import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePrioritiesRealtime } from './usePrioritiesRealtime';

const handlers: Record<string, (...a: unknown[]) => void> = {};
const socket = {
  on: vi.fn((ev: string, cb: (...a: unknown[]) => void) => { handlers[ev] = cb; }),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};
vi.mock('socket.io-client', () => ({ io: () => socket }));

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  socket.emit.mockClear();
});

// 1.24.5: the tab's one live connection is in every room some listener joined: My Priorities hears only its projects.
describe('usePrioritiesRealtime', () => {
  it('joins its projects and calls back for their changes only', () => {
    const onChange = vi.fn();
    renderHook(() => usePrioritiesRealtime(['p1'], onChange));
    handlers['connect']!();
    expect(socket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    handlers['task:updated']!({ id: 't1', projectId: 'p2' });
    expect(onChange).not.toHaveBeenCalled();
    handlers['checklist:changed']!({ taskId: 't1', projectId: 'p1' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
