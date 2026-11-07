import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ClientsPage } from './ClientsPage';
import { useAuthStore } from '../stores/auth-store';
import { windowWidth } from '../test/window-width';
import { FIN, MICO, RIG, access, apiClientAccount, clientServer, type ClientServerWorld } from '../components/clients/test-server';

const huda = apiClientAccount({
  id: 'c-huda',
  username: 'huda',
  firstName: 'Huda',
  lastName: 'Saleh',
  organisation: 'Owner Group',
  lastLoginAt: '2026-10-30T05:00:00.000Z',
  projects: [access(MICO, { modules: { progress: true } }), access(RIG, { modules: { meetings: true } })],
});
const karim = apiClientAccount({ id: 'c-karim', username: 'karim', firstName: 'Karim', lastName: 'N', email: 'karim@consult.test', locked: true, projects: [] });
const many = apiClientAccount({
  id: 'c-many',
  username: 'many',
  firstName: 'Mona',
  lastName: 'Y',
  status: 'INACTIVE',
  projects: [access(MICO, { modules: { progress: true } }), access(RIG, { modules: { progress: true } }), access(FIN, { modules: { progress: true } }), access({ id: 'p-sup', code: 'SUP', name: 'Supply Hub', company: null }, { modules: { meetings: true } })],
});

function renderPage(world: ClientServerWorld = { clients: [huda, karim, many] }) {
  const server = clientServer(world);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/clients']}>
        <ClientsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return server;
}
const rowOf = (name: string) => screen.getByRole('button', { name: `Open ${name}` }).closest('tr')!;

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe('ClientsPage', () => {
  it('lists each client: name, organisation, email, projects, last sign-in and status', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Open Huda Saleh' });
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Client', 'Organisation', 'Email', 'Projects', 'Last sign-in', 'Status', 'Actions']);
    const row = rowOf('Huda Saleh');
    expect(row).toHaveTextContent('@huda');
    expect(row).toHaveTextContent('Owner Group');
    expect(row).toHaveTextContent('huda@client.test');
    expect(within(row).getByText('2 projects')).toBeInTheDocument();
    expect(within(row).getByRole('list', { name: 'Projects' })).toHaveTextContent('MICO TowerRig Refit');
    expect(row).toHaveTextContent('30 Oct 2026');
    expect(within(row).getByText('Active')).toBeInTheDocument();
    const karimRow = rowOf('Karim N');
    expect(karimRow).toHaveTextContent('Never');
    expect(karimRow).toHaveTextContent('None yet');
    expect(within(karimRow).getByText('Locked')).toBeInTheDocument();
    // Four projects: three named, then how many more.
    expect(within(rowOf('Mona Y')).getByText('+1 more')).toBeInTheDocument();
    // Onboarding: one status for staff and clients, and whether the email is verified.
    expect(within(rowOf('Mona Y')).getByText('Deactivated')).toBeInTheDocument();
    expect(within(row).getByText('Not verified')).toBeInTheDocument();
  });

  it('with no clients, an empty state offers New client', async () => {
    renderPage({ clients: [] });
    expect(await screen.findByText('No clients yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new client/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('New client makes a client account and says whether the welcome email went', async () => {
    const server = renderPage();
    await screen.findByRole('button', { name: 'Open Huda Saleh' });
    await userEvent.click(screen.getAllByRole('button', { name: /new client/i })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'New client' });
    expect(within(dialog).queryByLabelText('Role')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/first name/i), 'Lina');
    await userEvent.type(within(dialog).getByLabelText(/last name/i), 'Q');
    await userEvent.type(within(dialog).getByLabelText(/^username/i), 'lina');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^email/i }), 'lina@owner.test');
    await userEvent.type(within(dialog).getByLabelText(/^organisation/i), 'Owner Group');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a project' }));
    await userEvent.click(await screen.findByRole('option', { name: /Finance Office/ }));
    await userEvent.click(within(within(dialog).getByRole('group', { name: 'Finance Office' })).getByRole('checkbox', { name: 'Progress, milestones and tasks' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /create client/i }));
    await waitFor(() => expect(server.requests('POST', '/clients')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent('lina’s account is ready. Welcome email sent to lina@owner.test.');
    expect(await screen.findByRole('button', { name: 'Open Lina Q' })).toBeInTheDocument();
  });

  it('opening a client edits them with the same editor', async () => {
    const server = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Open Huda Saleh' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit huda' });
    const mico = await within(dialog).findByRole('group', { name: 'MICO Tower' });
    await userEvent.click(within(mico).getByRole('checkbox', { name: 'Comment on tasks' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((server.lastBody('PUT', '/clients/c-huda') as { projects: unknown[] }).projects[0]).toMatchObject({ projectId: 'p-mico', actions: { comment: true } });
  });

  it('sends the invitation (welcome email), after asking', async () => {
    const server = renderPage();
    await screen.findByRole('button', { name: 'Open Huda Saleh' });
    await userEvent.click(within(rowOf('Huda Saleh')).getByRole('button', { name: 'Send invitation to huda' }));
    const ask = screen.getByRole('alertdialog', { name: 'Send an invitation to Huda Saleh (huda@client.test)?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(server.requests('POST', '/users/c-huda/welcome-email')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to Huda Saleh (huda@client.test).');
  });

  it('sends a password reset link, after saying what it does', async () => {
    const server = renderPage();
    await screen.findByRole('button', { name: 'Open Huda Saleh' });
    await userEvent.click(within(rowOf('Huda Saleh')).getByRole('button', { name: 'Send password reset to huda' }));
    const ask = screen.getByRole('alertdialog', { name: 'Send a password reset link to Huda Saleh (huda@client.test)?' });
    expect(ask).toHaveTextContent('The link works once, for an hour.');
    await userEvent.click(within(ask).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(server.requests('POST', '/users/c-huda/password-reset-email')).toHaveLength(1));
  });

  it('filters by status', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Open Huda Saleh' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Deactivated');
    expect(screen.queryByRole('button', { name: 'Open Huda Saleh' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Mona Y' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Invited');
    expect(screen.getByText('No one has an invitation waiting.')).toBeInTheDocument();
  });

  it('an inactive client can’t be sent one, and says why', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Open Mona Y' });
    const send = within(rowOf('Mona Y')).getByRole('button', { name: 'Send invitation to many' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', 'This account is inactive, so it can’t get a welcome email');
    expect(within(rowOf('Mona Y')).getByRole('button', { name: 'Send password reset to many' })).toBeDisabled();
  });

  it('deactivates and reactivates a client', async () => {
    const server = renderPage();
    await screen.findByRole('button', { name: 'Open Huda Saleh' });
    await userEvent.click(within(rowOf('Huda Saleh')).getByRole('button', { name: 'Deactivate huda' }));
    // Onboarding: asked first, saying what happens, with an optional reason.
    const ask = screen.getByRole('alertdialog', { name: 'Deactivate Huda Saleh?' });
    expect(ask).toHaveTextContent('They’re signed out everywhere at once');
    expect(server.requests('PATCH', '/users/c-huda/status')).toHaveLength(0);
    await userEvent.type(within(ask).getByLabelText(/^Reason/), 'Contract ended');
    await userEvent.click(within(ask).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(server.lastBody('PATCH', '/users/c-huda/status')).toEqual({ status: 'INACTIVE', reason: 'Contract ended' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Huda Saleh can’t sign in now.');
    await waitFor(() => expect(within(rowOf('Huda Saleh')).getByText('Deactivated')).toBeInTheDocument());
    await userEvent.click(within(rowOf('Huda Saleh')).getByRole('button', { name: 'Reactivate huda' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Reactivate Huda Saleh?' })).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(server.lastBody('PATCH', '/users/c-huda/status')).toEqual({ status: 'ACTIVE' }));
    await waitFor(() => expect(within(rowOf('Huda Saleh')).getByText('Active')).toBeInTheDocument());
  });

  it('deletes a client after asking', async () => {
    const server = renderPage();
    await screen.findByRole('button', { name: 'Open Huda Saleh' });
    await userEvent.click(within(rowOf('Huda Saleh')).getByRole('button', { name: 'Delete huda' }));
    const ask = screen.getByRole('alertdialog', { name: 'Delete Huda Saleh’s client account?' });
    expect(server.requests('DELETE', '/users/c-huda')).toHaveLength(0);
    await userEvent.click(within(ask).getByRole('button', { name: 'Delete client' }));
    await waitFor(() => expect(server.requests('DELETE', '/users/c-huda')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Huda Saleh' })).toBeNull());
  });

  it('unlocks a locked client', async () => {
    const server = renderPage();
    await screen.findByRole('button', { name: 'Open Karim N' });
    await userEvent.click(within(rowOf('Karim N')).getByRole('button', { name: 'Unlock karim' }));
    await waitFor(() => expect(server.requests('POST', '/users/c-karim/unlock')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Karim N can sign in again.');
  });

  it('says so when the list can’t be loaded, with Retry', async () => {
    const server = clientServer({ clients: [huda] });
    server.refuseNext(500, 'INTERNAL', 'Something went wrong', { method: 'GET', path: /^\/clients$/ });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/couldn’t load the clients/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Open Huda Saleh' })).toBeInTheDocument();
  });

  it('on a phone: one card per client, with finger-sized buttons', async () => {
    windowWidth(375);
    renderPage();
    const name = await screen.findByRole('button', { name: 'Open Huda Saleh' });
    expect(screen.queryByRole('table')).toBeNull();
    const card = name.closest('li')!;
    expect(card).toHaveTextContent('Owner Group');
    expect(card).toHaveTextContent('2 projects');
    for (const b of within(card).getAllByRole('button')) expect(b.className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
  });
});
