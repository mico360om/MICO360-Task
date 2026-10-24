import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelinePage } from './TimelinePage';
import { useAuthStore } from '../stores/auth-store';
import { invalidateTaskQueries } from '../lib/task-cache';
import type { TimelineData, TimelineProject, TimelineTasksData } from '../api/planning';

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
const SARA = { id: 'u1', name: 'Sara Ahmed', avatarUrl: null };
const OMAR = { id: 'u2', name: 'Omar Said', avatarUrl: null };
const WEEKS = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27'];
const weeks = (...n: number[]) => [...n, ...Array.from({ length: 13 - n.length }, () => 0)];

function tp(id: string, extra: Partial<TimelineProject>): TimelineProject {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    color: '#2F6FAE',
    icon: null,
    imageUrl: null,
    status: 'ACTIVE',
    owner: null,
    start: '2026-10-01',
    startFrom: 'project',
    startIsCreated: false,
    target: '2026-12-10',
    targetFrom: 'project',
    tasks: { total: 10, done: 5, open: 5, overdue: 0 },
    progress: 50,
    timeUsed: 30,
    health: 'on-track',
    daysLate: 0,
    dueByWeek: weeks(),
    milestones: [],
    nextMilestone: null,
    milestoneCount: 0,
    milestonesSoon: 0,
    meetings: [],
    meetingsThisWeek: 0,
    ...extra,
  };
}

const handover = { id: 'm-h', key: 'FCRM-9', title: 'Handover', date: '2026-10-20', done: false };
const kickoff = { id: 'm-k', key: 'MOB-1', title: 'Kick-off', date: '2026-10-06', done: true };
const beta = { id: 'm-b', key: 'MOB-2', title: 'Beta build', date: '2026-11-06', done: false };
const pilot = { id: 'm-p', key: 'RIG-7', title: 'Pilot on rig 3', date: '2026-11-12', done: false };

const PROJECTS: TimelineProject[] = [
  tp('rig', { name: 'Rig Inspection Portal', owner: SARA, start: '2026-10-05', target: '2026-12-20', progress: 62, timeUsed: 26, milestones: [pilot], nextMilestone: pilot, milestoneCount: 1, milestonesSoon: 1, dueByWeek: weeks(3, 0, 5, 2, 0, 1), meetings: [
    { id: 'mt2', title: 'Site walk', startAt: '2026-10-22T05:00:00.000Z', day: '2026-10-22' },
    { id: 'mt3', title: 'Vendor call', startAt: '2026-10-22T09:00:00.000Z', day: '2026-10-22' },
  ], meetingsThisWeek: 2 }),
  tp('mssp', { name: 'MICO360 Services', start: '2026-09-15', startIsCreated: true, target: null, timeUsed: null, health: 'no-target', progress: 20, dueByWeek: weeks(0, 0, 2) }),
  tp('mob', { name: 'Mobile App (Phase 2)', owner: SARA, start: '2026-10-01', target: '2026-12-10', progress: 9, timeUsed: 45, health: 'at-risk', tasks: { total: 11, done: 1, open: 10, overdue: 3 }, milestones: [kickoff, beta], nextMilestone: beta, milestoneCount: 2, milestonesSoon: 1, dueByWeek: weeks(1, 2, 4, 6), meetings: [
    { id: 'mt1', title: 'Design review', startAt: '2026-10-27T06:00:00.000Z', day: '2026-10-27' },
  ] }),
  tp('fcrm', { name: 'Falcon CRM', owner: OMAR, start: '2026-09-01', target: '2026-10-21', progress: 85, timeUsed: 100, health: 'late', daysLate: 3, tasks: { total: 20, done: 17, open: 3, overdue: 1 }, milestones: [handover], nextMilestone: handover, milestoneCount: 1, dueByWeek: weeks(2, 1, 3) }),
];

let requests: string[] = [];
let projects: TimelineProject[] = PROJECTS;
let fail = false;
let ownZone: string | null = null;
/** While set, a later quarter's task rows wait for it. */
let holdLater: Promise<void> | null = null;
const MOB_TASKS: TimelineTasksData = {
  projectId: 'mob',
  from: '2026-10-04',
  to: '2027-01-02',
  today: '2026-10-24',
  matched: 33,
  open: 12,
  undated: 3,
  tasks: [
    { id: 'k1', key: 'MOB-11', title: 'Login screen', start: '2026-10-12', due: '2026-10-20', done: false, overdue: true, priority: 'HIGH', isMilestone: false, assignees: [{ id: 'u1', name: 'Sara Ahmed' }] },
    { id: 'k2', key: 'MOB-12', title: 'Push alerts', start: null, due: '2026-10-22', done: true, overdue: false, priority: 'NORMAL', isMilestone: false, assignees: [] },
    { id: 'k3', key: 'MOB-13', title: 'Beta build', start: null, due: '2026-11-06', done: false, overdue: false, priority: 'NORMAL', isMilestone: true, assignees: [{ id: 'u2', name: 'Omar Said' }, { id: 'u1', name: 'Sara Ahmed' }] },
  ],
};

function answer(url: string): TimelineData {
  const q = new URL(url, 'http://test.local').searchParams;
  const from = q.get('from')!;
  const to = q.get('to')!;
  // The weeks asked for (the fixtures' figures are per week from 4 October).
  const weeks = WEEKS.filter((w) => w >= from && w <= to);
  return { from, to, weekStart: 0, today: '2026-10-24', currentWeek: '2026-10-18', weeks: weeks.length ? weeks : WEEKS, projects };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T08:00:00.000Z')); // Saturday 24 October, noon in Muscat
  requests = [];
  projects = PROJECTS;
  fail = false;
  ownZone = null;
  holdLater = null;
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (url.endsWith('/users/me/preferences')) return json({ data: { timeZone: ownZone, weekStart: null } });
      if (url.includes('/timeline?')) return fail ? json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } }, 500) : json({ data: answer(url) });
      const taskRows = /\/timeline\/projects\/([^/]+)\/tasks\?/.exec(url);
      if (taskRows) {
        // A later quarter: one task due in January.
        if (url.includes('from=2027-01-03')) {
          if (holdLater) await holdLater;
          return json({ data: { ...MOB_TASKS, from: '2027-01-03', to: '2027-04-03', matched: 1, tasks: [{ ...MOB_TASKS.tasks[2]!, id: 'k9', key: 'MOB-19', title: 'Store release', due: '2027-01-20', assignees: [] }] } });
        }
        return json({ data: taskRows[1] === 'mob' ? MOB_TASKS : { ...MOB_TASKS, projectId: taskRows[1], matched: 0, open: 0, undated: 0, tasks: [] } });
      }
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

function renderPage(path = '/timeline', qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TimelinePage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rows = () => within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('listitem');
const rowNames = () => rows().map((r) => within(r).getByRole('link').textContent);
const timelineRequests = () => requests.filter((u) => u.includes('/timeline?'));

describe('TimelinePage', () => {
  it('asks for the quarter around this week (weeks starting Sunday) and lists the projects needing attention first', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    expect(timelineRequests().at(-1)).toContain('/timeline?from=2026-10-04&to=2027-01-02&weekStart=0');
    expect(rowNames()).toEqual(['Falcon CRM', 'Mobile App (Phase 2)', 'Rig Inspection Portal', 'MICO360 Services']);
    expect(screen.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 1, name: 'Timeline' })).toBeInTheDocument();
  });

  it('sums each project up: progress, next milestone and a status written in words', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const [falcon, mobile, rig, mssp] = rows();
    expect(falcon).toHaveTextContent('85% · next ◆ Handover · overdue');
    expect(within(falcon!).getByText('Late')).toBeInTheDocument();
    expect(mobile).toHaveTextContent('9% · next ◆ Beta build · 6 Nov');
    expect(within(mobile!).getByText('At risk')).toBeInTheDocument();
    expect(within(rig!).getByText('On track')).toBeInTheDocument();
    expect(mssp).toHaveTextContent('20% · no milestones');
    expect(within(mssp!).getByText('No target')).toBeInTheDocument();
    // On the bars: how far behind an at-risk project is, and how late a late one is.
    expect(within(mobile!).getByText('9% done · 45% of the time used')).toBeInTheDocument();
    expect(within(falcon!).getByText('Target 21 Oct · 3 days late')).toBeInTheDocument();
  });

  it('shows the five cards: open projects, late, at risk, milestones in 30 days and meetings this week', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const cards = within(screen.getByRole('region', { name: 'Summary' }));
    expect(cards.getByText('Open projects').parentElement).toHaveTextContent('4');
    expect(cards.getByRole('button', { name: /1 late · target passed/i })).toHaveAttribute('aria-pressed', 'false');
    expect(cards.getByRole('button', { name: /1 at risk/i })).toHaveAttribute('aria-pressed', 'false');
    expect(cards.getByText('Milestones in 30 days').parentElement).toHaveTextContent('2');
    expect(cards.getByText('Meetings this week').parentElement).toHaveTextContent('2');
    expect(screen.getByRole('status')).toHaveTextContent('4 open projects · 1 late · 1 at risk');
  });

  it('narrows the rows to the late projects with the Late card, and back with a second click', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const late = screen.getByRole('button', { name: /late · target passed/i });
    await userEvent.click(late);
    expect(late).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['Falcon CRM']);
    expect(screen.getByRole('status')).toHaveTextContent('Showing the 1 late project');
    expect(screen.getByTestId('where')).toHaveTextContent('show=late');
    await userEvent.click(screen.getByRole('button', { name: /1 at risk/i }));
    expect(rowNames()).toEqual(['Mobile App (Phase 2)']);
    await userEvent.click(screen.getByRole('button', { name: /1 at risk/i }));
    expect(rowNames()).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('4 open projects');
  });

  it('counts each week’s open tasks due across the shown projects, with steps that fit the busiest week', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const busy = within(screen.getByRole('list', { name: 'Open tasks due each week' })).getAllByRole('listitem');
    expect(busy).toHaveLength(13);
    expect(busy.slice(0, 4).map((c) => c.textContent)).toEqual(['Week of 4 Oct: 6 tasks', 'Week of 11 Oct: 3 tasks', 'Week of 18 Oct: 14 tasks', 'Week of 25 Oct: 8 tasks']);
    expect(busy[4]).toHaveTextContent('Week of 1 Nov: 0');
    const legend = within(screen.getByRole('list', { name: 'Legend' }));
    for (const step of ['1–4', '5–8', '9–12', '13+']) expect(legend.getByText(step)).toBeInTheDocument();
  });

  it('filters by owner: the rows, the cards and the busy weeks follow', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Owner' }), 'Sara Ahmed');
    expect(rowNames()).toEqual(['Mobile App (Phase 2)', 'Rig Inspection Portal']);
    expect(screen.getByRole('status')).toHaveTextContent('2 open projects · 0 late · 1 at risk');
    const busy = within(screen.getByRole('list', { name: 'Open tasks due each week' })).getAllByRole('listitem');
    expect(busy[0]).toHaveTextContent('Week of 4 Oct: 4 tasks');
    expect(screen.getByTestId('where')).toHaveTextContent('owner=u1');
  });

  it('sorts by name or by target date', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'Name');
    expect(rowNames()).toEqual(['Falcon CRM', 'MICO360 Services', 'Mobile App (Phase 2)', 'Rig Inspection Portal']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'Target date');
    expect(rowNames()).toEqual(['Falcon CRM', 'Mobile App (Phase 2)', 'Rig Inspection Portal', 'MICO360 Services']);
  });

  it('opens a project’s details from its bar, by keyboard too, and closes them with Escape', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const bar = screen.getByRole('button', { name: /^Mobile App \(Phase 2\): at risk, 9% done/ });
    bar.focus();
    await userEvent.keyboard('{Enter}');
    const details = await screen.findByRole('dialog', { name: 'Mobile App (Phase 2)' });
    expect(details).toHaveTextContent('Dates1 Oct → 10 Dec 2026');
    expect(details).toHaveTextContent('Done1 of 11 tasks (9%) · 45% of the time used');
    expect(details).toHaveTextContent('Overdue3 tasks');
    expect(details).toHaveTextContent('Next◆ Beta build, 6 Nov');
    expect(within(details).getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '/projects/mob');
    expect(within(details).getByRole('link', { name: 'Open board' })).toHaveAttribute('href', '/board?project=mob');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bar).toHaveFocus();
  });

  it('opens a milestone’s details from its marker, marking those reached', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    expect(screen.getByRole('button', { name: 'Milestone Kick-off, 6 Oct, reached' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Milestone Beta build, 6 Nov, not reached yet' }));
    const details = await screen.findByRole('dialog', { name: 'Beta build' });
    expect(details).toHaveTextContent('ProjectMobile App (Phase 2)');
    expect(details).toHaveTextContent('Due6 Nov 2026 · not reached yet');
    expect(within(details).getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '/projects/mob');
  });

  it('opens a day’s project meetings from their marker', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: '2 meetings, Thu 22 Oct' }));
    const details = await screen.findByRole('dialog', { name: 'Meetings · Thu 22 Oct' });
    expect(details).toHaveTextContent('Site walk');
    expect(details).toHaveTextContent('09:00');
    expect(within(details).getAllByRole('link', { name: /Open meeting/ }).map((a) => a.getAttribute('href'))).toEqual(['/meetings/mt2', '/meetings/mt3']);
    await userEvent.click(screen.getByRole('button', { name: 'Meeting Design review, Tue 27 Oct' }));
    expect(await screen.findByRole('dialog', { name: 'Meetings · Tue 27 Oct' })).toHaveTextContent('Design review');
  });

  it('gives one meeting marker per week in a quarter, and one per day in a month', async () => {
    const rig = PROJECTS.find((p) => p.id === 'rig')!;
    projects = PROJECTS.map((p) =>
      p.id === 'rig' ? { ...rig, meetings: [{ id: 'mt0', title: 'Kick-off', startAt: '2026-10-20T06:00:00.000Z', day: '2026-10-20' }, ...rig.meetings] } : p,
    );
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: '3 meetings, 20–22 Oct' }));
    expect(await screen.findByRole('dialog', { name: 'Meetings · 20–22 Oct' })).toHaveTextContent('Kick-off');
    await userEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(await screen.findByRole('button', { name: 'Meeting Kick-off, Tue 20 Oct' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 meetings, Thu 22 Oct' })).toBeInTheDocument();
  });

  it('says how late a late project is in its details', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: /^Falcon CRM: late/ }));
    const details = await screen.findByRole('dialog', { name: 'Falcon CRM' });
    expect(details).toHaveTextContent('Target21 Oct · 3 days late');
    expect(details).toHaveTextContent('Done17 of 20 tasks (85%)Overdue1 task');
  });

  it('keeps the details right after their bar, and closes them on a second click or when Tab leaves them', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const bar = screen.getByRole('button', { name: /^Mobile App \(Phase 2\): at risk/ });
    await userEvent.click(bar);
    const details = screen.getByRole('dialog', { name: 'Mobile App (Phase 2)' });
    expect(bar.nextElementSibling).toBe(details);
    expect(bar).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(bar);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(bar);
    within(screen.getByRole('dialog')).getByRole('link', { name: 'Open board' }).focus();
    await userEvent.tab();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives milestones due the same day one marker, and lists them all in its details', async () => {
    const docs = { id: 'm-d', key: 'MOB-3', title: 'Beta docs', date: '2026-11-06', done: true };
    projects = PROJECTS.map((p) => (p.id === 'mob' ? { ...p, milestones: [...p.milestones, docs], milestoneCount: 3 } : p));
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    expect(screen.queryByRole('button', { name: /^Milestone Beta build/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '2 milestones, 6 Nov, 1 reached' }));
    const details = await screen.findByRole('dialog', { name: 'Milestones · 6 Nov' });
    expect(within(details).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['◆ Beta buildMOB-2 · not reached yet', '◆ Beta docsMOB-3 · reached']);
  });

  it('shows meeting times in the company’s time, the zone the days are placed in — also for someone set to another zone', async () => {
    ownZone = 'Europe/London';
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: '2 meetings, Thu 22 Oct' }));
    const details = await screen.findByRole('dialog', { name: 'Meetings · Thu 22 Oct' });
    // 05:00 UTC is 09:00 in Muscat (06:00 in London).
    expect(details).toHaveTextContent('09:00Site walk');
    expect(details).toHaveTextContent('13:00Vendor call');
  });

  it('reads the projects again whenever the page is opened, so changes made elsewhere show', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderPage('/timeline', qc);
    await screen.findByRole('list', { name: 'Projects' });
    first.unmount();
    const before = timelineRequests().length;
    renderPage('/timeline', qc);
    await waitFor(() => expect(timelineRequests().length).toBe(before + 1));
  });

  it('marks a bar whose dates come from its tasks, and says so in its details', async () => {
    projects = PROJECTS.map((p) => (p.id === 'mssp' ? { ...p, start: '2026-10-01', startFrom: 'tasks' as const, startIsCreated: false, target: '2026-12-12', targetFrom: 'tasks' as const, health: 'on-track' as const, timeUsed: 32 } : p));
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const bar = screen.getByRole('button', { name: /^MICO360 Services: .*dates from its tasks/ });
    expect(bar).toHaveTextContent('20% · dates from tasks');
    await userEvent.click(bar);
    expect(screen.getByRole('dialog', { name: 'MICO360 Services' })).toHaveTextContent('Dates1 Oct → 12 Dec 2026 (from its tasks)');
  });

  it('words a late project whose end comes from its tasks by its last task’s due day', async () => {
    projects = PROJECTS.map((p) => (p.id === 'fcrm' ? { ...p, targetFrom: 'tasks' as const } : p));
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    const falcon = rows()[0]!;
    expect(falcon).toHaveTextContent('Last task was due 21 Oct · 3 days ago');
    await userEvent.click(screen.getByRole('button', { name: /^Falcon CRM: late, .*dates from its tasks/ }));
    const details = screen.getByRole('dialog', { name: 'Falcon CRM' });
    expect(details).toHaveTextContent('Dates1 Sep → 21 Oct 2026 (end from its tasks)');
    expect(details).toHaveTextContent('Last taskdue 21 Oct · 3 days ago');
    expect(details).not.toHaveTextContent('Target');
  });

  it('opens a project’s tasks under it on request: overdue in red with ⚠, done grey with ✓, who has each, and the rest on its page', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    expect(requests.some((u) => u.includes('/tasks?'))).toBe(false);
    // One name, open or not: aria-expanded says which.
    const expand = screen.getByRole('button', { name: 'Tasks of Mobile App (Phase 2)' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(expand);
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(expand).toHaveAccessibleName('Tasks of Mobile App (Phase 2)');
    const tasks = await screen.findByRole('list', { name: 'Tasks of Mobile App (Phase 2)' });
    expect(requests.find((u) => u.includes('/timeline/projects/mob/tasks?'))).toContain('from=2026-10-04&to=2027-01-02');
    const items = within(tasks).getAllByRole('listitem');
    // Who has each is in the row's name (the initials show it on sight).
    const login = within(items[0]!).getByRole('button', { name: 'MOB-11 Login screen, 12 → 20 Oct, overdue, assigned to Sara Ahmed' });
    expect(login).toHaveTextContent('⚠');
    expect(items[0]).toHaveTextContent('SA');
    expect(items[0]!.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'overdue');
    expect(items[0]!.querySelector('[data-tone]')).toHaveClass('bg-danger');
    expect(within(items[1]!).getByRole('button', { name: 'MOB-12 Push alerts, due 22 Oct, done' })).toHaveTextContent('✓');
    expect(items[1]!.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'done');
    expect(items[1]!.querySelector('[data-tone]')).toHaveClass('bg-ink-3/60');
    expect(items[2]!.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'open');
    expect(items[2]).toHaveTextContent('OSSA');
    expect(within(items[2]!).getByRole('button', { name: 'MOB-13 Beta build, due 6 Nov, assigned to Omar Said and Sara Ahmed' })).toBeInTheDocument();
    // Rows were cut: how many show, and the project's open tasks on its own page.
    expect(tasks).toHaveTextContent('3 of 33 shown');
    expect(within(tasks).getByRole('link', { name: 'Show all 12 open tasks' })).toHaveAttribute('href', '/projects/mob?tab=tasks');
    expect(tasks).toHaveTextContent('3 open tasks have no due date');
    await userEvent.click(login);
    expect(screen.getByRole('dialog', { name: 'Task details panel' })).toHaveTextContent('open k1');
  });

  it('opens and closes every project’s tasks at once', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('button', { name: /^Tasks of/, expanded: true })).toHaveLength(4);
    const falcon = await screen.findByRole('list', { name: 'Tasks of Falcon CRM' });
    await waitFor(() => expect(falcon).toHaveTextContent('No tasks in these weeks.'));
    // Nothing was cut there: no count, no link.
    expect(falcon).not.toHaveTextContent(' shown');
    expect(within(falcon).queryByRole('link')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByRole('list', { name: /^Tasks of/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Tasks of/, expanded: false })).toHaveLength(4);
  });

  it('reads an open lane again when a task changes', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    renderPage('/timeline', qc);
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: 'Tasks of Mobile App (Phase 2)' }));
    await screen.findByRole('button', { name: /^MOB-11 Login screen/ });
    const lanes = () => requests.filter((u) => u.includes('/timeline/projects/mob/tasks?')).length;
    expect(lanes()).toBe(1);
    // What the task panel and every other task change do.
    await act(() => invalidateTaskQueries(qc));
    await waitFor(() => expect(lanes()).toBe(2));
  });

  it('shows Loading, not the last weeks’ rows, while a new quarter’s tasks load', async () => {
    let release!: () => void;
    holdLater = new Promise<void>((r) => (release = r));
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: 'Tasks of Mobile App (Phase 2)' }));
    await screen.findByRole('button', { name: /^MOB-11 Login screen/ });
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    const lane = await screen.findByRole('list', { name: 'Tasks of Mobile App (Phase 2)' });
    await waitFor(() => expect(lane).toHaveTextContent('Loading tasks…'));
    expect(screen.queryByRole('button', { name: /^MOB-11 Login screen/ })).not.toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByRole('button', { name: /^MOB-19 Store release/ })).toBeInTheDocument();
  });

  it('pages a quarter at a time, and Today comes back; Month asks for six weeks', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(timelineRequests().at(-1)).toContain('from=2027-01-03&to=2027-04-03'));
    expect(screen.getByTestId('where')).toHaveTextContent('at=2027-01-17');
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('at='));
    await userEvent.click(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() => expect(timelineRequests().at(-1)).toContain('from=2026-10-11&to=2026-11-21'));
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so when there are no open projects, and when a card leaves none', async () => {
    projects = [];
    renderPage();
    expect(await screen.findByText('No open projects')).toBeInTheDocument();
    expect(screen.getByText(/not completed or archived/i)).toBeInTheDocument();
  });

  it('shows a load error with Retry', async () => {
    fail = true;
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the timeline.');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Projects' })).toBeInTheDocument();
  });

  it('on a phone, lists the projects simply instead of the chart', async () => {
    const mm = vi.fn((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
    vi.stubGlobal('matchMedia', mm);
    Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
    renderPage();
    await screen.findByRole('list', { name: 'Projects' });
    expect(screen.queryByRole('list', { name: 'Open tasks due each week' })).not.toBeInTheDocument();
    const [falcon, mobile, , mssp] = rows();
    expect(within(falcon!).getByText('Late')).toBeInTheDocument();
    expect(falcon).toHaveTextContent('Target 21 Oct · 3 days late');
    expect(within(mobile!).getByRole('progressbar', { name: 'Mobile App (Phase 2): 9% done' })).toHaveAttribute('aria-valuenow', '9');
    expect(mobile).toHaveTextContent('Next ◆ Beta build · 6 Nov');
    expect(mobile).toHaveTextContent('Target 10 Dec');
    expect(mssp).toHaveTextContent('No target date');
    expect(within(mobile!).getByRole('link')).toHaveAttribute('href', '/projects/mob');
    // Its tasks, with their due days, on request.
    await userEvent.click(within(mobile!).getByRole('button', { name: 'Tasks of Mobile App (Phase 2)', expanded: false }));
    const tasks = await screen.findByRole('list', { name: 'Tasks of Mobile App (Phase 2)' });
    expect(within(tasks).getAllByRole('listitem')[0]).toHaveTextContent('MOB-11Login screendue 20 Oct · overdue');
    expect(within(tasks).getAllByRole('listitem')[1]).toHaveTextContent('due 22 Oct · ✓ done');
    await act(async () => {});
  });
});
