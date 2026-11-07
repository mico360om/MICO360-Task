import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '../stores/auth-store';

/**
 * Onboarding: an account whose email address isn't confirmed enters the 6-digit code we email before
 * it gets a session — "Check your email — enter the 6-digit code we sent to a•••@oxy.com".
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'ahmed@oxy.com', username: 'ahmed', roles: ['CLIENT'] }, accessToken: 'at', refreshToken: 'rt' };
const challenge = (o: Record<string, unknown> = {}) => ({
  token: 'secret-challenge-token',
  kind: 'VERIFY_EMAIL',
  sentTo: 'a•••@oxy.com',
  codeSent: true,
  resendAt: new Date(Date.now() + 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  ...o,
});

let sent: { url: string; body: Record<string, unknown> | null }[];
let loginAnswer: () => Response;
let verifyAnswer: (body: Record<string, unknown>) => Response;
let resendAnswer: () => Response;

beforeEach(() => {
  sent = [];
  loginAnswer = () => json({ data: { challenge: challenge() } });
  verifyAnswer = () => json({ data: SESSION });
  resendAnswer = () => json({ data: { codeSent: true, resendAt: new Date(Date.now() + 60_000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() } });
  useAuthStore.getState().logout('remote');
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      if (init?.method === 'POST') sent.push({ url: u, body });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '', emailEnabled: true, androidAppUrl: null } });
      if (u.endsWith('/auth/login')) return loginAnswer();
      if (u.endsWith('/auth/challenge/verify')) return verifyAnswer(body ?? {});
      if (u.endsWith('/auth/challenge/resend')) return resendAnswer();
      return json({ data: {} });
    }),
  );
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
async function signIn(keep = true) {
  await userEvent.type(screen.getByLabelText(/email or username/i), 'ahmed');
  await userEvent.type(screen.getByLabelText(/^password/i), 'Secret123');
  if (!keep) await userEvent.click(screen.getByRole('checkbox', { name: /keep me signed in/i }));
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}
const codeBox = () => screen.getByLabelText(/^6-digit code/);

describe('Sign-in: “Check your email” (a code before the first session)', () => {
  it('the website says it can take the code step; the answer is the step, not a session', async () => {
    renderPage();
    await signIn();
    expect(sent.find((s) => s.url.endsWith('/auth/login'))!.body).toMatchObject({ identifier: 'ahmed', password: 'Secret123', acceptChallenge: true });
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && /^Enter the 6-digit code we sent to a•••@oxy\.com to confirm it’s your email address\.$/.test(el.textContent ?? ''))).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    await waitFor(() => expect(codeBox()).toHaveFocus());
    expect(codeBox()).toHaveAttribute('autocomplete', 'one-time-code');
    expect(codeBox()).toHaveAttribute('inputmode', 'numeric');
  });

  it('the code signs them in (keeping “Keep me signed in” as chosen); the token is never stored or in the address', async () => {
    renderPage();
    await signIn(false);
    await userEvent.type(await screen.findByLabelText(/^6-digit code/), '042917');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(sent.find((s) => s.url.endsWith('/auth/challenge/verify'))!.body).toEqual({ challenge: 'secret-challenge-token', code: '042917', acceptPasswordChange: true });
    expect(sessionStorage.getItem('mico360.refreshToken')).toBe('rt');
    expect(localStorage.getItem('mico360.refreshToken')).toBeNull();
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + window.location.href;
    expect(stored).not.toContain('secret-challenge-token');
  });

  it('an empty or short code is caught before anything is sent', async () => {
    renderPage();
    await signIn();
    await screen.findByLabelText(/^6-digit code/);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    expect(await screen.findByText('Enter the 6-digit code from the email.')).toBeInTheDocument();
    await userEvent.type(codeBox(), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    expect(sent.some((s) => s.url.endsWith('/auth/challenge/verify'))).toBe(false);
  });

  it('a wrong code says so and keeps the step, with what was typed selected', async () => {
    verifyAnswer = () => json({ error: { code: 'WRONG_CODE', message: 'That code isn’t right. Check the newest email we sent and try again.' } }, 401);
    renderPage();
    await signIn();
    await userEvent.type(await screen.findByLabelText(/^6-digit code/), '111111');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code isn’t right.');
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(codeBox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('an expired step goes back to the password, saying why', async () => {
    verifyAnswer = () => json({ error: { code: 'SIGN_IN_EXPIRED', message: 'This sign-in has expired. Sign in again to get a new code.' } }, 401);
    renderPage();
    await signIn();
    await userEvent.type(await screen.findByLabelText(/^6-digit code/), '111111');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    expect(await screen.findByText('This sign-in has expired. Sign in again to get a new code.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });

  it('“Resend code” waits out the minute, then sends another and says the earlier one stops', async () => {
    loginAnswer = () => json({ data: { challenge: challenge({ resendAt: new Date(Date.now() - 1000).toISOString() }) } });
    renderPage();
    await signIn();
    await screen.findByLabelText(/^6-digit code/);
    await userEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    expect(sent.find((s) => s.url.endsWith('/auth/challenge/resend'))!.body).toEqual({ challenge: 'secret-challenge-token' });
    expect(await screen.findByText('We’ve sent a new code. Use the newest one — the earlier code no longer works.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend code in/ })).toBeDisabled();
  });

  it('signing in again with the step still open: the code already sent still works (no second email)', async () => {
    loginAnswer = () => json({ data: { challenge: challenge({ codeSent: false }) } });
    renderPage();
    await signIn();
    expect(await screen.findByText(/We emailed you a code a moment ago — use that one\./)).toBeInTheDocument();
  });

  it('“Sign in with a different account” goes back to the first step', async () => {
    renderPage();
    await signIn();
    await screen.findByLabelText(/^6-digit code/);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a different account' }));
    expect(screen.getByLabelText(/email or username/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull();
  });

  it('a confirmed account signs in straight away, as before', async () => {
    loginAnswer = () => json({ data: SESSION });
    renderPage();
    await signIn();
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull();
  });
});
