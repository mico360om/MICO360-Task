import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateUserModal } from './CreateUserModal';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';
import { apiCompany, companyServer } from '../test/company-server';
import { windowWidth } from '../test/window-width';
import { clientServer } from './clients/test-server';
import type { ClientPreviewDialogProps } from './portal/ClientPreviewDialog';

// 1.23.7 The portal lane builds the real preview: here, only what it is asked to show.
const preview = vi.hoisted(() => ({ spec: null as unknown }));
vi.mock('./portal/ClientPreviewDialog', () => ({
  ClientPreviewDialog: ({ spec, onClose }: ClientPreviewDialogProps) => {
    preview.spec = spec;
    return (
      <div role="dialog" aria-label="Preview as client">
        <button type="button" onClick={onClose}>
          Close preview
        </button>
      </div>
    );
  },
}));

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
    // Onboarding: the duplicate check while typing finds no one here.
    if (String(url).endsWith('/users/identity-check')) return json({ data: { email: null, username: null, sameName: [] } });
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

async function fill() {
  await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
  await userEvent.type(screen.getByLabelText(/last name/i), 'K');
  await userEvent.type(screen.getByLabelText(/username/i), 'sara');
  await userEvent.type(screen.getByRole('textbox', { name: /^email/i }), 'sara@x.test');
  await userEvent.click(screen.getByRole('button', { name: /create user/i }));
}
const linkChoice = () => screen.findByRole('radio', { name: /email an invitation link/i });
const temporaryChoice = () => screen.getByRole('radio', { name: 'Give them a temporary password yourself' });

describe('CreateUserModal', () => {
  it('1.23.6: no password box — one way in, an invitation link (the default) or a temporary password made for them', async () => {
    renderModal();
    expect(await linkChoice()).toBeChecked();
    expect(temporaryChoice()).not.toBeChecked();
    expect(screen.getByRole('group', { name: 'How will they get in?' })).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('asks for the missing details when a field is empty — under each field, with its rule', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    expect(screen.getByText('Fill in every field.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Enter a last name.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^last name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^last name/i)).toHaveFocus();
    expect(screen.getByLabelText(/^username/i)).toHaveAccessibleDescription(/Use 3–32 letters or numbers/);
    expect(posted).toBeNull();
  });

  it('a username with a space is caught before anything is sent (the server’s own rule)', async () => {
    renderModal();
    await userEvent.type(screen.getByLabelText(/first name/i), 'Sara');
    await userEvent.type(screen.getByLabelText(/last name/i), 'K');
    await userEvent.type(screen.getByLabelText(/username/i), 'sara k');
    await userEvent.type(screen.getByRole('textbox', { name: /^email/i }), 'sara@x.test');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    expect(screen.getByLabelText(/^username/i)).toHaveAttribute('aria-invalid', 'true');
    expect(posted).toBeNull();
  });

  it('says the email is not valid when the server refuses it — not that it is "already in use"', async () => {
    answer = () => json({ error: { code: 'VALIDATION', message: 'Invalid input.', details: { formErrors: [], fieldErrors: { email: ['Invalid email'] } } } }, 400);
    const onClose = renderModal();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter a valid email address/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/in use/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says the email or username is taken when it is, in the server’s words (whose it is)', async () => {
    answer = () => json({ error: { code: 'DUPLICATE_USER', message: 'This email address is already used by Sara Khan.', details: { field: 'email' } } }, 409);
    renderModal();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('This email address is already used by Sara Khan.');
  });

  it('does not blame the details when the server itself failed', async () => {
    answer = () => json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, 500);
    renderModal();
    await fill();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn’t create the account/i);
    expect(alert).not.toHaveTextContent(/in use/i);
  });

  it('creates the user with an invitation link by default (System Settings’ 7 days)', async () => {
    const onClose = renderModal();
    await linkChoice();
    await fill();
    await waitFor(() => expect(posted).toMatchObject({ username: 'sara', sendWelcome: true, inviteDays: 7 }));
    expect(posted).not.toHaveProperty('password');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('CreateUserModal — "How will they get in?" (1.23.6)', () => {
  it('the invitation link is the default; it sends the link with its lifetime and nothing else', async () => {
    renderModal();
    expect(await linkChoice()).toBeChecked();
    expect(screen.getByText('They get their username and a one-time link to set their own password.')).toBeInTheDocument();
    expect(screen.getByLabelText('The link works for')).toHaveValue('7');
    await fill();
    await waitFor(() => expect(posted).toEqual({ firstName: 'Sara', lastName: 'K', username: 'sara', email: 'sara@x.test', roleNames: ['EMPLOYEE'], sendWelcome: true, inviteDays: 7 }));
  });

  it('a lifetime for this one invitation: 1, 3, 7 or 14 days', async () => {
    renderModal();
    await linkChoice();
    const days = screen.getByLabelText('The link works for');
    expect(within(days).getAllByRole('option').map((o) => o.textContent)).toEqual(['1 day', '3 days', '7 days', '14 days']);
    await userEvent.selectOptions(days, '14');
    await fill();
    await waitFor(() => expect(posted).toMatchObject({ sendWelcome: true, inviteDays: 14 }));
  });

  it('the choices are finger-sized and named; on a phone the role takes its own row', async () => {
    renderModal();
    await linkChoice();
    expect(screen.getByText('Email an invitation link (recommended)').className).toMatch(/(^|\s)tap(\s|$)/);
    expect(screen.getByText('Give them a temporary password yourself').className).toMatch(/(^|\s)tap(\s|$)/);
    const row = screen.getByLabelText('Role').closest('.grid')!;
    expect(row.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/);
    expect(row.className).toMatch(/sm:grid-cols-2/);
  });

  it('a temporary password: made on the server (words or 16 characters), shown once with Copy and New one; Done tells the page — never the password', async () => {
    answer = () => json({ data: { id: 'u9', username: 'sara', firstName: 'Sara', lastName: 'K', mustChangePassword: true, temporaryPasswordExpiresAt: '2026-11-14T06:00:00.000Z' }, meta: { temporaryPassword: 'Kite-Mango-Fern-Ripple-472' } }, 201);
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderModal(onClose, onCreated);
    await linkChoice();
    await userEvent.click(temporaryChoice());
    expect(screen.getByLabelText('Unused, it stops working after')).toHaveValue('7');
    await userEvent.click(screen.getByRole('radio', { name: '16 characters' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Four words and a number' }));
    await fill();
    await waitFor(() => expect(posted).toEqual({ firstName: 'Sara', lastName: 'K', username: 'sara', email: 'sara@x.test', roleNames: ['EMPLOYEE'], generatePassword: 'words', inviteDays: 7 }));
    const shown = await screen.findByLabelText('Temporary password');
    expect(shown).toHaveTextContent('Kite-Mango-Fern-Ripple-472');
    expect(screen.getByText(/Give it to them yourself — not by email\. It works until 14 Nov/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Kite-Mango-Fern-Ripple-472');
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    answer = () => json({ data: { temporaryPassword: 'Opal-Rain-Cedar-Bolt-118', expiresAt: '2026-11-14T06:05:00.000Z' } });
    await userEvent.click(screen.getByRole('button', { name: 'New one' }));
    await waitFor(() => expect(screen.getByLabelText('Temporary password')).toHaveTextContent('Opal-Rain-Cedar-Bolt-118'));
    expect(posted).toEqual({ generate: 'words', days: 7 });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    const told = onCreated.mock.calls[0]![0] as Record<string, unknown>;
    expect(told).toMatchObject({ user: { id: 'u9', mustChangePassword: true } });
    expect(JSON.stringify(told)).not.toContain('Kite');
  });

  it('when email isn’t set up: the link can’t be chosen and says why; the temporary password is chosen', async () => {
    config = { timeZone: 'Asia/Muscat', emailEnabled: false };
    renderModal();
    const link = await linkChoice();
    await waitFor(() => expect(link).toBeDisabled());
    expect(link).not.toBeChecked();
    expect(temporaryChoice()).toBeChecked();
    expect(screen.getByText('Email isn’t set up on this server, so no invitation can be sent.')).toBeInTheDocument();
    await fill();
    await waitFor(() => expect(posted).toMatchObject({ generatePassword: 'words', inviteDays: 7 }));
    expect(posted).not.toHaveProperty('sendWelcome');
  });

  it('tells the page whether the invitation went', async () => {
    answer = () => json({ data: { id: 'u9', username: 'sara' }, meta: { welcome: { userId: 'u9', username: 'sara', email: 'sara@x.test', sent: true } } }, 201);
    const onCreated = vi.fn();
    renderModal(vi.fn(), onCreated);
    await linkChoice();
    await fill();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ user: { id: 'u9', username: 'sara' }, welcome: { userId: 'u9', username: 'sara', email: 'sara@x.test', sent: true } }));
  });

  it('says plainly when the server can’t send it because email isn’t set up, and the link then shows as unavailable', async () => {
    answer = () => {
      config = { timeZone: 'Asia/Muscat', emailEnabled: false }; // what the server says when the page asks again
      return json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email isn’t set up on this server yet, so no welcome email can be sent. An administrator needs to add the email (Mailjet) keys.' } }, 503);
    };
    const onClose = renderModal();
    await linkChoice();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Email isn’t set up on this server, so the invitation can’t be sent and the account wasn’t created\. Give them a temporary password instead\.$/,
    );
    await waitFor(() => expect(screen.getByRole('radio', { name: /email an invitation link/i })).toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('“both ways” refused by the server is said in plain words', async () => {
    answer = () => json({ error: { code: 'ONE_WAY_IN', message: 'x' } }, 400);
    renderModal();
    await linkChoice();
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose one way in: an invitation link or a temporary password — not both.');
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
    await userEvent.type(screen.getByRole('textbox', { name: /^email/i }), 'sara@x.test');
  };
  const create = () => userEvent.click(screen.getByRole('button', { name: /create user/i }));

  it('one company: no company fields, and the new account goes to the site’s company as before', async () => {
    const server = companyServer({ companies: [alpha] });
    renderModal();
    await waitFor(() => expect(server.gets('/me/companies')).toHaveLength(1));
    await linkChoice();
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
    await create();
    expect(await screen.findByRole('alert')).toHaveTextContent('Company not found.');
  });

  // 1.22 review I3: from 7 companies the list has a search box; Enter there only filters.
  it('Enter in Search companies filters the list and never creates the user', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => apiCompany({ id: `c${i}`, name: `Company ${'ABCDEFG'[i]}`, code: `C${i}` }));
    useCompanyStore.setState({ pick: 'c0' }); // ticked from the start: the form is complete
    const server = companyServer({ companies: seven });
    const onClose = renderModal();
    const search = await screen.findByRole('searchbox', { name: /search companies/i });
    expect(screen.getByRole('checkbox', { name: 'Company A' })).toBeChecked();
    await basics();
    await userEvent.type(search, 'Company C{Enter}');
    expect(screen.getByRole('checkbox', { name: 'Company C' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Company D' })).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.requests('POST', '/users')).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
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
    for (const field of [/first name/i, /last name/i, /username/i]) expect(person).toContainElement(screen.getByLabelText(field));
    expect(person).toContainElement(screen.getByRole('textbox', { name: /^email/i }));
    expect(person).toContainElement(screen.getByRole('group', { name: 'How will they get in?' }));
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

describe('CreateUserModal: Role "Client" (1.23)', () => {
  beforeEach(() => {
    useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  });
  afterEach(() => useAuthStore.getState().logout());

  const person = async () => {
    await userEvent.type(screen.getByLabelText(/first name/i), 'Huda');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Saleh');
    await userEvent.type(screen.getByLabelText(/username/i), 'huda');
    await userEvent.type(screen.getByRole('textbox', { name: /^email/i }), 'huda@owner.test');
    // Onboarding: a client's organisation is required.
    await userEvent.type(screen.getByLabelText(/^organisation/i), 'Owner Group');
  };
  const addProject = async (name: RegExp) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Add a project' }));
    await userEvent.click(await screen.findByRole('option', { name }));
  };
  /** 1.23.7 A tick in the permission matrix, by permission and project ("Comment — MICO Tower"). */
  const tick = (project: string, box: string) => userEvent.click(screen.getByRole('checkbox', { name: `${box} — ${project}` }));
  const pickRole = (project: string, role: string) => userEvent.selectOptions(screen.getByRole('combobox', { name: `Role — ${project}` }), role);
  const create = () => userEvent.click(screen.getByRole('button', { name: /create/i }));
  const NO_ACTIONS = { comment: false, signOff: false, respond: false, download: false, upload: false, notify: false };

  it('offers Employee, Administrator and Client', async () => {
    clientServer();
    renderModal();
    const role = screen.getByLabelText('Role');
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Employee', 'Administrator', 'Client']);
  });

  it('choosing Client asks for the organisation and phone, and shows project access instead of companies', async () => {
    clientServer();
    renderModal();
    expect(screen.queryByLabelText(/organisation/i)).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    expect(screen.getByLabelText(/organisation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toHaveAttribute('type', 'tel');
    expect(screen.getByRole('group', { name: 'Project access' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Companies' })).toBeNull();
    // One way in, as for staff: the invitation link by default.
    expect(await screen.findByRole('radio', { name: /email an invitation link/i })).toBeChecked();
    expect(screen.getByRole('button', { name: /create client/i })).toBeInTheDocument();
  });

  it('creates the client with POST /clients (never /users): two projects, each with its role and ticks, and says whether the welcome went', async () => {
    const server = clientServer();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderModal(onClose, onCreated);
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    await person(); // with the organisation
    await userEvent.type(screen.getByLabelText(/phone/i), '+968 9000 0000');
    await addProject(/MICO Tower/);
    await pickRole('MICO Tower', 'APPROVER');
    await addProject(/Rig Refit/);
    // Starts as Viewer; a tick changed makes it Custom.
    await tick('Rig Refit', 'View tasks');
    await tick('Rig Refit', 'Reply to invites');
    await create();
    await waitFor(() => expect(server.requests('POST', '/clients')).toHaveLength(1));
    expect(server.requests('POST', '/users')).toHaveLength(0);
    expect(server.lastBody('POST', '/clients')).toEqual({
      firstName: 'Huda',
      lastName: 'Saleh',
      username: 'huda',
      email: 'huda@owner.test',
      organisation: 'Owner Group',
      phone: '+968 9000 0000',
      sendWelcome: true,
      inviteDays: 7,
      projects: [
        { projectId: 'p-mico', role: 'APPROVER', modules: { progress: true, meetings: true }, actions: { comment: true, signOff: true, respond: true, download: true, upload: true, notify: true } },
        { projectId: 'p-rig', role: 'CUSTOM', modules: { progress: false, meetings: true }, actions: { ...NO_ACTIONS, respond: true, download: true, notify: true } },
      ],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const result = onCreated.mock.calls[0]![0] as { user: { username: string; roles: string[]; email: string }; welcome: { sent: boolean; email: string } };
    expect(result.user).toMatchObject({ username: 'huda', roles: ['CLIENT'], email: 'huda@owner.test' });
    expect(result.welcome).toMatchObject({ sent: true, email: 'huda@owner.test' });
  });

  it('a Custom project with neither view is said inline and on Create (the server’s words), and nothing is sent', async () => {
    const server = clientServer();
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    await person();
    await addProject(/Finance Office/);
    await tick('Finance Office', 'View tasks');
    await tick('Finance Office', 'View meetings & minutes');
    expect(within(screen.getByRole('group', { name: 'Finance Office' })).getByText('Tick at least one of View tasks or View meetings & minutes.')).toBeInTheDocument();
    await create();
    expect(screen.getByRole('alert')).toHaveTextContent('Tick at least one of View tasks or View meetings & minutes for Finance Office.');
    expect(screen.getByRole('checkbox', { name: 'View tasks — Finance Office' })).toHaveAttribute('aria-invalid', 'true');
    expect(server.requests('POST', '/clients')).toHaveLength(0);
  });

  it('1.23.7 Preview as client: the details typed so far and the matrix on screen, before the account exists — nothing is created', async () => {
    const server = clientServer();
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    const button = screen.getByRole('button', { name: 'Preview as client' });
    expect(button).toBeDisabled();
    await person();
    await addProject(/MICO Tower/);
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Preview as client' })).toBeInTheDocument();
    expect(preview.spec).toEqual({
      firstName: 'Huda',
      lastName: 'Saleh',
      organisation: 'Owner Group',
      email: 'huda@owner.test',
      projects: [{ projectId: 'p-mico', role: 'VIEWER', modules: { progress: true, meetings: true }, actions: { ...NO_ACTIONS, download: true, notify: true } }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.getByRole('dialog', { name: 'New user' })).toBeInTheDocument();
    expect(server.requests('POST', '/clients')).toHaveLength(0);
  });

  it('a temporary password, as for staff: made on the server, shown once (POST /clients)', async () => {
    const server = clientServer();
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    await userEvent.click(await screen.findByRole('radio', { name: 'Give them a temporary password yourself' }));
    await userEvent.click(screen.getByRole('radio', { name: '16 characters' }));
    await person();
    await create();
    await waitFor(() => expect(server.requests('POST', '/clients')).toHaveLength(1));
    expect(server.lastBody('POST', '/clients')).toMatchObject({ generatePassword: 'characters', inviteDays: 7, projects: [] });
    expect(server.lastBody('POST', '/clients')).not.toHaveProperty('sendWelcome');
  });

  it('shows the server’s words when it refuses (a username already in use)', async () => {
    const server = clientServer();
    server.refuseNext(409, 'DUPLICATE_USER', 'A user with this email or username already exists.', { method: 'POST', path: /^\/clients$/ });
    const onClose = vi.fn();
    renderModal(onClose);
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    await person();
    await create();
    expect(await screen.findByRole('alert')).toHaveTextContent('A user with this email or username already exists.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('from 1024px: the person and their role on the left, how they get in on the right, and the permission matrix across the whole form below', async () => {
    windowWidth(1280);
    clientServer();
    renderModal();
    const role = screen.getByLabelText('Role');
    role.focus();
    await userEvent.selectOptions(role, 'CLIENT');
    const dialog = screen.getByRole('dialog', { name: 'New user' });
    expect(dialog.className).toMatch(/lg:max-w-\[60rem\]/);
    const left = dialog.querySelector<HTMLElement>('[data-form-column="person"]')!;
    const right = dialog.querySelector<HTMLElement>('[data-form-column="way-in"]')!;
    const below = dialog.querySelector<HTMLElement>('[data-form-row="access"]')!;
    expect(left.parentElement!.className).toMatch(/grid-cols-/);
    expect(left).toContainElement(screen.getByLabelText(/organisation/i));
    expect(left).toContainElement(screen.getByLabelText('Role'));
    expect(right).toContainElement(screen.getByRole('group', { name: 'How will they get in?' }));
    expect(left.parentElement!.contains(below)).toBe(false);
    expect(below).toContainElement(screen.getByRole('group', { name: 'Project access' }));
    expect(below).toContainElement(screen.getByRole('table', { name: 'Permissions for each project' }));
    // Choosing Client keeps the Role box where it was (the keyboard stays on it).
    expect(screen.getByLabelText('Role')).toBe(role);
    expect(role).toHaveFocus();
  });

  it('on a phone: one column, project access under the person', async () => {
    windowWidth(375);
    clientServer();
    renderModal();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    const dialog = screen.getByRole('dialog', { name: 'New user' });
    expect(dialog.querySelector('[data-form-column]')).toBeNull();
    expect(screen.getByLabelText('Role').compareDocumentPosition(screen.getByRole('group', { name: 'Project access' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('as “New client” (the Clients page): no role to choose, and it makes a client', async () => {
    const server = clientServer();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CreateUserModal clientOnly onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'New client' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Role')).toBeNull();
    await person();
    await addProject(/MICO Tower/);
    await userEvent.click(screen.getByRole('button', { name: /create client/i }));
    await waitFor(() => expect(server.requests('POST', '/clients')).toHaveLength(1));
    expect(server.lastBody('POST', '/clients')).toMatchObject({ username: 'huda', projects: [{ projectId: 'p-mico', role: 'VIEWER', modules: { progress: true, meetings: true } }] });
  });
});
