import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TwoStepSettings, TwoStepOffBanner } from './TwoStepSettings';
import { useAuthStore } from '../../stores/auth-store';

/** 1.24 two-step sign-in: Settings → Security for administrators, and the red break-glass banner. */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let status: Record<string, unknown>;
let calls: { url: string; method: string; credentials?: RequestCredentials }[];

beforeEach(() => {
  status = { on: true, reason: null, trustedBrowsers: 2, thisBrowserTrustedUntil: '2026-12-18T08:00:00.000Z' };
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', credentials: init?.credentials });
      if (url.endsWith('/auth/two-step/forget')) {
        status = { ...status, trustedBrowsers: 0, thisBrowserTrustedUntil: null };
        return json({ data: { forgotten: 2 } });
      }
      if (url.endsWith('/auth/two-step')) return json({ data: status });
      return json({ data: null });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});
const signIn = (roles: string[]) => useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles }, accessToken: 'at', refreshToken: 'rt' });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('Settings → Security: two-step sign-in (administrators)', () => {
  it('says it is on, how many browsers are trusted and until when this one is; the cookie goes with the call', async () => {
    signIn(['ADMIN']);
    wrap(<TwoStepSettings />);
    expect(await screen.findByText('On (code by email)')).toBeInTheDocument();
    expect(screen.getByText('Trusted browsers: 2')).toBeInTheDocument();
    expect(screen.getByText(/This browser is trusted until 18 Dec/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/auth/two-step'))!.credentials).toBe('include');
  });

  it('Forget all trusted browsers: asked first, then every one asks for a code again (this page stays signed in)', async () => {
    signIn(['ADMIN']);
    wrap(<TwoStepSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Forget all trusted browsers' }));
    await userEvent.click(screen.getByRole('button', { name: 'Forget all' }));
    expect(await screen.findByText('Trusted browsers: 0')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Done. Every browser will ask for a code at its next sign-in.');
    const forget = calls.find((c) => c.url.endsWith('/auth/two-step/forget'))!;
    expect(forget.method).toBe('POST');
    expect(forget.credentials).toBe('include');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('no trusted browser: no Forget button', async () => {
    status = { ...status, trustedBrowsers: 0, thisBrowserTrustedUntil: null };
    signIn(['ADMIN']);
    wrap(<TwoStepSettings />);
    expect(await screen.findByText('Trusted browsers: 0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forget all trusted browsers' })).toBeNull();
  });

  it('switched off on the server: says so', async () => {
    status = { on: false, reason: 'switched-off', trustedBrowsers: 0, thisBrowserTrustedUntil: null };
    signIn(['ADMIN']);
    wrap(<TwoStepSettings />);
    expect(await screen.findByText('Off (switched off on the server)')).toBeInTheDocument();
  });

  it('nothing for an employee (and nothing asked)', async () => {
    signIn(['EMPLOYEE']);
    const { container } = wrap(<TwoStepSettings />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });
});

describe('the red banner while two-step sign-in is off', () => {
  it('administrators see it when it is switched off on the server', async () => {
    status = { on: false, reason: 'switched-off', trustedBrowsers: 0, thisBrowserTrustedUntil: null };
    signIn(['ADMIN']);
    wrap(<TwoStepOffBanner />);
    expect(await screen.findByRole('status')).toHaveTextContent('Two-step sign-in is switched off on the server.');
  });

  it('… and when email isn’t set up', async () => {
    status = { on: false, reason: 'email-not-set-up', trustedBrowsers: 0, thisBrowserTrustedUntil: null };
    signIn(['ADMIN']);
    wrap(<TwoStepOffBanner />);
    expect(await screen.findByRole('status')).toHaveTextContent('Two-step sign-in is off: email isn’t set up on the server.');
  });

  it('nothing while it is on, and nothing (not even asked) for an employee', async () => {
    signIn(['ADMIN']);
    const a = wrap(<TwoStepOffBanner />);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    calls = [];
    signIn(['EMPLOYEE']);
    const b = wrap(<TwoStepOffBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(b.container).toBeEmptyDOMElement();
    expect(calls).toEqual([]);
  });
});
