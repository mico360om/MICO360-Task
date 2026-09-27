import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';
import { useAuthStore } from '../stores/auth-store';
import { enqueueOffline } from '../lib/offline-replay';
import { clearQueue, getQueue, localStorageQueueStore } from '../lib/offline-queue';

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<div>Dashboard content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The header's notifications bell polls the API; stub it so the shell renders cleanly.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { count: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } })));
  useAuthStore.getState().setSession({
    user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
    accessToken: 'at',
    refreshToken: 'rt',
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  clearQueue(localStorageQueueStore);
});

describe('AppShell', () => {
  it('renders the sidebar, the header user, and the routed content', () => {
    renderShell();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText('ada')).toBeInTheDocument();
    expect(screen.getByText('Dashboard content')).toBeInTheDocument();
  });

  it('logs the user out from the profile menu', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /log out/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('warns about unsynced offline changes before logging out, then discards them', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false }); // stay offline so the shell doesn't sync them
    renderShell();
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /log out/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(/1 change made offline hasn’t synced/i);
    await userEvent.click(screen.getByRole('button', { name: /log out anyway/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(getQueue(localStorageQueueStore)).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
