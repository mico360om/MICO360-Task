import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectDetailPage } from './ProjectDetailPage';
import { useAuthStore } from '../stores/auth-store';

// Live updates: a stand-in socket the test can send events through.
type Handler = (...a: unknown[]) => void;
const socketHandlers: Record<string, Handler> = {};
const fakeSocket = { on: vi.fn((ev: string, cb: Handler) => { socketHandlers[ev] = cb; }), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
vi.mock('socket.io-client', () => ({ io: () => fakeSocket }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PROJECT = { id: 'p1', code: 'MICO', name: 'MICO Platform', description: 'Desc', clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', ownerId: null, createdAt: '', updatedAt: '' };
const COLUMNS = [
  { id: 'c1', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '#111', enabled: true },
  { id: 'c2', projectId: 'p1', name: 'Done', category: 'DONE', position: 1, color: '#222', enabled: true },
];
const task = (id: string, extra: Record<string, unknown>) => ({
  id, key: id.toUpperCase(), title: `Task ${id}`, description: null, projectId: 'p1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...extra,
});

const at = (iso: string) => iso;
const pm = (id: string, extra: Record<string, unknown>) => ({
  id, title: `Meeting ${id}`, status: 'SCHEDULED', startAt: at('2026-10-06T06:00:00.000Z'), endAt: at('2026-10-06T07:00:00.000Z'), timeZone: 'Asia/Muscat',
  location: null, onlineLink: null, recurrenceRule: null, recurrenceParentId: null, organizerId: 'u1', seriesId: null, phase: 'upcoming',
  attendeeCount: 0, attendees: [], minutes: 'NONE', decisionCount: 0, openActionItemCount: 0, ...extra,
});
let overview: Record<string, unknown>;
let extraTasks: Record<string, unknown>[];

let calls: string[] = [];
beforeEach(() => {
  calls = [];
  extraTasks = [];
  for (const k of Object.keys(socketHandlers)) delete socketHandlers[k];
  overview = {
    meetings: [
      pm('weekly', { title: 'Weekly sync', seriesId: 'weekly', recurrenceRule: { freq: 'WEEKLY', interval: 1 }, attendeeCount: 4, attendees: ['Mona M', 'Sara K', 'Omar A', 'Ali B'], openActionItemCount: 1 }),
      pm('kick', { title: 'Kick-off', status: 'COMPLETED', phase: 'completed', startAt: '2026-09-20T06:00:00.000Z', endAt: '2026-09-20T07:00:00.000Z', minutes: 'FINAL', decisionCount: 2 }),
      pm('off', { title: 'Vendor call', status: 'CANCELLED', phase: 'cancelled' }),
    ],
    decisions: [{ id: 'd1', text: 'Go live on 1 Nov', meetingId: 'kick', meetingTitle: 'Kick-off', at: '2026-09-20T06:30:00.000Z' }],
    actionItems: [
      { id: 'a1', description: 'Book the venue', status: 'OPEN', priority: 'HIGH', dueDate: '2026-09-28T00:00:00.000Z', overdue: true, assignee: { id: 'u7', name: 'Sara K' }, meetingId: 'kick', meetingTitle: 'Kick-off' },
    ],
    series: [{ id: 'weekly', title: 'Weekly sync', rule: { freq: 'WEEKLY', interval: 1 }, nextMeetingId: 'weekly', nextStartAt: '2026-10-06T06:00:00.000Z', upcoming: 1 }],
    stats: { upcoming: 1, ongoing: 0, completed: 1, cancelled: 1, nextMeetingId: 'weekly', openActionItems: 1, overdueActionItems: 1, decisions: 1 },
  };
  // A project MANAGER who is not an admin.
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'manager', roles: [] }, accessToken: 'at', refreshToken: 'rt' });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z')); // 14:00 on 30 Sep in Muscat
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
    if (u.includes('/members')) return json({ data: [{ id: 'u1', username: 'manager', email: '', firstName: 'Mona', lastName: 'M', role: 'MANAGER' }] });
    if (u.endsWith('/users/directory')) return json({ data: [
      { id: 'u1', username: 'manager', firstName: 'Mona', lastName: 'M', avatarUrl: null },
      { id: 'u7', username: 'sara', firstName: 'Sara', lastName: 'K', avatarUrl: null },
    ] });
    if (u.endsWith('/users')) return json({ error: { code: 'FORBIDDEN', message: 'Admins only' } }, 403);
    if (u.includes('/columns')) return json({ data: COLUMNS });
    if (u.endsWith('/meetings-overview')) return json({ data: overview });
    if (u.endsWith('/projects')) return json({ data: [PROJECT] });
    if (u.includes('/tasks')) return json({ data: [
      task('t1', { dueDate: '2026-09-30T00:00:00.000Z' }), // due today → not overdue
      task('t2', { dueDate: '2026-09-29T00:00:00.000Z' }), // yesterday → overdue
      task('t3', { dueDate: '2026-09-01T00:00:00.000Z', columnId: 'c2', columnCategory: 'DONE' }), // done → never overdue
      task('t4', { title: 'Go-live', isMilestone: true, dueDate: '2026-10-10T00:00:00.000Z', assignees: [{ id: 'u7', name: 'Sara K' }] }),
      ...extraTasks,
    ] });
    return json({ data: PROJECT });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(path = '/projects/p1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ProjectDetailPage: the dashboard', () => {
  it('gives the overview: milestones, deadlines, the manager, and the next meeting', async () => {
    renderPage();
    const marks = await screen.findByRole('region', { name: 'Milestones' });
    expect(await within(marks).findByRole('button', { name: 'Go-live' })).toBeInTheDocument();
    expect(within(marks).getByText(/10 Oct 2026 · Due in 10 days/)).toBeInTheDocument();
    const soon = screen.getByRole('region', { name: 'Upcoming deadlines' });
    expect(within(soon).getByText('Task t2')).toBeInTheDocument(); // overdue, listed first
    expect(within(soon).getByText(/^Late/)).toBeInTheDocument();
    const team = screen.getByRole('region', { name: 'Team' });
    expect(within(team).getByText('Mona M')).toBeInTheDocument();
    const next = screen.getByRole('region', { name: 'Next meeting' });
    expect(await within(next).findByRole('link', { name: 'Weekly sync' })).toHaveAttribute('href', '/meetings/weekly');
    expect(within(next).getByText(/1 upcoming · 1 held · 1 open action item/)).toBeInTheDocument();
  });

  it('filters the tasks: ongoing, pending, overdue, completed, milestones', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /tasks/i }));
    await screen.findByText('Task t1');
    await userEvent.click(screen.getByRole('button', { name: /^overdue/i }));
    expect(screen.getByText('Task t2')).toBeInTheDocument();
    expect(screen.queryByText('Task t1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^milestones/i }));
    expect(screen.getByText('Go-live')).toBeInTheDocument();
    expect(screen.queryByText('Task t2')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^completed/i }));
    expect(screen.getByText('Task t3')).toBeInTheDocument();
  });

  it('shows the project’s meetings with their minutes, decisions and action items', async () => {
    renderPage('/projects/p1?tab=meetings');
    const list = await screen.findByRole('list', { name: 'Meetings' });
    expect(within(list).getByRole('link', { name: 'Weekly sync' })).toBeInTheDocument();
    expect(within(list).getByText(/4 people/)).toBeInTheDocument();
    expect(within(list).getByText('1 open action item')).toBeInTheDocument();
    expect(within(list).queryByText('Kick-off')).not.toBeInTheDocument(); // held, not upcoming
    await userEvent.click(screen.getByRole('button', { name: /^held/i }));
    expect(within(screen.getByRole('list', { name: 'Meetings' })).getByRole('link', { name: 'Kick-off' })).toBeInTheDocument();
    expect(screen.getByText('Final minutes')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Decisions' })).getByText('Go live on 1 Nov')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Action items' })).getByText('Book the venue')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Repeating meetings' })).getByText(/Repeats every week/)).toBeInTheDocument();
  });

  it('lists the next dozen meetings of a busy project, the rest on request', async () => {
    const many = Array.from({ length: 14 }, (_, i) => pm(`d${i}`, { title: `Daily ${i + 1}`, startAt: `2026-10-${String(i + 1).padStart(2, '0')}T05:00:00.000Z`, seriesId: 'd0' }));
    overview = { ...overview, meetings: many, stats: { ...(overview.stats as object), upcoming: 14 } };
    renderPage('/projects/p1?tab=meetings');
    const list = await screen.findByRole('list', { name: 'Meetings' });
    expect(list.querySelectorAll('[data-meeting]')).toHaveLength(12);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 14 meetings' }));
    expect(screen.getByRole('list', { name: 'Meetings' }).querySelectorAll('[data-meeting]')).toHaveLength(14);
  });

  it('opens a new meeting in this project', async () => {
    renderPage('/projects/p1?tab=meetings');
    await userEvent.click(await screen.findByRole('button', { name: /new meeting/i }));
    const form = await screen.findByRole('dialog', { name: 'New meeting' });
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Project' })).toHaveTextContent('MICO Platform'));
  });

  it('updates live when someone changes a task or a meeting of the project', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Milestones' });
    act(() => socketHandlers['connect']!());
    expect(fakeSocket.emit).toHaveBeenCalledWith('join', { projectId: 'p1' });
    expect(await screen.findByText('Live')).toBeInTheDocument();
    extraTasks = [task('t9', { title: 'Sign the contract', isMilestone: true, dueDate: '2026-10-05T00:00:00.000Z' })];
    act(() => socketHandlers['task:created']!({ id: 't9' }));
    expect(await within(screen.getByRole('region', { name: 'Milestones' })).findByRole('button', { name: 'Sign the contract' })).toBeInTheDocument();
    overview = { ...overview, stats: { ...(overview.stats as object), upcoming: 3 } };
    act(() => socketHandlers['meeting:created']!({ id: 'm9' }));
    expect(await screen.findByText(/3 upcoming/)).toBeInTheDocument();
  });
});

describe('ProjectDetailPage', () => {
  it('shows the project number under the name, beside the code', async () => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (String(url).endsWith('/projects/p1') ? json({ data: { ...PROJECT, number: 'PDO-2026-014' } }) : base(url, init))));
    renderPage();
    await screen.findByRole('heading', { name: 'MICO Platform' });
    expect(await screen.findByText('Project no.', { exact: false })).toHaveTextContent('Project no. PDO-2026-014');
  });

  it('lets a project manager add members, picking from the people directory', async () => {
    renderPage();
    await screen.findByText('MICO Platform');
    await userEvent.click(screen.getByRole('tab', { name: /team/i }));
    const picker = await screen.findByLabelText(/add a member/i);
    expect(within(picker).getByRole('option', { name: 'Sara K' })).toBeInTheDocument();
    expect(calls.some((u) => u.endsWith('/users'))).toBe(false);
  });

  it('offers editing the project and its owner only to an admin — the server refuses them to anyone else', async () => {
    // A project manager (the default user here) may manage the team, not the project's own details.
    renderPage();
    await screen.findByRole('heading', { name: 'MICO Platform' });
    expect(screen.queryByRole('button', { name: /edit project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /project owner/i })).not.toBeInTheDocument();
    expect(screen.getByText('No owner')).toBeInTheDocument(); // the owner is still shown, as text
  });

  it('shows the project picture in the header: its icon on its colour, or its initials', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'MICO Platform' });
    const header = screen.getByRole('img', { name: 'MICO Platform' });
    expect(header).toHaveTextContent('MP'); // no icon or picture saved yet → initials on the project colour
    expect(header).toHaveStyle({ background: '#8B1E1E' });
  });

  it('lets an admin open the edit form, filled in with the project', async () => {
    useAuthStore.getState().setSession({ user: { id: 'u1', email: 'm@b.c', username: 'manager', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /edit project/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('MICO Platform');
    expect(within(dialog).getByLabelText(/^code/i)).toHaveValue('MICO');
    expect(screen.getByRole('button', { name: /project owner/i })).toBeInTheDocument();
  });

  it('opens the board of THIS project', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /open board/i });
    expect(link).toHaveAttribute('href', '/board?project=p1');
  });

  it('counts overdue by company calendar day and never counts finished tasks', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Overdue').previousElementSibling).toHaveTextContent('1'));
    expect(screen.getByText('Completed').previousElementSibling).toHaveTextContent('1');
  });

  it('a project that does not exist gets a clear "not found" page, not a broken one', async () => {
    const base = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (/\/projects\/p1$/.test(u)) return json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404);
      return base(url, init);
    }));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Project not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute('href', '/projects');
    // Nothing of the empty page shell (tabs, zero counters) is shown, and there is nothing to retry.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('a project that fails to load says so and offers to try again', async () => {
    const base = fetch;
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (/\/projects\/p1$/.test(u) && fail) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
      return base(url, init);
    }));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Couldn’t load this project' })).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'MICO Platform' })).toBeInTheDocument();
  });

  it('shows placeholders, not zero counters, while the project and its tasks are loading', async () => {
    const base = fetch;
    const never = new Promise<Response>(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (/\/projects\/p1$/.test(u) || u.includes('/tasks')) return never;
      return base(url, init);
    }));
    renderPage();
    expect(await screen.findByLabelText('Loading project')).toBeInTheDocument();
    // All five tiles (total, completed, in progress, overdue, completion) wait for the data.
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
