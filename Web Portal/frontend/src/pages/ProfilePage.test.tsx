import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ProfilePage } from './ProfilePage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const me = { id: 'u1', email: 'ada@x.co', username: 'ada', roles: ['EMPLOYEE'] };
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let passwordResponse: () => Response;

beforeEach(() => {
  calls = [];
  passwordResponse = () => json({ data: { accessToken: 'fresh-at', refreshToken: 'fresh-rt' } });
  useAuthStore.getState().setSession({ user: me, accessToken: 'old-at', refreshToken: 'old-rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).endsWith('/users/me/password')) return passwordResponse();
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ProfilePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(next: string, confirm = next) {
  await userEvent.type(screen.getByLabelText(/current password/i), 'OldPass123');
  await userEvent.type(screen.getByLabelText(/^new password/i), next);
  await userEvent.type(screen.getByLabelText(/confirm new password/i), confirm);
  await userEvent.click(screen.getByRole('button', { name: /update password/i }));
}

describe('ProfilePage — change password', () => {
  it('stores the fresh session the server returns, so this device stays signed in (SEC-18)', async () => {
    renderPage();
    await fillAndSubmit('NewPass456');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/still signed in here/i));
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('fresh-at');
    expect(s.refreshToken).toBe('fresh-rt');
    expect(s.user?.id).toBe('u1');
    expect(calls.find((c) => c.url.endsWith('/users/me/password'))!.body).toEqual({ currentPassword: 'OldPass123', newPassword: 'NewPass456' });
  });

  it('warns that a sign-in will be needed when the server returns no new session', async () => {
    passwordResponse = () => new Response(null, { status: 204 });
    renderPage();
    await fillAndSubmit('NewPass456');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/sign in again/i));
    expect(useAuthStore.getState().accessToken).toBe('old-at');
  });

  it('uses the same password rule and hint as everywhere else (SEC-12)', async () => {
    renderPage();
    expect(screen.getByText(/at least 8 characters, with a letter and a number/i)).toBeInTheDocument();
    await fillAndSubmit('aaaaaa');
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(calls.some((c) => c.url.endsWith('/users/me/password'))).toBe(false);
  });
});
