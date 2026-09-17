import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationsBell } from './NotificationsBell';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(() => vi.restoreAllMocks());

describe('NotificationsBell', () => {
  it('shows the unread count badge and lists notifications when opened', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/unread-count')) return json({ data: { count: 2 } });
      if (u.endsWith('/notifications')) return json({ data: [{ id: 'n1', type: 'TASK_ASSIGNED', title: 'You were assigned a task', body: null, readAt: null, createdAt: '' }] });
      return json({ data: {} });
    }));

    withQuery(<NotificationsBell />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument()); // unread badge
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    await waitFor(() => expect(screen.getByText('You were assigned a task')).toBeInTheDocument());
  });

  it('marks all read when the "Mark all read" action is used', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/unread-count')) return json({ data: { count: 1 } });
      if (u.endsWith('/read-all')) return json({ data: { ok: true } });
      if (u.endsWith('/notifications')) return json({ data: [{ id: 'n1', type: 'MENTION', title: 'Mentioned', body: null, readAt: null, createdAt: '' }] });
      return json({ data: {} });
    });
    vi.stubGlobal('fetch', fetchMock);

    withQuery(<NotificationsBell />);
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    await userEvent.click(await screen.findByRole('button', { name: /mark all read/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/notifications/read-all'))).toBe(true));
  });
});
