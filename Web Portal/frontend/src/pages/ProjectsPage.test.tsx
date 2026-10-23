import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectsPage } from './ProjectsPage';
import { ShortcutProvider } from '../components/shortcuts/ShortcutProvider';
import { useAuthStore } from '../stores/auth-store';
import type { ProjectOverview, ProjectStats } from '../api/projects';
import { invalidateTaskQueries } from '../lib/task-cache';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const person = (id: string, name: string) => ({ id, name, avatarUrl: null });
const SARA = person('u1', 'Sara Ahmed');
const OMAR = person('u2', 'Omar Said');
const HASSAN = person('u4', 'Hassan Ahmed');
const ME = person('u9', 'Khurram Admin');

function project(id: string, name: string, extra: Partial<Omit<ProjectOverview, 'stats'>> & { stats?: Partial<ProjectStats> } = {}): ProjectOverview {
  const { stats, ...rest } = extra;
  return {
    id,
    code: id.toUpperCase(),
    number: null,
    name,
    description: null,
    clientName: null,
    status: 'ACTIVE',
    priority: 'NORMAL',
    color: '#3A6EA5',
    icon: null,
    imageUrl: null,
    ownerId: null,
    managerId: null,
    startDate: null,
    targetDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    owner: null,
    team: [],
    ...rest,
    stats: { total: 0, done: 0, open: 0, overdue: 0, nextDue: null, lastActivityAt: '2026-10-20T00:00:00.000Z', ...stats },
  };
}

// Today is Friday 23 October 2026 in Muscat.
const LIST: ProjectOverview[] = [
  project('p4', 'Mobile App (Phase 2)', { code: 'MOB', status: 'PLANNING', ownerId: 'u4', owner: HASSAN, team: [HASSAN, ME], targetDate: '2026-12-02T00:00:00.000Z', stats: { total: 6, open: 6, nextDue: '2026-10-30' } }),
  project('p1', 'Rig Inspection Portal', { code: 'RIG', number: 'C-2041', clientName: 'Gulf Energy', ownerId: 'u1', owner: SARA, team: [SARA, OMAR], targetDate: '2026-11-30T00:00:00.000Z', stats: { total: 40, done: 25, open: 15, overdue: 4, nextDue: '2026-10-26' } }),
  project('p6', 'Website Refresh', { code: 'WEB', status: 'COMPLETED', ownerId: 'u2', owner: OMAR, managerId: 'u9', stats: { total: 3, done: 3 } }),
  project('p3', 'Falcon CRM', { code: 'FCRM', number: '2026-014', clientName: 'Falcon Trading', status: 'ON_HOLD', ownerId: 'u2', owner: OMAR, targetDate: '2026-10-20T00:00:00.000Z', stats: { total: 20, done: 17, open: 3, nextDue: '2026-10-29' } }),
  project('p2', 'MICO360 Services', { code: 'MSSP', clientName: 'Internal', ownerId: 'u9', owner: ME, stats: { total: 15, done: 3, open: 12, overdue: 2 } }),
  project('p5', 'Old Portal', { code: 'OLD', status: 'ARCHIVED', ownerId: 'u1', owner: SARA, stats: { total: 9, done: 9 } }),
];

let calls: { method: string; url: string; body: unknown }[] = [];
let overview: ProjectOverview[] = LIST;
let failOverview = false;
let failUpdate = false;

beforeEach(() => {
  calls = [];
  overview = LIST;
  failOverview = false;
  failUpdate = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (url.endsWith('/projects/overview')) {
        return failOverview ? json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500) : json({ data: overview });
      }
      const archive = url.match(/\/projects\/(\w+)\/archive$/);
      if (archive && method === 'POST') return json({ data: { ...LIST.find((p) => p.id === archive[1]), status: 'ARCHIVED' } });
      const one = url.match(/\/projects\/(\w+)$/);
      if (one && method === 'PUT') {
        if (failUpdate) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
        return json({ data: { ...LIST.find((p) => p.id === one[1]), ...(body as object) } });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

const signIn = (roles: string[]) =>
  useAuthStore.getState().setSession({ user: { id: 'u9', email: 'k@mico360.test', username: 'khurram', roles }, accessToken: 'at', refreshToken: 'rt' });

function Where() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="where">{loc.pathname + loc.search}</p>
      <button type="button" onClick={() => navigate(-1)}>Go back</button>
    </>
  );
}

function renderPage(at: string | string[] = '/projects', qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const entries = Array.isArray(at) ? at : [at];
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <ShortcutProvider>
          <Routes>
            <Route path="/projects" element={<><ProjectsPage /><Where /></>} />
            <Route path="*" element={<Where />} />
          </Routes>
        </ShortcutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const cardNames = () => screen.queryAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/projects/')).map((a) => a.textContent);
const where = () => screen.getByTestId('where').textContent;
const tab = (name: RegExp) => screen.getByRole('tab', { name });
const loaded = () => screen.findByRole('link', { name: 'Rig Inspection Portal' });
/** The count line: a polite live region, so changes are announced. */
const countLine = () => screen.getByTestId('projects-count');

describe('ProjectsPage', () => {
  it('loads the whole list, figures included, in one request', async () => {
    renderPage();
    await loaded();
    const api = calls.filter((c) => !c.url.endsWith('/config'));
    expect(api.map((c) => c.url.replace(/^.*\/api\/v1/, ''))).toEqual(['/projects/overview']);
  });

  it('fetches its figures again after a task changes anywhere (they count tasks)', async () => {
    // As in the app: data stays fresh for 30 seconds unless something marks it stale.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    renderPage('/projects', qc);
    await loaded();
    const fetches = () => calls.filter((c) => c.url.endsWith('/projects/overview')).length;
    expect(fetches()).toBe(1);
    await act(() => invalidateTaskQueries(qc));
    await waitFor(() => expect(fetches()).toBe(2));
  });

  it('heads the page with how many projects there are and how many need attention', async () => {
    renderPage();
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('5 projects · 3 need attention')).toBeInTheDocument();
  });

  it('shows every project but the archived ones under All, most overdue first, with a count on each tab', async () => {
    renderPage();
    await loaded();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All 5', 'Active 2', 'Planning 1', 'On hold 1', 'Completed 1', 'Archived 1']);
    expect(tab(/^All/)).toHaveAttribute('aria-selected', 'true');
    expect(cardNames()).toEqual(['Rig Inspection Portal', 'MICO360 Services', 'Falcon CRM', 'Mobile App (Phase 2)', 'Website Refresh']);
    expect(countLine()).toHaveTextContent('5 projects · most overdue first');
    expect(countLine()).toHaveAttribute('role', 'status');
  });

  it('shows archived projects only under their own tab, and keeps the tab in the address', async () => {
    renderPage();
    await loaded();
    await userEvent.click(tab(/^Archived/));
    expect(tab(/^Archived/)).toHaveAttribute('aria-selected', 'true');
    expect(cardNames()).toEqual(['Old Portal']);
    expect(where()).toBe('/projects?status=archived');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tab(/^Archived/).id);
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    renderPage();
    await loaded();
    tab(/^All/).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab(/^Active/)).toHaveFocus();
    expect(tab(/^Active/)).toHaveAttribute('aria-selected', 'true');
    expect(cardNames()).toEqual(['Rig Inspection Portal', 'MICO360 Services']);
    await userEvent.keyboard('{End}');
    expect(tab(/^Archived/)).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab(/^All/)).toHaveFocus();
    // Only the chosen tab is a Tab stop.
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toEqual([tab(/^All/)]);
  });

  it('searches name, code, client and project number, every word required, and announces the count', async () => {
    renderPage();
    await loaded();
    const box = screen.getByRole('searchbox', { name: 'Search projects' });
    await userEvent.type(box, 'GULF portal');
    expect(cardNames()).toEqual(['Rig Inspection Portal']);
    expect(countLine()).toHaveTextContent('1 project · most overdue first');
    await waitFor(() => expect(where()).toBe('/projects?q=GULF+portal'));
    await userEvent.clear(box);
    await userEvent.type(box, '2026-014');
    expect(cardNames()).toEqual(['Falcon CRM']);
  });

  it('keeps every key typed fast in the search box, while the address catches up', async () => {
    renderPage();
    await loaded();
    const user = userEvent.setup({ delay: null });
    const box = screen.getByRole('searchbox', { name: 'Search projects' });
    await user.type(box, 'gulf portal');
    expect(box).toHaveValue('gulf portal');
    expect(cardNames()).toEqual(['Rig Inspection Portal']);
    await waitFor(() => expect(where()).toBe('/projects?q=gulf+portal'));
  });

  it('follows Back: the previous tab and search come back from the address', async () => {
    renderPage();
    await loaded();
    const box = screen.getByRole('searchbox', { name: 'Search projects' });
    await userEvent.type(box, 'portal');
    await waitFor(() => expect(where()).toBe('/projects?q=portal'));
    await userEvent.click(tab(/^Archived/));
    expect(cardNames()).toEqual(['Old Portal']);
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(tab(/^All/)).toHaveAttribute('aria-selected', 'true'));
    expect(box).toHaveValue('portal');
    expect(cardNames()).toEqual(['Rig Inspection Portal']);
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(cardNames()).toHaveLength(5);
  });

  it('follows the search into the tab counts', async () => {
    renderPage();
    await loaded();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search projects' }), 'portal');
    expect(tab(/^All/)).toHaveAccessibleName('All 1');
    expect(tab(/^Archived/)).toHaveAccessibleName('Archived 1');
  });

  it('jumps to the search box with the page-search shortcut (/)', async () => {
    renderPage();
    await loaded();
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toHaveAttribute('data-page-search');
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true }));
    });
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toHaveFocus();
  });

  it('starts from the address: tab, search, owner and sort', async () => {
    renderPage('/projects?status=on-hold&q=falcon&owner=u2&sort=name');
    expect(await screen.findByRole('link', { name: 'Falcon CRM' })).toBeInTheDocument();
    expect(tab(/^On hold/)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toHaveValue('falcon');
    expect(screen.getByRole('combobox', { name: 'Owner' })).toHaveValue('u2');
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('name');
    expect(cardNames()).toEqual(['Falcon CRM']);
  });

  it('ignores an owner from a shared link who owns none of the projects you can see, and drops them from the address', async () => {
    renderPage(['/elsewhere', '/projects?owner=ghost&sort=name']);
    await loaded();
    expect(screen.getByRole('combobox', { name: 'Owner' })).toHaveValue('');
    expect(cardNames()).toHaveLength(5);
    expect(screen.queryByText('No projects match')).not.toBeInTheDocument();
    await waitFor(() => expect(where()).toBe('/projects?sort=name'));
    // Replaced, not added: Back leaves the page rather than bringing the unknown owner back.
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(where()).toBe('/elsewhere'));
  });

  it('filters by owner, offering anyone and the people who own projects', async () => {
    renderPage();
    await loaded();
    const owner = screen.getByRole('combobox', { name: 'Owner' });
    expect(within(owner).getAllByRole('option').map((o) => o.textContent)).toEqual(['Anyone', 'Hassan Ahmed', 'Khurram Admin', 'Omar Said', 'Sara Ahmed']);
    await userEvent.selectOptions(owner, 'u2');
    expect(cardNames()).toEqual(['Falcon CRM', 'Website Refresh']);
    expect(where()).toBe('/projects?owner=u2');
  });

  it('sorts by name, recent updates, target date or progress when chosen', async () => {
    renderPage();
    await loaded();
    const sort = screen.getByRole('combobox', { name: 'Sort' });
    expect(within(sort).getAllByRole('option').map((o) => o.textContent)).toEqual(['Needs attention', 'Name', 'Recently updated', 'Target date', 'Progress']);
    await userEvent.selectOptions(sort, 'name');
    expect(cardNames()).toEqual(['Falcon CRM', 'MICO360 Services', 'Mobile App (Phase 2)', 'Rig Inspection Portal', 'Website Refresh']);
    expect(countLine()).toHaveTextContent('5 projects · A to Z');
    expect(where()).toBe('/projects?sort=name');
    await userEvent.selectOptions(sort, 'target');
    expect(cardNames()).toEqual(['Falcon CRM', 'Rig Inspection Portal', 'Mobile App (Phase 2)', 'MICO360 Services', 'Website Refresh']);
  });

  it('offers “Only my projects” to an administrator: the ones they own, manage or are on the team of', async () => {
    signIn(['ADMIN']);
    renderPage();
    await loaded();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Only my projects' }));
    expect(cardNames()).toEqual(['MICO360 Services', 'Mobile App (Phase 2)', 'Website Refresh']);
    expect(where()).toBe('/projects?mine=1');
  });

  it('shows an empty state with Clear filters when nothing matches, and clearing brings everything back', async () => {
    renderPage('/projects?q=zzz&owner=u1');
    expect(await screen.findByText('No projects match')).toBeInTheDocument();
    expect(countLine()).toHaveTextContent('No projects');
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(cardNames()).toHaveLength(5);
    expect(where()).toBe('/projects');
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toHaveFocus();
  });

  it('says when a tab has nothing in it', async () => {
    overview = LIST.filter((p) => p.status !== 'ARCHIVED');
    renderPage('/projects?status=archived');
    expect(await screen.findByText('No archived projects')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('invites an administrator to create the first project when there are none', async () => {
    signIn(['ADMIN']);
    overview = [];
    renderPage();
    expect(await screen.findByText('No projects yet', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new project/i })).toHaveLength(2);
  });
});

describe('ProjectsPage for an administrator', () => {
  beforeEach(() => signIn(['ADMIN']));

  it('opens the new-project form, and the edit form from a card’s “⋯” menu', async () => {
    renderPage();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: /new project/i }));
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Rig Inspection Portal' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('Rig Inspection Portal');
  });

  it('changes a status from the card’s status menu through the API', async () => {
    renderPage();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: /status: active\. change the status of rig inspection portal/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'On hold' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: expect.stringMatching(/\/projects\/p1$/), body: { status: 'ON_HOLD' } }));
  });

  it('puts the status back and says so when the change fails', async () => {
    failUpdate = true;
    renderPage();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: /status: active\. change the status of rig inspection portal/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'On hold' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the status of Rig Inspection Portal.');
    expect(screen.getByRole('button', { name: /status: active\. change the status of rig inspection portal/i })).toBeInTheDocument();
  });

  it('asks before archiving from the status menu, and does nothing when kept', async () => {
    renderPage();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: /change the status of rig inspection portal/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Archived' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Archive Rig Inspection Portal?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('archives through the archive action once confirmed from “⋯”', async () => {
    renderPage();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Rig Inspection Portal' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive…' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Archive Rig Inspection Portal?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: expect.stringMatching(/\/projects\/p1\/archive$/) }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

describe('ProjectsPage for someone who is not an administrator', () => {
  beforeEach(() => signIn(['EMPLOYEE']));

  it('shows statuses as labels and no New project or “Only my projects”', async () => {
    renderPage();
    await loaded();
    expect(screen.queryByRole('button', { name: /new project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change the status/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Only my projects' })).not.toBeInTheDocument();
  });
});

describe('ProjectsPage when the projects cannot be loaded', () => {
  it('says so in plain words and loads them on Retry', async () => {
    failOverview = true;
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load projects.');
    expect(alert).not.toHaveTextContent(/API/);
    failOverview = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await loaded();
  });
});
