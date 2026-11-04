import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { UsersPage } from './UsersPage';
import { useAuthStore } from '../stores/auth-store';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let calls: { url: string; method: string; body?: Record<string, unknown> }[];

beforeEach(() => {
  calls = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/users') && method === 'POST') return json({ data: { id: 'new' } }, 201);
      if (String(url).includes('/status')) return json({ data: {} });
      return json({ data: [{ id: 'u9', email: 'omar@x.co', username: 'omar', firstName: 'Omar', lastName: 'A', status: 'ACTIVE', roles: ['EMPLOYEE'] }] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function renderPage(at = '/admin/users') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/admin/users" element={<><UsersPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UsersPage (admin management)', () => {
  it('shows each person by their full name, with the username they sign in with under it', async () => {
    renderPage();
    const username = await screen.findByText('omar');
    const cell = username.closest('td')!;
    expect(within(cell).getByText('Omar A')).toBeInTheDocument();
    expect(cell).toHaveTextContent('Omar A@omar');
    // Names are people's own text: set apart, so an Arabic name keeps its own direction.
    expect(within(cell).getByText('Omar A').tagName).toBe('BDI');
  });

  it('changes a user’s status via the API', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/status for omar/i), 'SUSPENDED');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/u9/status') && c.body?.status === 'SUSPENDED')).toBe(true));
  });

  it('keeps whose row it is in view while the table scrolls sideways on a phone, tablet or small laptop, and says it scrolls', async () => {
    renderPage();
    const name = (await screen.findByText('omar')).closest('td')!;
    // The table is wider than the page below xl (1280px), not only on a phone.
    expect(name.className).toMatch(/max-xl:sticky/);
    expect(screen.getByText(/swipe the table sideways/i).className).toMatch(/xl:hidden/);
    const boxes = screen.queryAllByRole('checkbox');
    for (const box of boxes) expect(box.closest('label')).not.toBeNull();
  });

  it('names each row’s buttons after the user, so a screen reader does not hear "Edit, Edit, Edit"', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Edit omar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete omar' }));
    expect(screen.getByRole('button', { name: 'Confirm deleting omar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No, keep omar' })).toBeInTheDocument();
  });

  it('creates a new user from the modal', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    await userEvent.type(screen.getByLabelText(/first name/i), 'Nadia');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Ahmed');
    await userEvent.type(screen.getByLabelText(/username/i), 'nadia');
    await userEvent.type(screen.getByLabelText(/^email/i), 'nadia@x.co');
    await userEvent.type(screen.getByLabelText(/temp password/i), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/users') && c.method === 'POST' && c.body?.username === 'nadia')).toBe(true),
    );
  });

  it('edits a user’s email and roles from the edit modal', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: /^edit /i })[0]!);
    const email = await screen.findByLabelText(/^email/i);
    await userEvent.clear(email);
    await userEvent.type(email, 'omar2@x.co');
    await userEvent.click(screen.getByLabelText('Administrator'));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.endsWith('/users/u9') &&
            c.method === 'PUT' &&
            c.body?.email === 'omar2@x.co' &&
            Array.isArray(c.body?.roleNames) &&
            (c.body?.roleNames as string[]).includes('ADMIN'),
        ),
      ).toBe(true),
    );
  });

  it('shows locked accounts and unlocks them (SEC-04)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      if (String(url).endsWith('/unlock')) return json({ data: {} });
      return json({ data: [{ id: 'u9', email: 'omar@x.co', username: 'omar', firstName: 'Omar', lastName: 'A', status: 'ACTIVE', roles: ['EMPLOYEE'], locked: true }] });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/locked$/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /unlock omar/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/u9/unlock') && c.method === 'POST')).toBe(true));
    expect(await screen.findByText(/omar can sign in again/i)).toBeInTheDocument();
  });

  it('won’t let an admin change their own roles or status from the edit dialog (SEC-08)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'PUT') return json({ data: {} });
      return json({ data: [{ id: 'me', email: 'a@b.c', username: 'admin', firstName: 'Ada', lastName: 'Admin', status: 'ACTIVE', roles: ['ADMIN'] }] });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: /^edit /i })[0]!);
    expect(await screen.findByText(/can’t change your own roles or account status/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Administrator')).toBeDisabled();
    expect(screen.getByLabelText(/account status/i)).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).not.toHaveProperty('roleNames');
    expect(calls.some((c) => c.url.endsWith('/status'))).toBe(false);
  });

  it('shows the server’s reason when a change is refused (e.g. last admin)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).includes('/status')) return json({ error: { code: 'LAST_ADMIN', message: 'The last active administrator can’t be deactivated.' } }, 409);
      return json({ data: [{ id: 'u9', email: 'omar@x.co', username: 'omar', firstName: 'Omar', lastName: 'A', status: 'ACTIVE', roles: ['ADMIN'] }], method });
    }));
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/status for omar/i), 'INACTIVE');
    expect(await screen.findByRole('alert')).toHaveTextContent(/last active administrator/i);
  });

  it('applies the shared password rule when an admin resets a password (SEC-12)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: /^edit /i })[0]!);
    expect(screen.getByText(/at least 8 characters, with a letter and a number/i)).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText(/new password/i), 'abc123');
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(calls.some((c) => c.url.endsWith('/users/u9/password'))).toBe(false);
  });

  it('resets a user’s password from the edit modal', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('omar')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('button', { name: /^edit /i })[0]!);
    await userEvent.type(await screen.findByLabelText(/new password/i), 'FreshPass1!');
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith('/users/u9/password') && c.method === 'POST' && c.body?.password === 'FreshPass1!'),
      ).toBe(true),
    );
  });
});

describe('UsersPage: New user from the address', () => {
  it('opens the New user form on arrival at /admin/users?new=1 (the first steps’ “Add your team”), then drops it from the address', async () => {
    renderPage('/admin/users?new=1');
    expect(await screen.findByRole('dialog', { name: /new user/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/users'));
  });

  it('opens nothing without it', async () => {
    renderPage();
    await screen.findByText('omar');
    expect(screen.queryByRole('dialog', { name: /new user/i })).toBeNull();
  });
});

describe('UsersPage on a phone (below 768px): one card per person', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 47.9375em'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());
  const people = [
    { id: 'u9', email: 'omar@x.co', username: 'omar', firstName: 'Omar', lastName: 'A', status: 'ACTIVE', roles: ['EMPLOYEE'], lastLoginAt: '2026-10-24T05:12:00.000Z' },
    { id: 'u8', email: 'sara@x.co', username: 'sara', firstName: 'Sara', lastName: 'B', status: 'SUSPENDED', roles: ['EMPLOYEE', 'MANAGER'], locked: true, lastLoginAt: null },
  ];
  const serve = () =>
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(url).endsWith('/unlock') || String(url).includes('/status')) return json({ data: {} });
      if (String(url).endsWith('/config')) return json({ data: { emailEnabled: true } });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return json({ data: people });
    });

  it('shows a card per person instead of the table that needed sideways swiping', async () => {
    vi.stubGlobal('fetch', serve());
    renderPage();
    const list = await screen.findByRole('list', { name: 'Users' });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/swipe the table sideways/i)).toBeNull();
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    // The full name with @username under it, as the table shows; the email, roles, status and last sign-in.
    const omar = cards[0]!;
    expect(within(omar).getByText('Omar A').tagName).toBe('BDI');
    expect(omar).toHaveTextContent('Omar A@omar');
    expect(omar).toHaveTextContent('omar@x.co');
    expect(omar).toHaveTextContent('EMPLOYEE');
    expect(omar).toHaveTextContent('ACTIVE');
    expect(omar).toHaveTextContent('24 Oct 2026');
    const sara = cards[1]!;
    expect(sara).toHaveTextContent('EMPLOYEE, MANAGER');
    expect(sara).toHaveTextContent('SUSPENDED');
    expect(sara).toHaveTextContent('Locked');
    expect(sara).toHaveTextContent('Never signed in');
  });

  it('keeps every action the table row has: select, welcome email, unlock, edit, status and delete', async () => {
    vi.stubGlobal('fetch', serve());
    renderPage();
    const list = await screen.findByRole('list', { name: 'Users' });
    const [omar, sara] = within(list).getAllByRole('listitem');
    expect(within(omar!).getByRole('checkbox', { name: 'Select omar' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select everyone shown' })).toBeInTheDocument();
    expect(within(omar!).getByRole('button', { name: 'Send welcome email to omar' })).toHaveTextContent('Send welcome email');
    expect(within(omar!).getByRole('button', { name: 'Edit omar' })).toBeInTheDocument();
    expect(within(omar!).queryByRole('button', { name: /unlock/i })).toBeNull();

    await userEvent.click(within(sara!).getByRole('button', { name: 'Unlock sara' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/u8/unlock') && c.method === 'POST')).toBe(true));

    await userEvent.selectOptions(within(omar!).getByRole('combobox', { name: 'Status for omar' }), 'INACTIVE');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/u9/status') && c.body?.status === 'INACTIVE')).toBe(true));

    await userEvent.click(within(omar!).getByRole('checkbox', { name: 'Select omar' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await userEvent.click(within(omar!).getByRole('button', { name: 'Delete omar' }));
    await userEvent.click(within(omar!).getByRole('button', { name: 'Confirm deleting omar' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/users/u9') && c.method === 'DELETE')).toBe(true));

    await userEvent.click(within(omar!).getByRole('button', { name: 'Edit omar' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('gives each card’s controls a finger-sized target on a touch screen', async () => {
    vi.stubGlobal('fetch', serve());
    renderPage();
    const list = await screen.findByRole('list', { name: 'Users' });
    const omar = within(list).getAllByRole('listitem')[0]!;
    for (const b of [...within(omar).getAllByRole('button'), within(omar).getByRole('combobox')]) expect(b.className, b.textContent ?? '').toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/); // the ! form: the base 32px button rule outranks a plain class
  });
});

