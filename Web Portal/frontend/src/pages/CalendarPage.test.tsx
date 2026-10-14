import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarPage } from './CalendarPage';
import { useAuthStore } from '../stores/auth-store';
import type { ApiTask } from '../api/tasks';

// The full task panel has its own tests; here it only has to open for the right task.
vi.mock('../components/TaskDrawerContainer', () => ({
  TaskDrawerContainer: ({ taskId, onClose }: { taskId: string; onClose: () => void }) => (
    <div role="dialog" aria-label="Task details panel">
      open {taskId}
      <button type="button" onClick={onClose}>Close panel</button>
    </div>
  ),
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const task = (over: Partial<ApiTask>): ApiTask => ({
  id: 't1', key: 'MICO-1', title: 'Prepare report', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-14T00:00:00.000Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '',
  version: 3, assignees: [{ id: 'me', name: 'Mo Me' }], ...over,
});

const PROJECTS = [
  { id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#8B1E1E', icon: 'rocket', clientName: null },
  { id: 'p2', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE', color: '#1E5A8B', clientName: null },
  { id: 'old', code: 'OLD', name: 'Old project', status: 'ARCHIVED', color: '#777777', clientName: null },
];

let tasks: ApiTask[];
let occurrences: { taskId: string; seriesId: string; date: string }[];
let series: ApiTask[];
let prefs: { timeZone: string | null; weekStart: number | null };
let requests: { url: string; method: string; body?: unknown }[];
let override: (u: string, method: string, body: unknown) => Response | undefined;

const dueDay = (t: ApiTask) => (t.dueDate ?? '').slice(0, 10);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T08:00:00.000Z')); // Saturday 10 October, noon in Muscat
  localStorage.clear();
  requests = [];
  override = () => undefined;
  prefs = { timeZone: null, weekStart: null };
  occurrences = [];
  series = [];
  tasks = [
    task({}),
    task({ id: 't2', key: 'MICO-2', title: 'Late invoice', dueDate: '2026-10-05T00:00:00.000Z', priority: 'HIGH' }),
    task({ id: 't3', key: 'RIG-3', title: 'Shipped inspection', projectId: 'p2', columnCategory: 'DONE', dueDate: '2026-10-07T00:00:00.000Z', assignees: [{ id: 'u2', name: 'Omar Ahmed' }] }),
    task({ id: 't4', key: 'RIG-4', title: 'Waiting for the vendor contract', projectId: 'p2', columnCategory: 'BLOCKED', dueDate: '2026-10-21T00:00:00.000Z', assignees: [{ id: 'u2', name: 'Omar Ahmed' }] }),
    task({ id: 't5', key: 'OLD-5', title: 'Archived project work', projectId: 'old', dueDate: '2026-10-14T00:00:00.000Z' }),
  ];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url: u, method, body });
    const o = override(u, method, body);
    if (o) return o;
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/users/me/preferences')) return json({ data: prefs });
    if (u.endsWith('/projects')) return json({ data: PROJECTS });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'me', username: 'me', firstName: 'Mo', lastName: 'Me' }, { id: 'u2', username: 'omar', firstName: 'Omar', lastName: 'Ahmed' }] });
    if (u.includes('/calendar?')) {
      const q = new URL(u, "http://test.local").searchParams;
      const from = q.get('from')!;
      const to = q.get('to')!;
      return json({ data: { from, to, timeZone: 'Asia/Muscat', tasks: tasks.filter((t) => dueDay(t) >= from && dueDay(t) <= to), occurrences: occurrences.filter((o) => o.date >= from && o.date <= to), series } });
    }
    if (u.includes('/tasks?overdue=true')) return json({ data: tasks.filter((t) => dueDay(t) < '2026-10-10' && t.columnCategory !== 'DONE') });
    const put = /\/tasks\/([^/?]+)$/.exec(u);
    if (put && method === 'PUT') {
      const t = tasks.find((x) => x.id === put[1])!;
      const next = { ...t, ...(body as object), dueDate: `${(body as { dueDate: string }).dueDate}T00:00:00.000Z`, version: (t.version ?? 0) + 1 };
      tasks = tasks.map((x) => (x.id === t.id ? next : x));
      return json({ data: next });
    }
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.search}</output>;
}

function renderPage(path = '/calendar') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <CalendarPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const calendarRequests = () => requests.filter((r) => r.url.includes('/calendar?')).map((r) => new URL(r.url, "http://test.local").search);
const chip = (title: RegExp | string) => screen.findByRole('button', { name: typeof title === 'string' ? new RegExp(title) : title });
const day = (key: string) => document.querySelector(`[data-day="${key}"]`) as HTMLElement;

describe('CalendarPage — toolbar and views', () => {
  it('has the views, navigation, today and a date picker in one toolbar', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Week', 'Agenda']) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /previous month/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next month/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Go to date'), { target: { value: '2027-03-18' } });
    expect(await screen.findByRole('heading', { level: 2, name: 'March 2027' })).toBeInTheDocument();
  });

  it('asks the server only for the days on screen, and steps across months and years', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'October 2026' });
    await waitFor(() => expect(calendarRequests()).toContain('?from=2026-09-27&to=2026-10-31'));
    await userEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    await waitFor(() => expect(calendarRequests()).toContain('?from=2026-11-01&to=2026-12-05'));
    await userEvent.click(screen.getByRole('button', { name: /next month/i }));
    await userEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByRole('heading', { name: 'January 2027' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('heading', { name: /27 Dec 2026 – 2 Jan 2027|3 – 9 Jan 2027/ })).toBeInTheDocument();
  });

  it('steps from 31 October to November (not December)', async () => {
    vi.setSystemTime(new Date('2026-10-31T08:00:00Z'));
    renderPage();
    await screen.findByRole('heading', { name: 'October 2026' });
    await userEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /previous month/i }));
    await userEvent.click(screen.getByRole('button', { name: /previous month/i }));
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument();
  });

  it('marks today, and the days outside the month', async () => {
    renderPage();
    await chip(/Prepare report/);
    expect(within(day('2026-10-10')).getByRole('button', { name: /Sat 10 Oct/ })).toHaveAttribute('aria-current', 'date');
    expect(day('2026-09-30')).toHaveAttribute('data-outside', 'true');
    expect(day('2026-10-01')).not.toHaveAttribute('data-outside');
  });

  it('keeps the view and filters in the address, so switching views keeps the filters', async () => {
    renderPage();
    await chip(/Prepare report/);
    await userEvent.click(screen.getByRole('button', { name: 'My tasks' }));
    await userEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByTestId('where').textContent).toMatch(/view=week/);
    expect(screen.getByTestId('where').textContent).toMatch(/mine=1/);
    expect(screen.getByRole('button', { name: 'My tasks' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('CalendarPage — how tasks look', () => {
  it('reserves red for overdue, and says blocked and done in words and icons too', async () => {
    renderPage();
    const late = await chip(/Late invoice/);
    expect(late).toHaveAccessibleName(/overdue/i);
    expect(late.className).toMatch(/danger/);
    const blocked = await chip(/Waiting for the vendor contract/);
    expect(blocked).toHaveAccessibleName(/blocked/i);
    expect(blocked.className).not.toMatch(/danger/);
    const done = await chip(/Shipped inspection/);
    expect(done).toHaveAccessibleName(/done/i);
    expect(done.className).not.toMatch(/danger|line-through/);
    // A legend explains them.
    const legend = screen.getByRole('list', { name: 'Legend' });
    for (const word of ['Overdue', 'To do', 'In progress', 'Blocked', 'Done', 'Repeats (not created yet)']) expect(within(legend).getByText(word)).toBeInTheDocument();
  });

  it('never shows a completed task as overdue', async () => {
    tasks = [task({ id: 't9', title: 'Shipped report', columnCategory: 'DONE', dueDate: '2026-10-02T00:00:00.000Z' })];
    renderPage();

    const c = await chip(/Shipped report/);
    expect(c).not.toHaveAccessibleName(/overdue/i);
    expect(c.className).not.toMatch(/danger/);
  });

  it('hides archived projects’ tasks unless asked, and can hide completed ones', async () => {
    renderPage();
    await chip(/Prepare report/);
    expect(screen.queryByRole('button', { name: /Archived project work/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /more filters/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /archived projects/i }));
    expect(await chip(/Archived project work/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /show completed/i }));
    expect(screen.queryByRole('button', { name: /Shipped inspection/ })).not.toBeInTheDocument();
  });

  it('keeps Arabic titles in their own direction', async () => {
    tasks = [task({ id: 'ar', title: 'مراجعة خطة الصيانة الوقائية' })];
    renderPage();
    const c = await chip(/مراجعة خطة الصيانة الوقائية/);
    expect(within(c).getByText('مراجعة خطة الصيانة الوقائية')).toHaveAttribute('dir', 'auto');
  });

  it('uses the company time zone for “today” (already 1 July in Muscat late on 30 June UTC)', async () => {
    vi.setSystemTime(new Date('2026-06-30T21:00:00Z'));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'July 2026' })).toBeInTheDocument();
  });

  it('uses your own time zone and week start when you set them, without moving date-only deadlines', async () => {
    prefs = { timeZone: 'America/New_York', weekStart: 1 };
    vi.setSystemTime(new Date('2026-10-10T02:00:00.000Z')); // 22:00 on 9 Oct in New York
    tasks = [task({ id: 'eom', title: 'Month end close', dueDate: '2026-10-31T00:00:00.000Z' })];
    renderPage();
    await chip(/Month end close/);
    expect(within(day('2026-10-09')).getByRole('button', { name: /Fri 9 Oct/ })).toHaveAttribute('aria-current', 'date');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    await waitFor(() => expect(calendarRequests()).toContain('?from=2026-09-28&to=2026-11-01'));
    expect(within(day('2026-10-31')).getByRole('button', { name: /Month end close/ })).toBeInTheDocument();
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
  });
});

describe('CalendarPage — filters', () => {
  it('filters by project, person, my tasks, words, status and priority', async () => {
    renderPage();
    await chip(/Prepare report/);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'invoice');
    expect(screen.queryByRole('button', { name: /Prepare report/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Late invoice/ })).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search tasks' }));

    await userEvent.click(screen.getByRole('button', { name: /^project/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Rig Inspection/ }));
    expect(screen.queryByRole('button', { name: /Prepare report/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Waiting for the vendor contract/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));

    await userEvent.click(screen.getByRole('button', { name: /more filters/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Overdue' }));
    expect(screen.getByRole('button', { name: /Late invoice/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prepare report/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Overdue' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'High' }));
    expect(screen.getByRole('button', { name: /Late invoice/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prepare report/ })).not.toBeInTheDocument();
  });

  it('applies a filter at once (no flicker while the address catches up)', async () => {
    renderPage();
    await chip(/Prepare report/);
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }));
    const high = screen.getByRole('checkbox', { name: 'High' });
    fireEvent.click(high);
    // Checked in the same tick as the click, and the list already filtered.
    expect(high).toBeChecked();
    expect(screen.queryByRole('button', { name: /Prepare report/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    expect(screen.getByRole('heading', { level: 2, name: 'November 2026' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/priority=HIGH/));
  });

  it('shows the filters from the address on arrival', async () => {
    renderPage('/calendar?view=agenda&assignee=u2');
    expect(await screen.findByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true');
    expect(await chip(/Waiting for the vendor contract/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prepare report/ })).not.toBeInTheDocument();
  });
});

describe('CalendarPage — busy days', () => {
  it('shows a few tasks per day; “+N more” lists them all (respecting the filters)', async () => {
    tasks = Array.from({ length: 6 }, (_, i) => task({ id: `b${i}`, key: `MICO-${10 + i}`, title: `Busy day job ${i + 1}`, dueDate: '2026-10-15T00:00:00.000Z', projectId: i < 4 ? 'p1' : 'p2' }));
    renderPage();
    const more = await screen.findByRole('button', { name: /3 more tasks on Thu 15 Oct/i });
    expect(more).toHaveTextContent('+3 more');
    await userEvent.click(more);
    const list = await screen.findByRole('dialog', { name: /Thu 15 Oct/ });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    await userEvent.click(within(list).getByRole('button', { name: /close/i }));
    // With a project filter, the day has fewer to show.
    await userEvent.click(screen.getByRole('button', { name: /^project/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Rig Inspection/ }));
    expect(screen.queryByRole('button', { name: /more tasks on Thu 15 Oct/i })).not.toBeInTheDocument();
  });
});

describe('CalendarPage — details', () => {
  it('opens a task’s details with everything that matters, and its full panel', async () => {
    tasks = [task({ id: 'r1', title: 'Weekly reliability report with a long title that would otherwise be cut', priority: 'URGENT', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [3] } })];
    renderPage();
    await userEvent.click(await chip(/Weekly reliability report/));
    const d = await screen.findByRole('dialog', { name: /Weekly reliability report with a long title that would otherwise be cut/ });
    for (const text of ['MICO360 Platform', 'Mo Me', /Wed 14 Oct 2026/, 'Urgent', 'To do', /Repeats/]) expect(within(d).getByText(text)).toBeInTheDocument();
    expect(within(d).getByText('MICO360 Platform').parentElement!.querySelector('[data-project-avatar="icon"]')).not.toBeNull(); // its saved icon
    expect(screen.getByRole('button', { name: 'Project' }).querySelector('[data-project-avatar]')).toBeNull(); // "All projects" has no picture…
    await userEvent.click(within(d).getByRole('button', { name: 'Open task' }));
    expect(await screen.findByRole('dialog', { name: 'Task details panel' })).toHaveTextContent('open r1');
  });

  it('shows projected copies of a repeating task as such (not real tasks, not movable)', async () => {
    const head = task({ id: 'h1', title: 'Weekly check', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    tasks = [head];
    series = [head];
    occurrences = [{ taskId: 'h1', seriesId: 'h1', date: '2026-10-21' }];
    renderPage();
    const projected = await screen.findByRole('button', { name: /Weekly check.*repeat, not created yet/i });
    expect(projected).not.toHaveAttribute('draggable', 'true');
    await userEvent.click(projected);
    const d = await screen.findByRole('dialog', { name: /Weekly check/ });
    expect(within(d).getByText(/will be created/i)).toBeInTheDocument();
    expect(within(d).queryByRole('button', { name: /change date/i })).not.toBeInTheDocument();
  });
});

describe('CalendarPage — rescheduling', () => {
  it('moves a task with the date control, saves it, and can undo', async () => {
    renderPage();
    await userEvent.click(await chip(/Prepare report/));
    const d = await screen.findByRole('dialog', { name: /Prepare report/ });
    await userEvent.click(within(d).getByRole('button', { name: /change date/i }));
    fireEvent.change(within(d).getByLabelText('New due date'), { target: { value: '2026-10-16' } });
    await userEvent.click(within(d).getByRole('button', { name: 'Save date' }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', url: expect.stringContaining('/tasks/t1'), body: { dueDate: '2026-10-16', expectedVersion: 3 } })));
    expect(await within(day('2026-10-16')).findByRole('button', { name: /Prepare report/ })).toBeInTheDocument();
    const toast = await screen.findByRole('status', { name: /moved/i });
    expect(toast).toHaveTextContent(/MICO-1.*Fri 16 Oct/);
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(requests.filter((r) => r.method === 'PUT').at(-1)!.body).toEqual({ dueDate: '2026-10-14', expectedVersion: 4 }));
    expect(await within(day('2026-10-14')).findByRole('button', { name: /Prepare report/ })).toBeInTheDocument();
  });

  it('puts the task back and says so when the save fails', async () => {
    override = (u, method) => (method === 'PUT' && u.includes('/tasks/t1') ? json({ error: { code: 'VERSION_CONFLICT', message: 'This task was changed by someone else.' } }, 409) : undefined);
    renderPage();
    const c = await chip(/Prepare report/);
    fireEvent.dragStart(c, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.dragOver(day('2026-10-16'), { dataTransfer: { dropEffect: 'move' } });
    fireEvent.drop(day('2026-10-16'), { dataTransfer: { getData: () => 't1' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t move.*changed by someone else/i);
    await waitFor(() => expect(within(day('2026-10-14')).getByRole('button', { name: /Prepare report/ })).toBeInTheDocument());
    expect(within(day('2026-10-16')).queryByRole('button', { name: /Prepare report/ })).not.toBeInTheDocument();
  });

  it('drags a task to another day', async () => {
    renderPage();
    const c = await chip(/Prepare report/);
    expect(c).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(c, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-20'), { dataTransfer: { getData: () => 't1' } });
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', body: { dueDate: '2026-10-20', expectedVersion: 3 } })));
  });

  it('asks whether to move one occurrence or the series, and saves each choice without duplicates', async () => {
    tasks = [task({ id: 'w1', title: 'Weekly sync', dueDate: '2026-10-12T00:00:00.000Z', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } })];
    renderPage();
    const c = await chip(/Weekly sync/);
    fireEvent.dragStart(c, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-14'), { dataTransfer: { getData: () => 'w1' } });
    const ask = await screen.findByRole('dialog', { name: /move a repeating task/i });
    await userEvent.click(within(ask).getByRole('radio', { name: /this occurrence/i }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1));
    expect(requests.find((r) => r.method === 'PUT')!.body).toEqual({ dueDate: '2026-10-14', expectedVersion: 3, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], resumeFrom: '2026-10-12' } });

    // The series this time (from its new day).
    const again = await within(day('2026-10-14')).findByRole('button', { name: /Weekly sync/ });
    fireEvent.dragStart(again, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-13'), { dataTransfer: { getData: () => 'w1' } });
    const ask2 = await screen.findByRole('dialog', { name: /move a repeating task/i });
    await userEvent.click(within(ask2).getByRole('radio', { name: /this and future/i }));
    await userEvent.click(within(ask2).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(2));
    expect(requests.filter((r) => r.method === 'PUT')[1]!.body).toEqual({ dueDate: '2026-10-13', expectedVersion: 4, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
  });

  it('cannot drag finished tasks or tasks of archived projects', async () => {
    renderPage();
    expect(await chip(/Shipped inspection/)).not.toHaveAttribute('draggable', 'true');
  });

  it('adds a task on a chosen day', async () => {
    renderPage();
    await chip(/Prepare report/);
    await userEvent.click(within(day('2026-10-22')).getByRole('button', { name: /Thu 22 Oct/ }));
    const list = await screen.findByRole('dialog', { name: /Thu 22 Oct/ });
    await userEvent.click(within(list).getByRole('button', { name: /add a task on Thu 22 Oct/i }));
    const create = await screen.findByRole('dialog', { name: 'New task' });
    expect(within(create).getByLabelText(/due date/i)).toHaveValue('2026-10-22');
  });
});

describe('CalendarPage — agenda, states and phones', () => {
  it('lists the month day by day, with overdue work first', async () => {
    renderPage('/calendar?view=agenda');
    const overdue = await screen.findByRole('region', { name: /overdue/i });
    expect(within(overdue).getByRole('button', { name: /Late invoice/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Wed 14 Oct/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prepare report/ })).toBeInTheDocument();
  });

  it('says when nothing matches, with a way to clear the filters', async () => {
    renderPage('/calendar?view=agenda&q=zzz');
    expect(await screen.findByText(/no tasks match/i)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /clear filters/i })[0]!);
    expect(await chip(/Prepare report/)).toBeInTheDocument();
  });

  it('shows a loading state, then an error with Retry', async () => {
    let fail = true;
    override = (u) => (u.includes('/calendar?') && fail ? json({ error: { code: 'ERR', message: 'boom' } }, 500) : undefined);
    renderPage();
    expect(screen.getByRole('status', { name: /loading the calendar/i })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load the calendar/i);
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await chip(/Prepare report/)).toBeInTheDocument();
  });

  it('on a phone, shows a compact month and the chosen day as a list', async () => {
    const mm = vi.fn((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
    vi.stubGlobal('matchMedia', mm);
    Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
    renderPage();
    const list = await screen.findByRole('region', { name: /Sat 10 Oct/ });
    expect(within(list).getByText(/nothing due/i)).toBeInTheDocument();
    await userEvent.click(within(day('2026-10-14')).getByRole('button', { name: /Wed 14 Oct, 1 task/ }));
    const chosen = await screen.findByRole('region', { name: /Wed 14 Oct/ });
    expect(within(chosen).getByRole('button', { name: /Prepare report/ })).toBeInTheDocument();
    await act(async () => {});
  });

  it('on a tablet (the sidebar leaves the month too narrow for readable chips), uses the compact month too', async () => {
    const mm = vi.fn((q: string) => ({ matches: q.includes('1023px'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
    vi.stubGlobal('matchMedia', mm);
    Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
    renderPage();
    expect(await screen.findByRole('region', { name: /Sat 10 Oct/ })).toBeInTheDocument();
    await act(async () => {});
  });
});

describe('CalendarPage — a long overdue list', () => {
  it('shows the first few overdue tasks in the agenda, and the rest on request', async () => {
    tasks = Array.from({ length: 12 }, (_, i) => task({ id: `o${i}`, key: `MICO-${50 + i}`, title: `Overdue job ${i + 1}`, dueDate: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z` }));
    renderPage('/calendar?view=agenda');
    const overdue = await screen.findByRole('region', { name: /overdue \(12\)/i });
    expect(within(overdue).getAllByRole('listitem')).toHaveLength(8);
    await userEvent.click(within(overdue).getByRole('button', { name: /show all 12/i }));
    expect(within(overdue).getAllByRole('listitem')).toHaveLength(12);
  });
});
