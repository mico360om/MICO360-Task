import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HealthCard, NextActionsCard, OwnersCard, RecentActivityCard, RisksCard } from './HealthCards';
import { useAuthStore } from '../../stores/auth-store';
import type { ProjectHealthDetail, ProjectRisk } from '../../api/project-health';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), io: { on: vi.fn() } }) }));

// 1.23.5 — the project page's Overview: health with every reason, risks with who is accountable (five, then
// "Show all"), the accountable owners, Next actions (the 1.23.4 rows, seven first) and Recent activity.
const person = (id: string, name: string) => ({ id, name, avatarUrl: null });
const risk = (i: number, o: Partial<ProjectRisk> = {}): ProjectRisk => ({
  code: 'BLOCKED',
  level: 'AMBER',
  title: `Risk ${i}`,
  detail: `Why ${i}`,
  accountable: [person('sara', 'Sara Khan')],
  tasks: [{ id: `t${i}`, key: `RIG-${i}`, title: `Task ${i}` }],
  ...o,
});
let detail: ProjectHealthDetail;
let calls: string[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const actionRow = (i: number) => ({
  id: `task:t${i}`,
  kind: 'task',
  reason: { code: 'overdue', days: i },
  also: [],
  chips: [],
  group: 1,
  task: { id: `t${i}`, key: `RIG-${i}`, title: `Late ${i}`, priority: 'NORMAL', dueDate: '2026-11-01', startDate: null, startAt: null, version: 1, columnId: 'c', project: { id: 'p1', code: 'RIG', name: 'Rig', color: null, icon: null, imageUrl: null }, assignees: [], blockers: [], doneColumnId: 'd', recurrenceRule: null, can: { complete: false, reschedule: false, assign: false, approve: false } },
});

beforeEach(() => {
  calls = [];
  detail = {
    projectId: 'p1',
    rag: 'RED',
    reasons: [
      { code: 'MILESTONE_LATE', level: 'RED', text: 'Milestone “Handover” is 3 days late' },
      { code: 'WORKLOAD', level: 'AMBER', text: 'Omar Ahmed holds 9 of 15 open tasks (60%)' },
    ],
    completion: { mode: 'WEIGHT', pct: 62, countPct: 70, weightPct: 62, total: 10, done: 7, weightTotal: 40, weightDone: 25 },
    timeUsedPct: 85,
    risks: [risk(1, { code: 'MILESTONE_LATE', level: 'RED', title: 'Milestone “Handover” is 3 days late', accountable: [person('omar', 'Omar Ahmed')] }), ...[2, 3, 4, 5, 6].map((i) => risk(i))],
    owners: {
      owner: person('olivia', 'Olivia Owner'),
      managers: [person('bilal', 'Bilal Boss')],
      milestones: [{ id: 'm1', key: 'RIG-9', title: 'Handover', due: '2026-11-17', owners: [person('omar', 'Omar Ahmed')] }],
    },
    generatedAt: '2026-11-20T06:00:00.000Z',
  };
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x.y', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/projects/p1/health')) return json({ data: detail });
      if (url.includes('/projects/p1/next-actions')) {
        const items = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(actionRow);
        return json({ data: { today: '2026-11-20', timeZone: 'Asia/Muscat', manager: false, items, total: 9, counts: { all: 9, overdue: 9, today: 0, approvals: 0, blocked: 0, upcoming: 0, team: 0 }, watch: ['p1'] } });
      }
      if (url.endsWith('/projects/p1/activity'))
        return json({ data: [{ id: 'a1', taskId: 't1', projectId: 'p1', action: 'MOVED', meta: { from: 'To Do', to: 'Done' }, createdAt: '2026-11-20T05:00:00.000Z', actor: { id: 'sara', name: 'Sara Khan' }, task: { id: 't1', key: 'RIG-1', title: 'Pour slab' }, project: { id: 'p1', name: 'Rig' } }] });
      return json({ data: {} });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function show(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Health', () => {
  it('the mark with every reason, worst first, and completion by weight with the count beside it', async () => {
    show(<HealthCard projectId="p1" completion={{ mode: 'WEIGHT', pct: 62, countPct: 70, weightPct: 62 }} />);
    const card = await screen.findByRole('region', { name: 'Health' });
    expect(await within(card).findByRole('button', { name: /^Health: Red — Milestone “Handover” is 3 days late; Omar Ahmed holds/ })).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Why' }).textContent).toBe('Milestone “Handover” is 3 days lateOmar Ahmed holds 9 of 15 open tasks (60%)');
    expect(within(card).getByTestId('health-completion')).toHaveTextContent('62% by weight · 70% by count');
    expect(within(card).getByText('85% of the planned time used')).toBeInTheDocument();
  });

  it('a failed load says so (never a mark that isn’t true)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'SERVER', message: 'Down' } }, 500)));
    show(<HealthCard projectId="p1" completion={null} />);
    expect(await screen.findByText(/Couldn’t load the project’s health/)).toBeInTheDocument();
    expect(document.querySelector('[data-health-badge]')).toBeNull();
  });
});

describe('Risks', () => {
  it('each with its explanation, its tasks and who is accountable; five, then “Show all”', async () => {
    const opened: string[] = [];
    show(<RisksCard projectId="p1" onOpenTask={(id) => opened.push(id)} />);
    const card = await screen.findByRole('region', { name: 'Risks · 6' });
    const items = await within(card).findAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Serious risk: Milestone “Handover” is 3 days late');
    expect(items[0]).toHaveTextContent(/Accountable.*Omar Ahmed/);
    expect(items[1]).toHaveTextContent('Risk: Risk 2Why 2');
    // Each task's button names the task (review, re-graded): "Open RIG-2: Task 2".
    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Open RIG-2: Task 2' }));
    expect(opened).toEqual(['t2']);
    await userEvent.click(within(card).getByRole('button', { name: 'Show all (6)' }));
    expect(within(card).getAllByRole('listitem')).toHaveLength(6);
  });

  it('none: says nothing is late, held up or overloaded', async () => {
    detail = { ...detail, risks: [] };
    show(<RisksCard projectId="p1" onOpenTask={() => {}} />);
    expect(await screen.findByText('No risks spotted — nothing late, held up or overloaded.')).toBeInTheDocument();
  });
});

describe('Accountable owners', () => {
  it('the owner, the managers, and each open milestone’s owners', async () => {
    show(<OwnersCard projectId="p1" onOpenTask={() => {}} />);
    const card = await screen.findByRole('region', { name: 'Accountable owners' });
    await within(card).findByText('Olivia Owner');
    expect(card).toHaveTextContent(/Project owner.*Olivia Owner.*Manager.*Bilal Boss/);
    expect(card).toHaveTextContent('Open milestones');
    expect(within(card).getByRole('button', { name: /RIG-9.*Handover/ })).toBeInTheDocument();
  });
});

describe('Next actions and Recent activity', () => {
  it('Next actions: the 1.23.4 rows, seven first, then “Show all”; no chips; nothing listened to on its own', async () => {
    show(<NextActionsCard projectId="p1" onOpenTask={() => {}} />);
    const card = await screen.findByRole('region', { name: /Next actions/ });
    expect(await within(card).findAllByRole('listitem')).toHaveLength(7);
    expect(within(card).queryByRole('group', { name: 'Show priorities by reason' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Show all (9)' })).toBeInTheDocument();
    expect(calls.some((u) => u.includes('/projects/p1/next-actions'))).toBe(true);
  });

  it('Recent activity: the project’s lines as the Activity page words them', async () => {
    show(<RecentActivityCard projectId="p1" onOpenTask={() => {}} />);
    const card = await screen.findByRole('region', { name: 'Recent activity' });
    expect(await within(card).findByText('Pour slab')).toBeInTheDocument();
    expect(card).toHaveTextContent('Sara Khan moved RIG-1');
    expect(card).toHaveTextContent('To Do → Done');
  });
});
