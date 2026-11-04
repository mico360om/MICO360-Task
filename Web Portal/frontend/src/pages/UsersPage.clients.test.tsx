import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UsersPage } from './UsersPage';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';
import { apiCompany, apiUser } from '../test/company-server';
import { windowWidth } from '../test/window-width';
import { MICO, access, apiClientAccount, clientServer, type ClientServerWorld } from '../components/clients/test-server';

const alpha = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA' });
const beta = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA' });
const omar = apiUser({ id: 'u-omar', username: 'omar', firstName: 'Omar', lastName: 'A', roles: ['EMPLOYEE'] });
const ada = apiUser({ id: 'u-ada', username: 'ada', firstName: 'Ada', lastName: 'Admin', roles: ['ADMIN'] });
const huda = apiClientAccount({ id: 'c-huda', username: 'huda', firstName: 'Huda', lastName: 'Saleh', organisation: 'Owner Group', projects: [access(MICO, { modules: { progress: true } })] });

function renderPage(world: ClientServerWorld = {}) {
  const server = clientServer({ staff: [omar, ada], clients: [huda], ...world });
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
const shownUsernames = () => [...document.querySelectorAll('[data-username]')].map((e) => e.textContent);
const rowOf = (username: string) => screen.getByText(username, { selector: '[data-username]' }).closest('tr')!;

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  useCompanyStore.setState({ pick: null, userId: 'me' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
  useCompanyStore.setState({ pick: null, userId: null });
});

describe('UsersPage: client accounts (1.23)', () => {
  it('lists clients with a “Client” badge and their organisation', async () => {
    const server = renderPage();
    await screen.findByText('huda');
    const roles = within(rowOf('huda')).getByText('Client');
    expect(roles).toHaveAttribute('data-tone');
    await waitFor(() => expect(within(rowOf('huda')).getByText('Owner Group')).toBeInTheDocument());
    expect(server.requests('GET', '/clients')).toHaveLength(1);
    // Staff keep their roles as before.
    expect(rowOf('omar')).toHaveTextContent('EMPLOYEE');
    expect(within(rowOf('omar')).queryByText('Client')).toBeNull();
  });

  it('filters by role: All roles, Administrator, Employee, Client', async () => {
    renderPage();
    await screen.findByText('huda');
    const role = screen.getByLabelText('Role');
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['All roles', 'Administrator', 'Employee', 'Client']);
    expect(shownUsernames()).toEqual(['omar', 'ada', 'huda']);
    await userEvent.selectOptions(role, 'CLIENT');
    expect(shownUsernames()).toEqual(['huda']);
    await userEvent.selectOptions(role, 'EMPLOYEE');
    expect(shownUsernames()).toEqual(['omar']);
    await userEvent.selectOptions(role, 'ADMIN');
    expect(shownUsernames()).toEqual(['ada']);
  });

  it('Client with no clients says so', async () => {
    renderPage({ clients: [] });
    await screen.findByText('omar');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'CLIENT');
    expect(screen.getByText('No client accounts yet. Make one with New user and Role “Client”.')).toBeInTheDocument();
  });

  it('Edit on a client opens Manage account with their project access', async () => {
    const server = renderPage();
    await screen.findByText('huda');
    await userEvent.click(screen.getByRole('button', { name: 'Edit huda' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit huda' });
    expect(await within(dialog).findByRole('group', { name: 'MICO Tower' })).toBeInTheDocument();
    expect(server.requests('GET', '/clients/c-huda')).toHaveLength(1);
  });

  it('a client made with New user (Role “Client”) is said the same way as staff: welcome sent', async () => {
    const server = renderPage();
    await screen.findByText('huda');
    await userEvent.click(screen.getByRole('button', { name: /new user/i }));
    await userEvent.selectOptions(screen.getByLabelText('Role', { selector: 'select#nu-role' }), 'CLIENT');
    await userEvent.type(screen.getByLabelText(/first name/i), 'Lina');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Q');
    await userEvent.type(screen.getByLabelText(/^username/i), 'lina');
    await userEvent.type(screen.getByLabelText(/^email/i), 'lina@owner.test');
    await userEvent.click(screen.getByRole('button', { name: /create client/i }));
    await waitFor(() => expect(server.requests('POST', '/clients')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent('lina’s account is ready. Welcome email sent to lina@owner.test.');
  });

  it('on a phone, a client’s card says “Client”', async () => {
    windowWidth(375);
    renderPage();
    const card = (await screen.findByText('huda', { selector: '[data-username]' })).closest('li')!;
    expect(within(card).getByText('Client')).toBeInTheDocument();
    await waitFor(() => expect(within(card).getByText('Owner Group')).toBeInTheDocument());
  });
});

describe('UsersPage: company bulk assign leaves clients out (1.23)', () => {
  it('only the staff ticked are sent, and the notice says the clients were left out', async () => {
    const server = renderPage({ companies: [alpha, beta] });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select omar' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select huda' }));
    expect(screen.getByText('Clients are left out of company changes: they don’t belong to companies.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add to a company…' }));
    const dialog = screen.getByRole('dialog', { name: 'Add 1 person to a company' });
    await waitFor(() => expect(within(dialog).getAllByRole('radio').length).toBe(2));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Beta Co' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.lastBody('POST', '/users/companies')).toEqual({ userIds: ['u-omar'], addCompanyIds: ['cb'] });
    expect(screen.getByRole('status')).toHaveTextContent('1 changed. 1 client left out: clients don’t belong to companies.');
  });

  it('with only clients ticked, the company buttons can’t be used, and say why', async () => {
    renderPage({ companies: [alpha, beta] });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select huda' }));
    for (const name of ['Add to a company…', 'Remove from a company…']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Clients don’t belong to companies');
    }
  });

  it('a client’s Companies cell says they have none, as a client', async () => {
    renderPage({ companies: [alpha, beta] });
    await screen.findByText('huda');
    await waitFor(() => expect(within(rowOf('huda')).getByText('None (client)')).toBeInTheDocument());
  });
});
