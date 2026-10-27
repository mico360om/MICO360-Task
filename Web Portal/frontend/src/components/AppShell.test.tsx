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
    expect(screen.getByRole('alert')).toHaveTextContent(/1 change saved on this device hasn’t been sent yet/i);
    await userEvent.click(screen.getByRole('button', { name: /log out anyway/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(getQueue(localStorageQueueStore)).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('counts inspection changes still on this device in the same warning', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const uid = useAuthStore.getState().user!.id;
    localStorage.setItem(`mico360.inspection.${uid}.i1`, JSON.stringify({ v: 1, ownerId: uid, inspectionId: 'i1', projectId: 'p1', title: 'Rig daily check', snapshot: { id: 'i1', projectId: 'p1', title: 'Rig daily check', status: 'IN_PROGRESS', structure: { sections: [], clientSignature: 'NONE', supervisorSignature: 'NONE' }, answers: [], revision: 0 }, answers: { a: { itemId: 'a', result: 'PASS', reading: null, note: null, editedAt: '2026-10-27T08:00:00.000Z' }, b: { itemId: 'b', result: 'FAIL', reading: null, note: null, editedAt: '2026-10-27T08:00:01.000Z' } }, finish: null, followUps: {}, problem: null, savedAt: '', sentAt: null }));
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /log out/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/2 changes saved on this device haven’t been sent yet/i);
    await userEvent.click(screen.getByRole('button', { name: /log out anyway/i }));
    expect(localStorage.getItem(`mico360.inspection.${uid}.i1`)).toBeNull();
    vi.unstubAllGlobals();
  });

  describe('unread chat messages', () => {
    const answer = (url: string) => {
      const data = String(url).endsWith('/conversations')
        ? [
            { conversation: { id: 'c1', kind: 'DIRECT', projectId: null, createdAt: '' }, participants: [], unread: 2, lastMessage: null, prefs: { favorite: false, archived: false, muted: false } },
            { conversation: { id: 'c2', kind: 'PROJECT', projectId: 'p1', createdAt: '' }, participants: [], unread: 3, lastMessage: null, prefs: { favorite: false, archived: false, muted: false } },
            { conversation: { id: 'c3', kind: 'PROJECT', projectId: 'p2', createdAt: '' }, participants: [], unread: 9, lastMessage: null, prefs: { favorite: false, archived: false, muted: true } },
          ]
        : String(url).includes('/notifications') ? { count: 0 } : [];
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    it('shows the total on the sidebar’s Chat link (muted conversations left out)', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => answer(url)));
      renderShell();
      const chat = await screen.findByRole('link', { name: 'Chat, 5 unread messages' });
      expect(chat.querySelector('[data-chat-badge]')).toHaveTextContent('5');
    });

    it('marks the phone’s menu button, which hides the sidebar, and shows the count inside the menu', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => answer(url)));
      renderShell();
      const opener = await screen.findByRole('button', { name: 'Open menu, 5 unread chat messages' });
      expect(opener.querySelector('[data-chat-dot]')).not.toBeNull();
      await userEvent.click(opener);
      const menu = screen.getByRole('dialog', { name: 'Menu' });
      expect(menu.querySelector('a[href="/chat"]')).toHaveAccessibleName('Chat, 5 unread messages');
    });

    it('shows nothing when every message is read', async () => {
      renderShell();
      expect(await screen.findByRole('button', { name: 'Open menu' })).toBeInTheDocument();
      expect(document.querySelector('[data-chat-badge]')).toBeNull();
      expect(document.querySelector('[data-chat-dot]')).toBeNull();
    });
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

