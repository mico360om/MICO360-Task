import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NotificationsBell } from './NotificationsBell';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}
function withQuery(ui: React.ReactElement, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="*" element={<>{ui}<LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

  it('opens the related task (and marks the notification read) when clicked', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/unread-count')) return json({ data: { count: 1 } });
      if (u.endsWith('/read')) return json({ data: {} });
      if (u.endsWith('/notifications')) return json({ data: [{ id: 'n1', type: 'TASK_ASSIGNED', title: 'You were assigned WEB-12', body: null, entityType: 'task', entityId: 't12', readAt: null, createdAt: '' }] });
      return json({ data: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    withQuery(<NotificationsBell />);
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    await userEvent.click(await screen.findByText('You were assigned WEB-12'));
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard?task=t12');
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/notifications/n1/read'))).toBe(true));
  });

  it('shares one cache with the Notifications page (read state stays in sync)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/unread-count')) return json({ data: { count: 0 } });
      if (u.endsWith('/notifications')) return json({ data: [{ id: 'n1', type: 'X', title: 'Hello', body: null, readAt: null, createdAt: '' }] });
      return json({ data: {} });
    }));
    withQuery(<NotificationsBell />, qc);
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    await screen.findByText('Hello');
    expect(qc.getQueryData(['notifications'])).toHaveLength(1);
  });

  it('shows an error (not “all caught up”) when the list fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/unread-count')) return json({ data: { count: 0 } });
      return new Response('{}', { status: 500 });
    }));
    withQuery(<NotificationsBell />);
    await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(await screen.findByText(/couldn’t load notifications/i)).toBeInTheDocument();
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument();
  });
});
