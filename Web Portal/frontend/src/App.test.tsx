import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { App } from './App';
import { useAuthStore } from './stores/auth-store';

function renderApp(path = '/dashboard') {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.getState().logout();
});

describe('App routing', () => {
  it('redirects to the login page when signed out', () => {
    renderApp('/dashboard');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows the dashboard inside the shell when signed in', () => {
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
      accessToken: 'at',
      refreshToken: 'rt',
    });
    renderApp('/dashboard');
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    // The shell's sidebar nav renders around the dashboard (the dashboard also links to
    // Projects, so target the nav landmark specifically to stay unambiguous).
    const nav = screen.getByRole('navigation', { name: /main/i });
    expect(within(nav).getByRole('link', { name: /projects/i })).toBeInTheDocument();
  });

  it('a client page opens outside the staff app: no sign-in page, no shell, no staff token — even in a staff browser', async () => {
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
      accessToken: 'staff-access-token',
      refreshToken: 'rt',
    });
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { code: 'CLIENT_SIGN_IN', message: 'Enter the code.' } }), { status: 401 });
    });
    try {
      renderApp('/client/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde');
      expect(await screen.findByRole('heading', { name: 'View a shared project' })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: /main/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
      expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
      const clientCalls = calls.filter((c) => c.url.includes('/client/'));
      expect(clientCalls.length).toBeGreaterThan(0);
      for (const c of clientCalls) expect(JSON.stringify(c.init ?? {})).not.toContain('staff-access-token');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('titles the tab after the page and marks signed-in pages noindex', () => {
    const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
    const signedOut = renderApp('/dashboard');
    // Signed out: the visitor is on the public sign-in page.
    expect(document.title).toBe('Sign in · MICO360 Tasks');
    expect(robots()).toBeNull();
    signedOut.unmount();
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] },
      accessToken: 'at',
      refreshToken: 'rt',
    });
    renderApp('/dashboard');
    expect(document.title).toBe('Dashboard · MICO360 Tasks');
    expect(robots()).toBe('noindex, nofollow');
  });
});
