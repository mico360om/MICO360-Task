import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingFormModal } from './MeetingFormModal';
import type { Meeting } from '../api/meetings';
import type { MyCompany } from '../api/companies';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyStore } from '../stores/company-store';

/**
 * Companies in the meeting form (MC2 Task 7): a meeting without a project belongs to one of my
 * companies ("Company", the picked one first); the people offered are the ones the server says can be
 * invited; free times follow the meeting's company. With one company the form is as it was.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string): MyCompany => ({ id, name, code: id, logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const alpha = company('cA', 'Alpha Co');
const beta = company('cB', 'Beta Co');

let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let mine: { companies: MyCompany[]; primaryCompanyId: string | null; siteCompanyCount: number };
let override: (u: string, method: string) => Response | undefined;

beforeEach(() => {
  calls = [];
  override = () => undefined;
  localStorage.clear();
  mine = { companies: [alpha, beta], primaryCompanyId: null, siteCompanyCount: 2 };
  useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: 'me' });
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'mona', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const o = override(u, method);
    if (o) return o;
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/me/companies')) return json({ data: { ...mine, allArchived: false } });
    if (u.endsWith('/users/directory')) {
      return json({ data: [
        { id: 'me', username: 'mona', firstName: 'Mona', lastName: 'M', avatarUrl: null },
        { id: 'amy', username: 'amy', firstName: 'Amy', lastName: 'Alphaonly', avatarUrl: null },
        { id: 'bob', username: 'bob', firstName: 'Bob', lastName: 'Betaonly', avatarUrl: null },
      ] });
    }
    if (u.includes('/meetings/invite-candidates')) {
      const q = new URL(u, 'http://t').searchParams;
      const who = q.get('projectId') === 'pab' || q.get('companyId') === alpha.id ? [{ id: 'amy', firstName: 'Amy', lastName: 'Alphaonly', username: 'amy', avatarUrl: null }] : [{ id: 'bob', firstName: 'Bob', lastName: 'Betaonly', username: 'bob', avatarUrl: null }];
      return json({ data: who });
    }
    if (u.endsWith('/meetings/free-times')) return json({ data: { suggestions: [], clashes: [], day: [], workingHours: hours } });
    if (u.endsWith('/projects') && method === 'GET') return json({ data: [{ id: 'pab', name: 'PAB project', code: 'PAB', number: null, status: 'ACTIVE' }] });
    if (u.endsWith('/meetings') && method === 'POST') return json({ data: { id: 'm-new' } }, 201);
    if (u.includes('/meetings/') && method === 'PUT') return json({ data: { id: 'm1' } });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const baseMeeting: Meeting = {
  id: 'm1', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: null, organizerId: 'me',
  location: null, onlineLink: null, startAt: '2026-11-10T06:00:00.000Z', endAt: '2026-11-10T07:00:00.000Z', timeZone: 'Asia/Muscat',
  recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
  createdById: 'me', createdAt: '', updatedAt: '', companyId: alpha.id,
};

function renderModal(meeting?: Meeting, defaultProjectId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MeetingFormModal meeting={meeting} defaultProjectId={defaultProjectId} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}
const companiesKnown = () => waitFor(() => expect(calls.some((c) => c.url.endsWith('/me/companies'))).toBe(true));
async function choose(trigger: string, option: string | RegExp) {
  await userEvent.click(screen.getByRole('button', { name: trigger }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
const posted = () => calls.filter((c) => c.url.endsWith('/meetings') && c.method === 'POST').at(-1)?.body;
const asks = (part: string) => calls.filter((c) => c.method === 'GET' && c.url.includes(part)).map((c) => c.url.slice(c.url.indexOf('/meetings/')));
async function fillAndSave() {
  await userEvent.type(screen.getByLabelText(/title/i), 'Weekly sync');
  await userEvent.click(screen.getByRole('button', { name: /schedule meeting/i }));
}

describe('Meeting form — companies', () => {
  it('one company: no Company field, nothing new sent, people from the directory', async () => {
    mine = { companies: [alpha], primaryCompanyId: alpha.id, siteCompanyCount: 1 };
    renderModal();
    await companiesKnown();
    expect(screen.queryByLabelText('Company')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add a team member' }));
    expect(await screen.findByRole('option', { name: /Amy Alphaonly/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Bob Betaonly/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await fillAndSave();
    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()).not.toHaveProperty('companyId');
    expect(asks('/meetings/invite-candidates')).toEqual([]);
  });

  it('a standalone meeting asks for its company, the picked one first', async () => {
    useCompanyStore.setState({ pick: beta.id });
    renderModal();
    // The same kind of select as Project, Repeat and Status.
    const field = await screen.findByRole('button', { name: 'Company' });
    expect(field).toHaveTextContent('Beta Co');
    await userEvent.click(field);
    expect(within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha Co', 'Beta Co']);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('A meeting without a project belongs to one of your companies.')).toBeInTheDocument();
    await fillAndSave();
    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()).toMatchObject({ projectId: null, companyId: beta.id });
  });

  it('without a pick it starts in my primary company; another can be chosen', async () => {
    mine = { ...mine, primaryCompanyId: alpha.id };
    renderModal();
    expect(await screen.findByRole('button', { name: 'Company' })).toHaveTextContent('Alpha Co');
    await choose('Company', 'Beta Co');
    await fillAndSave();
    await waitFor(() => expect(posted()).toMatchObject({ companyId: beta.id }));
  });

  it('a project meeting has no Company field and sends none: its project’s companies decide', async () => {
    useCompanyStore.setState({ pick: beta.id });
    renderModal();
    await screen.findByLabelText('Company');
    await choose('Project', /PAB project/);
    expect(screen.queryByLabelText('Company')).toBeNull();
    await fillAndSave();
    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()).toMatchObject({ projectId: 'pab' });
    expect(posted()).not.toHaveProperty('companyId');
  });

  it('the people picker asks the server who can be invited', async () => {
    useCompanyStore.setState({ pick: beta.id });
    renderModal();
    await screen.findByLabelText('Company');
    await waitFor(() => expect(asks('/meetings/invite-candidates').at(-1)).toBe(`/meetings/invite-candidates?companyId=${beta.id}`));
    await userEvent.click(screen.getByRole('button', { name: 'Add a team member' }));
    expect(within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Bob Betaonly')]);
    await userEvent.keyboard('{Escape}');
    await choose('Project', /PAB project/);
    await waitFor(() => expect(asks('/meetings/invite-candidates').at(-1)).toBe('/meetings/invite-candidates?projectId=pab'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a team member' }));
    await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Amy Alphaonly')]));
  });

  it('free times follow the meeting’s company (standalone) or its project', async () => {
    useCompanyStore.setState({ pick: beta.id });
    renderModal();
    await screen.findByLabelText('Company');
    const freeBody = () => calls.filter((c) => c.url.endsWith('/meetings/free-times')).at(-1)?.body;
    await waitFor(() => expect(freeBody()).toMatchObject({ companyId: beta.id }), { timeout: 2000 });
    expect(freeBody()).not.toHaveProperty('projectId');
    await choose('Project', /PAB project/);
    await waitFor(() => expect(freeBody()).toMatchObject({ projectId: 'pab' }), { timeout: 2000 });
    expect(freeBody()).not.toHaveProperty('companyId');
  });

  it('a company the server refuses shows the server’s words', async () => {
    useCompanyStore.setState({ pick: beta.id });
    override = (u, method) => (u.endsWith('/meetings') && method === 'POST' ? json({ error: { code: 'COMPANY_NOT_AVAILABLE', message: 'You no longer have access to this company.' } }, 403) : undefined);
    renderModal();
    await screen.findByLabelText('Company');
    await fillAndSave();
    expect(await screen.findByRole('alert')).toHaveTextContent('You no longer have access to this company.');
    expect(useCompanyStore.getState().pick).toBe(beta.id);
  });

  it('editing a standalone meeting shows its company and sends a new one', async () => {
    renderModal(baseMeeting);
    const field = await screen.findByRole('button', { name: 'Company' });
    await waitFor(() => expect(field).toHaveTextContent('Alpha Co'));
    await choose('Company', 'Beta Co');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ companyId: beta.id });
  });
});

// 1.23 Client accounts: a project meeting may invite the project's clients (those with its Meetings module).
describe('Meeting form — clients (1.23)', () => {
  const hamad = { id: 'cl1', firstName: 'Hamad', lastName: 'Al Busaidi', username: 'hamad', avatarUrl: null, client: true, organisation: 'NWT' };
  const amyOption = { id: 'amy', firstName: 'Amy', lastName: 'Alphaonly', username: 'amy', avatarUrl: null };

  it('one company: a project meeting offers the directory and the project’s clients, marked Client with their organisation', async () => {
    mine = { companies: [alpha], primaryCompanyId: alpha.id, siteCompanyCount: 1 };
    override = (u) => (u.includes('/meetings/invite-candidates') ? json({ data: [amyOption, hamad] }) : undefined);
    renderModal(undefined, 'pab');
    await waitFor(() => expect(asks('/meetings/invite-candidates').at(-1)).toBe('/meetings/invite-candidates?projectId=pab'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a team member' }));
    const options = () => within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    await waitFor(() => expect(options()).toContainEqual(expect.stringMatching(/Hamad Al Busaidi.*Client · NWT/)));
    // The directory's people as before, each once.
    expect(options().filter((t) => t?.includes('Amy Alphaonly'))).toHaveLength(1);
    expect(options()).toContainEqual(expect.stringContaining('Bob Betaonly'));
    await userEvent.click(screen.getByRole('option', { name: /Hamad Al Busaidi/ }));
    const invited = screen.getByRole('list', { name: 'People invited' });
    expect(within(invited).getByText('Hamad Al Busaidi')).toBeInTheDocument();
    expect(within(invited).getByText('Client')).toBeInTheDocument();
    await fillAndSave();
    await waitFor(() => expect(posted()).toBeDefined());
    expect(posted()!.attendees).toEqual([{ userId: 'cl1' }]);
  });

  it('several companies: the server’s candidates, its clients marked Client', async () => {
    override = (u) => (u.includes('/meetings/invite-candidates') ? json({ data: [amyOption, hamad] }) : undefined);
    renderModal(undefined, 'pab');
    await waitFor(() => expect(asks('/meetings/invite-candidates').at(-1)).toBe('/meetings/invite-candidates?projectId=pab'));
    await userEvent.click(screen.getByRole('button', { name: 'Add a team member' }));
    await waitFor(() =>
      expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([
        expect.stringMatching(/Amy Alphaonly.*@amy/),
        expect.stringMatching(/Hamad Al Busaidi.*Client · NWT/),
      ]),
    );
  });
});
