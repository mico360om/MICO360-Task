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

describe('SystemSettingsPage — daily task emails', () => {
  it('has the daily task email log', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Daily task emails' })).toBeInTheDocument();
  });
});

describe('SystemSettingsPage', () => {
  it('renders system settings from the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('companyName')).toBeInTheDocument());
    expect(screen.getByText('MICO Energy')).toBeInTheDocument();
  });

  it('never prints raw setting JSON such as AI provider keys (SEC-05)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [
      { key: 'companyName', value: 'MICO Energy' },
      { key: 'carryForward.enabled', value: false },
      { key: 'carryForward.statuses', value: ['TODO', 'BLOCKED'] },
      { key: 'ai.config', value: { providers: [{ name: 'OpenAI', apiKey: 'sk-live-SECRET123' }] } },
      { key: 'integrations.webhook', value: { url: 'https://x', token: 'tok-SECRET' } },
    ] })));
    renderPage();
    await waitFor(() => expect(screen.getByText('MICO Energy')).toBeInTheDocument());
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('To do, Blocked')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SECRET/);
    expect(screen.queryByText('ai.config')).not.toBeInTheDocument();
    expect(screen.getByText(/2 other settings are managed on their own page/i)).toBeInTheDocument();
  });

  it('shows the carry-forward controls and runs the sweep on demand', async () => {
    renderPage();
    expect(screen.getByRole('switch', { name: /automatic carry-forward/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /run carry-forward now/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/tasks/carry-forward') && c.method === 'POST')).toBe(true));
    await waitFor(() => expect(screen.getByText(/carried 3 tasks forward/i)).toBeInTheDocument());
  });

  it('does not offer a run that would do nothing: with carry-forward switched off the button says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      return json({ data: [{ key: 'carryForward.enabled', value: false }] });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByRole('switch', { name: /automatic carry-forward/i })).toHaveAttribute('aria-checked', 'false'));
    const run = screen.getByRole('button', { name: /run carry-forward now/i });
    expect(run).toBeDisabled();
    expect(screen.getByText(/switch carry-forward on to run it/i)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/tasks/carry-forward'))).toBe(false);
  });

  it('announces the result of a run', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /run carry-forward now/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/carried 3 tasks forward/i);
  });

  it('lists the statuses in full and in the order of the chips, whatever order they were ticked in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ key: 'carryForward.statuses', value: ['REVIEW', 'TODO', 'BACKLOG', 'IN_PROGRESS', 'BLOCKED'] }] })));
    renderPage();
    const value = await screen.findByText('Backlog, To do, In progress, Blocked, Review');
    expect(value).not.toHaveClass('truncate');
  });

  it('shows keyboard focus on a status chip (the real checkbox is visually hidden)', async () => {
    renderPage();
    const chip = (await screen.findByRole('checkbox', { name: 'Backlog' })).closest('label')!;
    expect(chip.className).toMatch(/has-\[:focus-visible\]:outline/);
  });
});
