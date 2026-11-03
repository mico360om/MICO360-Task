import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CompaniesPage } from './CompaniesPage';
import { useAuthStore } from '../stores/auth-store';
import { MY_COMPANIES_KEY } from '../api/companies';
import { apiCompany, companyServer } from '../test/company-server';

const alphaApi = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA', logoUrl: '/uploads/alpha.png' });
const betaApi = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA', weekStart: 1, counts: { people: 4, projects: 1 } });

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(MY_COMPANIES_KEY, { companies: [], primaryCompanyId: null, allArchived: false, siteCompanyCount: 2 });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/companies']}>
        <CompaniesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Each company's row: its first six cells (Company, Code, People, Projects, Week starts, Status). */
async function rows() {
  const table = await screen.findByRole('table');
  await within(table).findAllByRole('row');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell').slice(0, 6).map((c) => c.textContent?.trim()));
}
const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe('CompaniesPage', () => {
  it('is the Admin page "Companies", with "New company"', async () => {
    companyServer({ companies: [alphaApi, betaApi] });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New company/ })).toBeInTheDocument();
  });

  it('lists companies with their code, people and projects counts, week start and status', async () => {
    companyServer({ companies: [alphaApi, betaApi] });
    renderPage();
    expect(await rows()).toEqual([
      ['Alpha Co', 'ALPHA', '3', '2', 'Same as the site', 'Active'],
      ['Beta Co', 'BETA', '4', '1', 'Monday', 'Active'],
    ]);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers.slice(0, 6)).toEqual(['Company', 'Code', 'People', 'Projects', 'Week starts', 'Status']);
    // No time zone anywhere: every company uses the site's (owner, 31 Oct).
    expect(screen.queryByText(/time zone/i)).toBeNull();
    // The name is the administrator's own text: kept in its own direction.
    expect(within(row('Alpha Co')).getByText('Alpha Co').tagName).toBe('BDI');
    // On a touch screen every button in a row is finger-sized (44px, over the base 32px rule).
    for (const b of within(row('Beta Co')).getAllByRole('button')) expect(b.className, b.textContent ?? '').toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
  });

  it('an archived company says since when, and can be unarchived', async () => {
    const server = companyServer({ companies: [alphaApi, apiCompany({ ...betaApi, status: 'ARCHIVED', archivedAt: '2026-10-30T08:00:00.000Z' })] });
    renderPage();
    expect((await rows())[1]![5]).toBe('Archived since 30 Oct 2026');
    await userEvent.click(within(row('Beta Co')).getByRole('button', { name: 'Unarchive Beta Co' }));
    await waitFor(() => expect(server.requests('POST', '/companies/cb/unarchive')).toHaveLength(1));
    expect((await rows())[1]![5]).toBe('Active');
  });

  it('archive asks first and says what happens', async () => {
    const server = companyServer({ companies: [alphaApi, betaApi] });
    renderPage();
    await rows();
    await userEvent.click(within(row('Beta Co')).getByRole('button', { name: 'Archive Beta Co' }));
    const ask = screen.getByRole('alertdialog', { name: 'Archive Beta Co?' });
    expect(ask).toHaveTextContent('Its projects become archived, and people who belong only to Beta Co see an empty site until they get another company.');
    expect(server.requests('POST', '/companies/cb/archive')).toHaveLength(0);
    await userEvent.click(within(ask).getByRole('button', { name: 'Archive company' }));
    await waitFor(() => expect(server.requests('POST', '/companies/cb/archive')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await rows())[1]![5]).toBe('Archived since 30 Oct 2026');
    // The admin's company picker reads its list again.
    expect(qc.getQueryState(MY_COMPANIES_KEY)?.isInvalidated).toBe(true);
  });

  it('archiving the last active company shows the server’s words, and the question stays open', async () => {
    const server = companyServer({ companies: [alphaApi] });
    server.refuseNext(409, 'LAST_ACTIVE_COMPANY', 'You can’t archive the last active company.');
    renderPage();
    await rows();
    await userEvent.click(screen.getByRole('button', { name: 'Archive Alpha Co' }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive company' }));
    expect(await within(screen.getByRole('alertdialog')).findByText('You can’t archive the last active company.')).toBeInTheDocument();
  });

  it('"New company" makes one; it joins the list and the picker is told', async () => {
    const server = companyServer({ companies: [alphaApi, betaApi] });
    renderPage();
    await rows();
    await userEvent.click(screen.getByRole('button', { name: /New company/ }));
    const dialog = screen.getByRole('dialog', { name: 'New company' });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Gamma');
    await userEvent.type(within(dialog).getByLabelText(/^Short code/), 'gam');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.lastBody('POST', '/companies')).toEqual({ name: 'Gamma', code: 'GAM', weekStart: null, workingHours: null, senderName: null });
    expect((await rows()).map((r) => r[0])).toEqual(['Alpha Co', 'Beta Co', 'Gamma']);
    expect(screen.getByRole('status')).toHaveTextContent('Gamma created.');
    // The name is the administrator's own text: kept in its own direction.
    expect(within(screen.getByRole('status')).getByText('Gamma').tagName).toBe('BDI');
    expect(qc.getQueryState(MY_COMPANIES_KEY)?.isInvalidated).toBe(true);
  });

  it('a company’s name opens its details; its people and projects counts open those tabs', async () => {
    companyServer({ companies: [alphaApi, betaApi] });
    renderPage();
    await rows();
    await userEvent.click(within(row('Alpha Co')).getByRole('button', { name: 'Alpha Co' }));
    let dialog = screen.getByRole('dialog', { name: 'Alpha Co' });
    expect(within(dialog).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(row('Beta Co')).getByRole('button', { name: '4 people in Beta Co' }));
    dialog = screen.getByRole('dialog', { name: 'Beta Co' });
    // The tab's number is the list's count until the people load (none in this world).
    expect(within(dialog).getByRole('tab', { name: /^People \(/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(row('Beta Co')).getByRole('button', { name: '1 project in Beta Co' }));
    expect(within(screen.getByRole('dialog', { name: 'Beta Co' })).getByRole('tab', { name: /^Projects \(/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a list that can’t load says so, with Retry', async () => {
    const server = companyServer({ companies: [alphaApi] });
    server.refuseNext(500, 'ERROR', 'Request failed (500)', { method: 'GET', path: /^\/companies$/ });
    renderPage();
    expect(await screen.findByText(/Couldn’t load the companies/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await rows()).toHaveLength(1);
  });
});
