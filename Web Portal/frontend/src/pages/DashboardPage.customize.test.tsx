import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardPage } from './DashboardPage';
import { useAuthStore } from '../stores/auth-store';
import type { DashboardLayout, MyLayoutAnswer } from '../api/dashboard';
import { builtInLayout } from '../lib/dashboard-layout';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), io: { on: vi.fn() } }) }));

// 1.23.4 Smarter Dashboard — the widgets in each person's arrangement, and "Customize dashboard": move by
// handle or Move up / Move down (said aloud), show/hide, Small/Wide, Done saves to the account, Reset to
// default; an administrator also arranges and saves the two defaults.
type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let mine: MyLayoutAnswer;
let canApprove = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answerOf = (layout: DashboardLayout, o: Partial<MyLayoutAnswer> = {}): MyLayoutAnswer => ({ layout, customized: false, group: 'everyone', widgets: layout.widgets.map((w) => w.id), defaultLayout: layout, ...o });

function signIn(admin: boolean) {
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: admin ? 'admin' : 'emp', roles: admin ? ['ADMIN'] : ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
}

beforeEach(() => {
  calls = [];
  canApprove = false;
  // An employee who approves nothing: the server leaves Approvals out of their arrangement.
  mine = answerOf({ widgets: builtInLayout(false).widgets.filter((w) => w.id !== 'approvals') });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url.endsWith('/users/me/dashboard-layout')) {
        if (method === 'PUT') mine = { ...mine, layout: body.layout ?? mine.defaultLayout, customized: body.layout !== null };
        return json({ data: mine });
      }
      if (url.endsWith('/settings/dashboard-default')) {
        if (method === 'PUT') return json({ data: { admins: builtInLayout(true), everyone: body.layout ?? builtInLayout(false) } });
        return json({ data: { admins: builtInLayout(true), everyone: { widgets: [{ id: 'activity', hidden: false, size: 'wide' }, ...builtInLayout(false).widgets.filter((w) => w.id !== 'activity')] } } });
      }
      if (url.includes('/dashboard/priorities')) return json({ data: { today: '2026-11-06', timeZone: 'Asia/Muscat', manager: false, items: [], total: 0, counts: { all: 0, overdue: 0, today: 0, approvals: 0, blocked: 0, upcoming: 0, team: 0 }, watch: [] } });
      if (url.endsWith('/tasks/approvals')) return json({ data: { canApprove, tasks: [] } });
      if (url.endsWith('/reports/status')) return json({ data: { TODO: 1 } });
      if (url.endsWith('/reports/projects')) return json({ data: [] });
      if (url.endsWith('/tasks/mine')) return json({ data: [{ id: 't1', key: 'T-1', title: 'Mine', projectId: 'p1', columnId: 'c', priority: 'NORMAL', dueDate: null, completedAt: null, columnCategory: 'TODO' }] });
      if (url.includes('/projects')) return json({ data: [{ id: 'p1' }] });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.getState().logout();
});

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const order = () => [...document.querySelectorAll('[data-widget]')].map((e) => e.getAttribute('data-widget'));

describe('the widgets in the person’s arrangement', () => {
  it('My Priorities Today first and wide; the hidden ones left out; the order as saved', async () => {
    signIn(false);
    mine = answerOf({ widgets: [{ id: 'activity', hidden: false, size: 'small' }, { id: 'priorities', hidden: false, size: 'wide' }, { id: 'stats', hidden: true, size: 'wide' }, { id: 'open-tasks', hidden: false, size: 'small' }, { id: 'due-soon', hidden: false, size: 'small' }] }, { customized: true });
    show();
    await waitFor(() => expect(order()).toEqual(['activity', 'priorities', 'open-tasks', 'due-soon']));
    expect(document.querySelector('[data-widget="priorities"]')!.className).toContain('lg:col-span-2');
    expect(document.querySelector('[data-widget="activity"]')!.className).not.toContain('lg:col-span-2');
    expect(screen.queryByTestId('stat-tiles')).toBeNull();
  });

  it('Approvals only for people who can approve; the charts only for administrators', async () => {
    signIn(false);
    mine = answerOf({ widgets: [...builtInLayout(false).widgets, { id: 'status-chart', hidden: false, size: 'small' }] });
    show();
    await waitFor(() => expect(order()).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'activity']));
  });

  it('the account’s arrangement can’t be read: the built-in default (never an empty page)', async () => {
    signIn(true);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = f.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (input: string, init?: RequestInit) => (String(input).endsWith('/dashboard-layout') ? json({ error: { code: 'X', message: 'down' } }, 500) : base(input, init)));
    canApprove = true;
    show();
    await waitFor(() => expect(order()).toEqual(['priorities', 'stats', 'status-chart', 'completion', 'approvals', 'due-soon', 'activity']));
  });
});

describe('Customize dashboard', () => {
  it('Move down (said aloud), hide, Wide — then Done saves it to the account', async () => {
    signIn(false);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Customize dashboard' }));
    const panel = screen.getByTestId('customize-panel');
    expect(within(panel).queryByRole('group', { name: 'Arranging' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Move My Priorities Today down' }));
    expect(within(panel).getByText('My Priorities Today moved to position 2 of 5.')).toHaveAttribute('aria-live', 'polite');
    await userEvent.click(within(panel).getByRole('button', { name: 'Hide Recent activity' }));
    expect(within(panel).getByText('Recent activity hidden.')).toHaveAttribute('aria-live', 'polite');
    await userEvent.click(within(within(panel).getByRole('group', { name: 'Due soon size' })).getByRole('button', { name: 'Wide' }));
    // The page shows it as it will be.
    expect(order()).toEqual(['stats', 'priorities', 'open-tasks', 'due-soon']);
    await userEvent.click(within(panel).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/users/me/dashboard-layout'))).toHaveLength(1));
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({
      layout: {
        widgets: [
          { id: 'stats', hidden: false, size: 'wide' },
          { id: 'priorities', hidden: false, size: 'wide' },
          { id: 'open-tasks', hidden: false, size: 'small' },
          { id: 'due-soon', hidden: false, size: 'wide' },
          { id: 'activity', hidden: true, size: 'small' },
        ],
      },
    });
    await waitFor(() => expect(screen.queryByTestId('customize-panel')).toBeNull());
    expect(screen.getByText('Your dashboard is saved.')).toBeInTheDocument();
  });

  it('Cancel leaves it as it was; Reset to default then Done sends “back to the default” (null)', async () => {
    signIn(false);
    mine = answerOf({ widgets: [...builtInLayout(false).widgets].reverse() }, { customized: true, defaultLayout: builtInLayout(false) });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Customize dashboard' }));
    await userEvent.click(screen.getByRole('button', { name: /Move Recent activity down/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(order()).toEqual(['activity', 'due-soon', 'open-tasks', 'stats', 'priorities']));
    await userEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(order()).toEqual(['priorities', 'stats', 'open-tasks', 'due-soon', 'activity']);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ layout: null }));
  });

  it('an administrator arranges the default for everyone else (no admin charts listed) and saves it for everyone', async () => {
    signIn(true);
    canApprove = true;
    mine = answerOf(builtInLayout(true), { group: 'admins' });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Customize dashboard' }));
    const panel = screen.getByTestId('customize-panel');
    const arranging = within(panel).getByRole('group', { name: 'Arranging' });
    expect(within(arranging).getByRole('radio', { name: 'My dashboard' })).toBeChecked();
    await userEvent.click(within(arranging).getByRole('radio', { name: 'Default for everyone else' }));
    await waitFor(() => expect(within(panel).getAllByRole('listitem').map((li) => li.getAttribute('data-widget-row'))).toEqual(['activity', 'priorities', 'stats', 'open-tasks', 'approvals', 'due-soon']));
    expect(within(panel).getByText(/People who never customized/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Move Recent activity down' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Save as the default for everyone else' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/settings/dashboard-default'))).toHaveLength(1));
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/settings/dashboard-default'))!;
    expect(put.body).toMatchObject({ group: 'everyone' });
    expect((put.body as { layout: DashboardLayout }).layout.widgets.map((w) => w.id)).toEqual(['priorities', 'activity', 'stats', 'open-tasks', 'approvals', 'due-soon']);
    expect(await screen.findByText('Saved the default for everyone else.')).toBeInTheDocument();
    // Their own arrangement was not touched.
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/users/me/dashboard-layout'))).toBe(false);
  });

  it('a save that fails says so and keeps the panel open', async () => {
    signIn(false);
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const base = f.getMockImplementation() as (input: string, init?: RequestInit) => Promise<Response>;
    f.mockImplementation(async (input: string, init?: RequestInit) => (init?.method === 'PUT' ? json({ error: { code: 'X', message: 'down' } }, 500) : base(input, init)));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Customize dashboard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the arrangement. Please try again.');
    expect(screen.getByTestId('customize-panel')).toBeInTheDocument();
  });
});
