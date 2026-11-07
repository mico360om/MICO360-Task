import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrioritiesWidget } from './PrioritiesWidget';
import { useAuthStore } from '../../stores/auth-store';
import type { PrioritiesAnswer, PriorityRow, PriorityTask } from '../../api/dashboard';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), io: { on: vi.fn() } }) }));

// 1.23.4 Smarter Dashboard — "My Priorities Today" on the page: the reasons and chips, the first ten, and
// each quick action (what it sends, the row leaving at once, the notice with Undo, a refusal).
const TODAY = '2026-11-06';
const task = (o: Partial<PriorityTask> = {}): PriorityTask => ({
  id: 't1',
  key: 'RIG-4',
  title: 'Pump check',
  priority: 'NORMAL',
  dueDate: '2026-11-04',
  startDate: null,
  startAt: null,
  version: 3,
  columnId: 'c-todo',
  project: { id: 'p1', code: 'RIG', name: 'Rig Inspection', color: null, icon: null, imageUrl: null },
  assignees: [{ id: 'me', name: 'Me Myself' }],
  blockers: [],
  doneColumnId: 'c-done',
  recurrenceRule: null,
  can: { complete: true, reschedule: true, assign: true, approve: false },
  ...o,
});
const taskRow = (o: Partial<PriorityRow> & { task?: PriorityTask } = {}): PriorityRow => ({ id: `task:${o.task?.id ?? 't1'}`, kind: 'task', reason: { code: 'overdue', days: 2 }, also: [], chips: ['overdue'], group: 1, task: task(), ...o });
const answer = (items: PriorityRow[], o: Partial<PrioritiesAnswer> = {}): PrioritiesAnswer => {
  const counts = { all: items.length, overdue: 0, today: 0, approvals: 0, blocked: 0, upcoming: 0, team: 0 };
  for (const r of items) for (const c of r.chips) counts[c] += 1;
  return { today: TODAY, timeZone: 'Asia/Muscat', manager: false, items, total: items.length, counts, watch: [], ...o };
};

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let current: PrioritiesAnswer = answer([]);
/** The list as it was before a Complete (an Undo brings it back). */
let before: PrioritiesAnswer = answer([]);
let refuse: RegExp | null = null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  refuse = null;
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x.y', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (refuse && refuse.test(`${method} ${url}`)) return json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } }, 403);
      if (url.includes('/dashboard/priorities')) return json({ data: current });
      // The server's list after a move: Done takes it off, back to its column puts it back.
      if (url.endsWith('/move')) current = JSON.parse(String(init!.body)).columnId === 'c-done' ? answer([]) : before;
      if (url.endsWith('/move')) return json({ data: { id: 't1', key: 'RIG-4', columnId: (init?.body && JSON.parse(String(init.body)).columnId) ?? 'x', approvalRequestedAt: null } });
      if (method === 'PUT' && /\/tasks\/t1$/.test(url)) return json({ data: { id: 't1', version: 4 } });
      if (url.endsWith('/projects/p1/members')) return json({ data: [{ id: 'me', firstName: 'Me', lastName: 'Myself', username: 'me', email: '', role: 'MEMBER' }, { id: 'omar', firstName: 'Omar', lastName: 'Ahmed', username: 'omar', email: '', role: 'MEMBER' }] });
      if (url.includes('/assignees')) return method === 'DELETE' ? new Response(null, { status: 204 }) : json({ data: [] });
      return json({ data: {} });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

function show(onOpenTask = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PrioritiesWidget onOpenTask={onOpenTask} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onOpenTask;
}
const row = (id: string) => document.querySelector(`[data-priority-row="${id}"]`) as HTMLElement;
const sent = (method: string, path: RegExp) => calls.filter((c) => c.method === method && path.test(c.url));

describe('the list', () => {
  it('each row says why (strongest first, then tags) and what it is; the chips count by reason', async () => {
    current = answer([
      taskRow({ reason: { code: 'blocking', count: 2 }, also: [{ code: 'due-today' }], chips: ['today'], group: 3 }),
      taskRow({ id: 'task:t2', task: task({ id: 't2', key: 'RIG-7', title: 'Valve', blockers: [{ id: 'b1', key: 'RIG-1' }] }), reason: { code: 'blocked-by', blockers: [{ id: 'b1', key: 'RIG-1' }] }, chips: ['blocked'], group: 8 }),
    ]);
    const open = show();
    expect(await screen.findByText('Pump check')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /My Priorities Today/ })).toHaveTextContent('2');
    expect(within(row('task:t1')).getByText('Blocks 2 tasks')).toBeInTheDocument();
    expect(within(row('task:t1')).getByText('Due today')).toBeInTheDocument();
    expect(within(row('task:t1')).getByText('Pump check')).toBeInTheDocument();
    expect(within(row('task:t1')).getByText('Rig Inspection')).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Show priorities by reason' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['All 2', 'Overdue 0', 'Today 1', 'Approvals 0', 'Blocked 1', 'Upcoming 0']);
    // Waiting on another task: no Complete — "Blocked by RIG-1", which opens that task.
    expect(within(row('task:t2')).queryByRole('button', { name: 'Complete RIG-7' })).toBeNull();
    await userEvent.click(within(row('task:t2')).getByRole('button', { name: /RIG-1/ }));
    expect(open).toHaveBeenCalledWith('b1', expect.any(Array));
    // A chip keeps its rows.
    await userEvent.click(within(chips).getByRole('button', { name: /Blocked/ }));
    expect(row('task:t1')).toBeNull();
    expect(row('task:t2')).not.toBeNull();
  });

  it('Team chip only for the people who run projects; a team row names whose it is', async () => {
    current = answer([taskRow({ reason: { code: 'team-overdue', days: 4 }, chips: ['overdue', 'team'], group: 6, task: task({ assignees: [{ id: 'o', name: 'Omar Ahmed' }] }) })], { manager: true });
    show();
    expect(await screen.findByText('Overdue 4 days · Omar Ahmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Team 1/ })).toBeInTheDocument();
  });

  it('the first ten, then Show all (n)', async () => {
    current = answer(Array.from({ length: 13 }, (_, i) => taskRow({ id: `task:t${i}`, task: task({ id: `t${i}`, key: `RIG-${i}`, title: `Task ${i}` }) })));
    show();
    await screen.findByText('Task 0');
    expect(document.querySelectorAll('[data-priority-row]')).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: 'Show all (13)' }));
    expect(document.querySelectorAll('[data-priority-row]')).toHaveLength(13);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('nothing: "Nothing urgent — you’re clear for today."; an outage says so instead (never "clear")', async () => {
    current = answer([]);
    show();
    expect(await screen.findByText('Nothing urgent — you’re clear for today.')).toBeInTheDocument();
  });

  it('a failed load is an error with Retry', async () => {
    refuse = /priorities/;
    show();
    expect(await screen.findByText(/Couldn’t load your priorities/)).toBeInTheDocument();
    expect(screen.queryByText(/clear for today/)).toBeNull();
  });
});

describe('quick actions', () => {
  it('Complete moves it to the Done column, the row leaves at once, the notice offers Undo — which moves it back', async () => {
    current = before = answer([taskRow()]);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4' }));
    await waitFor(() => expect(row('task:t1')).toBeNull());
    expect(sent('PATCH', /\/tasks\/t1\/move$/)[0]!.body).toEqual({ columnId: 'c-done' });
    expect(await screen.findByText('Completed RIG-4.')).toBeInTheDocument();
    // Read again from the server, skipping its 30-second copy.
    expect(calls.some((c) => c.url.includes('/dashboard/priorities?fresh=1'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('PATCH', /\/tasks\/t1\/move$/)).toHaveLength(2));
    expect(sent('PATCH', /\/tasks\/t1\/move$/)[1]!.body).toEqual({ columnId: 'c-todo' });
    expect(await screen.findByText('RIG-4 is open again.')).toBeInTheDocument();
  });

  it('a task that needs approval: the notice says it waits for a project manager', async () => {
    current = answer([taskRow()]);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = f.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (input: string, init?: RequestInit) =>
      String(input).endsWith('/move') ? json({ data: { id: 't1', key: 'RIG-4', columnId: 'c-review', approvalRequestedAt: '2026-11-06T08:00:00Z' } }) : base(input, init),
    );
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4' }));
    expect(await screen.findByText('RIG-4 needs approval, so it’s waiting for a project manager.')).toBeInTheDocument();
  });

  it('review I1: one that waits for approval in the column it was in — no Undo (moving it "back" would change nothing)', async () => {
    current = answer([taskRow({ task: task({ columnId: 'c-review' }) })]);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = f.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (input: string, init?: RequestInit) =>
      String(input).endsWith('/move') ? json({ data: { id: 't1', key: 'RIG-4', columnId: 'c-review', approvalRequestedAt: '2026-11-06T08:00:00Z' } }) : base(input, init),
    );
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4' }));
    expect(await screen.findByText('RIG-4 needs approval, so it’s waiting for a project manager.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('a refusal brings the row back and says why', async () => {
    current = answer([taskRow()]);
    refuse = /PATCH .*\/move$/;
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4' }));
    expect(await within(row('task:t1')).findByRole('alert')).toHaveTextContent('You do not have permission to do that.');
  });

  it('Reschedule: Today · Tomorrow · Next week · Pick a date; it sends the day from the copy it saw; Undo puts it back', async () => {
    current = answer([taskRow()]);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule RIG-4' }));
    const menu = screen.getByRole('dialog', { name: 'Reschedule RIG-4' });
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['TodayFri 6 Nov', 'TomorrowSat 7 Nov', 'Next weekSun 8 Nov', 'Pick a date…']);
    await userEvent.click(within(menu).getByRole('button', { name: /Tomorrow/ }));
    await waitFor(() => expect(sent('PUT', /\/tasks\/t1$/)).toHaveLength(1));
    expect(sent('PUT', /\/tasks\/t1$/)[0]!.body).toEqual({ dueDate: '2026-11-07', expectedVersion: 3 });
    expect(await screen.findByText('RIG-4 is now due Sat 7 Nov.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('PUT', /\/tasks\/t1$/)).toHaveLength(2));
    expect(sent('PUT', /\/tasks\/t1$/)[1]!.body).toEqual({ dueDate: '2026-11-04', expectedVersion: 4 });
  });

  it('Pick a date shows the month in the same menu; a day there reschedules', async () => {
    current = answer([taskRow()]);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule RIG-4' }));
    await userEvent.click(screen.getByRole('button', { name: /Pick a date/ }));
    const menu = screen.getByRole('dialog', { name: 'Reschedule RIG-4' });
    await userEvent.click(within(menu).getByRole('button', { name: /20 November|20 Nov/ }));
    await waitFor(() => expect(sent('PUT', /\/tasks\/t1$/)[0]?.body).toEqual({ dueDate: '2026-11-20', expectedVersion: 3 }));
  });

  it('Assign: the team, without the people already on it; Undo takes them off again', async () => {
    current = answer([taskRow({ reason: { code: 'unassigned' }, chips: ['team'], group: 7, task: task({ assignees: [{ id: 'me', name: 'Me Myself' }] }) })], { manager: true });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Assign RIG-4' }));
    const menu = screen.getByRole('dialog', { name: 'Assign RIG-4' });
    expect(await within(menu).findByRole('button', { name: 'Omar Ahmed' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Me Myself' })).toBeNull();
    await userEvent.click(within(menu).getByRole('button', { name: 'Omar Ahmed' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/t1\/assignees$/)).toHaveLength(1));
    expect(sent('POST', /\/tasks\/t1\/assignees$/)[0]!.body).toEqual({ userIds: ['omar'] });
    expect(await screen.findByText('Assigned RIG-4 to Omar Ahmed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('DELETE', /\/tasks\/t1\/assignees\/omar$/)).toHaveLength(1));
  });

  it('an approval: Approve (from the copy it saw) and Send back (asks why) — no Complete, Reschedule or Assign', async () => {
    current = answer([taskRow({ id: 'approval:t1', kind: 'approval', reason: { code: 'approval', since: null }, chips: ['approvals'], group: 2, task: task({ can: { complete: false, reschedule: false, assign: false, approve: true }, requestedBy: { id: 's', name: 'Sara Ali' } }) })]);
    show();
    expect(await screen.findByText('Waiting for your approval')).toBeInTheDocument();
    expect(screen.getByText(/Finished by/)).toHaveTextContent('Finished by Sara Ali');
    expect(screen.queryByRole('button', { name: 'Complete RIG-4' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reschedule RIG-4' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send RIG-4 back' }));
    expect(await screen.findByRole('dialog', { name: /Send RIG-4 back/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve RIG-4' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/t1\/approve$/)).toHaveLength(1));
    expect(sent('POST', /\/tasks\/t1\/approve$/)[0]!.body).toEqual({ expectedVersion: 3 });
    expect(await screen.findByText('Approved RIG-4.')).toBeInTheDocument();
  });

  it('an action item: Mark done (Undo opens it again), Reschedule, Open meeting', async () => {
    current = answer([
      {
        id: 'action-item:a1',
        kind: 'action-item',
        reason: { code: 'due-today' },
        also: [],
        chips: ['today'],
        group: 4,
        actionItem: { id: 'a1', description: 'Send the report', dueDate: TODAY, priority: 'NORMAL', status: 'OPEN', meeting: { id: 'm1', title: 'Weekly site meeting' }, projectId: 'p1', can: { done: true, reschedule: true } },
      },
    ]);
    show();
    expect(await screen.findByText('Send the report')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the meeting Weekly site meeting' })).toHaveAttribute('href', '/meetings/m1');
    await userEvent.click(screen.getByRole('button', { name: 'Mark “Send the report” done' }));
    await waitFor(() => expect(sent('PATCH', /\/action-items\/a1$/)).toHaveLength(1));
    expect(sent('PATCH', /\/action-items\/a1$/)[0]!.body).toEqual({ status: 'COMPLETED' });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('PATCH', /\/action-items\/a1$/)).toHaveLength(2));
    expect(sent('PATCH', /\/action-items\/a1$/)[1]!.body).toEqual({ status: 'OPEN' });
  });

  it('a checklist item (1.23.3): Tick (Undo unticks), Reschedule, Open the task', async () => {
    current = answer([
      { id: 'checklist-item:c1', kind: 'checklist-item', reason: { code: 'overdue', days: 1 }, also: [], chips: ['overdue'], group: 1, checklistItem: { id: 'c1', text: 'Torque the bolts', dueDate: '2026-11-05', listTitle: 'Commissioning', task: { id: 't9', key: 'RIG-9', title: 'Flange', projectId: 'p1' }, can: { tick: true, reschedule: true } } },
    ]);
    const open = show();
    expect(await screen.findByText('Torque the bolts')).toBeInTheDocument();
    expect(screen.getByText(/Checklist item/)).toHaveTextContent('Checklist item · Commissioning · Flange');
    await userEvent.click(screen.getByRole('button', { name: 'Tick “Torque the bolts”' }));
    await waitFor(() => expect(sent('PUT', /\/checklist\/c1$/)).toHaveLength(1));
    expect(sent('PUT', /\/checklist\/c1$/)[0]!.body).toEqual({ done: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('PUT', /\/checklist\/c1$/)).toHaveLength(2));
    expect(sent('PUT', /\/checklist\/c1$/)[1]!.body).toEqual({ done: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Reschedule “Torque the bolts”' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Reschedule “Torque the bolts”' })).getByRole('button', { name: /Tomorrow/ }));
    await waitFor(() => expect(sent('PUT', /\/checklist\/c1$/)).toHaveLength(3));
    expect(sent('PUT', /\/checklist\/c1$/)[2]!.body).toEqual({ dueDate: '2026-11-07' });
    // Open goes to the task panel at that item (1.23.3: ?item=).
    await userEvent.click(screen.getByRole('button', { name: 'Open RIG-9 at “Torque the bolts”' }));
    expect(open).toHaveBeenLastCalledWith('t9', ['t9'], { item: 'c1' });
    await userEvent.click(screen.getByRole('button', { name: /^Open RIG-9$/ }));
    expect(open).toHaveBeenLastCalledWith('t9', ['t9'], { item: 'c1' });
  });

  it('a checklist item the person may not tick or move offers only Open', async () => {
    current = answer([
      { id: 'checklist-item:c2', kind: 'checklist-item', reason: { code: 'due-today' }, also: [], chips: ['today'], group: 4, checklistItem: { id: 'c2', text: 'Parent step', dueDate: TODAY, listTitle: 'Steps', task: { id: 't9', key: 'RIG-9', title: 'Flange', projectId: 'p1' }, can: { tick: false, reschedule: false } } },
    ]);
    show();
    expect(await screen.findByText('Parent step')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tick / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reschedule / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open RIG-9' })).toBeInTheDocument();
  });
});
