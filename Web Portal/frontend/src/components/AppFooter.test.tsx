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

  it('asks to reload when a newer build has been deployed since this page was loaded', async () => {
    deployedWeb = { version: '1.0.1', builtAt: '2099-01-01T00:00:00.000Z' };
    renderFooter();
    expect(await screen.findByText(/a new version of mico360 tasks is available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('says nothing about updates while this page is the deployed build', async () => {
    renderFooter();
    await screen.findByText(/Last Updated: 16\/10\/2026/);
    expect(screen.queryByText(/a new version/i)).toBeNull();
  });
});

describe('AppFooter: the apps', () => {
  it('offers the Android app and the Chrome extension as downloads from this site', async () => {
    renderFooter();
    const apps = await screen.findByRole('navigation', { name: 'Get the apps' });
    const android = await within(apps).findByRole('link', { name: /android app/i });
    expect(android.getAttribute('href')).toBe('/downloads/MICO360-Tasks.apk');
    expect(android.hasAttribute('download')).toBe(true);
    const extension = await within(apps).findByRole('link', { name: /chrome extension/i });
    expect(extension.getAttribute('href')).toBe('/downloads/MICO360-Tasks-Chrome-Extension.zip');
    expect(extension.hasAttribute('download')).toBe(true);
    // How to install a zipped extension, for anyone who hasn't done it before.
    expect(extension.getAttribute('title')).toMatch(/chrome:\/\/extensions.*Load unpacked/);
  });

  it('leaves out a download this site doesn’t have', async () => {
    missing.add('/downloads/MICO360-Tasks-Chrome-Extension.zip');
    renderFooter();
    const apps = await screen.findByRole('navigation', { name: 'Get the apps' });
    await within(apps).findByRole('link', { name: /android app/i });
    await waitFor(() => expect(within(apps).queryByRole('link', { name: /chrome extension/i })).toBeNull());
  });

  it('opens an Android app page the administrator set (a store, say) instead of a file', async () => {
    androidAppUrl = 'https://play.google.com/store/apps/details?id=com.mico360.tasks';
    renderFooter();
    const apps = await screen.findByRole('navigation', { name: 'Get the apps' });
    await waitFor(() => expect(within(apps).getByRole('link', { name: /android app/i }).getAttribute('href')).toBe(androidAppUrl));
    const android = within(apps).getByRole('link', { name: /android app/i });
    expect(android.hasAttribute('download')).toBe(false);
    expect(android.getAttribute('target')).toBe('_blank');
    expect(android.getAttribute('rel')).toContain('noopener');
  });
});
