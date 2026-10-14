import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateUserModal } from './CreateUserModal';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let posted: Record<string, unknown> | null = null;
/** What the server answers to the create request (default: created). */
let answer: () => Response;
beforeEach(() => {
  posted = null;
  answer = () => json({ data: { id: 'u9' } }, 201);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted = JSON.parse(String(init.body));
      return answer();
    }
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CreateUserModal onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function fill(password: string) {
  await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
  await userEvent.type(screen.getByLabelText(/last name/i), 'K');
  await userEvent.type(screen.getByLabelText(/username/i), 'sara');
  await userEvent.type(screen.getByLabelText(/email/i), 'sara@x.test');
  await userEvent.type(screen.getByLabelText(/temp password/i), password);
  await userEvent.click(screen.getByRole('button', { name: /create user/i }));
}

describe('CreateUserModal', () => {
  it('shows the shared password rule under the temp-password field', () => {
    renderModal();
    expect(screen.getByText('At least 8 characters, with a letter and a number.')).toBeInTheDocument();
  });

  it('rejects a weak password with the shared rule (no request sent)', async () => {
    renderModal();
    await fill('abcdef'); // 6 chars, no digit — the old rule accepted this
    // Every field IS filled in: name the real problem only.
    expect(screen.getByRole('alert')).toHaveTextContent(/^Use at least 8 characters, including a letter and a number.$/);
    expect(posted).toBeNull();
  });

  it('asks for the missing details when a field is empty', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('Fill in every field.');
    expect(posted).toBeNull();
  });

  it('says the email is not valid when the server refuses it — not that it is "already in use"', async () => {
    answer = () => json({ error: { code: 'VALIDATION', message: 'Invalid input.', details: { formErrors: [], fieldErrors: { email: ['Invalid email'] } } } }, 400);
    const onClose = renderModal();
    await fill('Welcome123');
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a valid email address/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/in use/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says the email or username is taken when it is', async () => {
    answer = () => json({ error: { code: 'DUPLICATE_USER', message: 'A user with this email or username already exists.' } }, 409);
    renderModal();
    await fill('Welcome123');
    expect(await screen.findByRole('alert')).toHaveTextContent(/email or username is already in use/i);
  });

  it('does not blame the details when the server itself failed', async () => {
    answer = () => json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, 500);
    renderModal();
    await fill('Welcome123');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn’t create the account/i);
    expect(alert).not.toHaveTextContent(/in use/i);
  });

  it('creates the user with a strong password', async () => {
    const onClose = renderModal();
    await fill('Welcome123');
    await waitFor(() => expect(posted).toMatchObject({ username: 'sara', password: 'Welcome123' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
