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
let hostsApk = false;
let loginResponse: () => Response = () => json({});
let otpRequest: () => Response;
let otpVerify: (body: { identifier: string; code: string }) => Response;
let sent: { url: string; body: unknown }[] = [];
beforeEach(() => {
  emailEnabled = true;
  hostsApk = false;
  sent = [];
  otpRequest = () => json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email sign-in isn’t available right now. Sign in with your password or contact an administrator.' } }, 503);
  otpVerify = () => json({ error: { code: 'INVALID_OTP', message: 'Invalid or unknown code.' } }, 401);
  useAuthStore.getState().logout('remote');
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (init?.method === 'POST') sent.push({ url: u, body });
    // The sign-in page asks whether the site has the APK before offering it.
    if (init?.method === 'HEAD') return new Response(null, { status: hostsApk ? 200 : 404 });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '', emailEnabled, androidAppUrl: hostsApk ? '/downloads/MICO360-Tasks.apk' : null } });
    if (u.endsWith('/auth/login')) return loginResponse();
    if (u.endsWith('/auth/otp/request')) return otpRequest();
    if (u.endsWith('/auth/otp/verify')) return otpVerify(body);
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

  it('links Privacy and Terms to real pages, and iOS is a label rather than a dead link', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(screen.queryByRole('link', { name: /ios/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/ios app coming soon/i)).toBeInTheDocument();
  });

  it('downloads the APK from this site, at its own address, never from a code-hosting page', async () => {
    hostsApk = true;
    renderPage();
    await waitFor(() => expect(screen.getByRole('link', { name: /android/i })).toHaveAttribute('href', '/downloads/MICO360-Tasks.apk'));
    const link = screen.getByRole('link', { name: /android/i });
    expect(link).toHaveAttribute('download');
    expect(link).not.toHaveAttribute('target');
    expect(document.body.innerHTML).not.toMatch(/github\.com/);
  });

  it('says the Android app is not available yet when the site has no APK, instead of a link that fails', async () => {
    hostsApk = false;
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/android app not available yet/i)).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /android/i })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/github\.com/);
  });

  it('offers nothing that needs email until the server has said email works (no options that appear, then vanish)', async () => {
    // The answer about email has not arrived yet.
    vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).endsWith('/config') ? new Promise<Response>(() => {}) : Promise.resolve(json({ data: {} })))));
    renderPage();
    expect(screen.getByLabelText(/email or username/i)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /email code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /forgot password/i })).not.toBeInTheDocument();
  });

  it('with email working, offers the emailed code and "Forgot password?"', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: /email code/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /forgot password/i }).length).toBeGreaterThan(0);
  });

  it('with email not set up, does not offer a reset link that cannot be sent — it says who can help', async () => {
    emailEnabled = false;
    renderPage();
    expect(await screen.findByText(/forgot your password\? ask your administrator to reset it/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /forgot password/i })).not.toBeInTheDocument();
  });

  it('still offers "Forgot password?" when the server could not say (the reset page explains if it cannot help)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/config') ? json({ error: { code: 'INTERNAL', message: 'x' } }, 500) : json({ data: {} }))));
    renderPage();
    expect((await screen.findAllByRole('link', { name: /forgot password/i })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: /email code/i })).not.toBeInTheDocument();
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

  describe('signing in with an emailed code', () => {
    const session = { user: { id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['EMPLOYEE'], avatarUrl: null }, accessToken: 'at', refreshToken: 'rt' };
    beforeEach(() => {
      otpRequest = () => json({ data: { sent: true } });
      otpVerify = (b) => (b.code === '482913' ? json({ data: session }) : json({ error: { code: 'INVALID_OTP', message: 'Invalid or unknown code.' } }, 401));
    });

    async function askForCode() {
      renderPage();
      await userEvent.click(await screen.findByRole('tab', { name: /email code/i }));
      await userEvent.type(screen.getByLabelText(/email or username/i), 'ada@mico360.test');
      await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
      await screen.findByLabelText(/one-time code/i);
    }

    it('asks for a code, then signs in with it', async () => {
      await askForCode();
      expect(sent).toContainEqual({ url: expect.stringContaining('/auth/otp/request'), body: { identifier: 'ada@mico360.test' } });
      expect(screen.getByRole('status')).toHaveTextContent('If that account exists, we’ve emailed it a one-time code. Check your inbox — and your spam folder.');
      await userEvent.type(screen.getByLabelText(/one-time code/i), '482913');
      await userEvent.click(screen.getByRole('button', { name: /verify & sign in/i }));
      await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
      expect(sent).toContainEqual({ url: expect.stringContaining('/auth/otp/verify'), body: { identifier: 'ada@mico360.test', code: '482913' } });
    });

    it('says why a wrong code was refused and keeps the code step open', async () => {
      await askForCode();
      await userEvent.type(screen.getByLabelText(/one-time code/i), '111111');
      await userEvent.click(screen.getByRole('button', { name: /verify & sign in/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or unknown code.');
      expect(screen.getByLabelText(/one-time code/i)).toBeInTheDocument();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('"Use a different email" goes back to the first step with the address editable', async () => {
      await askForCode();
      await userEvent.click(screen.getByRole('button', { name: /use a different email/i }));
      expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/one-time code/i)).not.toBeInTheDocument();
      const address = screen.getByLabelText(/email or username/i);
      expect(address).not.toHaveAttribute('readonly');
      expect(address).toHaveFocus();
    });
  });

  it('loads the logos it shows right away (nothing above the fold is lazy)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: /welcome back/i });
    expect(document.querySelector('img[loading="lazy"]')).toBeNull();
  });
});
