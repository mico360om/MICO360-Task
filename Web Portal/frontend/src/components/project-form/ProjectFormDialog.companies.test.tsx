import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectFormDialog } from './ProjectFormDialog';
import { useAuthStore } from '../../stores/auth-store';
import { useCompanyStore } from '../../stores/company-store';
import type { ApiProject } from '../../api/projects';
import type { MyCompany } from '../../api/companies';

/**
 * Companies in the project form (MC2 Task 6): the "Companies" field (main first), a new project's
 * default company, locked chips for other companies, a team from those companies, and the server's
 * refusals under the field. With one company the form is as it was.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const hours = { days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' };
const company = (id: string, name: string): MyCompany => ({ id, name, code: id, logoUrl: null, timeZone: 'Asia/Muscat', weekStart: 0, workingHours: hours });
const alpha = company('cA', 'Alpha Co');
const beta = company('cB', 'Beta Co');
const ref = (c: MyCompany, isMain: boolean) => ({ id: c.id, name: c.name, code: c.code, logoUrl: c.logoUrl, isMain, timeZone: 'Asia/Muscat', weekStart: 0 });

const existing = {
  id: 'p1', code: 'PAB', name: 'Shared project', description: null, clientName: null, status: 'ACTIVE', priority: 'NORMAL',
  color: '#8B1E1E', icon: null, imageUrl: null, ownerId: 'emp', startDate: null, targetDate: null, createdAt: '', updatedAt: '',
  companies: [ref(alpha, true), ref(beta, false)], mainCompanyId: alpha.id,
} as ApiProject;

let requests: { url: string; method: string; body?: unknown }[];
let mine: { companies: MyCompany[]; primaryCompanyId: string | null; siteCompanyCount: number };
let override: (u: string, method: string) => Response | undefined;

const people = {
  [alpha.id]: [{ id: 'amy', firstName: 'Amy', lastName: 'Alphaonly', username: 'amy', avatarUrl: null }],
  [beta.id]: [{ id: 'bob', firstName: 'Bob', lastName: 'Betaonly', username: 'bob', avatarUrl: null }],
} as Record<string, { id: string; firstName: string; lastName: string; username: string; avatarUrl: null }[]>;

function signIn(admin: boolean) {
  useAuthStore.getState().setSession({
    user: { id: admin ? 'admin' : 'emp', email: 'x@x', username: admin ? 'admin' : 'sara', roles: [admin ? 'ADMIN' : 'EMPLOYEE'] },
    accessToken: 'at',
    refreshToken: 'rt',
  });
}
/** The companies I may use (administrators: every active one); `site` = active companies on the site. */
function usable(companies: MyCompany[], more: { primary?: string | null; site?: number } = {}) {
  mine = { companies, primaryCompanyId: more.primary ?? null, siteCompanyCount: more.site ?? Math.max(companies.length, 1) };
}
const pick = (id: string | null) => useCompanyStore.setState({ pick: id });

beforeEach(() => {
  requests = [];
  override = () => undefined;
  localStorage.clear();
  useCompanyStore.setState({ pick: null, notice: null, names: {}, userId: 'emp' });
  signIn(false);
  usable([alpha]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url: u, method, body });
    const o = override(u, method);
    if (o) return o;
    if (u.endsWith('/me/companies')) return json({ data: { ...mine, allArchived: false } });
    if (u.includes('/people/candidates')) {
      const ids = new URL(u, 'http://t').searchParams.get('companyIds')!.split(',');
      return json({ data: ids.flatMap((id) => people[id] ?? []) });
    }
    if (u.includes('/projects/code-check')) {
      const code = new URL(u, 'http://t').searchParams.get('code')!.toUpperCase();
      return json({ data: { code, valid: true, available: true } });
    }
    if (u.endsWith('/projects') && method === 'POST') return json({ data: { ...existing, ...(body as object), id: 'pNew' } }, 201);
    if (/\/projects\/p1$/.test(u) && method === 'PUT') return json({ data: { ...existing, ...(body as object) } });
    if (u.endsWith('/templates/projects/pt1/projects') && method === 'POST') return json({ data: { ...existing, id: 'pNew', taskCount: 0 } }, 201);
    if (u.endsWith('/users/directory')) {
      return json({
        data: [
          { id: 'emp', username: 'sara', firstName: 'Sara', lastName: 'Said', active: true },
          { id: 'admin', username: 'admin', firstName: 'Khurram', lastName: 'Admin', active: true },
          { id: 'amy', username: 'amy', firstName: 'Amy', lastName: 'Alphaonly', active: true },
          { id: 'bob', username: 'bob', firstName: 'Bob', lastName: 'Betaonly', active: true },
        ],
      });
    }
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderForm(props: Partial<React.ComponentProps<typeof ProjectFormDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ProjectFormDialog onClose={vi.fn()} onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return { onSaved, qc };
}

const companiesGroup = () => screen.findByRole('group', { name: 'Companies' });
/** Each chip's words without its buttons: "Alpha CoMain", "Beta Co". */
const chips = async () =>
  within(await companiesGroup())
    .getAllByRole('listitem')
    .map((li) => {
      const copy = li.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('button').forEach((b) => b.remove());
      return copy.textContent;
    });
async function addCompany(name: string) {
  await userEvent.click(within(await companiesGroup()).getByRole('button', { name: 'Add company' }));
  await userEvent.click(screen.getByRole('menuitem', { name }));
}
async function fillNew() {
  await userEvent.type(screen.getByLabelText(/^name/i), 'Rig Inspection Portal');
  await screen.findByText(/RIP is free/i);
}
const posted = (path: RegExp) => requests.filter((r) => r.method === 'POST' && path.test(r.url)).at(-1)?.body as Record<string, unknown> | undefined;
const put = () => requests.filter((r) => r.method === 'PUT').at(-1)?.body as Record<string, unknown> | undefined;
const candidateAsks = () => requests.filter((r) => r.url.includes('/people/candidates')).map((r) => r.url.slice(r.url.indexOf('/people/')));
/** Let /me/companies answer. */
const settle = () => waitFor(() => expect(requests.some((r) => r.url.endsWith('/me/companies'))).toBe(true));

describe('Project form — companies', () => {
  it('one company: the project form is unchanged', async () => {
    usable([alpha]);
    const { onSaved } = renderForm();
    await settle();
    await fillNew();
    expect(screen.queryByText('Companies')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posted(/\/projects$/)).not.toHaveProperty('companyIds');
    // The team picker draws from the directory, as before.
    expect(candidateAsks()).toEqual([]);
  });

  it('a new project starts in the picked company; the first is the main one', async () => {
    usable([alpha, beta]);
    pick(beta.id);
    const { onSaved } = renderForm();
    expect(await chips()).toEqual(['Beta CoMain']);
    await addCompany('Alpha Co');
    await userEvent.click(screen.getByRole('button', { name: 'Make Alpha Co the main company' }));
    expect(await chips()).toEqual(['Alpha CoMain', 'Beta Co']);
    await fillNew();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posted(/\/projects$/)!.companyIds).toEqual([alpha.id, beta.id]);
  });

  it('without a pick it starts in my primary company', async () => {
    usable([alpha, beta], { primary: beta.id });
    renderForm();
    expect(await chips()).toEqual(['Beta CoMain']);
  });

  it('nothing to start from: asks for a company before sending', async () => {
    signIn(true);
    usable([alpha, beta]);
    renderForm();
    await companiesGroup();
    await fillNew();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Choose at least one company for this project.')).toBeInTheDocument();
    expect(posted(/\/projects$/)).toBeUndefined();
  });

  it('another company’s chip is locked for a non-admin', async () => {
    usable([alpha], { site: 2 });
    renderForm({ project: existing });
    expect(await chips()).toEqual(['Alpha CoMain', 'Beta Co']);
    expect(screen.getByRole('button', { name: 'Remove Beta Co' })).toBeDisabled();
    expect(screen.getByTitle('Only an administrator or a member of Beta Co can change this.')).toBeInTheDocument();
  });

  it('an administrator may change every company', async () => {
    signIn(true);
    usable([alpha, beta]);
    renderForm({ project: existing });
    await companiesGroup();
    expect(screen.getByRole('button', { name: 'Remove Beta Co' })).toBeEnabled();
    expect(screen.queryByTitle(/Only an administrator/)).toBeNull();
  });

  it('editing sends the companies only when they changed, main first', async () => {
    signIn(true);
    usable([alpha, beta]);
    const { onSaved } = renderForm({ project: existing });
    await companiesGroup();
    await userEvent.clear(screen.getByLabelText(/^name/i));
    await userEvent.type(screen.getByLabelText(/^name/i), 'Shared project 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(put()).toEqual({ name: 'Shared project 2' });
  });

  it('a new main company is sent as the first of the companies', async () => {
    signIn(true);
    usable([alpha, beta]);
    const { onSaved } = renderForm({ project: existing });
    await companiesGroup();
    await userEvent.click(screen.getByRole('button', { name: 'Make Beta Co the main company' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(put()).toEqual({ companyIds: [beta.id, alpha.id] });
  });

  it('the team picker offers people from the chosen companies', async () => {
    usable([alpha, beta]);
    pick(alpha.id);
    renderForm();
    await companiesGroup();
    await waitFor(() => expect(candidateAsks().at(-1)).toBe(`/people/candidates?companyIds=${alpha.id}`));
    await addCompany('Beta Co');
    await waitFor(() => expect(candidateAsks().at(-1)).toBe(`/people/candidates?companyIds=${alpha.id},${beta.id}`));
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people to the team' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([expect.stringContaining('Amy Alphaonly'), expect.stringContaining('Bob Betaonly')]);
  });

  it('adding a company keeps the team already picked; taking one off takes its people off the team', async () => {
    usable([alpha, beta]);
    pick(alpha.id);
    renderForm();
    await companiesGroup();
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people to the team' }));
    await userEvent.click(await screen.findByRole('option', { name: /Amy Alphaonly/ }));
    const team = () => screen.queryByRole('list', { name: 'Team' });
    expect(within(team()!).getByText('Amy Alphaonly')).toBeInTheDocument();
    // Beta's people arrive later: Amy stays on the team meanwhile, and after.
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => { release = r; });
    override = (u) => (u.includes(`companyIds=${alpha.id},${beta.id}`) ? (slow.then(() => json({ data: [...people[alpha.id]!, ...people[beta.id]!] })) as unknown as Response) : undefined);
    await addCompany('Beta Co');
    await waitFor(() => expect(candidateAsks().at(-1)).toBe(`/people/candidates?companyIds=${alpha.id},${beta.id}`));
    expect(within(team()!).getByText('Amy Alphaonly')).toBeInTheDocument();
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(within(team()!).getByText('Amy Alphaonly')).toBeInTheDocument();
    override = () => undefined;
    // Alpha taken off: Amy (only in Alpha) leaves the new team.
    await userEvent.click(screen.getByRole('button', { name: 'Make Beta Co the main company' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Alpha Co' }));
    await waitFor(() => expect(team()).toBeNull());
  });

  it('a template’s roles are filled from the chosen companies’ people, and a company taken off takes its people off the roles', async () => {
    usable([alpha, beta]);
    pick(alpha.id);
    override = (u) => {
      if (u.endsWith('/templates/projects')) return json({ data: [{ id: 'pt1', name: 'Rig inspection', description: null, columnCount: 1, roleCount: 1, taskCount: 0, createdById: 'admin', createdByName: 'Admin', canManage: true, createdAt: '', updatedAt: '' }] });
      if (u.includes('/templates/projects/pt1/plan')) {
        return json({ data: { template: { id: 'pt1', name: 'Rig inspection', description: null, updatedAt: '2026-10-20T08:00:00.000Z', columns: [], roles: [{ id: 'r1', name: 'Inspector' }] }, startDate: '2026-11-03', today: '2026-11-03', workingDays: [0, 1, 2, 3, 4], startColumn: 0, tasks: [], overdue: 0, moved: 0 } });
      }
      return undefined;
    };
    const { onSaved } = renderForm({ templateId: 'pt1' });
    await companiesGroup();
    await waitFor(() => expect(candidateAsks().at(-1)).toBe(`/people/candidates?companyIds=${alpha.id}`));
    await userEvent.click(await screen.findByRole('button', { name: 'Person for Inspector' }));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((t) => t?.includes('Amy Alphaonly'))).toBe(true);
    expect(options.some((t) => t?.includes('Bob Betaonly'))).toBe(false); // in the directory, not in Alpha
    await userEvent.click(screen.getByRole('option', { name: /Amy Alphaonly/ }));
    // Beta added and made main, Alpha taken off: Amy (only in Alpha) no longer fills the role.
    await addCompany('Beta Co');
    await userEvent.click(screen.getByRole('button', { name: 'Make Beta Co the main company' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Alpha Co' }));
    await waitFor(() => expect(candidateAsks().at(-1)).toBe(`/people/candidates?companyIds=${beta.id}`));
    await fillNew();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posted(/\/templates\/projects\/pt1\/projects$/)!.roles).toEqual({});
  });

  it('the picked team stays while the candidates can’t be read (a cache reset, a failed request)', async () => {
    usable([alpha, beta]);
    pick(alpha.id);
    const { qc } = renderForm();
    await companiesGroup();
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people to the team' }));
    await userEvent.click(await screen.findByRole('option', { name: /Amy Alphaonly/ }));
    const team = () => screen.queryByRole('list', { name: 'Team' });
    expect(within(team()!).getByText('Amy Alphaonly')).toBeInTheDocument();
    // Everything is read again (another company was picked elsewhere, or my companies changed).
    await act(async () => {
      await qc.resetQueries();
    });
    await waitFor(() => expect(candidateAsks().length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(within(team()!).getByText('Amy Alphaonly')).toBeInTheDocument();
    // Beta's people can't be read: the team stays as it is.
    override = (u) => (u.includes(`companyIds=${alpha.id},${beta.id}`) ? json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500) : undefined);
    await addCompany('Beta Co');
    await waitFor(() => expect(candidateAsks().at(-1)).toBe(`/people/candidates?companyIds=${alpha.id},${beta.id}`));
    await new Promise((r) => setTimeout(r, 30));
    expect(within(team()!).getByText('Amy Alphaonly')).toBeInTheDocument();
  });

  it('a multi-company site with one company of mine: no field, but the team comes from my company', async () => {
    usable([alpha], { site: 2 });
    renderForm();
    await settle();
    await waitFor(() => expect(candidateAsks().at(-1)).toBe(`/people/candidates?companyIds=${alpha.id}`));
    expect(screen.queryByText('Companies')).toBeNull();
    await userEvent.click(screen.getByRole('combobox', { name: 'Add people to the team' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([expect.stringContaining('Amy Alphaonly')]);
  });

  it('the server’s refusal words show in the form, under Companies', async () => {
    usable([alpha, beta], { site: 2 });
    renderForm({ project: existing });
    await companiesGroup();
    override = (u, method) =>
      method === 'PUT' ? json({ error: { code: 'WOULD_LOSE_ACCESS', message: 'You’d lose access to this project. Ask an administrator to make this change.' } }, 409) : undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Remove Alpha Co' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const msg = await screen.findByText('You’d lose access to this project. Ask an administrator to make this change.');
    expect((await companiesGroup()).getAttribute('aria-describedby')).toContain(msg.id);
    // Said there only (no banner as well).
    expect(screen.getAllByRole('alert')).toEqual([msg]);
  });

  it('a refused company on a new project shows there too, and the code stays as typed', async () => {
    usable([alpha, beta]);
    pick(alpha.id);
    renderForm();
    await companiesGroup();
    await fillNew();
    override = (u, method) => (method === 'POST' && u.endsWith('/projects') ? json({ error: { code: 'COMPANY_ARCHIVED', message: 'Alpha Co is archived.' } }, 400) : undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Alpha Co is archived.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^code/i)).toHaveValue('RIP');
    expect(screen.getByLabelText(/^code/i)).not.toHaveAttribute('aria-invalid');
  });

  it('a project from a template goes into the chosen companies', async () => {
    usable([alpha, beta]);
    pick(beta.id);
    override = (u) => {
      if (u.endsWith('/templates/projects') ) return json({ data: [{ id: 'pt1', name: 'Rig inspection', description: null, columnCount: 1, roleCount: 0, taskCount: 0, createdById: 'admin', createdByName: 'Admin', canManage: true, createdAt: '', updatedAt: '' }] });
      if (u.includes('/templates/projects/pt1/plan')) {
        return json({ data: { template: { id: 'pt1', name: 'Rig inspection', description: null, updatedAt: '2026-10-20T08:00:00.000Z', columns: [], roles: [] }, startDate: '2026-11-03', today: '2026-11-03', workingDays: [0, 1, 2, 3, 4], startColumn: 0, tasks: [], overdue: 0, moved: 0 } });
      }
      return undefined;
    };
    const { onSaved } = renderForm({ templateId: 'pt1' });
    expect(await chips()).toEqual(['Beta CoMain']);
    await fillNew();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(posted(/\/templates\/projects\/pt1\/projects$/)!.companyIds).toEqual([beta.id]);
  });
});
