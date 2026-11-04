import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkCompanyDialog } from './BulkCompanyDialog';
import { useAuthStore } from '../../stores/auth-store';
import { MY_COMPANIES_KEY } from '../../api/companies';
import { apiCompany, companyServer } from '../../test/company-server';

const alpha = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA' });
const beta = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA' });
const gamma = apiCompany({ id: 'cg', name: 'Gamma Co', code: 'GAMMA', status: 'ARCHIVED', archivedAt: '2026-10-30T08:00:00.000Z' });

const onClose = vi.fn();
const onDone = vi.fn();
let qc: QueryClient;
function open(mode: 'add' | 'remove', userIds = ['u1', 'u2', 'u3']) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(MY_COMPANIES_KEY, { companies: [], primaryCompanyId: null, allArchived: false, siteCompanyCount: 2 });
  return render(
    <QueryClientProvider client={qc}>
      <BulkCompanyDialog mode={mode} userIds={userIds} onClose={onClose} onDone={onDone} />
    </QueryClientProvider>,
  );
}
// One company per line (1.22): round buttons with each company's whole name, as the user dialogs' list.
const options = async () => {
  const group = screen.getByRole('group', { name: 'Company' });
  await waitFor(() => expect(within(group).getAllByRole('radio').length).toBeGreaterThan(0));
  return within(group).getAllByRole('radio').map((o) => o.closest('label')!.textContent);
};
const choose = (name: string) => userEvent.click(screen.getByRole('radio', { name }));

beforeEach(() => {
  onClose.mockReset();
  onDone.mockReset();
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe('BulkCompanyDialog', () => {
  it('add: says how many people, offers the active companies A–Z, and adds them', async () => {
    const server = companyServer({ companies: [beta, alpha, gamma] });
    open('add');
    expect(screen.getByRole('dialog', { name: 'Add 3 people to a company' })).toBeInTheDocument();
    expect(await options()).toEqual(['Alpha Co', 'Beta Co']);
    expect(screen.getByRole('radio', { name: 'Alpha Co' }).closest('label')!.className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
    await choose('Beta Co');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ changed: 3, refused: [] }));
    expect(server.lastBody('POST', '/users/companies')).toEqual({ userIds: ['u1', 'u2', 'u3'], addCompanyIds: ['cb'] });
    // The administrator's picker reads its list again.
    await waitFor(() => expect(server.gets('/me/companies')).toHaveLength(1));
  });

  it('remove: one person, every company (archived ones too)', async () => {
    const server = companyServer({ companies: [alpha, beta, gamma] });
    open('remove', ['u1']);
    expect(screen.getByRole('dialog', { name: 'Remove 1 person from a company' })).toBeInTheDocument();
    expect(await options()).toEqual(['Alpha Co', 'Beta Co', 'Gamma Co (archived)']);
    await choose('Gamma Co (archived)');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(server.lastBody('POST', '/users/companies')).toEqual({ userIds: ['u1'], removeCompanyIds: ['cg'] });
  });

  it('no company chosen: says so (the server’s words) and sends nothing', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    open('add');
    await options();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a company to add or remove.');
    expect(server.requests('POST', '/users/companies')).toHaveLength(0);
  });

  it('a refused request shows the server’s words and stays open', async () => {
    const server = companyServer({ companies: [alpha, beta] });
    server.refuseNext(400, 'VALIDATION', 'Company not found.');
    open('add');
    await options();
    await choose('Alpha Co');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Company not found.');
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel and Escape close it', async () => {
    companyServer({ companies: [alpha, beta] });
    open('add');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
