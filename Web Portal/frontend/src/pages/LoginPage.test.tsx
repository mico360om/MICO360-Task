import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let emailEnabled = true;
let loginResponse: () => Response = () => json({});
beforeEach(() => {
  emailEnabled = true;
  useAuthStore.getState().logout('remote');
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '', emailEnabled } });
    if (u.endsWith('/auth/login')) return loginResponse();
    if (u.endsWith('/auth/otp/request')) return json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email sign-in isn’t available right now. Sign in with your password or contact an administrator.' } }, 503);
    return json({ data: {} });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function signIn(keep: boolean) {
  await userEvent.type(screen.getByLabelText(/email or username/i), 'ada');
  await userEvent.type(screen.getByLabelText(/^password/i), 'Secret123');
  if (!keep) await userEvent.click(screen.getByRole('checkbox', { name: /keep me signed in/i }));
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('LoginPage', () => {
  it('with "Keep me signed in" unticked, keeps the session out of localStorage', async () => {
    loginResponse = () => json({ data: { user: { id: 'u1', email: 'a@x', username: 'ada', roles: [] }, accessToken: 'at', refreshToken: 'rt' } });
    renderPage();
    await signIn(false);
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(localStorage.getItem('mico360.refreshToken')).toBeNull();
    expect(sessionStorage.getItem('mico360.refreshToken')).toBe('rt');
  });

  it('shows when a locked account can try again (423 + retryAfterSeconds)', async () => {
    loginResponse = () => json({ error: { code: 'ACCOUNT_LOCKED', message: 'Account locked.', details: { retryAfterSeconds: 90 } } }, 423);
    renderPage();
    await signIn(true);
    expect(await screen.findByText(/too many attempts\. try again in 2 minutes\./i)).toBeInTheDocument();
  });

  it('hides "Email code" when email is not configured', async () => {
    emailEnabled = false;
    renderPage();
    await waitFor(() => expect(screen.queryByRole('tab', { name: /email code/i })).not.toBeInTheDocument());
  });

  it('explains a 503 EMAIL_NOT_CONFIGURED and points to password sign-in', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /email code/i }));
    await userEvent.type(screen.getByLabelText(/email or username/i), 'ada');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    expect(await screen.findByText(/sign in with your password/i)).toBeInTheDocument();
  });
});
