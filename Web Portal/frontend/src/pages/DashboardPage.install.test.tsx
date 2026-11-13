import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import { useAuthStore } from '../stores/auth-store';
import { resetInstallAppForTests, startInstallApp, type InstallWorld } from '../lib/install-app';

// Installable website (13 Nov): the Dashboard offers to install the site, once, in a small card under
// the welcome band.
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function device(iphone: boolean): void {
  const w: InstallWorld = {
    addEventListener: () => {},
    displayModeStandalone: () => false,
    onDisplayModeChange: () => {},
    navigator: iphone
      ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 }
      : { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', platform: 'Win32', maxTouchPoints: 0 },
    storage: null,
    now: () => Date.UTC(2026, 10, 13),
  };
  startInstallApp(w);
}

beforeEach(() => {
  resetInstallAppForTests();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetInstallAppForTests();
  useAuthStore.getState().logout();
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the Dashboard’s install card', () => {
  it('where the site can be installed: “Install MICO360 Tasks on this device”, after the welcome band', () => {
    device(true);
    renderPage();
    const card = screen.getByRole('region', { name: 'Install MICO360 Tasks on this device' });
    const welcome = screen.getByRole('heading', { level: 1 });
    expect(welcome.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('not where the browser can’t install', () => {
    device(false);
    renderPage();
    expect(screen.queryByRole('region', { name: /install mico360 tasks/i })).toBeNull();
  });
});
