import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ActivityPage } from './ActivityPage';
import { useAuthStore } from '../stores/auth-store';

// 1.22: the Activity page's calendar — how many changes each day, and a day's changes under it.
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, taskId: 't1', projectId: 'p1', userId: 'u1', action: 'MOVED', createdAt: '2026-11-03T08:00:00.000Z',
  meta: { from: 'To Do', to: 'In Progress' }, actor: { id: 'u1', name: 'Omar Ahmed' },
  task: { id: 't1', key: 'MICO-7', title: 'Ship the release' }, project: { id: 'p1', name: 'Mobile App' }, ...over,
});

let requests: string[];
let prefs: { timeZone: string | null; weekStart: number | null };
let dayPages: Record<string, { data: unknown[]; next: string | null }>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T08:00:00.000Z')); // Wednesday 4 November, noon in Muscat
  localStorage.clear();
  requests = [];
  prefs = { timeZone: null, weekStart: null };
  dayPages = {
    '': { data: [row('d1'), row('d2', { id: 'd2', action: 'ASSIGNED', meta: { assignee: 'Nadia Ahmed' }, actor: { id: 'u2', name: 'Ada Lovelace' }, task: { id: 't2', key: 'MICO-8', title: 'Write docs' } })], next: 'd2' },
    d2: { data: [row('d3', { task: { id: 't3', key: 'MICO-9', title: 'Older change' } })], next: null },
  };
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    requests.push(u);
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/users/me/preferences')) return json({ data: prefs });
    const q = new URL(u, 'http://test.local').searchParams;
    if (u.includes('/activity?') && q.has('from')) {
      return json({ data: [{ day: '2026-11-02', count: 2 }, { day: '2026-11-03', count: 12 }, { day: '2026-11-04', count: 5 }] });
    }
    if (u.includes('/activity?') && q.has('day')) return json(q.get('day') === '2026-11-05' ? { data: [], next: null } : dayPages[q.get('before') ?? ''] ?? { data: [], next: null });
    if (u.endsWith('/activity')) return json({ data: [row('l1', { createdAt: new Date().toISOString() })] });
    if (u.endsWith('/projects')) return json({ data: [{ id: 'p1' }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dayButton = (name: RegExp) => screen.findByRole('button', { name });
const countRequests = () => requests.filter((u) => u.includes('/activity?') && u.includes('from=')).map((u) => new URL(u, 'http://test.local').searchParams);
const dayRequests = () => requests.filter((u) => u.includes('/activity?') && u.includes('day=')).map((u) => new URL(u, 'http://test.local').searchParams);

describe('Activity — List | Calendar', () => {
  it('starts on the list (unchanged), and the switch says which view is on', async () => {
    renderPage();
    expect(await screen.findByText('Omar Ahmed')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'View' });
    expect(within(group).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'false');
    expect(countRequests()).toHaveLength(0);
  });

  it('the calendar is remembered for this person, on this browser', async () => {
    const first = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(localStorage.getItem('mico360.u.me.activity.view')).toBe('calendar');
    first.unmount();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Activity — the calendar', () => {
  beforeEach(() => localStorage.setItem('mico360.u.me.activity.view', 'calendar'));

  it('a month: each day’s number of changes, shaded from quiet to busy, today marked', async () => {
    renderPage();
    const busy = await dayButton(/^Tuesday 3 November 2026: 12 changes/);
    expect(busy).toHaveAttribute('data-shade', '4');
    expect(await dayButton(/^Monday 2 November 2026: 2 changes/)).toHaveAttribute('data-shade', '1');
    const today = await dayButton(/^Wednesday 4 November 2026: 5 changes, today/);
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveAttribute('data-shade', '2');
    expect(within(today).getByText('5')).toBeInTheDocument();
    expect(await dayButton(/^Thursday 5 November 2026: No changes/)).toHaveAttribute('data-shade', '0');
    // The month's whole weeks (Sunday first, the site's week until set): 1 Nov to 5 Dec.
    const asked = countRequests().at(-1)!;
    expect([asked.get('from'), asked.get('to')]).toEqual(['2026-11-01', '2026-12-05']);
  });

  it('click a day: its changes below the calendar, as the list’s rows, 100 at a time', async () => {
    renderPage();
    await userEvent.click(await dayButton(/^Tuesday 3 November 2026/));
    expect(await dayButton(/^Tuesday 3 November 2026/)).toHaveAttribute('aria-pressed', 'true');
    const day = await screen.findByRole('region', { name: /Tuesday 3 November 2026/ });
    expect(await within(day).findByText('MICO-7')).toBeInTheDocument();
    expect(within(day).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(day).getByText(/→ Nadia Ahmed/)).toBeInTheDocument();
    expect(dayRequests().at(-1)!.get('day')).toBe('2026-11-03');
    await userEvent.click(within(day).getByRole('button', { name: 'Show more' }));
    expect(await within(day).findByText('MICO-9')).toBeInTheDocument();
    expect(dayRequests().at(-1)!.get('before')).toBe('d2');
    expect(within(day).queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('opens on today’s changes', async () => {
    renderPage();
    expect(await screen.findByRole('region', { name: /Wednesday 4 November 2026/ })).toBeInTheDocument();
    expect(dayRequests()[0]!.get('day')).toBe('2026-11-04');
  });

  it('a week view, with Previous, Next and Today', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Week' }));
    expect(await screen.findByRole('heading', { name: '1 – 7 Nov 2026' })).toBeInTheDocument();
    expect([countRequests().at(-1)!.get('from'), countRequests().at(-1)!.get('to')]).toEqual(['2026-11-01', '2026-11-07']);
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByRole('heading', { name: '8 – 14 Nov 2026' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(await screen.findByRole('heading', { name: '25 – 31 Oct 2026' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { name: '1 – 7 Nov 2026' })).toBeInTheDocument();
    expect(localStorage.getItem('mico360.u.me.activity.calendar')).toBe('week');
  });

  it('the week starts on the person’s own week start', async () => {
    prefs = { timeZone: null, weekStart: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Week' }));
    expect(await screen.findByRole('heading', { name: '2 – 8 Nov 2026' })).toBeInTheDocument();
  });

  it('a month moves by Previous and Next month', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
    expect(countRequests().at(-1)!.get('from')).toBe('2026-11-29');
  });

  it('the filters apply to the counts and to the day’s list', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'November 2026' });
    await userEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(countRequests().at(-1)!.get('kind')).toBe('COMPLETED'));
    await waitFor(() => expect(dayRequests().at(-1)!.get('kind')).toBe('COMPLETED'));
  });

  it('a day with nothing says so', async () => {
    renderPage();
    await userEvent.click(await dayButton(/^Thursday 5 November 2026/));
    const day = await screen.findByRole('region', { name: /Thursday 5 November 2026/ });
    expect(await within(day).findByText('No changes on this day.')).toBeInTheDocument();
  });
});
