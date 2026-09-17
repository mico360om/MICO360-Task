import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('ForgotPasswordPage', () => {
  it('submits the identifier to the forgot endpoint and shows a confirmation', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(json({ data: { sent: true } })));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/email or username/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByText(/check your email/i)).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/password/forgot'))).toBe(true);
  });
});

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(json({ data: { reset: true } }))));
  });

  function renderAt(url: string) {
    return render(<MemoryRouter initialEntries={[url]}><ResetPasswordPage /></MemoryRouter>);
  }

  it('shows an invalid-link message when no token is present', () => {
    renderAt('/reset');
    expect(screen.getByText(/invalid reset link/i)).toBeInTheDocument();
  });

  it('submits the token + new password and confirms success', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(json({ data: { reset: true } })));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/reset?token=tok123');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'NewPass123');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'NewPass123');
    await userEvent.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => expect(screen.getByText(/password updated/i)).toBeInTheDocument());
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/auth/password/reset'));
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1]!.body as string)).toEqual({ token: 'tok123', password: 'NewPass123' });
  });

  it('blocks mismatched passwords without calling the API', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(json({ data: { reset: true } })));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/reset?token=tok123');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'NewPass123');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'Different123');
    await userEvent.click(screen.getByRole('button', { name: /update password/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/don.t match/i);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/auth/password/reset'))).toBe(false);
  });
});
