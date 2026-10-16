import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppFooter } from './AppFooter';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

let deployedWeb: unknown;
beforeEach(() => {
  deployedWeb = { version: __APP_VERSION__, builtAt: __APP_BUILT_AT__ };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/version')) return json({ data: { version: '1.0.0', deployedAt: '2026-10-16T15:30:00.000Z' } });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', serverTime: new Date().toISOString() } });
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
