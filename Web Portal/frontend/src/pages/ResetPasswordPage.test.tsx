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
