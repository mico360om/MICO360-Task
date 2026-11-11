import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BinUndoToast, UNDO_MS } from './BinUndoToast';
import { binNoticeFor, showBinNotice, useBinNotice } from '../../lib/bin-notice';
import { useTaskNotice } from '../../lib/task-notice';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let posted: unknown[] = [];
let answer: () => Response;

const renderHost = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BinUndoToast />
    </QueryClientProvider>,
  );

beforeEach(() => {
  posted = [];
  useBinNotice.setState({ notice: null });
  useTaskNotice.setState({ notice: null });
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  answer = () => json({ data: { restored: [{ id: 't1', key: 'RIG-12', title: 'Pump', projectId: 'p' }], notRestored: [] } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).includes('/recycle-bin/restore')) {
        posted.push(JSON.parse(String(init?.body)));
        return answer();
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Undo after a delete', () => {
  it('words: one task, or it and its series', () => {
    expect(binNoticeFor({ id: 't1', key: 'RIG-12' }, null)).toEqual({ text: 'RIG-12 moved to the Recycle Bin', taskId: 't1', key: 'RIG-12', wholeBatch: false });
    expect(binNoticeFor({ id: 't1', key: 'RIG-12' }, 12)).toEqual({ text: 'RIG-12 and its series (12 tasks) moved to the Recycle Bin', taskId: 't1', key: 'RIG-12', wholeBatch: true });
  });

  it('Undo restores what the delete took (its series too) and says it is back', async () => {
    renderHost();
    act(() => showBinNotice(binNoticeFor({ id: 't1', key: 'RIG-12' }, 2)));
    expect(screen.getByRole('status')).toHaveTextContent('RIG-12 and its series (2 tasks) moved to the Recycle Bin');
    await userEvent.click(screen.getByRole('button', { name: 'Undo: restore RIG-12' }));
    expect(posted).toEqual([{ taskIds: ['t1'], wholeBatch: true }]);
    expect(useBinNotice.getState().notice).toBeNull();
    expect(useTaskNotice.getState().notice).toEqual({ text: 'Task RIG-12 restored', taskId: 't1', key: 'RIG-12' });
  });

  it('a restore that can’t be done says why and stays', async () => {
    answer = () => json({ data: { restored: [], notRestored: [{ id: 't1', key: 'RIG-12', title: 'Pump', reason: 'archived', message: 'x' }] } });
    renderHost();
    act(() => showBinNotice(binNoticeFor({ id: 't1', key: 'RIG-12' }, null)));
    await userEvent.click(screen.getByRole('button', { name: 'Undo: restore RIG-12' }));
    expect(screen.getByRole('status')).toHaveTextContent('RIG-12 wasn’t restored: its project is archived. Unarchive the project first.');
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
    vi.useFakeTimers();
    act(() => vi.advanceTimersByTime(UNDO_MS * 3));
    expect(screen.getByRole('status')).toHaveTextContent('wasn’t restored');
  });

  it('waits while pointed at (a keyboard user can reach Undo); a failure stays until dismissed', async () => {
    renderHost();
    act(() => showBinNotice(binNoticeFor({ id: 't1', key: 'RIG-12' }, null)));
    vi.useFakeTimers();
    const toast = screen.getByRole('status');
    act(() => toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    act(() => vi.advanceTimersByTime(UNDO_MS * 2));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    act(() => vi.advanceTimersByTime(UNDO_MS));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('goes away on its own after a few seconds', () => {
    vi.useFakeTimers();
    renderHost();
    act(() => showBinNotice(binNoticeFor({ id: 't1', key: 'RIG-12' }, null)));
    act(() => vi.advanceTimersByTime(UNDO_MS));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
