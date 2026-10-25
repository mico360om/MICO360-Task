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
/** The server's public config (whether email is set up). */
let config: Record<string, unknown>;
beforeEach(() => {
  posted = null;
  config = { timeZone: 'Asia/Muscat', emailEnabled: true };
  answer = () => json({ data: { id: 'u9' } }, 201);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted = JSON.parse(String(init.body));
      return answer();
    }
    if (String(url).endsWith('/config')) return json({ data: config });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderModal(onClose = vi.fn(), onCreated = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CreateUserModal onClose={onClose} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function fill(password: string) {
  await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
  await userEvent.type(screen.getByLabelText(/last name/i), 'K');
  await userEvent.type(screen.getByLabelText(/username/i), 'sara');
  await userEvent.type(screen.getByLabelText(/^email/i), 'sara@x.test');
  if (password) await userEvent.type(screen.getByLabelText(/temp password/i), password);
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

describe('CreateUserModal — "Send a welcome email"', () => {
  it('is on by default, and the temporary password is then optional', async () => {
    renderModal();
    const box = await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    expect(box).toBeChecked();
    expect(screen.getByText('They get their username and a link to set their own password (it works for 7 days).')).toBeInTheDocument();
    expect(screen.getByLabelText(/temp password/i)).not.toBeRequired();
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    await fill('');
    await waitFor(() => expect(posted).toEqual({ firstName: 'Sara', lastName: 'K', username: 'sara', email: 'sara@x.test', roleNames: ['EMPLOYEE'], sendWelcome: true }));
  });

  it('a password given with it still has to meet the rule, and is sent along', async () => {
    renderModal();
    await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    await fill('abcdef');
    expect(screen.getByRole('alert')).toHaveTextContent('Use at least 8 characters, including a letter and a number.');
    expect(posted).toBeNull();
    await userEvent.clear(screen.getByLabelText(/temp password/i));
    await userEvent.type(screen.getByLabelText(/temp password/i), 'Welcome123');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    await waitFor(() => expect(posted).toMatchObject({ password: 'Welcome123', sendWelcome: true }));
  });

  it('turned off, today’s rule stays: a temporary password is required', async () => {
    renderModal();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Send a welcome email' }));
    expect(screen.getByLabelText(/temp password/i)).toBeRequired();
    await fill('');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a temporary password, or turn on “Send a welcome email” so they can set their own.');
    expect(posted).toBeNull();
    await userEvent.type(screen.getByLabelText(/temp password/i), 'Welcome123');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    await waitFor(() => expect(posted).toMatchObject({ password: 'Welcome123', sendWelcome: false }));
  });

  it('when email isn’t set up, it is off, can’t be turned on, and says why', async () => {
    config = { timeZone: 'Asia/Muscat', emailEnabled: false };
    renderModal();
    const box = await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    await waitFor(() => expect(box).toBeDisabled());
    expect(box).not.toBeChecked();
    expect(screen.getByText('Email isn’t set up on this server, so a welcome email can’t be sent. Give them a temporary password instead.')).toBeInTheDocument();
    expect(screen.getByLabelText(/temp password/i)).toBeRequired();
  });

  it('tells the page whether the welcome email went', async () => {
    answer = () => json({ data: { id: 'u9', username: 'sara' }, meta: { welcome: { userId: 'u9', username: 'sara', email: 'sara@x.test', sent: true } } }, 201);
    const onCreated = vi.fn();
    renderModal(vi.fn(), onCreated);
    await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    await fill('');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ user: { id: 'u9', username: 'sara' }, welcome: { userId: 'u9', username: 'sara', email: 'sara@x.test', sent: true } }));
  });

  it('says plainly when the server can’t send it because email isn’t set up', async () => {
    answer = () => json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email isn’t set up on this server yet, so no welcome email can be sent. An administrator needs to add the email (Mailjet) keys.' } }, 503);
    const onClose = renderModal();
    await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    await fill('');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email isn’t set up on this server, so the welcome email can’t be sent and the account wasn’t created. Turn off “Send a welcome email” and give them a temporary password.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
