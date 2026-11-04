import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateUserModal } from './CreateUserModal';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';
import { apiCompany, companyServer } from '../test/company-server';
import { windowWidth } from '../test/window-width';

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

  it('gives the welcome choice a finger-sized target, and on a phone the password and role a row each', async () => {
    renderModal();
    await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    expect(screen.getByText('Send a welcome email').className).toMatch(/(^|\s)tap(\s|$)/);
    const row = screen.getByLabelText(/temp password/i).closest('.grid')!;
    expect(row).toContainElement(screen.getByLabelText('Role'));
    expect(row.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/);
    expect(row.className).toMatch(/sm:grid-cols-2/);
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

  it('when email isn’t set up and no password is given, the advice doesn’t point at the option it can’t use', async () => {
    config = { timeZone: 'Asia/Muscat', emailEnabled: false };
    renderModal();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Send a welcome email' })).toBeDisabled());
    await fill('');
    expect(screen.getByRole('alert')).toHaveTextContent(/^Email isn’t set up on this server, so a welcome email can’t be sent\. Give them a temporary password\.$/);
    expect(posted).toBeNull();
  });

  it('tells the page whether the welcome email went', async () => {
    answer = () => json({ data: { id: 'u9', username: 'sara' }, meta: { welcome: { userId: 'u9', username: 'sara', email: 'sara@x.test', sent: true } } }, 201);
    const onCreated = vi.fn();
    renderModal(vi.fn(), onCreated);
    await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    await fill('');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ user: { id: 'u9', username: 'sara' }, welcome: { userId: 'u9', username: 'sara', email: 'sara@x.test', sent: true } }));
  });

  it('says plainly when the server can’t send it because email isn’t set up, and the option then shows as unavailable', async () => {
    answer = () => {
      config = { timeZone: 'Asia/Muscat', emailEnabled: false }; // what the server says when the page asks again
      return json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email isn’t set up on this server yet, so no welcome email can be sent. An administrator needs to add the email (Mailjet) keys.' } }, 503);
    };
    const onClose = renderModal();
    await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    await fill('');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Email isn’t set up on this server, so the welcome email can’t be sent and the account wasn’t created\. Give them a temporary password\.$/,
    );
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Send a welcome email' })).toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CreateUserModal: companies', () => {
  const alpha = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA' });
  const beta = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA' });
  const gone = apiCompany({ id: 'cg', name: 'Gamma Co', code: 'GAMMA', status: 'ARCHIVED', archivedAt: '2026-10-30T08:00:00.000Z' });
  beforeEach(() => {
    useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    useCompanyStore.setState({ pick: null, userId: 'me' });
  });
  afterEach(() => {
    useAuthStore.getState().logout();
    useCompanyStore.setState({ pick: null, userId: null });
  });
  const basics = async () => {
    await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
    await userEvent.type(screen.getByLabelText(/last name/i), 'K');
    await userEvent.type(screen.getByLabelText(/username/i), 'sara');
    await userEvent.type(screen.getByLabelText(/^email/i), 'sara@x.test');
  };
  const create = () => userEvent.click(screen.getByRole('button', { name: /create user/i }));

  it('one company: no company fields, and the new account goes to the site’s company as before', async () => {
    const server = companyServer({ companies: [alpha] });
    renderModal();
    await waitFor(() => expect(server.gets('/me/companies')).toHaveLength(1));
    await screen.findByRole('checkbox', { name: 'Send a welcome email' });
    expect(screen.queryByText('Companies')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Primary company' })).toBeNull();
    await basics();
    await create();
    await waitFor(() => expect(server.requests('POST', '/users')).toHaveLength(1));
    const body = server.lastBody('POST', '/users') as Record<string, unknown>;
    expect(body).not.toHaveProperty('companyIds');
    expect(body).not.toHaveProperty('primaryCompanyId');
  });

  it('two companies: a new person gets companies and a primary one', async () => {
    const server = companyServer({ companies: [alpha, beta, gone] });
    renderModal();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Beta Co' }));
    const primary = screen.getByRole('combobox', { name: 'Primary company' });
    expect(primary).toHaveValue('cb');
    expect(primary).toHaveAccessibleDescription('Used for their emails: logo and name');
    expect(primary.className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alpha Co' }));
    expect(primary).toHaveValue('cb');
    expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label') ?? c.closest('label')?.textContent)).not.toContain('Gamma Co');
    await basics();
    await create();
    await waitFor(() => expect(server.requests('POST', '/users')).toHaveLength(1));
    expect(server.lastBody('POST', '/users')).toMatchObject({ companyIds: ['cb', 'ca'], primaryCompanyId: 'cb' });
  });

  it('starts with the picked company ticked', async () => {
    useCompanyStore.setState({ pick: 'cb' });
    companyServer({ companies: [alpha, beta] });
    renderModal();
    expect(await screen.findByRole('checkbox', { name: 'Beta Co' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Alpha Co' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Primary company' })).toHaveValue('cb');
  });

  it('unticking the primary company makes another one primary; none ticked, no primary', async () => {
    companyServer({ companies: [alpha, beta] });
    renderModal();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha Co' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Beta Co' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Primary company' }), 'cb');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Beta Co' }));
    expect(screen.getByRole('combobox', { name: 'Primary company' })).toHaveValue('ca');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alpha Co' }));
    expect(screen.queryByRole('combobox', { name: 'Primary company' })).toBeNull();
  });

  it('an employee needs a company (the server’s words); an administrator may have none', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    renderModal();
    await screen.findByRole('checkbox', { name: 'Alpha Co' });
    await basics();
    await userEvent.type(screen.getByLabelText(/temp password/i), 'Secret123');
    await create();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one company.');
    expect(server.requests('POST', '/users')).toHaveLength(0);
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'ADMIN');
    await create();
    await waitFor(() => expect(server.requests('POST', '/users')).toHaveLength(1));
    expect(server.lastBody('POST', '/users')).toMatchObject({ roleNames: ['ADMIN'], companyIds: [], primaryCompanyId: null });
  });

  it('a refused company shows the server’s words', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    server.refuseNext(400, 'VALIDATION', 'Company not found.', { method: 'POST', path: /^\/users$/ });
    renderModal();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Alpha Co' }));
    await basics();
    await userEvent.type(screen.getByLabelText(/temp password/i), 'Secret123');
    await create();
    expect(await screen.findByRole('alert')).toHaveTextContent('Company not found.');
  });
});

describe('CreateUserModal: a big form (1.22)', () => {
  const alpha = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA' });
  const beta = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA' });
  beforeEach(() => {
    useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    useCompanyStore.setState({ pick: null, userId: 'me' });
  });
  afterEach(() => {
    useAuthStore.getState().logout();
    useCompanyStore.setState({ pick: null, userId: null });
  });

  it('with companies: 960px from 1024px, the person on the left and their companies on the right', async () => {
    windowWidth(1280);
    companyServer({ companies: [alpha, beta] });
    renderModal();
    const companies = await screen.findByRole('group', { name: 'Companies' });
    const dialog = screen.getByRole('dialog', { name: 'New user' });
    expect(dialog.className).toMatch(/lg:max-w-\[60rem\]/);
    const person = dialog.querySelector<HTMLElement>('[data-form-column="person"]')!;
    const access = dialog.querySelector<HTMLElement>('[data-form-column="companies"]')!;
    expect(person.parentElement!.className).toMatch(/grid-cols-/);
    for (const field of [/first name/i, /last name/i, /username/i, /^email/i, /temp password/i]) expect(person).toContainElement(screen.getByLabelText(field));
    expect(person).toContainElement(screen.getByLabelText('Role'));
    expect(access).toContainElement(companies);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Beta Co' }));
    expect(access).toContainElement(screen.getByRole('combobox', { name: 'Primary company' }));
  });

  it('below 1024px: one column, the companies under the role', async () => {
    windowWidth(900);
    companyServer({ companies: [alpha, beta] });
    renderModal();
    const companies = await screen.findByRole('group', { name: 'Companies' });
    expect(screen.getByRole('dialog', { name: 'New user' }).querySelector('[data-form-column]')).toBeNull();
    expect(screen.getByLabelText('Role').compareDocumentPosition(companies) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('one company: a normal form (720px), one column', async () => {
    windowWidth(1280);
    const server = companyServer({ companies: [alpha] });
    renderModal();
    await waitFor(() => expect(server.gets('/me/companies')).toHaveLength(1));
    const dialog = screen.getByRole('dialog', { name: 'New user' });
    expect(dialog.className).toMatch(/sm:max-w-\[45rem\]/);
    expect(dialog.className).not.toMatch(/lg:max-w-\[60rem\]/);
    expect(dialog.querySelector('[data-form-column]')).toBeNull();
  });
});
