import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';
import { useAuthStore } from '../stores/auth-store';
import { enqueueOffline } from '../lib/offline-replay';
import { clearQueue, getQueue, localStorageQueueStore } from '../lib/offline-queue';

// The shell opens a live-update socket: keep it off the network, or a server running on this computer
// answers it (an unknown token, a session refresh) and the test's session changes under it.
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));

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

  describe('phone menu', () => {
    it('opens as a dialog with focus inside it, and closes with Escape', async () => {
      renderShell();
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
      const opener = screen.getByRole('button', { name: 'Open menu' });
      await userEvent.click(opener);
      const menu = screen.getByRole('dialog', { name: 'Menu' });
      expect(menu).toHaveAttribute('aria-modal', 'true');
      expect(menu.contains(document.activeElement)).toBe(true);

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });

    it('has a Close button, and closes when a page is chosen', async () => {
      renderShell();
      await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      const menu = screen.getByRole('dialog', { name: 'Menu' });
      await userEvent.click(menu.querySelector('a[href="/dashboard"]')!);
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    });
  });
});

