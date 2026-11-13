import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileMenu } from './ProfileMenu';
import { useAuthStore } from '../stores/auth-store';
import { resetInstallAppForTests, startInstallApp, type InstallWorld } from '../lib/install-app';

// Installable website (13 Nov): "Install App" in the account menu, just before About, while the site
// can be installed here.
const me = { id: 'u1', email: 'aisha@x.co', username: 'aisha', roles: ['EMPLOYEE'], firstName: 'Aisha', lastName: 'Khan', avatarUrl: null };

function device(over: Partial<InstallWorld> = {}) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const prompt = vi.fn(async () => undefined);
  startInstallApp({
    addEventListener: (type, fn) => void (listeners[type] ??= []).push(fn),
    displayModeStandalone: () => false,
    onDisplayModeChange: () => {},
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 0 },
    storage: null,
    now: () => Date.UTC(2026, 10, 13),
    ...over,
  });
  (listeners.beforeinstallprompt ?? []).forEach((fn) => fn({ preventDefault: () => {}, prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) }));
  return { prompt };
}

function show() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: me }), { status: 200, headers: { 'content-type': 'application/json' } })));
  useAuthStore.getState().setSession({ user: me as never, accessToken: 'a1', refreshToken: 'r1' }, { remember: true });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ProfileMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
}

beforeEach(() => {
  localStorage.clear();
  resetInstallAppForTests();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetInstallAppForTests();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

describe('the account menu’s Install App', () => {
  it('sits just before About; it opens the browser’s install and closes the menu', () => {
    const { prompt } = device();
    show();
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent?.trim() ?? '');
    const install = items.indexOf('Install App');
    expect(install).toBeGreaterThanOrEqual(0);
    expect(items[install + 1]).toBe('About and version history');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Install App' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('not there when the site runs installed', () => {
    device({ displayModeStandalone: () => true });
    show();
    expect(screen.queryByRole('menuitem', { name: 'Install App' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'About and version history' })).toBeInTheDocument();
  });
});
