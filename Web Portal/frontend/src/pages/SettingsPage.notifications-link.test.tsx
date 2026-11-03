import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { useAuthStore } from '../stores/auth-store';

// 1.22: the Notifications page's "Notification settings" link goes to /settings#notifications —
// the page brings its Notifications card into view.
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'ada@x.co', username: 'ada', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => json({ data: String(url).includes('/notifications/preferences') ? { muted: [] } : [] })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={qc}>
        <SettingsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Settings → Notifications from a link', () => {
  it('#notifications brings the Notifications card into view', async () => {
    const scrolled: Element[] = [];
    const spy = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = spy as never;
    renderAt('/settings#notifications');
    const card = screen.getByRole('heading', { name: 'Notifications' }).closest('section')!;
    expect(card).toHaveAttribute('id', 'notifications');
    await waitFor(() => expect(scrolled).toContain(card));
  });

  it('without it, the page opens at the top', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy as never;
    renderAt('/settings');
    await screen.findByRole('heading', { name: 'Notifications' });
    expect(spy).not.toHaveBeenCalled();
  });
});
