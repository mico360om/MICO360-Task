import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordPage } from './ResetPasswordPage';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
let answer: () => Response;
beforeEach(() => {
  answer = () => json({ data: {} });
  vi.stubGlobal('fetch', vi.fn(async () => answer()));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

describe('ResetPasswordPage', () => {
  it('a link that has expired is not a dead end: it offers a new one', async () => {
    answer = () => json({ error: { code: 'INVALID_TOKEN', message: 'This reset link is invalid or has expired. Request a new one.' } }, 400);
    renderAt('/reset?token=stale');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'NewPass456');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'NewPass456');
    await userEvent.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
    expect(screen.getByRole('link', { name: /request a new reset link/i })).toHaveAttribute('href', '/forgot');
  });

  it('does not offer a new link for a problem with what was typed', async () => {
    renderAt('/reset?token=ok');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'NewPass456');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'Different789');
    await userEvent.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/don’t match/i);
    expect(screen.queryByRole('link', { name: /request a new reset link/i })).not.toBeInTheDocument();
  });
});

describe('ResetPasswordPage for a welcome email’s link (?welcome=1)', () => {
  it('says “Set your password”, not reset', () => {
    renderAt('/reset?token=t1&welcome=1');
    expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
    expect(screen.getByText('Welcome to MICO360 Tasks. Choose a password to finish setting up your account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeInTheDocument();
    expect(screen.queryByText(/reset/i)).not.toBeInTheDocument();
  });

  it('once set: “Password set”, and how to sign in', async () => {
    renderAt('/reset?token=t1&welcome=1');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'NewPass456');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'NewPass456');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('heading', { name: 'Password set' })).toBeInTheDocument();
    expect(screen.getByText('Your password is set. Sign in with your username or email address and your new password.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('an expired or used welcome link: says so in welcome words, and offers a password reset link', async () => {
    answer = () => json({ error: { code: 'INVALID_RESET_TOKEN', message: 'This reset link is invalid or has expired. Request a new one.' } }, 400);
    renderAt('/reset?token=stale&welcome=1');
    await userEvent.type(screen.getByLabelText(/^new password/i), 'NewPass456');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'NewPass456');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This welcome link has expired or has already been used. Ask your administrator to send a new one, or get a password reset link.',
    );
    expect(screen.getByRole('link', { name: 'Get a password reset link' })).toHaveAttribute('href', '/forgot');
  });

  it('a welcome link missing its token', () => {
    renderAt('/reset?welcome=1');
    expect(screen.getByRole('heading', { name: 'Invalid link' })).toBeInTheDocument();
    expect(screen.getByText('This link is missing its token. Ask your administrator to send a new welcome email, or get a password reset link.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get a password reset link' })).toHaveAttribute('href', '/forgot');
  });

  it('names the browser tab “Set your password”', () => {
    renderAt('/reset?token=t1&welcome=1');
    expect(document.title).toMatch(/^Set your password/);
  });
});
