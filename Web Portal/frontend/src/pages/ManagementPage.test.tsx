import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagementPage, ManagementRoute } from './ManagementPage';
import { useAuthStore } from '../stores/auth-store';
import type { ItemList, ManagementOverview } from '../api/management';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function overview(over: Partial<ManagementOverview> = {}): ManagementOverview {
  return {
    scope: 'ALL',
    generatedAt: '2026-10-27T06:00:00.000Z',
    timeZone: 'Asia/Muscat',
    today: '2026-10-27',
    weekStart: 0,
    filters: { projectIds: [], ownerId: null, statuses: ['PLANNING', 'ACTIVE', 'ON_HOLD'], weeks: 12 },
    period: { from: '2026-08-09', to: '2026-10-27', weeks: 12 },
    options: {
      projects: [
        { id: 'rig', code: 'RIG', name: 'Rig Inspection Portal', status: 'ACTIVE', color: '#2F6FAE', icon: null, imageUrl: null },
        { id: 'arab', code: 'ARB', name: 'مشروع الحفر', status: 'PLANNING', color: '#B87611', icon: null, imageUrl: null },
        { id: 'old', code: 'OLD', name: 'Old Works', status: 'ARCHIVED', color: '#948985', icon: null, imageUrl: null },
      ],
      owners: [{ id: 'omar', name: 'Omar Ahmed' }],
    },
    tiles: { projects: 2, red: 1, amber: 0, green: 1, lateTasks: 4, missingChecks: 3, checksDue: 7, checksDone: 3, checksDoneLate: 1, passRate: 88, openFollowUps: 1, overloadedPeople: 1 },
    projects: [
      {
        id: 'rig',
        code: 'RIG',
        name: 'Rig Inspection Portal',
        status: 'ACTIVE',
        color: '#2F6FAE',
        icon: null,
        imageUrl: null,
        owner: null,
        total: 13,
        done: 5,
        open: 8,
        late: 4,
        completionPct: 38,
        nextMilestone: { id: 'r1', key: 'RIG-1', title: 'Handover', due: '2026-10-24', daysLeft: -3 },
        lateMilestones: 1,
        lastActivityAt: '2026-10-26T08:00:00.000Z',
        missingChecks: 3,
        checksDue: 7,
        checksDone: 3,
        checksDoneLate: 1,
        openFollowUps: 1,
        rag: 'RED',
        reasons: [
          { code: 'MILESTONE_LATE', level: 'RED', text: 'Milestone “Handover” is 3 days late' },
          { code: 'MANY_MISSING_CHECKS', level: 'RED', text: '3 missing checks' },
        ],
      },
      {
        id: 'arab',
        code: 'ARB',
        name: 'مشروع الحفر',
        status: 'PLANNING',
        color: '#B87611',
        icon: null,
        imageUrl: null,
        owner: { id: 'omar', name: 'Omar Ahmed' },
        total: 2,
        done: 1,
        open: 1,
        late: 0,
        completionPct: 50,
        nextMilestone: null,
        lateMilestones: 0,
        lastActivityAt: '2026-10-27T05:00:00.000Z',
        missingChecks: 0,
        checksDue: 0,
        checksDone: 0,
        checksDoneLate: 0,
        openFollowUps: 0,
        rag: 'GREEN',
        reasons: [{ code: 'ON_TRACK', level: 'GREEN', text: 'On track' }],
      },
    ],
    inspections: {
      due: 7,
      done: 3,
      doneLate: 1,
      noReport: 1,
      missing: 3,
      finished: 3,
      passed: 22,
      failed: 3,
      passRate: 88,
      openFollowUps: 1,
      topItems: [{ formId: 'F1', itemId: 'valve', label: 'Valve sealed', formTitle: 'Rig daily check', failures: 2 }],
      topForms: [{ formId: 'F1', title: 'Rig daily check', finished: 2, withFailures: 2, failedItems: 3 }],
    },
    people: [{ id: 'bilal', name: 'Bilal Ahmed', avatarUrl: null, lateTasks: 2, overloadedDays: [{ date: '2026-10-28', count: 4, limit: 2 }], openActions: 1, overdueActions: 1 }],
    workload: { week: '2026-10-25', limit: 2, workingDays: [0, 1, 2, 3, 4] },
    trends: [
      { start: '2026-10-11', end: '2026-10-17', label: '11 Oct', current: false, created: 2, completed: 1, late: 1, passed: 5, failed: 0, passRate: 100 },
      { start: '2026-10-18', end: '2026-10-24', label: '18 Oct', current: false, created: 1, completed: 4, late: 2, passed: 8, failed: 2, passRate: 80 },
      { start: '2026-10-25', end: '2026-10-31', label: '25 Oct', current: true, created: 1, completed: 2, late: 4, passed: 9, failed: 1, passRate: 90 },
    ],
    ...over,
  };
}

const LATE: ItemList = {
  metric: 'late-tasks',
  title: 'Late tasks · Rig Inspection Portal',
  total: 4,
  limit: 200,
  rows: [
    { kind: 'task', id: 'c3', title: 'Daily rig check', key: 'RIG-7', project: { id: 'rig', code: 'RIG', name: 'Rig Inspection Portal' }, due: '2026-10-22', daysLate: 5, people: ['Zara Ahmed'], tone: 'danger' },
  ],
};

let data: ManagementOverview;
let calls: string[];
let fail: boolean | number;
let allowed: boolean | 'error';
let items: Record<string, ItemList>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T06:00:00.000Z'));
  data = overview();
  calls = [];
  fail = false;
  allowed = true;
  items = {};
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (url.endsWith('/management/access')) {
        if (allowed === 'error') return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
        return json({ data: allowed ? { allowed: true, scope: 'RUN' } : { allowed: false, scope: null } });
      }
      if (url.includes('/management/overview.pdf')) return new Response(new Blob(['%PDF-1.4']), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="management-overview-2026-10-27.pdf"' } });
      if (url.includes('/management/overview')) {
        if (fail === 403) return json({ error: { code: 'FORBIDDEN', message: 'Only administrators and the people who run a project can see the Management page.' } }, 403);
        if (fail) return json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500);
        return json({ data });
      }
      if (url.includes('/management/items')) {
        const metric = new URL(url, 'http://test.local').searchParams.get('metric') ?? '';
        return json({ data: items[metric] ?? LATE });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let where = '';
function Where() {
  const l = useLocation();
  where = `${l.pathname}${l.search}`;
  return null;
}
function renderPage(path = '/management') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/management" element={<ManagementPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const overviewCalls = () => calls.filter((c) => c.includes('/management/overview?'));

describe('ManagementPage', () => {
  it('shows the headline numbers and every project’s mark in words, with its reasons and Arabic names set to their own direction', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Management' })).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    const health = await screen.findByRole('region', { name: 'Project health' });
    const rows = within(health).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Red');
    expect(rows[1]).toHaveTextContent('Milestone “Handover” is 3 days late');
    expect(rows[1]).toHaveTextContent('3 days late');
    expect(rows[2]).toHaveTextContent('Green');
    expect(rows[2]).toHaveTextContent('On track');
    // An Arabic name sits at the start like the others, read right to left inside its own <bdi> (D3).
    const arabic = within(health).getAllByText('مشروع الحفر')[0]!;
    expect(arabic.tagName).toBe('BDI');
    expect(arabic.closest('[dir="auto"]')).toBeNull();
    expect(screen.getByRole('button', { name: /4 late tasks in all projects/i })).toBeInTheDocument();
    // A percentage isn't a list: the pass rate is shown, not a button (M-7).
    expect(screen.getAllByText('88%').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /pass rate/i })).not.toBeInTheDocument();
  });

  it('keeps the filters in the address: what it opened with is asked for, a change is written back and read again', async () => {
    renderPage('/management?weeks=4&status=ACTIVE');
    await screen.findByRole('region', { name: 'Project health' });
    expect(overviewCalls()[0]).toContain('status=ACTIVE&weeks=4');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: '26 weeks' }));
    await waitFor(() => expect(where).toContain('weeks=26'));
    await waitFor(() => expect(overviewCalls().at(-1)).toContain('weeks=26'));
    await user.click(screen.getByRole('checkbox', { name: 'Archived' }));
    await waitFor(() => expect(where).toContain('status=ACTIVE%2CARCHIVED'));
    await waitFor(() => expect(overviewCalls().at(-1)).toContain('status=ACTIVE%2CARCHIVED'));
  });

  it('follows the address when it changes on its own (back, forward, a link)', async () => {
    let go: (to: string) => void = () => {};
    function Nav() {
      go = useNavigate();
      return null;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/management?weeks=4']}>
          <Nav />
          <Routes>
            <Route path="/management" element={<ManagementPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('region', { name: 'Project health' });
    expect(screen.getByRole('radio', { name: '4 weeks' })).toBeChecked();
    act(() => go('/management?weeks=26&status=ARCHIVED'));
    await waitFor(() => expect(screen.getByRole('radio', { name: '26 weeks' })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: 'Archived' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Active' })).not.toBeChecked();
    await waitFor(() => expect(overviewCalls().at(-1)).toContain('status=ARCHIVED&weeks=26'));
  });

  it('chooses projects and an owner', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Project health' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /projects: all/i }));
    const box = screen.getByRole('checkbox', { name: 'Rig Inspection Portal' });
    await user.click(box);
    // Ticked at once — not only once the address has caught up (router updates are transitions).
    expect(box).toBeChecked();
    await waitFor(() => expect(where).toContain('projects=rig'));
    await waitFor(() => expect(overviewCalls().at(-1)).toContain('projectIds=rig'));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /owner/i }));
    await user.click(await screen.findByRole('option', { name: /Omar Ahmed/ }));
    await waitFor(() => expect(where).toContain('owner=omar'));
  });

  it('opens the list behind a number in a side sheet; a row opens its task; Escape closes it', async () => {
    renderPage();
    const health = await screen.findByRole('region', { name: 'Project health' });
    const user = userEvent.setup();
    await user.click(within(health).getAllByRole('button', { name: /4 late tasks in Rig Inspection Portal/i })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'Late tasks · Rig Inspection Portal' });
    expect(calls.some((c) => c.includes('/management/items?') && c.includes('metric=late-tasks') && c.includes('projectId=rig'))).toBe(true);
    expect(await within(sheet).findByText('Daily rig check')).toBeInTheDocument();
    expect(within(sheet).getByText('5 days late')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /Daily rig check/ }));
    await waitFor(() => expect(where).toContain('task=c3'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /late tasks/i })).not.toBeInTheDocument());
  });

  it('has a table alternative for the charts', async () => {
    renderPage();
    const trends = await screen.findByRole('region', { name: 'Trends' });
    const table = within(trends).getByRole('table', { name: /weekly figures/i });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(table).toHaveTextContent('90%');
  });

  it('says when there are no projects in scope, and when there are no inspections yet', async () => {
    data = overview({
      projects: [],
      people: [],
      tiles: { ...overview().tiles, projects: 0, red: 0, green: 0, lateTasks: 0, missingChecks: 0, checksDue: 0, checksDone: 0, passRate: null },
      inspections: { ...overview().inspections, due: 0, done: 0, doneLate: 0, noReport: 0, missing: 0, finished: 0, passed: 0, failed: 0, passRate: null, openFollowUps: 0, topItems: [], topForms: [] },
    });
    renderPage();
    expect(await screen.findByText('No projects to show')).toBeInTheDocument();
    expect(screen.getByText('No inspections yet')).toBeInTheDocument();
  });

  it('says it couldn’t load, with a retry', async () => {
    fail = true;
    renderPage();
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('Couldn’t load the management overview.');
  });

  it('downloads the PDF with the same filters, under the name the server gives it', async () => {
    const created: string[] = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download);
    });
    renderPage('/management?weeks=26');
    await screen.findByRole('region', { name: 'Project health' });
    await userEvent.setup().click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(created).toEqual(['management-overview-2026-10-27.pdf']));
    expect(calls.find((c) => c.includes('/management/overview.pdf'))).toContain('weeks=26');
    click.mockRestore();
  });
});

describe('ManagementRoute', () => {
  function renderRoute() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/management']}>
          <Where />
          <Routes>
            <Route path="/management" element={<ManagementRoute />} />
            <Route path="/dashboard" element={<p>Dashboard page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('opens the page for someone who runs a project', async () => {
    renderRoute();
    expect(await screen.findByRole('heading', { level: 1, name: 'Management' })).toBeInTheDocument();
  });

  it('sends anyone else to the dashboard', async () => {
    allowed = false;
    renderRoute();
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument();
    expect(where).toBe('/dashboard');
  });
});


const day = (key: string) => key;
function weeks(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(Date.UTC(2026, 7, 9 + 7 * i)).toISOString().slice(0, 10);
    return { start, end: start, label: start.slice(5), current: i === n - 1, created: i, completed: 1, late: 2, passed: i % 2 ? 9 : 0, failed: i % 2 ? 1 : 0, passRate: i % 2 ? 90 : null };
  });
}

describe('ManagementPage: the fixes from review', () => {
  it('the trend charts share their weeks: the pass rate has gaps, no label is cut or marked “(now)” (D1, D4)', async () => {
    data = overview({ trends: weeks(12) });
    renderPage();
    const trends = await screen.findByRole('region', { name: 'Trends' });
    const charts = within(trends).getAllByRole('img');
    expect(charts).toHaveLength(3);
    const ticks = (c: HTMLElement) => [...c.querySelectorAll('text')].map((t) => t.textContent).filter((t) => /^\d\d-\d\d$/.test(t ?? ''));
    expect(ticks(charts[2]!)).toEqual(ticks(charts[0]!));
    expect(trends.textContent).not.toContain('(now)');
  });

  it('the weekly table shows the latest six weeks, and all of them on request — never half a row (D2)', async () => {
    data = overview({ trends: weeks(12) });
    renderPage();
    const trends = await screen.findByRole('region', { name: 'Trends' });
    const table = within(trends).getByRole('table', { name: /weekly figures/i });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    await userEvent.setup().click(within(trends).getByRole('button', { name: 'Show all 12 weeks' }));
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(within(trends).getByRole('button', { name: 'Show the latest 6 weeks' })).toBeInTheDocument();
  });

  it('every count opens its own list: a reason, a late milestone, overdue action items, a form’s numbers (M-7)', async () => {
    renderPage();
    const user = userEvent.setup();
    const health = await screen.findByRole('region', { name: 'Project health' });
    const itemCalls = () => calls.filter((c) => c.includes('/management/items?'));
    await user.click(within(health).getAllByRole('button', { name: /Milestone “Handover” is 3 days late: show the list/ })[0]!);
    await waitFor(() => expect(itemCalls().at(-1)).toMatch(/metric=late-milestones.*projectId=rig|projectId=rig.*metric=late-milestones/));
    await user.keyboard('{Escape}');
    await user.click(within(health).getAllByRole('button', { name: /3 missing checks: show the list/ })[0]!);
    await waitFor(() => expect(itemCalls().at(-1)).toContain('metric=missing-checks'));
    await user.keyboard('{Escape}');
    await user.click(within(health).getAllByRole('button', { name: /Late milestones in Rig Inspection Portal: show the list/ })[0]!);
    await waitFor(() => expect(itemCalls().at(-1)).toContain('metric=late-milestones'));
    await user.keyboard('{Escape}');
    const people = screen.getByRole('region', { name: 'People and workload' });
    await user.click(within(people).getAllByRole('button', { name: /Bilal Ahmed: 1 overdue action item: show the list/ })[0]!);
    await waitFor(() => expect(itemCalls().at(-1)).toMatch(/metric=overdue-actions/));
    await user.keyboard('{Escape}');
    const insp = screen.getByRole('region', { name: 'Inspections' });
    await user.click(within(insp).getByRole('button', { name: /3 failed items in Rig daily check: show the list/ }));
    await waitFor(() => expect(itemCalls().at(-1)).toMatch(/metric=failed-form/));
    await user.keyboard('{Escape}');
    await user.click(within(insp).getByRole('button', { name: /2 inspections of Rig daily check had a failure: show the list/ }));
    await waitFor(() => expect(itemCalls().at(-1)).toMatch(/failed=1/));
  });

  it('an overloaded person’s list has one row per day (as the number counts days), each with its tasks, and links to that Workload week (M-7, I-1)', async () => {
    items['person-overloaded'] = {
      metric: 'person-overloaded',
      title: 'Overloaded days · Bilal Ahmed',
      total: 1,
      limit: 200,
      rows: [{ kind: 'day', id: day('2026-10-28'), title: 'Wed 28 Oct', detail: '4 due (limit 2)', tone: 'danger', tasks: [{ id: 't1', key: 'RIG-3', title: 'Pressure test' }] }],
    };
    renderPage();
    const people = await screen.findByRole('region', { name: 'People and workload' });
    const user = userEvent.setup();
    await user.click(within(people).getAllByRole('button', { name: /Bilal Ahmed: 1 day over the limit this week: show the list/ })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'Overloaded days · Bilal Ahmed' });
    expect(await within(sheet).findByText('Wed 28 Oct')).toBeInTheDocument();
    expect(within(sheet).getByText('1 day')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /Wed 28 Oct/ })).toHaveAttribute('href', '/workload?week=2026-10-25');
    await user.click(within(sheet).getByRole('button', { name: /RIG-3 Pressure test/ }));
    await waitFor(() => expect(where).toContain('task=t1'));
  });

  it('picking a project another status filter hides shows it anyway, by adding its status (M-8)', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Project health' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /projects: all/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Old Works' }));
    await waitFor(() => expect(where).toContain('projects=old'));
    expect(where).toContain('status=PLANNING%2CACTIVE%2CON_HOLD%2CARCHIVED');
    expect(screen.getByRole('checkbox', { name: 'Archived' })).toBeChecked();
  });

  it('a project runner’s numbers say “in the projects you run” (M-10)', async () => {
    data = overview({ scope: 'RUN' });
    renderPage();
    expect(await screen.findByRole('button', { name: /4 late tasks in the projects you run/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /in all projects/ })).not.toBeInTheDocument();
  });

  it('someone who no longer runs a project is told so, in plain words (M-5)', async () => {
    fail = 403;
    renderPage();
    expect(await screen.findByText(/You no longer run any projects/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load/)).not.toBeInTheDocument();
  });
});

describe('ManagementRoute: losing access while on the page (M-5)', () => {
  it('says so in plain words and stays — it doesn’t whisk them off to the dashboard', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/management']}>
          <Where />
          <Routes>
            <Route path="/management" element={<ManagementRoute />} />
            <Route path="/dashboard" element={<p>Dashboard page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('region', { name: 'Project health' });
    allowed = false;
    fail = 403;
    await userEvent.setup().click(screen.getByRole('radio', { name: '26 weeks' }));
    await waitFor(() => expect(screen.getByText(/You no longer run any projects/)).toBeInTheDocument());
    // The access was asked again (the sidebar link goes), and the page still says why.
    await waitFor(() => expect(calls.filter((c) => c.endsWith('/management/access')).length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/You no longer run any projects/)).toBeInTheDocument();
    expect(where.startsWith('/management')).toBe(true);
  });
});

describe('ManagementRoute: when access can’t be checked (M-5)', () => {
  it('a network problem says so and offers to try again — it never sends anyone to the dashboard', async () => {
    allowed = 'error';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/management']}>
          <Where />
          <Routes>
            <Route path="/management" element={<ManagementRoute />} />
            <Route path="/dashboard" element={<p>Dashboard page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Couldn’t check whether you can see this page/, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(where).toBe('/management');
    allowed = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Management' })).toBeInTheDocument();
  });
});
