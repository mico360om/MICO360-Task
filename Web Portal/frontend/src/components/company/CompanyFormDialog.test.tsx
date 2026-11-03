import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CompanyFormDialog, type CompanyTab } from './CompanyFormDialog';
import { useAuthStore } from '../../stores/auth-store';
import { MY_COMPANIES_KEY, type ApiCompany, type CompanyPerson } from '../../api/companies';
import { apiCompany, apiUser, companyServer } from '../../test/company-server';

const alphaApi = apiCompany({ id: 'ca', name: 'Alpha Co', code: 'ALPHA', logoUrl: '/uploads/alpha.png' });
const betaApi = apiCompany({ id: 'cb', name: 'Beta Co', code: 'BETA', weekStart: 1, counts: { people: 2, projects: 2 } });
const person = (id: string, firstName: string, lastName: string, isPrimary = false): CompanyPerson => ({ id, firstName, lastName, username: firstName.toLowerCase(), email: `${firstName.toLowerCase()}@x.co`, status: 'ACTIVE', isPrimary });
const ana = person('u-ana', 'Ana', 'Alpha', true);
const sam = person('u-sam', 'Sam', 'Shared');

let qc: QueryClient;
const onClose = vi.fn();
const onSaved = vi.fn();
function open(company: ApiCompany | null, tab?: CompanyTab) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(MY_COMPANIES_KEY, { companies: [], primaryCompanyId: null, allArchived: false, siteCompanyCount: 2 });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CompanyFormDialog company={company} initialTab={tab} onClose={onClose} onSaved={onSaved} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dialog = () => screen.getByRole('dialog');
const field = (label: RegExp | string) => within(dialog()).getByLabelText(label);
const save = () => userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));

beforeEach(() => {
  onClose.mockReset();
  onSaved.mockReset();
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:logo'), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe('CompanyFormDialog: a new company', () => {
  it('has the fields in plain words, and no time zone', async () => {
    companyServer();
    open(null);
    expect(dialog()).toHaveAccessibleName('New company');
    expect(field(/^Name/)).toHaveFocus();
    expect(field(/^Short code/)).toHaveAccessibleDescription('2–10 capital letters or digits');
    expect(within(dialog()).getByText('PNG, JPEG or WebP, up to 2 MB')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Upload logo' })).toBeInTheDocument();
    expect(field('Email sender name')).toHaveAttribute('placeholder', 'Same as the site');
    await waitFor(() => expect(within(field('Week starts on') as HTMLSelectElement).getAllByRole('option').map((o) => o.textContent)).toEqual(['Same as the site (Sunday)', 'Sunday', 'Monday', 'Saturday']));
    expect(within(dialog()).getByRole('switch', { name: 'Same as the site' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog()).queryByRole('group', { name: 'Working days' })).toBeNull();
    expect(within(dialog()).queryByText(/time zone/i)).toBeNull();
    // A new company has no people or projects yet.
    expect(within(dialog()).queryByRole('tab')).toBeNull();
  });

  it('sends the name, the code in capitals, and the site’s values as null — never a time zone', async () => {
    const server = companyServer();
    open(null);
    await userEvent.type(field(/^Name/), '  Gamma ');
    await userEvent.type(field(/^Short code/), 'gam');
    expect(field(/^Short code/)).toHaveValue('GAM');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(server.lastBody('POST', '/companies')).toEqual({ name: 'Gamma', code: 'GAM', weekStart: null, workingHours: null, senderName: null });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gamma' }), true);
    expect(onClose).toHaveBeenCalled();
  });

  it('a name and a code are needed first (the server’s words)', async () => {
    const server = companyServer();
    open(null);
    await save();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Give the company a name of up to 120 characters.');
    await userEvent.type(field(/^Name/), 'Gamma');
    await userEvent.type(field(/^Short code/), 'g');
    await save();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Use 2–10 capital letters or digits for the short code.');
    expect(server.requests('POST', '/companies')).toHaveLength(0);
  });

  it('with a logo: the company is made, then its logo is sent', async () => {
    const server = companyServer();
    open(null);
    await userEvent.type(field(/^Name/), 'Gamma');
    await userEvent.type(field(/^Short code/), 'GAM');
    const file = new File([new Uint8Array(1000)], 'gamma.png', { type: 'image/png' });
    await userEvent.upload(within(dialog()).getByLabelText('Upload logo', { selector: 'input' }), file);
    expect(within(dialog()).getByRole('button', { name: 'Remove logo' })).toBeInTheDocument();
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const order = server.sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
    expect(order).toEqual(['POST /companies', 'POST /companies/new1/logo']);
    expect((server.lastBody('POST', '/companies/new1/logo') as FormData).get('file')).toBe(file);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: '/uploads/logo-new1.png' }), true);
  });

  it('a logo that isn’t a PNG, JPEG or WebP up to 2 MB is refused before anything is sent', async () => {
    const server = companyServer();
    open(null);
    await userEvent.upload(within(dialog()).getByLabelText('Upload logo', { selector: 'input' }), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('The logo must be a PNG, JPEG or WebP picture up to 2 MB.');
    expect(within(dialog()).queryByRole('button', { name: 'Remove logo' })).toBeNull();
    await userEvent.upload(within(dialog()).getByLabelText('Upload logo', { selector: 'input' }), new File(['x'], 'logo.gif', { type: 'image/gif' }), { applyAccept: false });
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('The logo must be a PNG, JPEG or WebP picture up to 2 MB.');
    expect(server.sent.filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('shows the server’s refusal words and stays open', async () => {
    const server = companyServer({ companies: [alphaApi] });
    open(null);
    await userEvent.type(field(/^Name/), 'Gamma');
    await userEvent.type(field(/^Short code/), 'ALPHA');
    server.refuseNext(409, 'DUPLICATE_COMPANY_CODE', 'A company with this code already exists.');
    await save();
    expect(await within(dialog()).findByText('A company with this code already exists.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a logo the server refuses after the company is made: the company stays made, and the dialog says why', async () => {
    const server = companyServer();
    open(null);
    await userEvent.type(field(/^Name/), 'Gamma');
    await userEvent.type(field(/^Short code/), 'GAM');
    await userEvent.upload(within(dialog()).getByLabelText('Upload logo', { selector: 'input' }), new File(['x'], 'g.png', { type: 'image/png' }));
    server.refuseNext(400, 'VALIDATION', 'The logo must be a PNG, JPEG or WebP picture up to 2 MB.', { method: 'POST', path: /\/logo$/ });
    await save();
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Gamma was created, but its logo wasn’t saved: The logo must be a PNG, JPEG or WebP picture up to 2 MB.');
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' }), true);
    expect(onClose).not.toHaveBeenCalled();
    // Saving again now changes the company that was made (never a second one).
    server.sent.length = 0;
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.sent.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`)).toEqual(['PUT /companies/new1', 'POST /companies/new1/logo']);
  });
});

describe('CompanyFormDialog: a company’s details', () => {
  it('shows its values and sends its changes', async () => {
    const server = companyServer({ companies: [alphaApi, betaApi] });
    open(betaApi);
    expect(dialog()).toHaveAccessibleName('Beta Co');
    expect(field(/^Name/)).toHaveValue('Beta Co');
    expect(field(/^Short code/)).toHaveValue('BETA');
    expect(field('Week starts on')).toHaveValue('1');
    await userEvent.clear(field(/^Name/));
    await userEvent.type(field(/^Name/), 'Beta Group');
    await userEvent.type(field('Email sender name'), 'Beta Projects');
    await userEvent.selectOptions(field('Week starts on'), '');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/companies/cb')).toEqual({ name: 'Beta Group', code: 'BETA', weekStart: null, workingHours: null, senderName: 'Beta Projects' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Beta Group' }), false);
    expect(qc.getQueryState(MY_COMPANIES_KEY)?.isInvalidated).toBe(true);
  });

  it('working days and hours: the site’s until the switch is turned off, then the days and From/To', async () => {
    const server = companyServer({ companies: [alphaApi] });
    open(alphaApi);
    expect(within(dialog()).getByText('Sun–Thu, 08:00–17:00')).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole('switch', { name: 'Same as the site' }));
    const days = within(dialog()).getByRole('group', { name: 'Working days' });
    expect(within(days).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
    await userEvent.click(within(days).getByRole('button', { name: 'Sun' }));
    await userEvent.click(within(days).getByRole('button', { name: 'Fri' }));
    await userEvent.clear(field('From'));
    await userEvent.type(field('From'), '09:00');
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/companies/ca')).toMatchObject({ workingHours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } });
  });

  it('a company’s own hours show as they are; the switch back to the site’s sends null', async () => {
    const own = apiCompany({ ...alphaApi, workingHours: { days: [6, 0, 1, 2, 3], start: '07:00', end: '15:00' } });
    const server = companyServer({ companies: [own] });
    open(own);
    const sw = within(dialog()).getByRole('switch', { name: 'Same as the site' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(field('From')).toHaveValue('07:00');
    expect(field('To')).toHaveValue('15:00');
    await userEvent.click(sw);
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.lastBody('PUT', '/companies/ca')).toMatchObject({ workingHours: null });
  });

  it('days and times are checked before saving', async () => {
    const server = companyServer({ companies: [alphaApi] });
    open(alphaApi);
    await userEvent.click(within(dialog()).getByRole('switch', { name: 'Same as the site' }));
    const days = within(dialog()).getByRole('group', { name: 'Working days' });
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']) await userEvent.click(within(days).getByRole('button', { name: d }));
    await save();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Choose at least one working day.');
    await userEvent.click(within(days).getByRole('button', { name: 'Mon' }));
    await userEvent.clear(field('To'));
    await userEvent.type(field('To'), '07:00');
    await save();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('The day has to end after it starts.');
    expect(server.requests('PUT', '/companies/ca')).toHaveLength(0);
  });

  it('"Remove logo" takes the logo away when saved', async () => {
    const server = companyServer({ companies: [alphaApi] });
    open(alphaApi);
    expect(within(dialog()).getByRole('img', { name: 'Alpha Co logo' })).toHaveAttribute('src', expect.stringContaining('/uploads/alpha.png'));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Remove logo' }));
    expect(within(dialog()).queryByRole('img', { name: 'Alpha Co logo' })).toBeNull();
    await save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.requests('DELETE', '/companies/ca/logo')).toHaveLength(1);
  });

  it('Cancel and Escape close without saving', async () => {
    const server = companyServer({ companies: [alphaApi] });
    open(alphaApi);
    await userEvent.type(field(/^Name/), ' X');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(server.sent.filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('tabs: Details, People (N) and Projects (N); arrow keys move along them', async () => {
    companyServer({ companies: [betaApi], people: { cb: [ana, sam] } });
    open(betaApi);
    const tabs = within(dialog()).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Details', 'People (2)', 'Projects (2)']);
    tabs[0]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(within(dialog()).getByRole('tab', { name: 'People (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog()).getByRole('tab', { name: 'People (2)' })).toHaveFocus();
    expect(await within(dialog()).findByRole('tabpanel', { name: 'People (2)' })).toBeInTheDocument();
  });
});

describe('the People panel', () => {
  it('lists the company’s people, the primary company marked', async () => {
    companyServer({ companies: [alphaApi], people: { ca: [ana, sam] } });
    open(alphaApi, 'people');
    const list = await within(dialog()).findByRole('list', { name: 'People in Alpha Co' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => within(i).getByText(/Alpha|Shared/).textContent)).toEqual(['Ana Alpha', 'Sam Shared']);
    expect(within(items[0]!).getByText('Primary')).toBeInTheDocument();
    expect(within(items[1]!).queryByText('Primary')).toBeNull();
    expect(within(items[0]!).getByText('Ana Alpha').tagName).toBe('BDI');
  });

  it('remove: the server’s reason when it refuses', async () => {
    const server = companyServer({ companies: [alphaApi], people: { ca: [ana, sam] } });
    open(alphaApi, 'people');
    server.refuseNext(409, 'LAST_COMPANY', 'Ana must keep at least one company. Add another company first.');
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Remove Ana Alpha from Alpha Co' }));
    expect(await within(dialog()).findByText('Ana must keep at least one company. Add another company first.')).toBeInTheDocument();
    expect(within(dialog()).getByText('Ana Alpha')).toBeInTheDocument();
  });

  it('remove: they leave the list, and the company’s counts and the picker are read again', async () => {
    const server = companyServer({ companies: [alphaApi], people: { ca: [ana, sam] } });
    open(alphaApi, 'people');
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Remove Sam Shared from Alpha Co' }));
    await waitFor(() => expect(server.requests('DELETE', '/companies/ca/people/u-sam')).toHaveLength(1));
    await waitFor(() => expect(within(dialog()).queryByText('Sam Shared')).toBeNull());
    expect(qc.getQueryState(MY_COMPANIES_KEY)?.isInvalidated).toBe(true);
  });

  it('"Add people" offers the people not in it yet, and adds the ones ticked', async () => {
    const server = companyServer({
      companies: [alphaApi],
      people: { ca: [ana] },
      users: [apiUser({ id: 'u-ana', username: 'ana', firstName: 'Ana', lastName: 'Alpha' }), apiUser({ id: 'u-bob', username: 'bob', firstName: 'Bob', lastName: 'Beta' }), apiUser({ id: 'u-cy', username: 'cy', firstName: 'Cy', lastName: 'Gamma' })],
    });
    open(alphaApi, 'people');
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Add people' }));
    const picker = await within(dialog()).findByRole('group', { name: 'People to add to Alpha Co' });
    expect(within(picker).getAllByRole('checkbox').map((c) => c.closest('label')?.querySelector('bdi')?.textContent)).toEqual(['Bob Beta', 'Cy Gamma']);
    await userEvent.type(within(dialog()).getByRole('searchbox', { name: 'Find people' }), 'cy');
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.click(within(picker).getByRole('checkbox', { name: /Cy Gamma/ }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add 1 person' }));
    await waitFor(() => expect(server.lastBody('POST', '/companies/ca/people')).toEqual({ userIds: ['u-cy'] }));
    expect(await within(dialog()).findByRole('status')).toHaveTextContent('1 added.');
  });

  it('"Add people" says who couldn’t be added, and why', async () => {
    const server = companyServer({ companies: [alphaApi], people: { ca: [] }, users: [apiUser({ id: 'u-bob', username: 'bob', firstName: 'Bob', lastName: 'Beta' }), apiUser({ id: 'u-cy', username: 'cy', firstName: 'Cy', lastName: 'Gamma' })] });
    server.answerNext('POST', /\/companies\/ca\/people$/, { data: { changed: 1, refused: [{ userId: 'u-cy', name: 'Cy Gamma', reason: 'User not found.' }] } });
    open(alphaApi, 'people');
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Add people' }));
    for (const name of [/Bob Beta/, /Cy Gamma/]) await userEvent.click(await within(dialog()).findByRole('checkbox', { name }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Add 2 people' }));
    expect(await within(dialog()).findByRole('status')).toHaveTextContent('1 added. 1 not added: Cy Gamma: User not found.');
  });
});

describe('the Projects panel', () => {
  it('lists each project as a link to it, with "Main" where it is the main company', async () => {
    companyServer({
      companies: [betaApi],
      projects: { cb: [{ id: 'p1', code: 'TWR', name: 'Tower', isMain: true, archived: false }, { id: 'p2', code: 'PAB', name: 'Shared yard', isMain: false, archived: true }] },
    });
    open(betaApi, 'projects');
    const list = await within(dialog()).findByRole('list', { name: 'Projects of Beta Co' });
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/projects/p1', '/projects/p2']);
    const [tower, yard] = within(list).getAllByRole('listitem');
    expect(within(tower!).getByText('Main')).toBeInTheDocument();
    expect(within(yard!).queryByText('Main')).toBeNull();
    expect(within(yard!).getByText('Archived')).toBeInTheDocument();
    expect(within(tower!).getByText('Tower').tagName).toBe('BDI');
  });

  it('none yet: says so', async () => {
    companyServer({ companies: [betaApi], projects: { cb: [] } });
    open(apiCompany({ ...betaApi, counts: { people: 0, projects: 0 } }), 'projects');
    expect(await within(dialog()).findByText((_, el) => el?.tagName === 'P' && el.textContent === 'No projects in Beta Co yet.')).toBeInTheDocument();
  });
});
