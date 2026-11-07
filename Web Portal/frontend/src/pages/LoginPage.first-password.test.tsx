import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '../stores/auth-store';

/**
 * 1.23.6: a temporary password signs in only as far as "Choose your own password" — the rules, typed
 * twice, not the temporary one — and then the session, as a sign-in gives.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const SESSION = { user: { id: 'u1', email: 'sara@x.co', username: 'sara', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' };
const STEP = { changePassword: { ticket: 'step-ticket', expiresAt: new Date(Date.now() + 900_000).toISOString() } };

let sent: { url: string; body: Record<string, unknown> | null }[];
let loginAnswer: () => Response;
let changeAnswer: (body: Record<string, unknown>) => Response;

beforeEach(() => {
  sent = [];
  loginAnswer = () => json({ data: STEP });
  changeAnswer = () => json({ data: SESSION });
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
      if (u.endsWith('/auth/password/first-change')) return changeAnswer(body ?? {});
      return json({ data: {} });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function signIn() {
  await userEvent.type(screen.getByLabelText(/email or username/i), 'sara');
  await userEvent.type(screen.getByLabelText(/^password/i), 'Kite-Mango-Fern-Ripple-472');
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('Sign-in: “Choose your own password” after a temporary one', () => {
  it('the page says it can take the step; the step asks for a new password twice and then signs in', async () => {
    renderPage();
    await signIn();
    expect(sent[0]!.body).toMatchObject({ identifier: 'sara', acceptChallenge: true, acceptPasswordChange: true });
    expect(await screen.findByRole('heading', { name: 'Choose your own password' })).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    const box = screen.getByLabelText(/^new password/i);
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('autocomplete', 'new-password');
    expect(box).toHaveAccessibleDescription(/Not the temporary one/);
    await userEvent.type(box, 'MyOwnPass99');
    await userEvent.type(screen.getByLabelText(/^type it again/i), 'MyOwnPass99');
    await userEvent.click(screen.getByRole('button', { name: 'Set my password and sign in' }));
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(sent.find((s) => s.url.endsWith('/auth/password/first-change'))!.body).toEqual({ ticket: 'step-ticket', password: 'MyOwnPass99' });
    expect(window.location.href).not.toContain('step-ticket');
    expect(JSON.stringify(localStorage)).not.toContain('step-ticket');
    expect(JSON.stringify(sessionStorage)).not.toContain('step-ticket');
  });

  it('the rules and the match are checked first (nothing sent); the server’s “not the temporary one” is said on the field', async () => {
    changeAnswer = () => json({ error: { code: 'SAME_AS_TEMPORARY', message: 'Choose a new password — not the temporary one.' } }, 400);
    renderPage();
    await signIn();
    const box = await screen.findByLabelText(/^new password/i);
    await userEvent.type(box, 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Set my password and sign in' }));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(sent.filter((s) => s.url.endsWith('/first-change'))).toHaveLength(0);
    await userEvent.clear(box);
    await userEvent.type(box, 'MyOwnPass99');
    await userEvent.type(screen.getByLabelText(/^type it again/i), 'MyOwnPass98');
    await userEvent.click(screen.getByRole('button', { name: 'Set my password and sign in' }));
    expect(screen.getByText('The two passwords don’t match.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/^type it again/i));
    await userEvent.type(screen.getByLabelText(/^type it again/i), 'MyOwnPass99');
    await userEvent.click(screen.getByRole('button', { name: 'Set my password and sign in' }));
    expect(await screen.findByText('Choose a new password — not the temporary one.')).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('a step that ran out goes back to the password with the reason', async () => {
    changeAnswer = () => json({ error: { code: 'PASSWORD_CHANGE_EXPIRED', message: 'This step has expired. Sign in again with your temporary password.' } }, 400);
    renderPage();
    await signIn();
    await userEvent.type(await screen.findByLabelText(/^new password/i), 'MyOwnPass99');
    await userEvent.type(screen.getByLabelText(/^type it again/i), 'MyOwnPass99');
    await userEvent.click(screen.getByRole('button', { name: 'Set my password and sign in' }));
    expect(await screen.findByText('This step has expired. Sign in again with your temporary password.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('an expired temporary password is said plainly at sign-in', async () => {
    loginAnswer = () => json({ error: { code: 'TEMPORARY_PASSWORD_EXPIRED', message: 'This temporary password has expired. Ask your administrator for a new one.' } }, 403);
    renderPage();
    await signIn();
    expect(await screen.findByText('This temporary password has expired. Ask your administrator for a new one.')).toBeInTheDocument();
  });
});
