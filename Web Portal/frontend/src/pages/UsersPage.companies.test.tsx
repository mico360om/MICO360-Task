import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsersPage } from './UsersPage';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';
import { apiCompany, apiUser, companyServer, type CompanyServerWorld } from '../test/company-server';

const alpha = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA' });
const beta = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA' });
const ref = (c: { id: string; name: string; code: string }) => ({ id: c.id, name: c.name, code: c.code });
const people = [
  apiUser({ id: 'u1', username: 'ana', firstName: 'Ana', lastName: 'Alpha', companies: [ref(alpha)], primaryCompanyId: 'ca' }),
  apiUser({ id: 'u2', username: 'sam', firstName: 'Sam', lastName: 'Shared', companies: [ref(alpha), ref(beta)], primaryCompanyId: 'cb' }),
  apiUser({ id: 'u3', username: 'nia', firstName: 'Nia', lastName: 'None', companies: [], primaryCompanyId: null }),
];

function renderPage(world: CompanyServerWorld) {
  const server = companyServer({ users: people, ...world });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/users']}>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return server;
}
const columnHeaders = () => within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent?.trim()).filter(Boolean);
const shownUsernames = () => [...document.querySelectorAll('[data-username]')].map((e) => e.textContent);
const tick = (username: string) => userEvent.click(screen.getByRole('checkbox', { name: `Select ${username}` }));

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  useCompanyStore.setState({ pick: null, userId: 'me' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
  useCompanyStore.setState({ pick: null, userId: null });
});

describe('UsersPage with one company', () => {
  it('looks as before: no Companies column, no company filter, and the tick boxes only with email', async () => {
    const server = renderPage({ companies: [alpha], emailEnabled: false });
    await screen.findByText('ana');
    await waitFor(() => expect(server.gets('/me/companies')).toHaveLength(1));
    expect(columnHeaders()).toEqual(['User', 'Email', 'Roles', 'Status', 'Last sign-in', 'Actions']);
    expect(screen.queryByLabelText('Company')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(server.gets('/users')).toEqual(['/users']);
  });

  it('with email on, ticking people offers welcome emails only, never the company buttons', async () => {
    renderPage({ companies: [alpha] });
    await screen.findByText('ana');
    await tick('ana');
    expect(screen.getByRole('button', { name: /Send welcome emails/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to a company…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove from a company…' })).toBeNull();
  });
});

describe('UsersPage with two companies', () => {
  it('a Companies column lists each person’s companies, their primary one marked', async () => {
    renderPage({ companies: [alpha, beta] });
    await screen.findByText('ana');
    await waitFor(() => expect(columnHeaders()).toEqual(['User', 'Email', 'Roles', 'Companies', 'Status', 'Last sign-in', 'Actions']));
    const cellOf = (username: string) => within(screen.getByText(username).closest('tr')!).getByRole('list', { name: 'Companies' });
    expect(within(cellOf('sam')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Alpha Co', 'Beta Co (primary)']);
    expect(within(cellOf('sam')).getByText('Beta Co').tagName).toBe('BDI');
    expect(within(screen.getByText('nia').closest('tr')!).getByText('No company')).toBeInTheDocument();
  });

  it('the company filter starts at the picked company', async () => {
    useCompanyStore.setState({ pick: 'ca' });
    const server = renderPage({ companies: [alpha, beta] });
    expect(await screen.findByLabelText('Company')).toHaveValue('ca');
    expect(server.gets('/users').at(-1)).toBe('/users?companyId=ca');
    await waitFor(() => expect(shownUsernames()).toEqual(['ana', 'sam']));
  });

  it('the filter: All companies, each company, No company — the choice isn’t remembered', async () => {
    const server = renderPage({ companies: [beta, alpha] });
    const select = await screen.findByLabelText('Company');
    expect(select).toHaveValue('');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All companies', 'Alpha Co', 'Beta Co', 'No company']);
    await userEvent.selectOptions(select, 'none');
    await waitFor(() => expect(shownUsernames()).toEqual(['nia']));
    expect(server.gets('/users').at(-1)).toBe('/users?companyId=none');
    await userEvent.selectOptions(select, 'cb');
    await waitFor(() => expect(shownUsernames()).toEqual(['sam']));
  });

  it('the tick boxes show even without email; "Add to a company…" adds the ticked people', async () => {
    const server = renderPage({ companies: [alpha, beta], emailEnabled: false });
    await screen.findByRole('checkbox', { name: 'Select ana' });
    await tick('ana');
    await tick('nia');
    expect(screen.queryByRole('button', { name: /Send welcome emails/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add to a company…' }));
    const dialog = screen.getByRole('dialog', { name: 'Add 2 people to a company' });
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBe(3));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Company' }), 'cb');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.lastBody('POST', '/users/companies')).toEqual({ userIds: ['u1', 'u3'], addCompanyIds: ['cb'] });
    expect(screen.getByRole('status')).toHaveTextContent('2 changed.');
    // Done: the selection is cleared and the list read again.
    expect(screen.queryByText('2 selected')).toBeNull();
    await waitFor(() => expect(server.gets('/users').length).toBeGreaterThan(1));
  });

  it('bulk remove says who couldn’t change', async () => {
    const server = renderPage({ companies: [alpha, beta] });
    server.answerNext('POST', /^\/users\/companies$/, { data: { changed: 2, refused: [{ userId: 'u1', name: 'Ana Alpha', reason: 'Ana Alpha must keep at least one company. Add another company first.' }] } });
    await screen.findByText('ana');
    for (const u of ['ana', 'sam', 'nia']) await tick(u);
    await userEvent.click(screen.getByRole('button', { name: 'Remove from a company…' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove 3 people from a company' });
    await waitFor(() => expect(within(dialog).getAllByRole('option').length).toBe(3));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Company' }), 'ca');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('2 changed. 1 not changed: Ana Alpha must keep at least one company. Add another company first.')).toBeInTheDocument();
  });

  it('several refused: the first is said, the rest under "Show all"', async () => {
    const server = renderPage({ companies: [alpha, beta] });
    server.answerNext('POST', /^\/users\/companies$/, {
      data: {
        changed: 0,
        refused: [
          { userId: 'u1', name: 'Ana Alpha', reason: 'Ana Alpha must keep at least one company. Add another company first.' },
          { userId: 'u2', name: 'Sam Shared', reason: 'Sam Shared must keep at least one company. Add another company first.' },
        ],
      },
    });
    await screen.findByText('ana');
    for (const u of ['ana', 'sam']) await tick(u);
    await userEvent.click(screen.getByRole('button', { name: 'Remove from a company…' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getAllByRole('option').length).toBe(3));
    await userEvent.selectOptions(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Company' }), 'ca');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    const note = await screen.findByRole('alert');
    expect(note).toHaveTextContent('0 changed. 2 not changed: Ana Alpha must keep at least one company. Add another company first.');
    await userEvent.click(within(note).getByText('Show all'));
    expect(within(note).getByText('Sam Shared must keep at least one company. Add another company first.')).toBeVisible();
  });
});

describe('UsersPage with two companies on a phone', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 47.9375em'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  it('each card says the person’s companies, and has its tick box', async () => {
    renderPage({ companies: [alpha, beta], emailEnabled: false });
    const card = (await screen.findByText('sam')).closest('li')!;
    await waitFor(() => expect(within(card).getByRole('list', { name: 'Companies' })).toHaveTextContent('Alpha CoBeta Co (primary)'));
    expect(within(card).getByRole('checkbox', { name: 'Select sam' })).toBeInTheDocument();
  });
});
