import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeeklySummarySettings } from './WeeklySummarySettings';
import { useAuthStore } from '../../stores/auth-store';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let allowed = true;
let saved: unknown[] = [];
let prefs: Record<string, unknown> = { muted: [], weeklySummary: true };

beforeEach(() => {
  allowed = true;
  saved = [];
  prefs = { muted: [], weeklySummary: true };
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/management/access')) return json({ data: allowed ? { allowed: true, scope: 'RUN' } : { allowed: false, scope: null } });
      if (url.endsWith('/notifications/preferences') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        saved.push(body);
        prefs = { ...prefs, ...body };
        return json({ data: prefs });
      }
      if (url.endsWith('/notifications/preferences')) return json({ data: prefs });
      return json({ data: null });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WeeklySummarySettings />
    </QueryClientProvider>,
  );

describe('Settings → Weekly management summary', () => {
  it('is offered to someone who can see the Management page, on by default, and turns off with one tap', async () => {
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Weekly management summary email' });
    expect(screen.getByRole('heading', { name: 'Weekly management summary' })).toBeInTheDocument();
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(saved).toEqual([{ weeklySummary: false }]));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('shows the saved choice', async () => {
    prefs = { muted: [], weeklySummary: false };
    renderIt();
    const toggle = await screen.findByRole('switch', { name: 'Weekly management summary email' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('is not shown to anyone else', async () => {
    allowed = false;
    renderIt();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).endsWith('/management/access'))).toBe(true));
    expect(screen.queryByRole('switch', { name: 'Weekly management summary email' })).not.toBeInTheDocument();
  });
});
