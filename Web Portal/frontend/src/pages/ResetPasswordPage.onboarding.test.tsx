import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { ResetPasswordPage } from './ResetPasswordPage';

/**
 * Onboarding: the set-password page asks what its link is before a password is typed — an expired or
 * replaced invitation says "This invitation has expired — ask <company> to send a new one".
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
let status: unknown;
let asked: { url: string; body: unknown }[];
beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return json({ data: status });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
/** A paragraph by its whole text (a name inside it is its own <bdi>). */
const para = (text: string) => screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );

describe('What the link is, before a password is typed', () => {
  it('an expired (or replaced) invitation: “This invitation has expired — ask <company> to send a new one”, no form', async () => {
    status = { kind: 'welcome', state: 'expired', company: 'Prolens Projects LLC' };
    renderAt('/reset?token=abc&welcome=1');
    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeInTheDocument();
    expect(para('This invitation has expired — ask Prolens Projects LLC to send a new one.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    // The token went in the body, never an address.
    expect(asked[0]).toEqual({ url: expect.stringMatching(/\/auth\/password\/link-status$/), body: { token: 'abc' } });
  });

  it('no company known: ask your administrator', async () => {
    status = { kind: 'welcome', state: 'expired', company: null };
    renderAt('/reset?token=abc&welcome=1');
    await screen.findByRole('heading', { name: 'This invitation has expired' });
    expect(para('This invitation has expired — ask your administrator to send a new one.')).toBeInTheDocument();
  });

  it('an invitation already used: the account is ready, sign in (or reset a forgotten password)', async () => {
    status = { kind: 'welcome', state: 'used', company: 'Prolens Projects LLC' };
    renderAt('/reset?token=abc&welcome=1');
    expect(await screen.findByRole('heading', { name: 'Your account is ready' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot');
  });

  it('an expired reset link: request a new one', async () => {
    status = { kind: 'reset', state: 'expired', company: null };
    renderAt('/reset?token=abc');
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/forgot');
  });

  it('a live link (or a server that can’t say): the form, as before', async () => {
    status = { kind: 'welcome', state: 'live', company: 'Prolens Projects LLC' };
    renderAt('/reset?token=abc&welcome=1');
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
  });
});
