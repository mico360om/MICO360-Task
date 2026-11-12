import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '../../stores/auth-store';
import type { KpiTile, ManagementKpis, PersonKpis, ProjectKpis, TrendPoint } from '../../api/kpis';
import { ProjectKpisTab } from './ProjectKpisTab';
import { ManagementKpiTable } from './ManagementKpiTable';
import { TargetsEditor } from './TargetsEditor';
import { KpiTileCard, LightMark, Sparkline } from './kpi-ui';
import { PerformancePage } from '../../pages/PerformancePage';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const POINTS: TrendPoint[] = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].map((label, i) => ({ key: `2026-${String(i + 6).padStart(2, '0')}`, label, current: i === 5, rebuilt: i < 5 }));

function tile(over: Partial<KpiTile> = {}): KpiTile {
  return { metric: 'onTime', label: 'On-time completion', help: 'Finished on or before the agreed due day', unit: 'percent', direction: 'higher', value: 50, detail: '1 of 2 tasks finished on time', target: 85, amberBand: 8.5, targetSource: 'company', light: 'red', words: 'Off target', trend: [null, 80, 90, null, 50, 50], list: true, ...over };
}

const PERIOD = { kind: 'month' as const, from: '2026-11-01', to: '2026-11-11', end: '2026-11-30', label: 'This month (1–11 Nov 2026)' };
function projectKpis(over: Partial<ProjectKpis> = {}): ProjectKpis {
  return {
    project: { id: 'rig', code: 'RIG', name: 'Rig 3', color: '#8B1E1E', icon: null, imageUrl: null, status: 'ACTIVE', archived: false, companyId: 'c1' },
    period: PERIOD,
    today: '2026-11-11',
    timeZone: 'Asia/Muscat',
    generatedAt: '2026-11-11T06:00:00.000Z',
    trend: { kind: 'month', points: POINTS },
    tiles: [tile(), tile({ metric: 'daysLate', label: 'Average days late', unit: 'days', direction: 'lower', value: 2, target: 2, light: 'green', words: 'On target', detail: '1 task finished late' }), tile({ metric: 'progress', label: 'Progress vs time', value: 92, target: 100, light: 'amber', words: 'Close', list: false })],
    custom: [{ id: 'k1', name: 'Safety incidents', unit: 'incidents', direction: 'LOWER', target: 0, amberBand: null, values: POINTS.map((p) => ({ month: p.key, value: p.key === '2026-10' ? 1 : null, note: null })), latest: { month: '2026-10', value: 1 }, light: 'amber', words: 'Close', due: null }],
    can: { manage: true },
    ...over,
  };
}

let calls: { method: string; url: string; body: unknown }[] = [];
let answers: Record<string, (url: string, method: string) => Response>;
beforeEach(() => {
  calls = [];
  useAuthStore.setState({ user: { id: 'mgr', email: 'm@x', username: 'mgr', roles: ['EMPLOYEE'] } as never, accessToken: 'at', refreshToken: 'rt', isAuthenticated: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      for (const [k, f] of Object.entries(answers)) if (url.includes(k)) return f(url, method);
      return json({ data: [] });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

let where = '';
function Where() {
  const l = useLocation();
  where = `${l.pathname}${l.search}`;
  return null;
}
function renderAt(path: string, element: React.ReactNode, route = '*') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('a KPI tile', () => {
  it('says its light in words, its target and what is behind it; opens its list', async () => {
    const open = vi.fn();
    render(<KpiTileCard tile={tile()} points={POINTS} onOpen={open} />);
    const button = screen.getByRole('button', { name: 'On-time completion: 50%, Off target. Show the list' });
    expect(button).toHaveTextContent('Target: At least 85%');
    expect(button).toHaveTextContent('1 of 2 tasks finished on time');
    expect(within(button).getByText(/Trend: Jun no figure, Jul 80%/)).toBeInTheDocument();
    await userEvent.click(button);
    expect(open).toHaveBeenCalled();
  });

  it('a KPI without a list is not a button; no figure reads "—"', () => {
    render(<KpiTileCard tile={tile({ list: false, value: null, light: 'nodata', words: 'No data yet' })} points={POINTS} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('a light is never colour alone; a sparkline leaves gaps for months with no figure', () => {
    const { container } = render(
      <>
        <LightMark light="amber" words="Close" />
        <Sparkline values={[1, null, 3, 4]} light="green" />
      </>,
    );
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });
});

describe('the project KPIs tab', () => {
  beforeEach(() => {
    answers = {
      '/kpis/projects/rig/items': () => json({ data: { metric: 'onTime', title: 'On-time completion', total: 1, limit: 200, rows: [{ kind: 'task', id: 't9', key: 'RIG-9', title: 'Pour slab', projectId: 'rig', due: '2026-11-05', doneDay: '2026-11-09', days: 2, hours: null, people: ['ann'], peopleNames: ['Ann'], detail: '2 working days late', tone: 'danger', project: { id: 'rig', code: 'RIG', name: 'Rig 3' } }] } }),
      '/kpis/projects/rig/targets': (_u, m) => json({ data: { projectId: 'rig', companyId: 'c1', metrics: [{ metric: 'onTime', label: 'On-time completion', unit: 'percent', direction: 'higher', builtIn: 85, target: 85, amberBand: null, source: 'default', own: false }] } }, m === 'PUT' ? 200 : 200),
      '/kpis/projects/rig': () => json({ data: projectKpis() }),
    };
  });

  it('shows the period, each KPI with its light, the own KPIs, and opens the tasks behind a number', async () => {
    const openTask = vi.fn();
    renderAt('/projects/rig?tab=kpis', <ProjectKpisTab projectId="rig" onOpenTask={openTask} />);
    expect(await screen.findByText('This month (1–11 Nov 2026)')).toBeInTheDocument();
    expect(screen.getAllByText('Off target').length).toBeGreaterThan(0);
    expect(screen.getByText('Behind by 8%')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /own KPIs by month/ })).toHaveTextContent('Safety incidents');
    expect(screen.getByText(/Jun, Jul, Aug, Sep, Oct were worked out from task dates/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /On-time completion: 50%/ }));
    const sheet = await screen.findByRole('dialog', { name: 'On-time completion' });
    await userEvent.click(within(sheet).getByRole('button', { name: /Pour slab/ }));
    expect(openTask).toHaveBeenCalledWith('t9');
  });

  it('a task deleted or merged while late is listed with why, but can’t be opened (owner, 11 Nov: late stays counted)', async () => {
    const gone = { kind: 'task', projectId: 'rig', due: '2026-11-02', doneDay: '2026-11-05', hours: null, people: [], peopleNames: [], tone: 'danger', project: { id: 'rig', code: 'RIG', name: 'Rig 3' } };
    answers['/kpis/projects/rig/items'] = () =>
      json({
        data: {
          metric: 'onTime',
          title: 'On-time completion',
          total: 3,
          limit: 200,
          rows: [
            { ...gone, id: 'x1', key: 'RIG-4', title: 'Old pour', days: 3, detail: '3 working days late · deleted while late (due 2 Nov 2026)', removed: 'binned' },
            { ...gone, id: 'x2', key: null, title: 'A task that was merged', days: 2, detail: '2 working days late · merged while late (due 2 Nov 2026)', removed: 'merged' },
            { ...gone, id: 't9', key: 'RIG-9', title: 'Pour slab', days: 2, detail: '2 working days late', people: ['ann'], peopleNames: ['Ann'] },
          ],
        },
      });
    const openTask = vi.fn();
    renderAt('/projects/rig?tab=kpis', <ProjectKpisTab projectId="rig" onOpenTask={openTask} />);
    await userEvent.click(await screen.findByRole('button', { name: /On-time completion: 50%/ }));
    const sheet = await screen.findByRole('dialog', { name: 'On-time completion' });
    expect(await within(sheet).findByText(/deleted while late/)).toBeInTheDocument();
    expect(within(sheet).getByText(/merged while late/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /Old pour/ })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /A task that was merged/ })).toBeNull();
    await userEvent.click(within(sheet).getByText('Old pour'));
    expect(openTask).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole('button', { name: /Pour slab/ }));
    expect(openTask).toHaveBeenCalledWith('t9');
  });

  it('the period is kept in the address; week asks for it', async () => {
    renderAt('/projects/rig?tab=kpis', <ProjectKpisTab projectId="rig" onOpenTask={() => {}} />);
    await screen.findByText('This month (1–11 Nov 2026)');
    await userEvent.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(where).toContain('period=week'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/kpis/projects/rig?period=week'))).toBe(true));
  });

  it('whoever runs it sees Targets and the own-KPI buttons; anyone else doesn’t', async () => {
    answers['/kpis/projects/rig'] = () => json({ data: projectKpis({ can: { manage: false } }) });
    renderAt('/projects/rig?tab=kpis', <ProjectKpisTab projectId="rig" onOpenTask={() => {}} />);
    await screen.findByText('This month (1–11 Nov 2026)');
    expect(screen.queryByRole('button', { name: 'Targets' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a KPI' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Enter a value/ })).toBeNull();
  });

  it('Manager View (Release B): an administrator on a project they don’t run sees no Targets or own-KPI buttons (the page says its settings are closed)', async () => {
    renderAt('/projects/rig?tab=kpis', <ProjectKpisTab projectId="rig" onOpenTask={() => {}} settingsAllowed={false} />);
    await screen.findByText('This month (1–11 Nov 2026)');
    expect(screen.queryByRole('button', { name: 'Targets' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a KPI' })).toBeNull();
  });

  it('adds an own KPI', async () => {
    answers['/kpis/projects/rig/custom'] = () => json({ data: [] }, 201);
    renderAt('/projects/rig?tab=kpis', <ProjectKpisTab projectId="rig" onOpenTask={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a KPI' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a KPI' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Budget used');
    await userEvent.type(within(dialog).getByLabelText(/^Unit/), '%');
    await userEvent.click(within(dialog).getByLabelText('Lower'));
    await userEvent.type(within(dialog).getByLabelText('Target'), '80');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add KPI' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.includes('/kpis/projects/rig/custom'))?.body).toEqual({ name: 'Budget used', unit: '%', direction: 'LOWER', target: 80, amberBand: null }));
  });
});

describe('the targets form', () => {
  it('sends only what changed; empty means no target; "use the company’s" goes back', async () => {
    const save = vi.fn();
    render(
      <TargetsEditor
        level="project"
        busy={false}
        error={null}
        onSave={save}
        metrics={[
          { metric: 'onTime', label: 'On-time completion', unit: 'percent', direction: 'higher', builtIn: 85, target: 90, amberBand: null, source: 'project', own: true },
          { metric: 'daysLate', label: 'Average days late', unit: 'days', direction: 'lower', builtIn: 2, target: 2, amberBand: null, source: 'company', own: false },
          { metric: 'blocked', label: 'Open blocked', unit: 'tasks', direction: 'lower', builtIn: 0, target: 0, amberBand: null, source: 'default', own: false },
        ]}
      />,
    );
    await userEvent.click(screen.getByLabelText('Use the company’s'));
    await userEvent.clear(screen.getByLabelText('Average days late: target'));
    await userEvent.type(screen.getByLabelText('Average days late: target'), '3');
    await userEvent.clear(screen.getByLabelText('Open blocked: target'));
    await userEvent.click(screen.getByRole('button', { name: 'Save targets' }));
    expect(save).toHaveBeenCalledWith([
      { metric: 'onTime', inherit: true },
      { metric: 'daysLate', target: 3, amberBand: null },
      { metric: 'blocked', target: null, amberBand: null },
    ]);
  });
});

describe('the Management KPI table', () => {
  const table: ManagementKpis = {
    scope: 'ALL',
    period: PERIOD,
    today: '2026-11-11',
    timeZone: 'Asia/Muscat',
    generatedAt: '2026-11-11T06:00:00.000Z',
    metrics: [{ metric: 'onTime', label: 'On-time completion', unit: 'percent', direction: 'higher' }],
    rows: [
      { project: { id: 'a', code: 'A', name: 'Alpha', color: '#8B1E1E', icon: null, imageUrl: null, status: 'ACTIVE' }, owner: null, figures: { onTime: { value: 95, light: 'green', words: 'On target', target: 85 } } },
      { project: { id: 'b', code: 'B', name: 'Bravo', color: '#8B1E1E', icon: null, imageUrl: null, status: 'ACTIVE' }, owner: null, figures: { onTime: { value: 40, light: 'red', words: 'Off target', target: 85 } } },
    ],
  };
  beforeEach(() => {
    answers = { '/kpis/management': () => json({ data: table }) };
  });

  it('every project’s KPIs with lights in words; sorting by a KPI puts the furthest off target first', async () => {
    renderAt('/management', <ManagementKpiTable filters={{ projectIds: [], ownerId: null, statuses: ['ACTIVE'], weeks: 12 }} today="2026-11-11" />);
    const t = await screen.findByRole('table', { name: /Each project’s KPIs/ });
    const names = () => within(t).getAllByRole('link').map((r) => r.getAttribute('href'));
    expect(names()).toEqual(['/projects/a?tab=kpis', '/projects/b?tab=kpis']);
    expect(t).toHaveTextContent('Off target');
    await userEvent.click(within(t).getByRole('button', { name: 'On-time completion' }));
    expect(names()).toEqual(['/projects/b?tab=kpis', '/projects/a?tab=kpis']);
    expect(within(t).getByRole('link', { name: 'Bravo' })).toHaveAttribute('href', '/projects/b?tab=kpis');
  });

  it('below 1280 px the projects are cards (every figure in view), with "Sort by"', async () => {
    renderAt('/management', <ManagementKpiTable filters={{ projectIds: [], ownerId: null, statuses: ['ACTIVE'], weeks: 12 }} today="2026-11-11" />);
    const cards = await screen.findByRole('list', { name: 'Project KPIs' });
    const order = () => within(cards).getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(order()).toEqual(['/projects/a?tab=kpis', '/projects/b?tab=kpis']);
    expect(within(cards).getAllByText('On-time completion')).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'onTime|asc');
    expect(order()).toEqual(['/projects/b?tab=kpis', '/projects/a?tab=kpis']);
  });
});

describe('My performance and a person’s KPIs', () => {
  const person = (over: Partial<PersonKpis> = {}): PersonKpis => ({
    person: { id: 'ann', name: 'Ann Lee', avatarUrl: null, active: true },
    scope: 'self',
    projects: [{ id: 'rig', code: 'RIG', name: 'Rig 3', color: '#8B1E1E', icon: null, imageUrl: null }],
    period: PERIOD,
    today: '2026-11-11',
    timeZone: 'Asia/Muscat',
    generatedAt: '2026-11-11T06:00:00.000Z',
    trend: { kind: 'month', points: POINTS },
    tiles: [tile({ metric: 'completed', label: 'Tasks completed', unit: 'tasks', value: 3, target: null, light: 'none', words: '' })],
    workload: { openTasks: 4, plannedHours: null, capacityHours: 90, meetingHours: 2 },
    ...over,
  });

  it('my own: asks for /kpis/people/me and says who can see it', async () => {
    answers = { '/kpis/people/me': () => json({ data: person() }) };
    renderAt('/performance', <PerformancePage />, '/performance');
    expect(await screen.findByRole('heading', { name: 'My performance' })).toBeInTheDocument();
    expect(await screen.findByText('Your own tasks in every project you’re on.')).toBeInTheDocument();
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('a manager’s view says it counts only their projects', async () => {
    answers = { '/kpis/people/ann': () => json({ data: person({ scope: 'manager' }) }) };
    renderAt('/performance/ann', <PerformancePage />, '/performance/:userId');
    expect(await screen.findByText('Their tasks in the projects you run only.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ann Lee' })).toBeInTheDocument();
  });

  it('a colleague is told plainly they can’t see it (the server refused), with the way to their own', async () => {
    answers = { '/kpis/people/ann': () => json({ error: { code: 'FORBIDDEN', message: 'Only the person…' } }, 403) };
    renderAt('/performance/ann', <PerformancePage />, '/performance/:userId');
    expect(await screen.findByText('You can’t see this person’s performance.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open my performance' })).toHaveAttribute('href', '/performance');
  });
});

describe('the monthly KPI values notice', () => {
  it('opens the project’s KPIs tab, with its own icon and name', async () => {
    const { notificationTarget } = await import('../../lib/notification-links');
    const { notificationKindLook } = await import('../notifications/NotificationKindIcon');
    expect(notificationTarget({ entityType: 'project-kpis', entityId: 'rig' })).toEqual({ kind: 'path', to: '/projects/rig?tab=kpis' });
    expect(notificationKindLook('KPI_VALUES_DUE')).toMatchObject({ id: 'kpi-values', name: 'KPI values to enter' });
  });
});
