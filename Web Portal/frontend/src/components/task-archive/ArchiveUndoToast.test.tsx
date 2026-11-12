import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArchiveUndoToast, ARCHIVE_UNDO_MS } from './ArchiveUndoToast';
import { showArchiveNotice, useArchiveNotice } from '../../lib/task-archive';
import { useTaskNotice } from '../../lib/task-notice';
import { useAuthStore } from '../../stores/auth-store';

// Task archive: "RIG-12 archived · Undo" at the foot of the window for a few seconds after an archive.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let posted: string[] = [];
let answer: () => Response;

const renderHost = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ArchiveUndoToast />
    </QueryClientProvider>,
  );

beforeEach(() => {
  posted = [];
  useArchiveNotice.setState({ notice: null });
  useTaskNotice.setState({ notice: null });
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  answer = () => json({ data: { id: 't1', key: 'RIG-12', archivedAt: null } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).endsWith('/tasks/t1/unarchive') && init?.method === 'POST') {
        posted.push(String(input));
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

describe('Undo after an archive', () => {
  it('says it, and Undo unarchives it and says it is back (with Open)', async () => {
    renderHost();
    act(() => showArchiveNotice({ id: 't1', key: 'RIG-12' }));
    expect(screen.getByRole('status')).toHaveTextContent('RIG-12 archived');
    await userEvent.click(screen.getByRole('button', { name: 'Undo: unarchive RIG-12' }));
    expect(posted).toHaveLength(1);
    expect(useArchiveNotice.getState().notice).toBeNull();
    expect(useTaskNotice.getState().notice).toEqual({ text: 'Task RIG-12 unarchived', taskId: 't1', key: 'RIG-12' });
  });

  it('an Undo the server refuses says why and stays', async () => {
    answer = () => json({ error: { code: 'PROJECT_ARCHIVED', message: 'This project is archived — reopen it first.' } }, 409);
    renderHost();
    act(() => showArchiveNotice({ id: 't1', key: 'RIG-12' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo: unarchive RIG-12' }));
    expect(await screen.findByText('This project is archived — reopen it first.')).toBeInTheDocument();
    expect(useArchiveNotice.getState().notice).not.toBeNull();
  });

  it('goes by itself after a few seconds; Dismiss sooner', async () => {
    vi.useFakeTimers();
    renderHost();
    act(() => showArchiveNotice({ id: 't1', key: 'RIG-12' }));
    act(() => vi.advanceTimersByTime(ARCHIVE_UNDO_MS + 10));
    expect(screen.queryByRole('status')).toBeNull();
    vi.useRealTimers();
    act(() => showArchiveNotice({ id: 't1', key: 'RIG-12' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
