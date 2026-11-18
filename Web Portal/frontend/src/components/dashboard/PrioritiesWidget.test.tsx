import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrioritiesWidget } from './PrioritiesWidget';
import { useAuthStore } from '../../stores/auth-store';
import type { PrioritiesAnswer, PriorityRow, PriorityTask } from '../../api/dashboard';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), io: { on: vi.fn() } }) }));

// 1.23.4 Smarter Dashboard — "My Priorities Today" on the page; 1.23.41 (owner, 18 Nov 2026): a compact grouped
// list — Today · Overdue · Approvals · Blocked · Upcoming · Team, five rows each, one-line rows with a tick and
// one ⋯ menu (Reschedule, Assign, Open), a row click opens the task, and the Overdue group's "Move all".
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
const late = (i: number, o: Partial<PriorityTask> = {}) => taskRow({ id: `task:t${i}`, task: task({ id: `t${i}`, key: `RIG-${i}`, title: `Late ${i}`, ...o }) });
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
/** What POST /tasks/bulk skips (by task id). */
let bulkSkips: string[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  refuse = null;
  bulkSkips = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x.y', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (refuse && refuse.test(`${method} ${url}`)) return json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } }, 403);
      if (url.includes('/dashboard/priorities')) return json({ data: current });
      if (/\/tasks\/bulk\/[^/]+\/undo$/.test(url)) return json({ data: { restored: [{ id: 't1', key: 'RIG-1', title: 'x', projectId: 'p1' }], skipped: [] } });
      if (url.endsWith('/tasks/bulk')) {
        const ids = body.taskIds as string[];
        const changed = ids.filter((id) => !bulkSkips.includes(id)).map((id) => ({ id, key: id, title: id, projectId: 'p1' }));
        const skipped = ids.filter((id) => bulkSkips.includes(id)).map((id) => ({ id, code: 'NOT_ALLOWED', reason: 'You can’t change it.' }));
        return json({ data: { action: 'dueDate', dryRun: false, total: ids.length, changed, skipped, undo: changed.length ? { id: 'bulk-1', until: '2026-11-06T10:00:30Z' } : null } });
      }
      // The server's list after a move: Done takes it off, back to its column puts it back.
      if (url.endsWith('/move')) current = body.columnId === 'c-done' ? answer([]) : before;
      if (url.endsWith('/move')) return json({ data: { id: 't1', key: 'RIG-4', columnId: body?.columnId ?? 'x', approvalRequestedAt: null } });
      if (method === 'PUT' && /\/tasks\/t\d+$/.test(url)) return json({ data: { id: 't1', version: 4 } });
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
/** Open a row's ⋯ menu (and choose one of its items). */
async function menu(name: string, item?: string) {
  await userEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }));
  const m = screen.getByRole('dialog', { name: `Actions for ${name}` });
  if (item) await userEvent.click(within(m).getByRole('button', { name: item }));
  return m;
}

describe('the groups', () => {
  it('Today · Overdue · Approvals · Upcoming in that order, each a list with a heading and its count (Blocked only if any)', async () => {
    current = answer([
      late(1),
      late(2),
      taskRow({ id: 'approval:t5', kind: 'approval', reason: { code: 'approval', since: null }, chips: ['approvals'], group: 2, task: task({ id: 't5', key: 'RIG-5', title: 'Approve me', can: { complete: false, reschedule: false, assign: false, approve: true } }) }),
      taskRow({ id: 'task:t3', reason: { code: 'due-today' }, chips: ['today'], group: 4, task: task({ id: 't3', key: 'RIG-3', title: 'Due now', dueDate: TODAY }) }),
      taskRow({ id: 'task:t4', reason: { code: 'due-soon', days: 2 }, chips: ['upcoming'], group: 9, task: task({ id: 't4', key: 'RIG-6', title: 'Soon', dueDate: '2026-11-08' }) }),
    ]);
    show();
    await screen.findByText('Due now');
    const heads = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(['Today 1', 'Overdue 2', 'Approvals 1', 'Upcoming 1']);
    const overdue = screen.getByRole('list', { name: /^Overdue/ });
    expect(within(overdue).getAllByRole('listitem').map((li) => li.getAttribute('data-priority-row'))).toEqual(['task:t1', 'task:t2']);
    expect(within(screen.getByRole('list', { name: /^Today/ })).getByText('Due now')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /^Blocked/ })).toBeNull();
  });

  it('the chips stay; a chip shows only its rows under one heading; All shows the groups again', async () => {
    current = answer([
      late(1),
      taskRow({ id: 'task:t2', task: task({ id: 't2', key: 'RIG-7', title: 'Valve', blockers: [{ id: 'b1', key: 'RIG-1' }] }), reason: { code: 'blocked-by', blockers: [{ id: 'b1', key: 'RIG-1' }] }, chips: ['blocked'], group: 8 }),
    ]);
    show();
    await screen.findByText('Valve');
    const chips = screen.getByRole('group', { name: 'Show priorities by reason' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['All 2', 'Overdue 1', 'Today 0', 'Approvals 0', 'Blocked 1', 'Upcoming 0']);
    await userEvent.click(within(chips).getByRole('button', { name: /Blocked/ }));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Blocked 1']);
    expect(row('task:t1')).toBeNull();
    expect(row('task:t2')).not.toBeNull();
    await userEvent.click(within(chips).getByRole('button', { name: /^All/ }));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(1);
  });

  it('five rows, then Show more (five more) and Show all N', async () => {
    current = answer(Array.from({ length: 13 }, (_, i) => late(i)));
    show();
    await screen.findByText('Late 0');
    const overdue = () => screen.getByRole('list', { name: /^Overdue/ });
    expect(within(overdue()).getAllByRole('listitem')).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'Show more in Overdue' }));
    expect(within(overdue()).getAllByRole('listitem')).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 13 in Overdue' }));
    expect(within(overdue()).getAllByRole('listitem')).toHaveLength(13);
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer in Overdue' }));
    expect(within(overdue()).getAllByRole('listitem')).toHaveLength(5);
  });

  it('Team only for the people who run projects; other people’s late work is under Team, not Overdue', async () => {
    current = answer([taskRow({ reason: { code: 'team-overdue', days: 4 }, chips: ['overdue', 'team'], group: 6, task: task({ assignees: [{ id: 'o', name: 'Omar Ahmed' }] }) })], { manager: true });
    show();
    await screen.findByText('Pump check');
    expect(within(screen.getByRole('list', { name: /^Team/ })).getByText('Pump check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Team 1/ })).toBeInTheDocument();
  });

  it('nothing: "Nothing urgent — you’re clear for today."', async () => {
    current = answer([]);
    show();
    expect(await screen.findByText('Nothing urgent — you’re clear for today.')).toBeInTheDocument();
  });

  it('a failed load is an error with Retry (never "clear")', async () => {
    refuse = /priorities/;
    show();
    expect(await screen.findByText(/Couldn’t load your priorities/)).toBeInTheDocument();
    expect(screen.queryByText(/clear for today/)).toBeNull();
  });
});

describe('one-line rows', () => {
  it('tick, number and title, Urgent, project, due words, faces (max 3) and one ⋯ menu', async () => {
    current = answer([
      taskRow({
        reason: { code: 'overdue', days: 27 },
        task: task({
          priority: 'URGENT',
          dueDate: '2026-10-10',
          assignees: [
            { id: 'a', name: 'Amal Said' },
            { id: 'b', name: 'Badr Ali' },
            { id: 'c', name: 'Cyrus Lee' },
            { id: 'd', name: 'Dana Fox' },
          ],
        }),
      }),
      taskRow({ id: 'task:t2', reason: { code: 'due-soon', days: 2 }, chips: ['upcoming'], group: 9, task: task({ id: 't2', key: 'RIG-8', title: 'Later', dueDate: '2026-11-13' }) }),
    ]);
    show();
    await waitFor(() => expect(row('task:t1')).not.toBeNull());
    const r = row('task:t1');
    expect(within(r).getByRole('button', { name: 'Complete RIG-4: Pump check' })).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'Open RIG-4: Pump check' })).toHaveTextContent('RIG-4');
    expect(within(r).getByText('Urgent')).toBeInTheDocument();
    expect(within(r).getByText('Rig Inspection')).toBeInTheDocument();
    expect(within(r).getByText('27 days late').className).toMatch(/text-overdue/);
    expect(within(row('task:t2')).getByText('Fri 13 Nov')).toBeInTheDocument();
    expect(within(r).getAllByTitle(/^(Amal Said|Badr Ali|Cyrus Lee|Dana Fox)$/)).toHaveLength(3);
    expect(within(r).getByText('+1')).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: 'More actions for RIG-4: Pump check' })).toBeInTheDocument();
    // No row of four buttons any more.
    expect(within(r).queryByRole('button', { name: /^Reschedule/ })).toBeNull();
    expect(within(r).queryByRole('button', { name: /^Assign/ })).toBeNull();
  });

  it('a phone: tick, title and ⋯ on the first line, 44px targets; project, due and faces on the second line', async () => {
    current = answer([taskRow()]);
    show();
    await waitFor(() => expect(row('task:t1')).not.toBeNull());
    const r = row('task:t1');
    const first = r.querySelector('[data-row-line="1"]') as HTMLElement;
    const second = r.querySelector('[data-row-line="2"]') as HTMLElement;
    expect(within(first).getByRole('button', { name: /^Open RIG-4/ })).toBeInTheDocument();
    expect(within(second).getByText('Rig Inspection')).toBeInTheDocument();
    expect(within(second).getByText('2 days late')).toBeInTheDocument();
    const tick = within(r).getByRole('button', { name: /^Complete RIG-4/ });
    const more = within(r).getByRole('button', { name: /^More actions/ });
    for (const b of [tick, more]) expect(b.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-11', 'w-11']));
    // The tick first, the title line, then the ⋯ last.
    const all = Array.from(r.querySelectorAll('*'));
    const order = [tick, first, second, more].map((el) => all.indexOf(el));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('clicking the row (not the tick or menu) opens the task panel, as Open does', async () => {
    current = answer([taskRow()]);
    const open = show();
    await waitFor(() => expect(row('task:t1')).not.toBeNull());
    await userEvent.click(within(row('task:t1')).getByText('Rig Inspection'));
    expect(open).toHaveBeenLastCalledWith('t1', ['t1']);
    open.mockClear();
    await userEvent.click(within(row('task:t1')).getByRole('button', { name: /^More actions/ }));
    expect(open).not.toHaveBeenCalled();
  });

  it('review I2: after Reschedule moves a row to another group, focus is back on its ⋯; after a tick, on the next row', async () => {
    current = answer([late(1), late(2)]);
    show();
    await menu('RIG-1: Late 1', 'Reschedule…');
    const later = { ...current, items: [late(2), { ...late(1), reason: { code: 'due-today' as const }, chips: ['today' as const] }] };
    current = later;
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Reschedule RIG-1' })).getByRole('button', { name: /^Today/ }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: /^Today/ })).getByText('Late 1')).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('More actions for RIG-1: Late 1'));
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = f.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (input: string, init?: RequestInit) => {
      const out = await base(input, init);
      if (String(input).endsWith('/move')) current = answer([late(2)]);
      return out;
    });
    await userEvent.click(screen.getByRole('button', { name: 'Complete RIG-1: Late 1' }));
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Complete RIG-2: Late 2'));
  });

  it('a task waiting on another: the tick is disabled and says why; "Blocked by RIG-1" opens that task', async () => {
    current = answer([taskRow({ id: 'task:t2', task: task({ id: 't2', key: 'RIG-7', title: 'Valve', blockers: [{ id: 'b1', key: 'RIG-1' }], can: { complete: false, reschedule: true, assign: false, approve: false } }), reason: { code: 'blocked-by', blockers: [{ id: 'b1', key: 'RIG-1' }] }, chips: ['blocked'], group: 8 })]);
    const open = show();
    const tick = await screen.findByRole('button', { name: 'Complete RIG-7: Valve' });
    expect(tick).toHaveAttribute('aria-disabled', 'true');
    expect(tick).toHaveAccessibleDescription(/Blocked by RIG-1/);
    await userEvent.click(tick);
    expect(sent('PATCH', /\/move$/)).toHaveLength(0);
    // A tap says why (a touch screen has no tooltip).
    expect(within(row('task:t2')).getByRole('alert')).toHaveTextContent(/Blocked by RIG-1/);
    await userEvent.click(within(row('task:t2')).getByRole('button', { name: /RIG-1/ }));
    expect(open).toHaveBeenCalledWith('b1', expect.any(Array));
  });
});

describe('quick actions', () => {
  it('the tick completes it (to the Done column), the row leaves at once, the notice offers Undo — which moves it back', async () => {
    current = before = answer([taskRow()]);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4: Pump check' }));
    await waitFor(() => expect(row('task:t1')).toBeNull());
    expect(sent('PATCH', /\/tasks\/t1\/move$/)[0]!.body).toEqual({ columnId: 'c-done' });
    expect(await screen.findByText('Completed RIG-4.')).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4: Pump check' }));
    expect(await screen.findByText('RIG-4 needs approval, so it’s waiting for a project manager.')).toBeInTheDocument();
  });

  it('review I1: one that waits for approval in the column it was in — no Undo', async () => {
    current = answer([taskRow({ task: task({ columnId: 'c-review' }) })]);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = f.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (input: string, init?: RequestInit) =>
      String(input).endsWith('/move') ? json({ data: { id: 't1', key: 'RIG-4', columnId: 'c-review', approvalRequestedAt: '2026-11-06T08:00:00Z' } }) : base(input, init),
    );
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4: Pump check' }));
    expect(await screen.findByText('RIG-4 needs approval, so it’s waiting for a project manager.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('a refusal brings the row back and says why', async () => {
    current = answer([taskRow()]);
    refuse = /PATCH .*\/move$/;
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete RIG-4: Pump check' }));
    expect(await within(row('task:t1')).findByRole('alert')).toHaveTextContent('You do not have permission to do that.');
  });

  it('⋯ has Reschedule, Assign and Open (only what the person may do)', async () => {
    current = answer([taskRow(), late(2, { can: { complete: true, reschedule: false, assign: false, approve: false } })]);
    const open = show();
    const m = await menu('RIG-4: Pump check');
    expect(within(m).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reschedule…', 'Assign…', 'Open']);
    await userEvent.click(within(m).getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenLastCalledWith('t1', expect.any(Array));
    const m2 = await menu('RIG-2: Late 2');
    expect(within(m2).getAllByRole('button').map((b) => b.textContent)).toEqual(['Open']);
  });

  it('Reschedule: Today · Tomorrow · Next week · Pick a date; it sends the day from the copy it saw; Undo puts it back', async () => {
    current = answer([taskRow()]);
    show();
    await menu('RIG-4: Pump check', 'Reschedule…');
    const m = screen.getByRole('dialog', { name: 'Reschedule RIG-4' });
    expect(within(m).getAllByRole('button').map((b) => b.textContent)).toEqual(['TodayFri 6 Nov', 'TomorrowSat 7 Nov', 'Next weekSun 8 Nov', 'Pick a date…']);
    await userEvent.click(within(m).getByRole('button', { name: /Tomorrow/ }));
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
    await menu('RIG-4: Pump check', 'Reschedule…');
    await userEvent.click(screen.getByRole('button', { name: /Pick a date/ }));
    const m = screen.getByRole('dialog', { name: 'Reschedule RIG-4' });
    await userEvent.click(within(m).getByRole('button', { name: /20 November|20 Nov/ }));
    await waitFor(() => expect(sent('PUT', /\/tasks\/t1$/)[0]?.body).toEqual({ dueDate: '2026-11-20', expectedVersion: 3 }));
  });

  it('Assign: the team, without the people already on it; Undo takes them off again', async () => {
    current = answer([taskRow({ reason: { code: 'unassigned' }, chips: ['team'], group: 7, task: task({ assignees: [{ id: 'me', name: 'Me Myself' }] }) })], { manager: true });
    show();
    await menu('RIG-4: Pump check', 'Assign…');
    const m = screen.getByRole('dialog', { name: 'Assign RIG-4' });
    expect(await within(m).findByRole('button', { name: 'Omar Ahmed' })).toBeInTheDocument();
    expect(within(m).queryByRole('button', { name: 'Me Myself' })).toBeNull();
    await userEvent.click(within(m).getByRole('button', { name: 'Omar Ahmed' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/t1\/assignees$/)).toHaveLength(1));
    expect(sent('POST', /\/tasks\/t1\/assignees$/)[0]!.body).toEqual({ userIds: ['omar'] });
    expect(await screen.findByText('Assigned RIG-4 to Omar Ahmed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('DELETE', /\/tasks\/t1\/assignees\/omar$/)).toHaveLength(1));
  });

  it('an approval: the Approve button on the row; ⋯ has Approve, Send back (asks why) and Open — no tick', async () => {
    current = answer([taskRow({ id: 'approval:t1', kind: 'approval', reason: { code: 'approval', since: null }, chips: ['approvals'], group: 2, task: task({ can: { complete: false, reschedule: false, assign: false, approve: true }, requestedBy: { id: 's', name: 'Sara Ali' } }) })]);
    show();
    expect(await screen.findByText(/Finished by/)).toHaveTextContent('Finished by Sara Ali');
    expect(screen.queryByRole('button', { name: /^Complete RIG-4/ })).toBeNull();
    const m = await menu('RIG-4: Pump check');
    expect(within(m).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve', 'Send back', 'Open']);
    await userEvent.click(within(m).getByRole('button', { name: 'Send back' }));
    expect(await screen.findByRole('dialog', { name: /Send RIG-4 back/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(row('approval:t1')).getByRole('button', { name: 'Approve RIG-4' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/t1\/approve$/)).toHaveLength(1));
    expect(sent('POST', /\/tasks\/t1\/approve$/)[0]!.body).toEqual({ expectedVersion: 3 });
    expect(await screen.findByText('Approved RIG-4.')).toBeInTheDocument();
  });

  it('an action item: the tick marks it done (Undo opens it again); ⋯ Reschedule and Open meeting', async () => {
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
    const m = await menu('Send the report');
    expect(within(m).getByRole('button', { name: 'Reschedule…' })).toBeInTheDocument();
    expect(within(m).getByRole('link', { name: 'Open the meeting Weekly site meeting' })).toHaveAttribute('href', '/meetings/m1');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Mark “Send the report” done' }));
    await waitFor(() => expect(sent('PATCH', /\/action-items\/a1$/)).toHaveLength(1));
    expect(sent('PATCH', /\/action-items\/a1$/)[0]!.body).toEqual({ status: 'COMPLETED' });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('PATCH', /\/action-items\/a1$/)).toHaveLength(2));
    expect(sent('PATCH', /\/action-items\/a1$/)[1]!.body).toEqual({ status: 'OPEN' });
  });

  it('a checklist item (1.23.3): the tick ticks it (Undo unticks), ⋯ Reschedule and Open task', async () => {
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
    await menu('RIG-9: Torque the bolts', 'Reschedule…');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Reschedule “Torque the bolts”' })).getByRole('button', { name: /Tomorrow/ }));
    await waitFor(() => expect(sent('PUT', /\/checklist\/c1$/)).toHaveLength(3));
    expect(sent('PUT', /\/checklist\/c1$/)[2]!.body).toEqual({ dueDate: '2026-11-07' });
    // Open goes to the task panel at that item (1.23.3: ?item=).
    await userEvent.click(screen.getByRole('button', { name: 'Open RIG-9 at “Torque the bolts”' }));
    expect(open).toHaveBeenLastCalledWith('t9', ['t9'], { item: 'c1' });
    open.mockClear();
    await menu('RIG-9: Torque the bolts', 'Open task');
    expect(open).toHaveBeenLastCalledWith('t9', ['t9'], { item: 'c1' });
  });

  it('a checklist item the person may not tick or move: the tick is disabled with a reason; ⋯ offers only Open task', async () => {
    current = answer([
      { id: 'checklist-item:c2', kind: 'checklist-item', reason: { code: 'due-today' }, also: [], chips: ['today'], group: 4, checklistItem: { id: 'c2', text: 'Parent step', dueDate: TODAY, listTitle: 'Steps', task: { id: 't9', key: 'RIG-9', title: 'Flange', projectId: 'p1' }, can: { tick: false, reschedule: false } } },
    ]);
    show();
    expect(await screen.findByText('Parent step')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tick “Parent step”' })).toHaveAttribute('aria-disabled', 'true');
    const m = await menu('RIG-9: Parent step');
    expect(within(m).getAllByRole('button').map((b) => b.textContent)).toEqual(['Open task']);
  });
});

describe('Overdue group: Move all to today and Reschedule all…', () => {
  it('asks first ("Move 2 tasks to today? 1 you can’t change will stay."), moves only what the person may, one undo', async () => {
    current = answer([late(1), late(2, { can: { complete: true, reschedule: false, assign: false, approve: false } }), late(3)]);
    show();
    await screen.findByText('Late 1');
    await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Move 2 tasks to today? 1 you can’t change will stay.' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Move to today' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/bulk$/)).toHaveLength(1));
    expect(sent('POST', /\/tasks\/bulk$/)[0]!.body).toEqual({ taskIds: ['t1', 't3'], action: { type: 'dueDate', mode: 'set', date: TODAY } });
    expect(await screen.findByText('Moved 2 tasks to today.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/bulk\/bulk-1\/undo$/)).toHaveLength(1));
    expect(await screen.findByText(/^Put back/)).toBeInTheDocument();
  });

  it('Cancel changes nothing', async () => {
    current = answer([late(1), late(3)]);
    show();
    await screen.findByText('Late 1');
    await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(sent('POST', /\/tasks\/bulk/)).toHaveLength(0);
  });

  it('a repeating task and a checklist item move one by one, as their own Reschedule does; Undo puts each back', async () => {
    current = answer([
      late(1),
      late(4, { recurrenceRule: { freq: 'WEEKLY', interval: 1 } as unknown as PriorityTask['recurrenceRule'] }),
      { id: 'checklist-item:c1', kind: 'checklist-item', reason: { code: 'overdue', days: 1 }, also: [], chips: ['overdue'], group: 1, checklistItem: { id: 'c1', text: 'Torque', dueDate: '2026-11-05', task: { id: 't9', key: 'RIG-9', title: 'Flange', projectId: 'p1' }, can: { tick: true, reschedule: true } } },
    ]);
    show();
    await screen.findByText('Late 1');
    await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Move 3 items to today?' })).getByRole('button', { name: 'Move to today' }));
    expect(await screen.findByText('Moved 3 items to today.')).toBeInTheDocument();
    expect(sent('POST', /\/tasks\/bulk$/)[0]!.body).toMatchObject({ taskIds: ['t1'] });
    expect(sent('PUT', /\/tasks\/t4$/)[0]!.body).toMatchObject({ dueDate: TODAY, expectedVersion: 3, recurrenceRule: { resumeFrom: '2026-11-04' } });
    expect(sent('PUT', /\/checklist\/c1$/)[0]!.body).toEqual({ dueDate: TODAY });
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(sent('PUT', /\/checklist\/c1$/)).toHaveLength(2));
    expect(sent('PUT', /\/checklist\/c1$/)[1]!.body).toEqual({ dueDate: '2026-11-05' });
    await waitFor(() => expect(sent('PUT', /\/tasks\/t4$/)).toHaveLength(2));
    expect(sent('PUT', /\/tasks\/t4$/)[1]!.body).toMatchObject({ dueDate: '2026-11-04', expectedVersion: 4 });
    expect(sent('POST', /\/tasks\/bulk\/bulk-1\/undo$/)).toHaveLength(1);
  });

  it('what the server skips is said', async () => {
    current = answer([late(1), late(3)]);
    bulkSkips = ['t3'];
    show();
    await screen.findByText('Late 1');
    await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Move to today' }));
    expect(await screen.findByText('Moved 1 task to today. 1 couldn’t be moved. You can’t change it.')).toBeInTheDocument();
  });

  it('Reschedule all… picks a date, then asks', async () => {
    current = answer([late(1), late(3)]);
    show();
    await screen.findByText('Late 1');
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule all…' }));
    const pick = screen.getByRole('dialog', { name: 'Reschedule the overdue tasks' });
    await userEvent.click(within(pick).getByRole('button', { name: /20 November|20 Nov/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Move 2 tasks to Fri 20 Nov?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Move to Fri 20 Nov' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/bulk$/)[0]?.body).toEqual({ taskIds: ['t1', 't3'], action: { type: 'dueDate', mode: 'set', date: '2026-11-20' } }));
    expect(await screen.findByText('Moved 2 tasks to Fri 20 Nov.')).toBeInTheDocument();
  });

  it('review I3: in the Overdue chip too, Move all leaves the team’s late tasks alone', async () => {
    current = answer([late(1), taskRow({ id: 'task:t7', reason: { code: 'team-overdue', days: 4 }, chips: ['overdue', 'team'], group: 6, task: task({ id: 't7', key: 'RIG-7', title: 'Theirs', assignees: [{ id: 'o', name: 'Omar Ahmed' }] }) })], { manager: true });
    show();
    await screen.findByText('Theirs');
    await userEvent.click(within(screen.getByRole('group', { name: 'Show priorities by reason' })).getByRole('button', { name: /^Overdue/ }));
    expect(row('task:t7')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }));
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Move 1 task to today?' })).getByRole('button', { name: 'Move to today' }));
    await waitFor(() => expect(sent('POST', /\/tasks\/bulk$/)[0]?.body).toMatchObject({ taskIds: ['t1'] }));
  });

  it('review I4: an Undo that ran out of time says so (not "changed since")', async () => {
    current = answer([late(1), late(3)]);
    refuse = /POST .*\/tasks\/bulk\/bulk-1\/undo$/;
    show();
    await screen.findByText('Late 1');
    await userEvent.click(screen.getByRole('button', { name: 'Move all to today' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Move to today' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText(/2 tasks stayed: You do not have permission to do that\./)).toBeInTheDocument();
    expect(screen.queryByText(/changed since/)).toBeNull();
  });

  it('nothing the person may move: no group actions', async () => {
    current = answer([late(2, { can: { complete: true, reschedule: false, assign: false, approve: false } })]);
    show();
    await screen.findByText('Late 2');
    expect(screen.queryByRole('button', { name: 'Move all to today' })).toBeNull();
  });
});

describe('contrast (1.23.8 page walk)', () => {
  it('the chosen chip’s count is full white on the brand fill (white/80 was 4.0:1 in dark mode)', async () => {
    current = answer([taskRow({ reason: { code: 'blocking', count: 2 }, chips: ['today'], group: 3 })]);
    show();
    await screen.findByText('Pump check');
    const chosen = screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')!;
    expect(chosen.querySelector('span')).toHaveClass('text-white');
  });
});
