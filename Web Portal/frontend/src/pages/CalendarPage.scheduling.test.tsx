import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarPage } from './CalendarPage';
import { useAuthStore } from '../stores/auth-store';
import type { ApiTask } from '../api/tasks';
import type { CalBlock, CalReminder } from '../api/calendar';
import { HOUR_PX } from '../lib/calendar-hours';

// Calendar scheduling (owner, 11 Nov 2026): bars from start to due, the week and day hours, planned time,
// meetings moved by their organizer, the split view, holidays and reminders — on the page.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const task = (over: Partial<ApiTask>): ApiTask => ({
  id: 't1', key: 'MICO-1', title: 'Pour the slab', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-14T00:00:00.000Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '',
  version: 3, assignees: [{ id: 'me', name: 'Mo Me' }], ...over,
});
const PROJECTS = [{ id: 'p1', code: 'MICO', name: 'MICO360 Platform', status: 'ACTIVE', color: '#8B1E1E', clientName: null }];

let tasks: ApiTask[];
let blocks: CalBlock[];
let reminders: CalReminder[];
let meetings: Array<Record<string, unknown>>;
let prefs: { layout: 'split' | 'full'; show: { tasks: boolean; meetings: boolean; blocks: boolean; reminders: boolean }; team: boolean };
let requests: { url: string; method: string; body?: unknown }[];
let daysOff: { day: string; name: string }[];
let overdue: ApiTask[];

const inRange = (d: string | null, from: string, to: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;

beforeEach(() => {
  // jsdom has no DragEvent: a drag event is a mouse event here too (its clientY says which hour).
  vi.stubGlobal('DragEvent', class extends MouseEvent {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T08:00:00.000Z')); // Saturday 10 October, noon in Muscat
  localStorage.clear();
  requests = [];
  blocks = [];
  reminders = [];
  meetings = [];
  daysOff = [];
  overdue = [];
  prefs = { layout: 'split', show: { tasks: true, meetings: true, blocks: true, reminders: true }, team: false };
  tasks = [
    task({ id: 'bar', key: 'MICO-1', title: 'Pour the slab', startDate: '2026-10-12T00:00:00.000Z', dueDate: '2026-10-14T00:00:00.000Z' }),
    task({ id: 'long', key: 'MICO-2', title: 'Long survey', startDate: '2026-10-13T00:00:00.000Z', dueDate: '2026-11-30T00:00:00.000Z' }),
  ];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url: u, method, body });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/users/me/preferences')) return json({ data: { timeZone: null, weekStart: null } });
    if (u.endsWith('/projects')) return json({ data: PROJECTS });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'me', username: 'me', firstName: 'Mo', lastName: 'Me' }, { id: 'u2', username: 'mona', firstName: 'Mona', lastName: 'Said' }] });
    if (u.endsWith('/calendar/preferences')) {
      if (method === 'PUT') prefs = { ...prefs, ...(body as object), show: { ...prefs.show, ...((body as { show?: object }).show ?? {}) } };
      return json({ data: prefs });
    }
    if (u.includes('/working-time?')) {
      const q = new URL(u, 'http://test.local').searchParams;
      return json({ data: { companyId: 'c1', timeZone: 'Asia/Muscat', weekStart: 0, workingDays: [0, 1, 2, 3, 4], hours: { start: '08:00', end: '17:00' }, from: q.get('from'), to: q.get('to'), daysOff } });
    }
    if (u.includes('/calendar?')) {
      const q = new URL(u, 'http://test.local').searchParams;
      const from = q.get('from')!;
      const to = q.get('to')!;
      const due = tasks.filter((t) => inRange(t.dueDate, from, to));
      const spanning = tasks.filter((t) => !due.includes(t) && (inRange(t.startDate, from, to) || (t.startDate && t.dueDate && t.startDate.slice(0, 10) < from && t.dueDate.slice(0, 10) > to)));
      return json({ data: { from, to, timeZone: 'Asia/Muscat', tasks: due, spanning, occurrences: [], series: [], workBlocks: blocks, reminders, team: { available: false, on: false } } });
    }
    if (/\/meetings\?/.test(u)) return json({ data: meetings });
    if (u.includes('/tasks?overdue=true')) return json({ data: overdue });
    const put = /\/tasks\/([^/?]+)$/.exec(u);
    if (put && method === 'PUT') {
      const t = tasks.find((x) => x.id === put[1])!;
      const b = body as { startDate?: string; dueDate?: string };
      const next = { ...t, ...(b.startDate !== undefined ? { startDate: b.startDate } : {}), ...(b.dueDate !== undefined ? { dueDate: b.dueDate.length === 10 ? `${b.dueDate}T00:00:00.000Z` : b.dueDate } : {}), version: (t.version ?? 0) + 1 };
      tasks = tasks.map((x) => (x.id === t.id ? next : x));
      return json({ data: next });
    }
    if (/\/tasks\/[^/]+\/work-blocks$/.test(u) && method === 'POST') {
      const b = body as { startAt: string; endAt: string; userId?: string };
      const row = { id: 'b-new', taskId: u.split('/tasks/')[1]!.split('/')[0]!, userId: b.userId ?? 'me', userName: 'Mo Me', plannedById: 'me', plannedByName: 'Mo Me', startAt: b.startAt, endAt: b.endAt, canChange: true };
      return json({ data: row }, 201);
    }
    if (/\/tasks\/[^/]+\/work-blocks$/.test(u)) return json({ data: [], meta: { forPeople: ['me'] } });
    if (/\/work-blocks\/[^/]+$/.test(u) && method === 'PUT') return json({ data: { ...(body as object) } });
    if (/\/work-blocks\/[^/]+$/.test(u) && method === 'DELETE') return new Response(null, { status: 204 });
    if (/\/tasks\/[^/]+\/reminders$/.test(u) && method === 'POST') return json({ data: { id: 'r-new' } }, 201);
    if (/\/tasks\/[^/]+\/reminders$/.test(u)) return json({ data: [], meta: { forPeople: ['me'] } });
    if (/\/meetings\/[^/?]+$/.test(u) && method === 'PUT') return json({ data: { ...(body as object) } });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(path = '/calendar') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const day = (key: string) => document.querySelector(`[data-day="${key}"]`) as HTMLElement;
const hours = (key: string) => document.querySelector(`[data-hours="${key}"]`) as HTMLElement;
const puts = () => requests.filter((r) => r.method === 'PUT' && /\/tasks\/[^/]+$/.test(r.url));
const wide = () => {
  const mm = vi.fn((q: string) => ({ matches: q.includes('min-width: 1280px'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
  vi.stubGlobal('matchMedia', mm);
  Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
};

describe('a task from its start to its due day (owner 1)', () => {
  it('one bar across its days with ▶ and ⚑; a task over three weeks shows only its two marks', async () => {
    renderPage();
    const bar = await screen.findByRole('button', { name: /Pour the slab.*from Mon 12 Oct to Wed 14 Oct/ });
    expect(bar).toHaveAttribute('data-role', 'bar');
    // It starts in Monday's cell and reaches across to Wednesday's.
    expect(day('2026-10-12')).toContainElement(bar);
    expect(bar.querySelector('[data-grip="start"]')).not.toBeNull();
    expect(bar.querySelector('[data-grip="due"]')).not.toBeNull();
    const marks = screen.getAllByRole('button', { name: /Long survey/ });
    expect(marks).toHaveLength(1); // only its start this month (its due mark is in November)
    expect(marks[0]).toHaveAttribute('data-role', 'start');
    expect(marks[0]).toHaveAccessibleName(/starts Tue 13 Oct/);
  });

  it('dragging the bar moves start and due together; Undo puts both back', async () => {
    renderPage();
    const bar = await screen.findByRole('button', { name: /Pour the slab/ });
    fireEvent.dragStart(bar, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-14'), { dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(puts().at(-1)!.body).toEqual({ startDate: '2026-10-14', dueDate: '2026-10-16', expectedVersion: 3 }));
    const toast = await screen.findByRole('status', { name: /moved/i });
    expect(toast).toHaveTextContent('Moved MICO-1 to Wed 14 Oct – Fri 16 Oct.');
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(puts().at(-1)!.body).toEqual({ startDate: '2026-10-12', dueDate: '2026-10-14', expectedVersion: 4 }));
  });

  it('dragging ⚑ changes the due date alone; a start dragged past the due day is refused, in words', async () => {
    renderPage();
    const bar = await screen.findByRole('button', { name: /Pour the slab/ });
    fireEvent.dragStart(bar.querySelector('[data-grip="due"]')!, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-16'), { dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(puts().at(-1)!.body).toEqual({ dueDate: '2026-10-16', expectedVersion: 3 }));
    const again = await screen.findByRole('button', { name: /Pour the slab.*to Fri 16 Oct/ });
    fireEvent.dragStart(again.querySelector('[data-grip="start"]')!, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-20'), { dataTransfer: { getData: () => '' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The start can’t be after the due date.');
    expect(puts()).toHaveLength(1);
  });

  it('a task nobody has started, moved to start later, says it will wait (call 6)', async () => {
    renderPage();
    const bar = await screen.findByRole('button', { name: /Pour the slab/ });
    fireEvent.dragStart(bar, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-19'), { dataTransfer: { getData: () => '' } });
    expect(await screen.findByRole('status', { name: /moved/i })).toHaveTextContent('It will wait until Mon 19 Oct.');
  });

  it('Alt + → moves a focused task a day (Alt + Shift + → its due date alone)', async () => {
    renderPage();
    const bar = await screen.findByRole('button', { name: /Pour the slab/ });
    bar.focus();
    fireEvent.keyDown(bar, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(puts().at(-1)!.body).toEqual({ startDate: '2026-10-13', dueDate: '2026-10-15', expectedVersion: 3 }));
    const moved = await screen.findByRole('button', { name: /Pour the slab.*from Tue 13 Oct/ });
    fireEvent.keyDown(moved, { key: 'ArrowRight', altKey: true, shiftKey: true });
    await waitFor(() => expect(puts().at(-1)!.body).toEqual({ dueDate: '2026-10-16', expectedVersion: 4 }));
  });
});

describe('reviewer fixes and rulings', () => {
  it('R11: the automatic start (the moment a task was made) draws no bar — the task sits on its due day', async () => {
    tasks = [task({ id: 'auto', key: 'MICO-9', title: 'Made last week', startDate: '2026-10-05T07:13:41.512Z', dueDate: '2026-10-14T00:00:00.000Z' })];
    renderPage();
    const chip = await screen.findByRole('button', { name: /Made last week/ });
    expect(chip).toHaveAttribute('data-role', 'single');
    expect(day('2026-10-14')).toContainElement(chip);
  });

  it('R12: a ⚑ dropped on an hour sets the due day (due dates are days on this site)', async () => {
    renderPage('/calendar?view=week&date=2026-10-13');
    const bar = await screen.findByRole('button', { name: /Pour the slab/ });
    fireEvent.dragStart(bar.querySelector('[data-grip="due"]')!, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(hours('2026-10-15'), { clientY: 15 * HOUR_PX, dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(puts().at(-1)!.body).toEqual({ dueDate: '2026-10-15', expectedVersion: 3 }));
  });

  it('a late task dragged from today’s list moves from its own due day (also one due before the month)', async () => {
    wide();
    overdue = [task({ id: 'late', key: 'MICO-7', title: 'Late report', dueDate: '2026-09-28T00:00:00.000Z' })];
    tasks = [...tasks, task({ id: 'late2', key: 'MICO-8', title: 'Late too', dueDate: '2026-10-05T00:00:00.000Z' })];
    overdue.push(tasks.at(-1)!);
    renderPage();
    const aside = await screen.findByRole('complementary', { name: 'The chosen day' });
    await screen.findAllByRole('button', { name: /Pour the slab/ });
    const row = (await within(aside).findByRole('button', { name: /Late report/ })).closest('li')!;
    fireEvent.dragStart(row, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-14'), { dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(puts().at(-1)).toMatchObject({ url: expect.stringContaining('/tasks/late'), body: { dueDate: '2026-10-14', expectedVersion: 3 } }));
    const row2 = within(aside).getByRole('button', { name: /Late too/ }).closest('li')!;
    fireEvent.dragStart(row2, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(day('2026-10-15'), { dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(puts().at(-1)).toMatchObject({ url: expect.stringContaining('/tasks/late2'), body: { dueDate: '2026-10-15', expectedVersion: 3 } }));
  });

  it('a task’s “Starts” copy in a phone’s week list is not dragged (it would move by the days from its due day)', async () => {
    const mm = vi.fn((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
    vi.stubGlobal('matchMedia', mm);
    Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
    renderPage('/calendar?view=week&date=2026-10-13');
    const copies = await screen.findAllByRole('button', { name: /Pour the slab/ });
    const starts = copies.filter((c) => c.closest('[data-day="2026-10-12"]'));
    const dues = copies.filter((c) => c.closest('[data-day="2026-10-14"]'));
    expect(starts.length).toBe(1);
    expect(starts[0]).not.toHaveAttribute('draggable', 'true');
    expect(dues[0]).toHaveAttribute('draggable', 'true');
  });
});

describe('week and day hours, planned time, meetings (owner 2)', () => {
  it('shows working hours lit, a meeting with its times and 👥, planned time hatched, a bell at a reminder’s time', async () => {
    blocks = [{ id: 'b1', taskId: 'bar', taskKey: 'MICO-1', taskTitle: 'Pour the slab', projectId: 'p1', userId: 'me', userName: 'Mo Me', plannedById: 'me', plannedByName: 'Mo Me', startAt: '2026-10-13T05:00:00.000Z', endAt: '2026-10-13T06:30:00.000Z', mine: true, canChange: true, done: false }];
    reminders = [{ id: 'r1', taskId: 'bar', taskKey: 'MICO-1', taskTitle: 'Pour the slab', projectId: 'p1', fireAt: '2026-10-13T04:00:00.000Z', at: null, anchor: 'due', offsetMinutes: 1440, setById: 'u2', setByName: 'Mona Said', state: 'wait', snoozedUntil: null }];
    meetings = [{ id: 'm1', title: 'Site walk', status: 'SCHEDULED', projectId: 'p1', organizerId: 'me', location: 'Rig 3', onlineLink: null, startAt: '2026-10-13T07:00:00.000Z', endAt: '2026-10-13T08:00:00.000Z', recurrenceRule: null, recurrenceParentId: null, invitesSentAt: '2026-10-01T00:00:00.000Z', attendeeCount: 6 }];
    renderPage('/calendar?view=week&date=2026-10-13');
    const col = await screen.findByRole('list', { name: 'Tuesday 13 October, by the hour' });
    expect(within(col).getByRole('button', { name: /^Planned: MICO-1 Pour the slab, Tue 13 Oct 09:00–10:30/ })).toBeInTheDocument();
    expect(within(hours('2026-10-13')).getByRole('link', { name: /Site walk, meeting, 11:00 – 12:00/ })).toHaveAttribute('draggable', 'true');
    expect(within(hours('2026-10-13')).getByRole('img', { name: /Reminder Tue 13 Oct 08:00: MICO-1 Pour the slab, set by Mona Said/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'All day' })).toBeInTheDocument();
  });

  it('a task dragged into an hour plans an hour of my time on it — its dates stay; Undo removes it', async () => {
    renderPage('/calendar?view=week&date=2026-10-13');
    const bar = await screen.findByRole('button', { name: /Pour the slab/ });
    fireEvent.dragStart(bar, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(hours('2026-10-14'), { clientY: 10 * HOUR_PX, dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'POST', url: expect.stringContaining('/tasks/bar/work-blocks'), body: { startAt: '2026-10-14T06:00:00.000Z', endAt: '2026-10-14T07:00:00.000Z' } })));
    expect(puts()).toHaveLength(0);
    const toast = await screen.findByRole('status', { name: /planned/i });
    expect(toast).toHaveTextContent('Planned MICO-1: Wed 14 Oct, 10:00–11:00.');
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'DELETE', url: expect.stringContaining('/tasks/bar/work-blocks/b-new') })));
  });

  it('planned time moves by drag (its length kept) and resizes from its lower edge, each with Undo; × removes it', async () => {
    blocks = [{ id: 'b1', taskId: 'bar', taskKey: 'MICO-1', taskTitle: 'Pour the slab', projectId: 'p1', userId: 'me', userName: 'Mo Me', plannedById: 'me', plannedByName: 'Mo Me', startAt: '2026-10-13T05:00:00.000Z', endAt: '2026-10-13T06:00:00.000Z', mine: true, canChange: true, done: false }];
    renderPage('/calendar?view=week&date=2026-10-13');
    const block = await screen.findByRole('button', { name: /^Planned: MICO-1/ });
    fireEvent.dragStart(block, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(hours('2026-10-15'), { clientY: 13 * HOUR_PX, dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', url: expect.stringContaining('/work-blocks/b1'), body: { startAt: '2026-10-15T09:00:00.000Z', endAt: '2026-10-15T10:00:00.000Z' } })));
    const grip = document.querySelector('[data-block="b1"] [data-grip="end"]')!;
    fireEvent.dragStart(grip, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(hours('2026-10-15'), { clientY: 11 * HOUR_PX, dataTransfer: { getData: () => '' } });
    await waitFor(() => expect(requests.filter((r) => r.method === 'PUT' && r.url.includes('/work-blocks/b1')).at(-1)!.body).toMatchObject({ endAt: expect.any(String) }));
    await userEvent.click(screen.getByRole('button', { name: /Remove planned time: MICO-1/ }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'DELETE', url: expect.stringContaining('/work-blocks/b1') })));
    expect(await screen.findByRole('status', { name: /removed/i })).toHaveTextContent(/Undo/);
  });

  it('a meeting dragged by its organizer asks first: “Send the updated invitation to 6 people?”', async () => {
    meetings = [{ id: 'm1', title: 'Site walk', status: 'SCHEDULED', projectId: 'p1', organizerId: 'me', location: 'Rig 3', onlineLink: null, startAt: '2026-10-13T07:00:00.000Z', endAt: '2026-10-13T08:00:00.000Z', recurrenceRule: null, recurrenceParentId: null, invitesSentAt: '2026-10-01T00:00:00.000Z', attendeeCount: 6 }];
    renderPage('/calendar?view=week&date=2026-10-13');
    const m = await screen.findByRole('link', { name: /Site walk/ });
    fireEvent.dragStart(m, { dataTransfer: { setData: () => {}, effectAllowed: 'move' } });
    fireEvent.drop(hours('2026-10-14'), { clientY: 9 * HOUR_PX, dataTransfer: { getData: () => '' } });
    const ask = await screen.findByRole('dialog', { name: 'Move the meeting' });
    expect(ask).toHaveTextContent('Send the updated invitation to 6 people?');
    expect(requests.some((r) => r.method === 'PUT' && r.url.includes('/meetings/m1'))).toBe(false);
    await userEvent.click(within(ask).getByRole('button', { name: 'Move and send' }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', url: expect.stringContaining('/meetings/m1'), body: { startAt: '2026-10-14T05:00:00.000Z', endAt: '2026-10-14T06:00:00.000Z' } })));
    expect(await screen.findByRole('status', { name: /moved/i })).toHaveTextContent('The updated invitation went to 6 people.');
  });

  it('someone else’s meeting is not draggable', async () => {
    meetings = [{ id: 'm2', title: 'Their call', status: 'SCHEDULED', projectId: 'p1', organizerId: 'u2', location: null, onlineLink: null, startAt: '2026-10-13T07:00:00.000Z', endAt: '2026-10-13T08:00:00.000Z', recurrenceRule: null, recurrenceParentId: null, invitesSentAt: null }];
    renderPage('/calendar?view=week&date=2026-10-13');
    expect(await screen.findByRole('link', { name: /Their call/ })).toHaveAttribute('draggable', 'false');
  });

  it('the Day view: one day’s hours', async () => {
    renderPage('/calendar?view=day&date=2026-10-13');
    expect(await screen.findByRole('heading', { level: 2, name: 'Tuesday 13 October 2026' })).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Tuesday 13 October, by the hour' });
    expect(hours('2026-10-13')).not.toBeNull();
    expect(hours('2026-10-14')).toBeNull();
  });
});

describe('the split view, holidays and reminders', () => {
  it('on a wide screen: the calendar left, the chosen day’s list right; Split | Full is remembered', async () => {
    wide();
    renderPage();
    const aside = await screen.findByRole('complementary', { name: 'The chosen day' });
    expect(within(aside).getByRole('heading', { name: 'Saturday 10 October' })).toBeInTheDocument();
    await screen.findAllByRole('button', { name: /Pour the slab/ });
    await userEvent.click(within(day('2026-10-12')).getByRole('button', { name: /^Mon 12 Oct/ }));
    expect(within(aside).getByRole('heading', { name: 'Monday 12 October' })).toBeInTheDocument();
    // Starting ▶ that day, with its quick actions.
    expect(within(aside).getByRole('button', { name: /^Starting/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(aside).getByRole('button', { name: /^MICO-1 Pour the slab/ })).toBeInTheDocument();
    for (const name of ['Complete MICO-1', 'Plan time for MICO-1', 'Remind me about MICO-1', 'Open MICO-1']) expect(within(aside).getByRole('button', { name })).toBeInTheDocument();
    // A day in between lists it under "Under way" (folded).
    await userEvent.click(within(day('2026-10-13')).getByRole('button', { name: /^Tue 13 Oct/ }));
    const underway = within(aside).getByRole('button', { name: /^Under way/ });
    expect(underway).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(underway);
    expect(within(aside).getByRole('button', { name: /^MICO-1 Pour the slab/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Full' }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', url: expect.stringContaining('/calendar/preferences'), body: { layout: 'full' } })));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'The chosen day' })).not.toBeInTheDocument());
  });

  it('a holiday is shaded and named; a weekend day shaded', async () => {
    daysOff = [{ day: '2026-10-15', name: 'Founders Day' }];
    renderPage();
    await screen.findByRole('button', { name: /Pour the slab/ });
    await waitFor(() => expect(day('2026-10-15')).toHaveAttribute('data-day-off', 'holiday'));
    expect(within(day('2026-10-15')).getByText('Founders Day')).toBeInTheDocument();
    expect(within(day('2026-10-15')).getByRole('button', { name: /^Thu 15 Oct.*Founders Day \(a day off\)/ })).toBeInTheDocument();
    expect(day('2026-10-16')).toHaveAttribute('data-day-off', 'weekend'); // Friday
  });

  it('a reminder is a bell on its day; “Remind me” adds one (a day before it’s due)', async () => {
    reminders = [{ id: 'r1', taskId: 'bar', taskKey: 'MICO-1', taskTitle: 'Pour the slab', projectId: 'p1', fireAt: '2026-10-13T04:00:00.000Z', at: null, anchor: 'due', offsetMinutes: 1440, setById: 'me', setByName: null, state: 'wait', snoozedUntil: null }];
    renderPage();
    await screen.findByRole('button', { name: /Pour the slab/ });
    expect(await within(day('2026-10-13')).findByRole('button', { name: '1 reminder on Tue 13 Oct' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Pour the slab/ }));
    const d = await screen.findByRole('dialog', { name: /Pour the slab/ });
    await userEvent.click(within(d).getByRole('button', { name: 'Remind me' }));
    const r = await screen.findByRole('dialog', { name: 'Reminders: MICO-1' });
    await userEvent.click(within(r).getByRole('radio', { name: '1 day before it’s due' }));
    await userEvent.click(within(r).getByRole('button', { name: 'Add reminder' }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'POST', url: expect.stringContaining('/tasks/bar/reminders'), body: { anchor: 'due', offsetMinutes: 1440 } })));
  });

  it('Show: planned time, reminders, meetings and tasks each hidden or shown, remembered', async () => {
    blocks = [{ id: 'b1', taskId: 'bar', taskKey: 'MICO-1', taskTitle: 'Pour the slab', projectId: 'p1', userId: 'me', userName: 'Mo Me', plannedById: 'me', plannedByName: 'Mo Me', startAt: '2026-10-13T05:00:00.000Z', endAt: '2026-10-13T06:00:00.000Z', mine: true, canChange: true, done: false }];
    renderPage();
    expect(await screen.findByRole('button', { name: /^Planned: MICO-1/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^show/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Planned time' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Planned: MICO-1/ })).not.toBeInTheDocument());
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', body: { show: { blocks: false } } })));
  });
});
