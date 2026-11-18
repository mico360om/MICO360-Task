import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '../stores/auth-store';

/**
 * 1.24 two-step sign-in for administrators: after the right password, the 6-digit code we email, with
 * "Trust this browser for 30 days" (on by default) — the trust cookie travels with the sign-in calls.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'ahmed@acme.com', username: 'ahmed', roles: ['CLIENT'] }, accessToken: 'at', refreshToken: 'rt' };
const challenge = (o: Record<string, unknown> = {}) => ({
  token: 'secret-challenge-token',
  kind: 'VERIFY_EMAIL',
  sentTo: 'a•••@acme.com',
  codeSent: true,
  resendAt: new Date(Date.now() + 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  ...o,
});

let sent: { url: string; body: Record<string, unknown> | null; credentials?: RequestCredentials }[];
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
      if (init?.method === 'POST') sent.push({ url: u, body, credentials: init?.credentials });
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '', emailEnabled: true, androidAppUrl: null } });
      if (u.endsWith('/auth/login')) return loginAnswer();
      if (u.endsWith('/auth/challenge/verify')) return verifyAnswer(body ?? {});
      if (u.endsWith('/auth/challenge/resend')) return resendAnswer();
      if (u.endsWith('/auth/password/first-change')) return json({ data: SESSION });
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

describe('Sign-in: an administrator’s two-step code (1.24)', () => {
  const twoStep = (o: Record<string, unknown> = {}) => challenge({ kind: 'TWO_STEP', trustOffered: true, ...o });

  it('says the code finishes signing in, and offers “Trust this browser for 30 days”, ticked', async () => {
    loginAnswer = () => json({ data: { challenge: twoStep() } });
    renderPage();
    await signIn();
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/to finish signing in/)).toBeInTheDocument();
    expect(screen.queryByText(/confirm it’s your email address/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Trust this browser for 30 days/ })).toBeChecked();
    // The trust cookie (httpOnly) is sent and kept: the sign-in calls carry credentials.
    expect(sent.find((s) => s.url.endsWith('/auth/login'))!.credentials).toBe('include');
  });

  it('the code goes with the choice (ticked by default); then signed in', async () => {
    loginAnswer = () => json({ data: { challenge: twoStep() } });
    renderPage();
    await signIn();
    await userEvent.type(codeBox(), '042917');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    const verify = sent.find((s) => s.url.endsWith('/auth/challenge/verify'))!;
    expect(verify.body).toMatchObject({ challenge: 'secret-challenge-token', code: '042917', trustBrowser: true });
    expect(verify.credentials).toBe('include');
  });

  it('unticked: trustBrowser false', async () => {
    loginAnswer = () => json({ data: { challenge: twoStep() } });
    renderPage();
    await signIn();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Trust this browser for 30 days/ }));
    await userEvent.type(codeBox(), '042917');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(sent.find((s) => s.url.endsWith('/auth/challenge/verify'))!.body).toMatchObject({ trustBrowser: false });
  });

  it('an employee’s email confirmation shows no tick-box', async () => {
    renderPage();
    await signIn();
    await screen.findByLabelText(/^6-digit code/);
    expect(screen.queryByRole('checkbox', { name: /Trust this browser/ })).toBeNull();
  });

  it('a temporary password after the code: the trust choice goes with the new password', async () => {
    loginAnswer = () => json({ data: { challenge: twoStep() } });
    verifyAnswer = () => json({ data: { changePassword: { ticket: 'tkt', expiresAt: new Date(Date.now() + 900_000).toISOString() } } });
    renderPage();
    await signIn();
    await userEvent.type(codeBox(), '042917');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));
    await screen.findByRole('heading', { name: 'Choose your own password' });
    await userEvent.type(screen.getByLabelText(/^new password/i), 'MyOwnPass99');
    await userEvent.type(screen.getByLabelText(/^type it again/i), 'MyOwnPass99');
    await userEvent.click(screen.getByRole('button', { name: 'Set my password and sign in' }));
    await waitFor(() => expect(sent.some((s) => s.url.endsWith('/auth/password/first-change'))).toBe(true));
    const change = sent.find((s) => s.url.endsWith('/auth/password/first-change'))!;
    expect(change.body).toMatchObject({ ticket: 'tkt', trustBrowser: true });
    expect(change.credentials).toBe('include');
  });
});
