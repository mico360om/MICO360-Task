import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncStatus } from './SyncStatus';
import { useAuthStore } from '../stores/auth-store';
import { clearQueue, enqueue, getQueue, localStorageQueueStore } from '../lib/offline-queue';

afterEach(() => {
  clearQueue(localStorageQueueStore);
});

function renderStatus() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <SyncStatus />
    </QueryClientProvider>,
  );
  return spy;
}

describe('SyncStatus', () => {
  it('shows a synced state when nothing is fetching', () => {
    renderStatus();
    expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
    expect(screen.getByText(/synced/i)).toBeInTheDocument();
  });

  it('triggers a global refetch when clicked', async () => {
    const spy = renderStatus();
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));
    expect(spy).toHaveBeenCalled();
  });

  it('lists changes that could not be synced and lets the user discard them', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
    enqueue(localStorageQueueStore, { kind: 'task.create', payload: { title: 'Offline idea' }, ownerId: 'u1' });
    const item = getQueue(localStorageQueueStore)[0]!;
    localStorageQueueStore.write([{ ...item, failedAt: Date.now(), lastError: 'Column not found' }]);
    renderStatus();
    await userEvent.click(screen.getByRole('button', { name: /1 not synced/i }));
    const panel = screen.getByRole('dialog', { name: /could not be synced/i });
    expect(panel).toHaveTextContent('New task “Offline idea”');
    expect(panel).toHaveTextContent('Column not found');
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(getQueue(localStorageQueueStore)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /not synced/i })).not.toBeInTheDocument();
  });
});
