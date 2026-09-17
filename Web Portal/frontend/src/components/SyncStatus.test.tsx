import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncStatus } from './SyncStatus';

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
});
