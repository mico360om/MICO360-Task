import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GuestContactsPage } from './GuestContactsPage';
import { App } from '../App';
import { useAuthStore } from '../stores/auth-store';
import { GUEST_WORDS } from '../lib/guest-contacts';
import type { ApiAdminGuest } from '../api/guests';
import { apiCompany, json } from '../test/company-server';
import { windowWidth } from '../test/window-width';

/**
 * 1.24 Guest contacts (admins): each company's reusable list of guests — people outside it named on
 * tasks for the record. Search, edit, retire / use again, remove (only when on no task) and merge
 * duplicates of one company.
 */

const prolens = apiCompany({ id: 'c1', name: 'Prolens Projects LLC', code: 'PRO' });
const beta = apiCompany({ id: 'c2', name: 'Beta Co', code: 'BETA' });

const guest = (over: Partial<ApiAdminGuest> & Pick<ApiAdminGuest, 'id' | 'name'>): ApiAdminGuest => ({
  companyId: 'c1',
  companyName: 'Prolens Projects LLC',
  company: null,
  designation: null,
  email: null,
  phone: null,
  notes: null,
  retiredAt: null,
  mergedIntoId: null,
  createdById: 'admin',
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
  taskCount: 0,
  ...over,
});

const ahmed = guest({ id: 'g1', name: 'Ahmed Al Harthy', company: 'Acme', designation: 'Site engineer', email: 'ahmed@acme.com', phone: '+968 9123 4567', notes: 'Prefers WhatsApp', taskCount: 3 });
const ahmed2 = guest({ id: 'g2', name: 'Ahmed Alharthy', company: 'Acme', phone: '91234567', taskCount: 2 });
const sara = guest({ id: 'g3', name: 'Sara Ali', company: 'NWT', taskCount: 0 });
const omar = guest({ id: 'g4', name: 'Omar Said', company: 'Fabrikam', companyId: 'c2', companyName: 'Beta Co', taskCount: 1 });
const retired = guest({ id: 'g5', name: 'Laila Old', company: 'Globex', retiredAt: '2026-10-20T06:00:00.000Z', taskCount: 4 });

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

let sent: Sent[];
let guests: ApiAdminGuest[];
let companies = [prolens, beta];
let refuse: ((r: Sent) => Response | null) | null;

const requests = (method: string, path: string | RegExp) => sent.filter((r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path)));

beforeEach(() => {
  sent = [];
  guests = [ahmed, ahmed2, sara, omar, retired].map((g) => ({ ...g }));
  companies = [prolens, beta];
  refuse = null;
  useAuthStore.getState().setSession({ user: { id: 'admin', email: 'a@b.c', username: 'admin', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x');
      const path = `${u.pathname.replace(/^\/api\/v1/, '')}${u.search}`;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const r: Sent = { method, path, body };
      sent.push(r);
      const refused = refuse?.(r);
      if (refused) return refused;
      const route = u.pathname.replace(/^\/api\/v1/, '');
      if (route === '/companies' && method === 'GET') return json({ data: companies });
      if (route === '/guests' && method === 'GET') {
        const p = u.searchParams;
        const status = p.get('status') ?? 'active';
        const q = (p.get('q') ?? '').toLowerCase();
        const list = guests
          .filter((g) => !p.get('companyId') || g.companyId === p.get('companyId'))
          .filter((g) => (status === 'active' ? !g.retiredAt : status === 'retired' ? !!g.retiredAt : true))
          .filter((g) => !q || [g.name, g.company, g.email, g.phone].some((v) => (v ?? '').toLowerCase().includes(q)))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json({ data: list });
      }
      if (route === '/guests/merge' && method === 'POST') {
        const { keepId, mergeIds } = body as { keepId: string; mergeIds: string[] };
        const keep = guests.find((g) => g.id === keepId)!;
        const moved = guests.filter((g) => mergeIds.includes(g.id)).reduce((n, g) => n + g.taskCount, 0);
        keep.taskCount += moved;
        guests = guests.filter((g) => !mergeIds.includes(g.id));
        return json({ data: { guest: keep, tasks: moved } });
      }
      const one = /^\/guests\/(\w+)(\/(retire|unretire))?$/.exec(route);
      if (one) {
        const g = guests.find((x) => x.id === one[1]);
        if (!g) return json({ error: { code: 'NOT_FOUND', message: 'That guest isn’t on the list any more.' } }, 404);
        if (one[3] === 'retire') g.retiredAt = '2026-11-10T08:00:00.000Z';
        else if (one[3] === 'unretire') g.retiredAt = null;
        else if (method === 'PUT') Object.assign(g, body as object);
        else if (method === 'DELETE') {
          if (g.taskCount > 0) return json({ error: { code: 'GUEST_IN_USE', message: GUEST_WORDS.inUse } }, 409);
          guests = guests.filter((x) => x.id !== g.id);
          return new Response(null, { status: 204 });
        }
        return json({ data: g });
      }
      if (route === '/config') return json({ data: { timeZone: 'Asia/Muscat' } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/guests']}>
        <GuestContactsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Each guest's row on the desktop table: its cells after the tick box, without the actions. */
async function rows() {
  const table = await screen.findByRole('table', { name: 'Guests' });
  await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1));
  const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
  const last = headers.indexOf('Actions');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell').slice(1, last).map((c) => c.textContent?.trim()));
}
const names = async () => (await rows()).map((r) => r[0]);
const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

describe('GuestContactsPage', () => {
  it('is the Admin page "Guest contacts" with its hint', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: GUEST_WORDS.adminTitle })).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText(GUEST_WORDS.adminHint)).toBeInTheDocument();
    await rows();
  });

  it('lists the active guests: name, company, designation, email, phone, their company list, tasks, a notes mark', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Guests' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(5));
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers.slice(1)).toEqual(['Name', 'Company', 'Designation', 'Email', 'Phone', 'Company list', 'Tasks', 'Actions']);
    expect(await rows()).toEqual([
      ['Ahmed Al Harthy', 'Acme', 'Site engineer', 'ahmed@acme.com', '+968 9123 4567', 'Prolens Projects LLC', 'On 3 tasks'],
      ['Ahmed Alharthy', 'Acme', '—', '—', '91234567', 'Prolens Projects LLC', 'On 2 tasks'],
      ['Omar Said', 'Fabrikam', '—', '—', '—', 'Beta Co', 'On 1 task'],
      ['Sara Ali', 'NWT', '—', '—', '—', 'Prolens Projects LLC', 'Not on any task'],
    ]);
    // Asked for the active ones, of every company.
    expect(requests('GET', /^\/guests/)[0]!.path).toBe('/guests?status=active');
    // A guest with notes is marked; the notes show on hover.
    const mark = within(row('Ahmed Al Harthy')).getByRole('img', { name: 'Has notes' });
    expect(mark).toHaveAttribute('title', 'Prefers WhatsApp');
    expect(within(row('Sara Ali')).queryByRole('img', { name: 'Has notes' })).toBeNull();
    // Phone and email are plain text: no mail or call links for a guest.
    expect(within(table).queryAllByRole('link')).toHaveLength(0);
    // Their own words in their own direction.
    expect(within(row('Ahmed Al Harthy')).getByText('Ahmed Al Harthy').tagName).toBe('BDI');
    // Finger-sized buttons on a touch screen.
    for (const b of within(row('Sara Ali')).getAllByRole('button')) expect(b.className, b.textContent ?? '').toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
  });

  it('filters by company list, status and search words — each asked of the server', async () => {
    renderPage();
    await rows();
    // One company: its list only, and no company column.
    await userEvent.selectOptions(screen.getByLabelText('Company list'), 'Beta Co');
    await waitFor(() => expect(requests('GET', '/guests?companyId=c2&status=active')).toHaveLength(1));
    await waitFor(async () => expect(await names()).toEqual(['Omar Said']));
    expect(within(screen.getByRole('table', { name: 'Guests' })).queryByRole('columnheader', { name: 'Company list' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Company list'), 'All companies');
    await waitFor(async () => expect(await names()).toHaveLength(4));

    // Retired: hidden from picking, still here.
    const status = screen.getByRole('group', { name: 'Status' });
    expect(within(status).getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(status).getByRole('button', { name: 'Retired' }));
    await waitFor(async () => expect(await names()).toEqual(['Laila Old Retired']));
    expect(requests('GET', '/guests?status=retired')).toHaveLength(1);
    await userEvent.click(within(status).getByRole('button', { name: 'All' }));
    await waitFor(async () => expect(await names()).toHaveLength(5));

    // Search: name, company, email or phone (the server's q), once typing pauses.
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search guests' }), 'acme');
    await waitFor(async () => expect(await names()).toEqual(['Ahmed Al Harthy', 'Ahmed Alharthy']));
    expect(requests('GET', '/guests?q=acme&status=all')).toHaveLength(1);
  });

  it('nothing matching says so; an empty list says how guests are added', async () => {
    guests = [];
    renderPage();
    expect(await screen.findByText('No guests yet')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search guests' }), 'zz');
    expect(await screen.findByText('No guest matches')).toBeInTheDocument();
  });

  it('a list that can’t load says so, with Retry', async () => {
    let once = true;
    refuse = (r) => (r.method === 'GET' && r.path.startsWith('/guests') && once ? ((once = false), json({ error: { code: 'ERROR', message: 'boom' } }, 500)) : null);
    renderPage();
    expect(await screen.findByText(/Couldn’t load the guest list/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await names()).toHaveLength(4);
  });

  it('Edit: checks the details as the task forms do, then saves them for every task with the guest', async () => {
    renderPage();
    await rows();
    await userEvent.click(within(row('Ahmed Al Harthy')).getByRole('button', { name: 'Edit Ahmed Al Harthy (Acme)' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit guest' });
    expect(within(dialog).getByText('Every task with this guest shows the new details.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Ahmed Al Harthy');
    expect(within(dialog).getByLabelText(/^Notes/)).toHaveValue('Prefers WhatsApp');

    await userEvent.clear(within(dialog).getByLabelText(/^Name/));
    await userEvent.clear(within(dialog).getByLabelText(/^Email/));
    await userEvent.type(within(dialog).getByLabelText(/^Email/), 'not an email');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter the guest’s name.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Enter a valid email address/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true');
    expect(requests('PUT', /^\/guests\//)).toHaveLength(0);

    // Notes: at most 2000 characters.
    const notes = within(dialog).getByLabelText(/^Notes/) as HTMLTextAreaElement;
    expect(notes).toHaveAttribute('maxLength', '2000');

    await userEvent.type(within(dialog).getByLabelText(/^Name/), ' Ahmed Al Harthy ');
    await userEvent.clear(within(dialog).getByLabelText(/^Email/));
    await userEvent.type(within(dialog).getByLabelText(/^Email/), 'ahmed.h@acme.com');
    await userEvent.clear(within(dialog).getByLabelText(/^Designation/));
    await userEvent.clear(notes);
    await userEvent.type(notes, ' Call before 9 ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(requests('PUT', '/guests/g1')[0]!.body).toEqual({ name: 'Ahmed Al Harthy', company: 'Acme', designation: null, email: 'ahmed.h@acme.com', phone: '+968 9123 4567', notes: 'Call before 9' });
    expect(screen.getByRole('status')).toHaveTextContent('Ahmed Al Harthy (Acme) saved.');
    await waitFor(async () => expect((await rows())[0]).toEqual(['Ahmed Al Harthy', 'Acme', '—', 'ahmed.h@acme.com', '+968 9123 4567', 'Prolens Projects LLC', 'On 3 tasks']));
  });

  it('Edit: the server’s refusal shows in the window, which stays open', async () => {
    refuse = (r) => (r.method === 'PUT' ? json({ error: { code: 'VALIDATION', message: 'Notes can have at most 2000 characters.' } }, 400) : null);
    renderPage();
    await rows();
    await userEvent.click(within(row('Sara Ali')).getByRole('button', { name: 'Edit Sara Ali (NWT)' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit guest' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Notes can have at most 2000 characters.');
    expect(screen.getByRole('dialog', { name: 'Edit guest' })).toBeInTheDocument();
  });

  it('Retire hides a guest from picking (kept on their tasks); Use again brings them back', async () => {
    renderPage();
    await rows();
    await userEvent.click(within(row('Sara Ali')).getByRole('button', { name: 'Retire Sara Ali (NWT)' }));
    await waitFor(() => expect(requests('POST', '/guests/g3/retire')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Sara Ali (NWT) retired: hidden from picking, kept on their tasks.');
    await waitFor(async () => expect(await names()).not.toContain('Sara Ali'));

    await userEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Retired' }));
    await waitFor(async () => expect(await names()).toEqual(['Laila Old Retired', 'Sara Ali Retired']));
    await userEvent.click(within(row('Laila Old')).getByRole('button', { name: 'Use Laila Old (Globex) again' }));
    await waitFor(() => expect(requests('POST', '/guests/g5/unretire')).toHaveLength(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Laila Old (Globex) can be picked again.');
    await waitFor(async () => expect(await names()).toEqual(['Sara Ali Retired']));
  });

  it('Remove: only a guest on no task — otherwise it says why; it asks first', async () => {
    renderPage();
    await rows();
    const inUse = within(row('Ahmed Al Harthy')).getByRole('button', { name: 'Remove Ahmed Al Harthy (Acme)' });
    expect(inUse).toHaveAttribute('aria-disabled', 'true');
    expect(inUse).toHaveAttribute('title', GUEST_WORDS.inUse);
    await userEvent.click(inUse);
    expect(screen.getByRole('alert')).toHaveTextContent(GUEST_WORDS.inUse);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    const free = within(row('Sara Ali')).getByRole('button', { name: 'Remove Sara Ali (NWT)' });
    expect(free).not.toHaveAttribute('aria-disabled');
    await userEvent.click(free);
    const ask = screen.getByRole('alertdialog', { name: 'Remove Sara Ali (NWT)?' });
    expect(requests('DELETE', /^\/guests\//)).toHaveLength(0);
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove guest' }));
    await waitFor(() => expect(requests('DELETE', '/guests/g3')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Sara Ali (NWT) removed from the list.');
    await waitFor(async () => expect(await names()).not.toContain('Sara Ali'));
  });

  it('Remove: a guest put on a task meanwhile — the server’s words, in the question', async () => {
    refuse = (r) => (r.method === 'DELETE' ? json({ error: { code: 'GUEST_IN_USE', message: GUEST_WORDS.inUse } }, 409) : null);
    renderPage();
    await rows();
    await userEvent.click(within(row('Sara Ali')).getByRole('button', { name: 'Remove Sara Ali (NWT)' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove guest' }));
    expect(await within(screen.getByRole('alertdialog')).findByText(GUEST_WORDS.inUse)).toBeInTheDocument();
  });

  it('Merge: tick duplicates of one company, choose the one to keep, and every task moves to it', async () => {
    renderPage();
    await rows();
    const merge = () => screen.getByRole('button', { name: /^Merge/ });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ahmed Al Harthy (Acme)' }));
    expect(screen.getByText('1 guest ticked')).toBeInTheDocument();
    // One is not enough.
    expect(merge()).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ahmed Alharthy (Acme)' }));
    expect(screen.getByText('2 guests ticked')).toBeInTheDocument();
    expect(merge()).not.toHaveAttribute('aria-disabled');
    await userEvent.click(merge());

    const dialog = screen.getByRole('dialog', { name: 'Merge guests' });
    // The one on the most tasks is kept unless another is chosen.
    expect(within(dialog).getByRole('radio', { name: /Ahmed Al Harthy/ })).toBeChecked();
    expect(within(dialog).getByText(/^Every task with the others moves to/)).toHaveTextContent('Every task with the others moves to Ahmed Al Harthy (Acme).');
    await userEvent.click(within(dialog).getByRole('radio', { name: /Ahmed Alharthy/ }));
    expect(within(dialog).getByText(/^Every task with the others moves to/)).toHaveTextContent('Every task with the others moves to Ahmed Alharthy (Acme).');
    expect(requests('POST', '/guests/merge')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Merge 2 guests' }));
    await waitFor(() => expect(requests('POST', '/guests/merge')).toHaveLength(1));
    expect(requests('POST', '/guests/merge')[0]!.body).toEqual({ keepId: 'g2', mergeIds: ['g1'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Merged into Ahmed Alharthy (Acme), 3 tasks updated.');
    await waitFor(async () => expect(await names()).toEqual(['Ahmed Alharthy', 'Omar Said', 'Sara Ali']));
    // The ticks are cleared.
    expect(screen.queryByText(/ticked/)).toBeNull();
  });

  it('Merge: guests of different companies can’t be merged — it says so', async () => {
    renderPage();
    await rows();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ahmed Al Harthy (Acme)' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Omar Said (Fabrikam)' }));
    expect(screen.getByText('Only guests on the same company’s list can be merged. Tick guests of one company.')).toBeInTheDocument();
    const merge = screen.getByRole('button', { name: /^Merge/ });
    expect(merge).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(merge);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText(/ticked/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select Ahmed Al Harthy (Acme)' })).not.toBeChecked();
  });

  it('one company on the site: no company picker and no company column', async () => {
    companies = [prolens];
    guests = guests.filter((g) => g.companyId === 'c1');
    renderPage();
    expect(await names()).toEqual(['Ahmed Al Harthy', 'Ahmed Alharthy', 'Sara Ali']);
    expect(screen.queryByLabelText('Company list')).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Guests' })).queryByRole('columnheader', { name: 'Company list' })).toBeNull();
  });

  it('on a phone (375px) each guest is a card with the same actions', async () => {
    windowWidth(375);
    renderPage();
    const list = await screen.findByRole('list', { name: 'Guests' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4));
    expect(screen.queryByRole('table')).toBeNull();
    const card = within(list).getAllByRole('listitem')[0]!;
    expect(card).toHaveTextContent('Ahmed Al Harthy');
    expect(card).toHaveTextContent('ahmed@acme.com');
    expect(card).toHaveTextContent('On 3 tasks');
    expect(within(card).getByRole('button', { name: 'Edit Ahmed Al Harthy (Acme)' })).toBeInTheDocument();
    expect(within(card).getByRole('checkbox', { name: 'Select Ahmed Al Harthy (Acme)' })).toBeInTheDocument();
  });
});

describe('Guest contacts: the address', () => {
  function renderApp() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/guests']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('/admin/guests opens the page for an admin', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Guest contacts' })).toBeInTheDocument();
  });

  it('anyone else is sent to the dashboard (the server refuses them too)', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u2', email: 'e@b.c', username: 'emp', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
    renderApp();
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Guest contacts' })).toBeNull();
    expect(requests('GET', /^\/guests/)).toHaveLength(0);
  });
});
