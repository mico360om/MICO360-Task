import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App';
import { useAuthStore } from './stores/auth-store';

// Installable website (13 Nov): the staff pages link the manifest (a client's never do), and every staff
// page carries the update notice.
const NEWER = { version: '9.9.9', builtAt: '2099-01-01T00:00:00.000Z' };
vi.mock('./lib/update-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/update-recovery')>()),
  pageUpdateWatcher: () => ({ navigate: () => false, subscribe: () => () => {}, newer: NEWER }),
}));

function at(url: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const manifest = () => document.head.querySelector('link[rel="manifest"]');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
  document.head.querySelector('link[rel="manifest"]')?.remove();
});

describe('App — the installable website', () => {
  it('a staff page: the manifest is linked and the update notice shows', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    at('/dashboard');
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(manifest()?.getAttribute('href')).toBe('/manifest.webmanifest');
    expect(screen.getByText('A new version of MICO360 Tasks is ready.')).toBeInTheDocument();
  });

  it('the sign-in page links it too (staff sign in there)', () => {
    at('/login');
    expect(manifest()).not.toBeNull();
  });

  it('a client’s shared page: no manifest (owner P2: no install offer for clients)', () => {
    at('/login');
    expect(manifest()).not.toBeNull();
    cleanup();
    at('/client/abc123');
    expect(manifest()).toBeNull();
  });
});
