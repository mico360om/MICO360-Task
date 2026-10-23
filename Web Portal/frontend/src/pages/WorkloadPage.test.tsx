import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkloadPage } from './WorkloadPage';
import { useAuthStore } from '../stores/auth-store';
import type { WorkloadCell, WorkloadData, WorkloadPerson, WorkloadTask } from '../api/planning';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const DAYS = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];

let seq = 0;
const plainTask = (key = `RIG-${100 + ++seq}`): WorkloadTask => ({ id: `x${++seq}`, key, title: `Task ${key}`, projectId: 'rig', priority: 'NORMAL', version: 1, suggestion: null });
function cells(counts: number[], special: Record<number, WorkloadTask[]> = {}): WorkloadCell[] {
  return counts.map((count, i) => {
    const limit = i >= 5 ? 0 : 5;
    const tasks = special[i] ?? Array.from({ length: count }, () => plainTask());
    return { date: DAYS[i]!, count, limit, over: Math.max(0, count - limit), tasks };
  });
}
function person(id: string, name: string, counts: number[], extra: Partial<WorkloadPerson> = {}, special: Record<number, WorkloadTask[]> = {}): WorkloadPerson {
  return { id, name, avatarUrl: null, me: false, overdue: 0, total: counts.reduce((a, b) => a + b, 0), weekLimit: 25, days: cells(counts, special), ...extra };
}

const WED: WorkloadTask[] = [
  { id: 't1', key: 'RIG-14', title: 'Pressure test report', projectId: 'rig', priority: 'LOW', version: 2, suggestion: { kind: 'reassign', to: { id: 'hassan', name: 'Hassan Ahmed' }, count: 2 } },
  { id: 't2', key: 'MOB-8', title: 'Login screen fixes', projectId: 'mob', priority: 'LOW', version: 1, suggestion: { kind: 'reassign', to: { id: 'rachel', name: 'Rachel Rea Dsouza' }, count: 0 } },
  { id: 't3', key: 'FCRM-3', title: 'Client follow-up', projectId: 'fcrm', priority: 'LOW', version: 4, suggestion: { kind: 'move', date: '2026-10-29' } },
  ...Array.from({ length: 5 }, () => plainTask()),
];

function makeData(over: Partial<WorkloadData> = {}): WorkloadData {
  return {
    week: '2026-10-25',
    today: '2026-10-28',
    days: DAYS.map((date, i) => ({ date, working: i < 5 })),
    limit: 5,
    canChangeLimit: true,
    scope: 'everyone',
    projectId: null,
    projects: [
      { id: 'rig', code: 'RIG', name: 'Rig Inspection Portal', color: '#2F6FAE', icon: null, imageUrl: null },
      { id: 'mob', code: 'MOB', name: 'Mobile App', color: '#B87611', icon: null, imageUrl: null },
    ],
    people: [
      person('hassan', 'Hassan Ahmed', [0, 1, 0, 2, 1, 0, 0]),
      person('omar', 'Omar Said', [3, 7, 5, 8, 5, 0, 0], { overdue: 12 }, { 3: WED }),
      person('rachel', 'Rachel Rea Dsouza', [0, 0, 1, 0, 1, 0, 0]),
      person('sara', 'Sara Ahmed', [2, 2, 4, 1, 5, 0, 0], { overdue: 3 }),
    ],
    ...over,
  };
}

let data: WorkloadData;
let calls: { method: string; url: string; body: unknown }[] = [];
let failLoad = false;
let conflict = false;
let admin = true;
let swapRefusal: string | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T06:00:00.000Z')); // Wednesday 28 October, 10:00 in Muscat
  data = makeData();
  calls = [];
  failLoad = false;
  conflict = false;
  admin = true;
  swapRefusal = null;
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (url.endsWith('/users/me/preferences')) return json({ data: { timeZone: null, weekStart: null } });
      if (url.includes('/workload?')) {
        if (failLoad) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
        const q = new URL(url, 'http://test.local').searchParams;
        return json({ data: { ...data, week: q.get('week'), projectId: q.get('projectId'), canChangeLimit: admin } });
      }
      const swap = /\/tasks\/([^/]+)\/assignees\/swap$/.exec(url);
      if (swap && method === 'POST') {
        if (swapRefusal) return json({ error: { code: swapRefusal, message: 'Refused.' } }, 409);
        // The server takes the task off the person's day: the next read shows it gone.
        data = {
          ...data,
          people: data.people.map((p) =>
            p.id === body.from ? { ...p, total: p.total - 1, days: p.days.map((c) => (c.tasks.some((t) => t.id === swap[1]) ? { ...c, count: c.count - 1, over: Math.max(0, c.over - 1), tasks: c.tasks.filter((t) => t.id !== swap[1]) } : c)) } : p,
          ),
        };
        return json({ data: [] });
      }
      if (/\/tasks\/[^/]+\/assignees/.test(url)) return method === 'DELETE' ? new Response(null, { status: 204 }) : json({ data: [] });
      if (/\/tasks\/[^/]+$/.test(url) && method === 'PUT') {
        if (conflict) return json({ error: { code: 'VERSION_CONFLICT', message: 'This task was changed by someone else. Reload and try again.' } }, 409);
        return json({ data: { id: 't3' } });
      }
      if (url.includes('/system-settings/')) return json({ data: { key: 'workload.dailyLimit', value: body?.value } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname + loc.search}</span>;
}
function renderPage(path = '/workload', qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <WorkloadPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const table = () => screen.getByRole('table', { name: /Open tasks due each day, per person/ });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);
const rowNames = () => bodyRows().map((r) => within(r).getByRole('rowheader').querySelector('[data-person-name]')?.textContent);
const workloadCalls = () => calls.filter((c) => c.url.includes('/workload?'));

describe('WorkloadPage', () => {
  it('asks for this week (from the person’s week start) and says who is over the daily limit', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    expect(workloadCalls()[0]!.url).toContain('/workload?week=2026-10-25');
    expect(screen.getByRole('status')).toHaveTextContent('1 person is over the daily limit on 2 days this week.');
    expect(screen.getByText(/Open tasks due each day, per person\./)).toBeInTheDocument();
    const headers = within(table()).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Person · this week', 'Overdue', 'Sun 25', 'Mon 26', 'Tue 27', 'Wed 28 · Today', 'Thu 29', 'Fri 30', 'Sat 31']);
    expect(screen.getByRole('button', { name: 'Week of 25 Oct' })).toBeInTheDocument();
  });

  it('lists the most overloaded first, each with their week against the limit and their overdue tasks', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    expect(rowNames()).toEqual(['Omar Said', 'Sara Ahmed', 'Hassan Ahmed', 'Rachel Rea Dsouza']);
    const [omar, sara, hassan] = bodyRows();
    expect(omar).toHaveTextContent('28 due · limit 25 · over by 3');
    expect(sara).toHaveTextContent('14 due · limit 25 · room for 11');
    expect(within(omar!).getAllByRole('cell')[0]).toHaveTextContent('12');
    // 0 is quiet, a day off says Off, a number opens the day.
    expect(within(hassan!).getAllByRole('cell')[1]).toHaveTextContent('0');
    expect(within(hassan!).getAllByRole('cell')[6]).toHaveTextContent('Off');
    expect(within(omar!).getByRole('button', { name: 'Omar Said, Wednesday 28 October: 8 tasks due, 3 over the limit' })).toBeInTheDocument();
    expect(within(sara!).getByRole('button', { name: 'Sara Ahmed, Thursday 29 October: 5 tasks due, at the limit' })).toHaveAttribute('data-tone', 'at');
    expect(within(sara!).getByRole('button', { name: 'Sara Ahmed, Sunday 25 October: 2 tasks due' })).toHaveAttribute('data-tone', 'below');
  });

  it('finds a person by name', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a person' }), 'ahm');
    expect(rowNames()).toEqual(['Sara Ahmed', 'Hassan Ahmed']);
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Find a person' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a person' }), 'nobody');
    expect(screen.getByText('Nobody matches “nobody”.')).toBeInTheDocument();
  });

  it('narrows to a project and moves between weeks', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Mobile App');
    await waitFor(() => expect(workloadCalls().at(-1)!.url).toContain('/workload?week=2026-10-25&projectId=mob'));
    expect(screen.getByTestId('where')).toHaveTextContent('project=mob');
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(workloadCalls().at(-1)!.url).toContain('week=2026-11-01'));
    expect(screen.getByRole('status')).toHaveTextContent('that week');
    await userEvent.click(screen.getByRole('button', { name: /Week of 1 Nov/ }));
    await waitFor(() => expect(workloadCalls().at(-1)!.url).toContain('week=2026-10-25'));
  });

  it('opens a day: the tasks to move, one suggestion each, and the rest', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.click(screen.getByRole('button', { name: /^Omar Said, Wednesday 28 October/ }));
    const pop = await screen.findByRole('dialog', { name: 'Omar Said · Wed 28 Oct' });
    expect(pop).toHaveTextContent('8 tasks due · limit 5 · 3 over');
    const items = within(pop).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'RIG-14Pressure test report→ Hassan (2 that day)',
      'MOB-8Login screen fixes→ Rachel (0 that day)',
      'FCRM-3Client follow-upMove to Thu 29',
    ]);
    expect(within(pop).getByRole('button', { name: 'Give RIG-14 to Hassan Ahmed, who has 2 tasks due that day' })).toBeInTheDocument();
    expect(pop).toHaveTextContent('+ 5 more');
    // Someone else's day: their tasks are on the calendar.
    expect(within(pop).getByRole('link', { name: 'Open in Calendar' })).toHaveAttribute('href', '/calendar?view=week&date=2026-10-28&assignee=omar&done=0&meetings=0');
    // Nothing has changed yet.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('gives a task to the suggested teammate in one call that checks the task is unchanged, then refreshes — focus stays in the day', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.click(screen.getByRole('button', { name: /^Omar Said, Wednesday 28 October/ }));
    const before = workloadCalls().length;
    await userEvent.click(await screen.findByRole('button', { name: 'Give RIG-14 to Hassan Ahmed, who has 2 tasks due that day' }));
    await waitFor(() => expect(screen.getByText('Gave RIG-14 to Hassan Ahmed.')).toBeInTheDocument());
    const writes = calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url.replace(/^.*\/api\/v1/, ''), c.body]);
    expect(writes).toEqual([['POST', '/tasks/t1/assignees/swap', { from: 'omar', to: 'hassan', expectedVersion: 2 }]]);
    await waitFor(() => expect(workloadCalls().length).toBeGreaterThan(before));
    // RIG-14 has left the day: focus moved on to the next suggestion, still inside the day's details.
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('7 tasks due · limit 5 · 2 over'));
    expect(screen.getByRole('button', { name: 'Give MOB-8 to Rachel Rea Dsouza, who has nothing due that day' })).toHaveFocus();
  });

  it('says plainly when a suggestion is refused because the task is already done, or the person is no longer on it', async () => {
    swapRefusal = 'TASK_DONE';
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.click(screen.getByRole('button', { name: /^Omar Said, Wednesday 28 October/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^Give RIG-14 to Hassan Ahmed/ }));
    expect(await screen.findByText('RIG-14 is already done. The numbers are up to date again.')).toBeInTheDocument();
    swapRefusal = 'ASSIGNEE_GONE';
    await userEvent.click(screen.getByRole('button', { name: /^Give RIG-14 to Hassan Ahmed/ }));
    expect(await screen.findByText('Omar Said is no longer on RIG-14. The numbers are up to date again.')).toBeInTheDocument();
  });

  it('names no number for a teammate when the server sends none (a project manager’s view)', async () => {
    data = makeData({ scope: 'teams' });
    data.people = data.people.map((p) =>
      p.id === 'omar' ? { ...p, days: p.days.map((c) => ({ ...c, tasks: c.tasks.map((t) => (t.suggestion?.kind === 'reassign' ? { ...t, suggestion: { ...t.suggestion, count: null } } : t)) })) } : p,
    );
    admin = false;
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.click(screen.getByRole('button', { name: /^Omar Said, Wednesday 28 October/ }));
    const give = await screen.findByRole('button', { name: 'Give RIG-14 to Hassan Ahmed' });
    expect(give).toHaveTextContent(/^→ Hassan$/);
  });

  it('keeps the day’s details in its cell, and closes them on a second click or when Tab leaves them', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    const cell = screen.getByRole('button', { name: /^Omar Said, Wednesday 28 October/ });
    await userEvent.click(cell);
    const pop = screen.getByRole('dialog', { name: 'Omar Said · Wed 28 Oct' });
    expect(cell.closest('td')!.contains(pop)).toBe(true);
    await userEvent.click(cell);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(cell);
    within(screen.getByRole('dialog')).getByRole('link', { name: 'Open in Calendar' }).focus();
    await userEvent.tab();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reads the numbers again whenever the page is opened (a changed limit or working hours show)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderPage('/workload', qc);
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    first.unmount();
    const before = workloadCalls().length;
    renderPage('/workload', qc);
    await waitFor(() => expect(workloadCalls().length).toBe(before + 1));
  });

  it('moves a task to the suggested day with the usual task update, sending the version it was read at', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.click(screen.getByRole('button', { name: /^Omar Said, Wednesday 28 October/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move FCRM-3 to Thursday 29 October' }));
    await waitFor(() => expect(screen.getByText('Moved FCRM-3 to Thursday 29 October.')).toBeInTheDocument());
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toMatch(/\/tasks\/t3$/);
    expect(put.body).toEqual({ dueDate: '2026-10-29', expectedVersion: 4 });
  });

  it('says so when the task changed meanwhile, and refreshes', async () => {
    conflict = true;
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    await userEvent.click(screen.getByRole('button', { name: /^Omar Said, Wednesday 28 October/ }));
    const before = workloadCalls().length;
    await userEvent.click(await screen.findByRole('button', { name: 'Move FCRM-3 to Thursday 29 October' }));
    expect(await screen.findByText('Someone else changed FCRM-3 just now. The numbers are up to date again — try once more if it still needs moving.')).toBeInTheDocument();
    await waitFor(() => expect(workloadCalls().length).toBeGreaterThan(before));
  });

  it('on your own day, offers My Tasks; Escape closes and returns to the number', async () => {
    data = makeData();
    data.people = data.people.map((p) => (p.id === 'sara' ? { ...p, me: true } : p));
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    const cell = screen.getByRole('button', { name: 'Sara Ahmed, Tuesday 27 October: 4 tasks due' });
    await userEvent.click(cell);
    const pop = await screen.findByRole('dialog', { name: 'Sara Ahmed · Tue 27 Oct' });
    expect(pop).toHaveTextContent('4 tasks due · limit 5 · room for 1');
    expect(within(pop).getAllByRole('listitem')).toHaveLength(4);
    expect(within(pop).getByRole('link', { name: 'Open in My Tasks' })).toHaveAttribute('href', '/my-tasks');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cell).toHaveFocus();
  });

  it('shows tasks due on a day off as their own case, not over the limit, with a move to a working day', async () => {
    const weekendTask: WorkloadTask = { id: 'tw', key: 'RIG-60', title: 'Weekend upload', projectId: 'rig', priority: 'NORMAL', version: 1, suggestion: { kind: 'move', date: '2026-11-01' } };
    data = makeData();
    data.people = data.people.map((p) =>
      p.id === 'rachel' ? { ...p, total: p.total + 1, days: p.days.map((c) => (c.date === '2026-10-30' ? { ...c, count: 1, over: 1, tasks: [weekendTask] } : c)) } : p,
    );
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    // Still only Omar is over the daily limit.
    expect(screen.getByRole('status')).toHaveTextContent('1 person is over the daily limit on 2 days this week.');
    const cell = screen.getByRole('button', { name: 'Rachel Rea Dsouza, Friday 30 October: a day off, 1 task due' });
    expect(cell).toHaveAttribute('data-tone', 'offdue');
    expect(cell).toHaveTextContent(/^1$/);
    await userEvent.click(cell);
    const pop = await screen.findByRole('dialog', { name: 'Rachel Rea Dsouza · Fri 30 Oct' });
    expect(pop).toHaveTextContent('1 task due on a day off');
    expect(within(pop).getByRole('button', { name: 'Move RIG-60 to Sunday 1 November' })).toHaveTextContent('Move to Sun 1 Nov');
  });

  it('lets an administrator change the daily limit, which the page then shows', async () => {
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    const before = workloadCalls().length;
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Daily limit' }), '6');
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/system-settings/workload.dailyLimit'))).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ value: 6 });
    await waitFor(() => expect(workloadCalls().length).toBeGreaterThan(before));
  });

  it('shows the limit to everyone else without a way to change it', async () => {
    admin = false;
    renderPage();
    await screen.findByRole('table', { name: /Open tasks due each day, per person/ });
    expect(screen.queryByRole('combobox', { name: 'Daily limit' })).not.toBeInTheDocument();
    expect(screen.getByText('Daily limit').parentElement).toHaveTextContent('Daily limit 5');
  });

  it('shows a load error with Retry', async () => {
    failLoad = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the workload.');
    failLoad = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: /Open tasks due each day, per person/ })).toBeInTheDocument();
  });
});
