import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettingsPage } from './SystemSettingsPage';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
let calls: { url: string; method: string }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      if (String(url).endsWith('/tasks/carry-forward')) return json({ data: { carried: 3 } });
      return json({ data: [{ key: 'companyName', value: 'MICO Energy' }] });
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SystemSettingsPage />
    </QueryClientProvider>,
  );
}

describe('SystemSettingsPage', () => {
  it('renders system settings from the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('companyName')).toBeInTheDocument());
    expect(screen.getByText('MICO Energy')).toBeInTheDocument();
  });

  it('shows the carry-forward controls and runs the sweep on demand', async () => {
    renderPage();
    expect(screen.getByRole('switch', { name: /automatic carry-forward/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /run carry-forward now/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tasks/carry-forward') && c.method === 'POST')).toBe(true));
    await waitFor(() => expect(screen.getByText(/carried 3 tasks forward/i)).toBeInTheDocument());
  });
});
