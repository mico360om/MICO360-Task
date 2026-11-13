import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppFooter } from './AppFooter';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

let deployedWeb: unknown;
let androidAppUrl: string | null;
let missing: Set<string>;
beforeEach(() => {
  deployedWeb = { version: __APP_VERSION__, builtAt: __APP_BUILT_AT__ };
  androidAppUrl = null;
  missing = new Set();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'HEAD') return new Response(null, { status: missing.has(u) ? 404 : 200 });
    if (u.endsWith('/version')) return json({ data: { version: '1.0.0', deployedAt: '2026-10-16T15:30:00.000Z' } });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', serverTime: new Date().toISOString(), androidAppUrl } });
    if (u.includes('/build-info.json')) return json(deployedWeb);
    return json({ data: [] });
  }));
});
afterEach(() => vi.restoreAllMocks());

function renderFooter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppFooter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppFooter', () => {
  it('shows the deployed version and when it was last updated, in Oman time', async () => {
    renderFooter();
    const footer = await screen.findByRole('contentinfo');
    await waitFor(() => expect(footer.textContent).toContain('Last Updated: 16/10/2026, 07:30 PM (Oman Time)'));
    expect(footer.textContent).toContain('Version: v1.0.0 | Last Updated: 16/10/2026, 07:30 PM (Oman Time)');
    expect(screen.getByRole('link', { name: /about and version history/i }).getAttribute('href')).toBe('/about');
  });

  // Installable website (13 Nov): a newer version is told by the update notice (UpdateToast: Refresh /
  // Later), the one way for an installed app too — the footer no longer has a banner of its own.
  it('leaves a newer version to the update notice: no banner of its own, nothing asked of build-info.json', async () => {
    deployedWeb = { version: '1.0.1', builtAt: '2099-01-01T00:00:00.000Z' };
    renderFooter();
    await screen.findByText(/Last Updated: 16\/10\/2026/);
    expect(screen.queryByText(/a new version/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /reload/i })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).includes('build-info.json'))).toBe(false);
  });
});

describe('AppFooter: the apps', () => {
  // Owner, 13 Nov (P1): Install App comes first; the Android download moved to the sign-in page's footer
  // and About.
  it('offers the Chrome extension as a download from this site — and no longer the Android app', async () => {
    androidAppUrl = '/downloads/MICO360-Tasks.apk';
    renderFooter();
    const apps = await screen.findByRole('navigation', { name: 'Get the apps' });
    const extension = await within(apps).findByRole('link', { name: /chrome extension/i });
    expect(extension.getAttribute('href')).toBe('/downloads/MICO360-Tasks-Chrome-Extension.zip');
    expect(extension.hasAttribute('download')).toBe(true);
    // How to install a zipped extension, for anyone who hasn't done it before.
    expect(extension.getAttribute('title')).toMatch(/chrome:\/\/extensions.*Load unpacked/);
    expect(within(apps).queryByRole('link', { name: /android/i })).toBeNull();
    expect(document.body.innerHTML).not.toContain('MICO360-Tasks.apk');
  });

  it('leaves out a download this site doesn’t have (with none left, no “Get the apps” at all)', async () => {
    missing.add('/downloads/MICO360-Tasks-Chrome-Extension.zip');
    renderFooter();
    await screen.findByText(/Last Updated: 16\/10\/2026/);
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Get the apps' })).toBeNull());
  });
});
