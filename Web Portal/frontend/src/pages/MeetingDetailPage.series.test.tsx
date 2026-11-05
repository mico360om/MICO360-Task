import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MeetingDetailPage } from './MeetingDetailPage';
import { useAuthStore } from '../stores/auth-store';

// 1.23 Meeting series on the meeting page: the series line under the title, the Series section, "Open
// from earlier meetings" (the same items: their status changes everywhere), Add to / Remove from series.
vi.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, emit: () => {}, connect: () => {}, disconnect: () => {} }) }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const THIS_YEAR = new Date().getUTCFullYear();
const at = (month: number, day: number, year = THIS_YEAR) => new Date(Date.UTC(year, month - 1, day, 6)).toISOString();

const meeting = (over: Record<string, unknown> = {}) => ({
  id: 'm3', title: 'Monthly 3', description: null, category: null, status: 'SCHEDULED', projectId: 'p1', organizerId: 'me',
  location: null, onlineLink: null, startAt: at(11, 3), endAt: null, timeZone: 'Asia/Muscat', recurrenceRule: null, recurrenceParentId: null,
  templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: 'me', createdAt: '', updatedAt: '', canEdit: true,
  seriesId: 's1', ...over,
});
const series = (over: Record<string, unknown> = {}) => ({
  series: { id: 's1', name: 'Monthly OXY review', projectId: 'p1', companyId: null, auto: false },
  meetings: [
    { id: 'm1', title: 'Monthly 1', status: 'COMPLETED', startAt: at(9, 1), endAt: null, timeZone: null, minutesFinal: true, repeats: false },
    { id: 'm2', title: 'Monthly 2', status: 'COMPLETED', startAt: at(10, 6), endAt: null, timeZone: null, minutesFinal: false, repeats: false },
    { id: 'm3', title: 'Monthly 3', status: 'SCHEDULED', startAt: at(11, 3), endAt: null, timeZone: null, minutesFinal: false, repeats: false, current: true },
    { id: 'm4', title: 'Monthly 4', status: 'SCHEDULED', startAt: at(12, 1), endAt: null, timeZone: null, minutesFinal: false, repeats: false },
  ],
  position: 3, total: 4,
  previous: { id: 'm2', title: 'Monthly 2', startAt: at(10, 6) },
  next: { id: 'm4', title: 'Monthly 4', startAt: at(12, 1) },
  openFromEarlier: [
    { id: 'ai1', description: 'Send the drawings', assigneeId: 'u2', assigneeName: 'Bilal Said', status: 'OPEN', priority: 'NORMAL', dueDate: '2026-10-20T00:00:00.000Z', overdue: true, taskId: null, taskKey: null, createdById: 'me', meeting: { id: 'm1', title: 'Monthly 1', startAt: at(9, 1) } },
  ],
  canManage: true, canRemove: true, keepsRepeat: false,
  ...over,
});

let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let meetingData: ReturnType<typeof meeting>;
let seriesData: ReturnType<typeof series> | null;
let agendaData: unknown[];

beforeEach(() => {
  calls = [];
  meetingData = meeting();
  seriesData = series();
  agendaData = [];
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/meetings/m3') && method === 'GET') return json({ data: meetingData });
    if (u.endsWith('/meetings/m3/series')) return json({ data: seriesData });
    if (u.endsWith('/meetings/m3/agenda')) return json({ data: agendaData });
    if (u.endsWith('/meetings/m3/series-options')) return json({ data: { canChange: true, repeats: false, familySize: 1, current: null, series: [{ id: 's9', name: 'Board meetings' }] } });
    if (u.endsWith('/meeting-series') && method === 'POST') return json({ data: { id: 's2', name: body?.name } }, 201);
    if (u.includes('/meeting-series/') && method === 'POST') return new Response(null, { status: 204 });
    if (u.includes('/action-items/') && method === 'PATCH') return json({ data: { id: 'ai1', status: body?.status } });
    if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', name: 'Falcon CRM', code: 'FAL' }] });
    if (u.endsWith('/users/directory')) return json({ data: [{ id: 'me', username: 'me', firstName: 'Me', lastName: 'Myself' }] });
    return json({ data: [] });
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/meetings/m3']}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
          <Route path="/meetings/series/:id" element={<p>Series page</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('a meeting in a series', () => {
  it('says its series, where it sits, and links to the previous and next meetings', async () => {
    renderPage();
    const nav = await screen.findByRole('navigation', { name: 'Meeting series' });
    expect(nav).toHaveTextContent('Series: Monthly OXY review');
    expect(nav).toHaveTextContent('3 of 4');
    expect(within(nav).getByRole('link', { name: 'Monthly OXY review' })).toHaveAttribute('href', '/meetings/series/s1');
    expect(within(nav).getByRole('link', { name: /^previous \(6 oct\): monthly 2/i })).toHaveAttribute('href', '/meetings/m2');
    expect(within(nav).getByRole('link', { name: /^next \(1 dec\): monthly 4/i })).toHaveAttribute('href', '/meetings/m4');
  });

  it('shows only the series name to someone who can open just this meeting', async () => {
    seriesData = series({ meetings: [series().meetings[2]], position: null, total: 1, previous: null, next: null, openFromEarlier: [], canRemove: false });
    renderPage();
    const nav = await screen.findByRole('navigation', { name: 'Meeting series' });
    expect(nav).toHaveTextContent('Series: Monthly OXY review');
    expect(nav).not.toHaveTextContent(/of|Previous|Next/);
  });

  it('lists the series’ meetings — earlier ones, this one marked, those to come — with Minutes final', async () => {
    renderPage();
    const section = (await screen.findByRole('heading', { name: /^Series/ })).closest('section')!;
    expect(within(section).getByText('Earlier')).toBeInTheDocument();
    expect(within(section).getByText('Coming up')).toBeInTheDocument();
    const current = section.querySelector('[aria-current="page"]')!;
    expect(current).toHaveTextContent('Monthly 3');
    expect(current).toHaveTextContent('This meeting');
    expect(within(section).getByRole('link', { name: /Monthly 1/ })).toHaveTextContent('Minutes final');
    expect(within(section).getByRole('link', { name: /open series/i })).toHaveAttribute('href', '/meetings/series/s1');
  });

  it('shows the open items of earlier meetings, and changes one’s status on the item itself', async () => {
    renderPage();
    const section = (await screen.findByRole('heading', { name: /open from earlier meetings/i })).closest('section')!;
    expect(section).toHaveTextContent('Send the drawings');
    expect(section).toHaveTextContent('Bilal Said');
    expect(section).toHaveTextContent('overdue');
    expect(within(section).getByRole('link', { name: /^from 1 sep: monthly 1/i })).toHaveAttribute('href', '/meetings/m1');
    await userEvent.click(within(section).getByRole('button', { name: /status for send the drawings/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'Completed' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/action-items/ai1'))?.body).toEqual({ status: 'COMPLETED' }));
  });

  it('takes the meeting out of the series after asking', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /more meeting actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from series…' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Remove from the series?' });
    expect(ask).toHaveTextContent('This meeting leaves “Monthly OXY review”');
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove from series' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/meeting-series/s1/meetings/m3'))).toBe(true));
    expect(await screen.findByText('Removed from the series.')).toBeInTheDocument();
  });
});

describe('a meeting in no series', () => {
  it('can be added to one of its project’s series, or to a new one named after it', async () => {
    meetingData = meeting({ seriesId: null });
    seriesData = null;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /more meeting actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to a series…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add to a series' });
    await within(dialog).findByRole('radio', { name: 'Board meetings' });
    expect(within(dialog).getByRole('radio', { name: 'New series…' })).toBeChecked();
    expect(within(dialog).getByLabelText(/series name/i)).toHaveValue('Monthly 3');
    await userEvent.clear(within(dialog).getByLabelText(/series name/i));
    await userEvent.type(within(dialog).getByLabelText(/series name/i), 'Monthly OXY review');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to series' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/meeting-series'))?.body).toEqual({ name: 'Monthly OXY review', meetingId: 'm3', wholeFamily: false }));
    expect(await screen.findByText('Added to the series “Monthly OXY review”.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Meeting series' })).not.toBeInTheDocument();
  });

  it('adds it to an existing series', async () => {
    meetingData = meeting({ seriesId: null });
    seriesData = null;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /more meeting actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to a series…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add to a series' });
    await userEvent.click(await within(dialog).findByRole('radio', { name: 'Board meetings' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to series' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/meeting-series/s9/meetings'))?.body).toEqual({ meetingIds: ['m3'] }));
  });
});

describe('review fixes (5 Nov)', () => {
  it('a repeating meeting in its own automatic series can still be added to another series', async () => {
    seriesData = series({
      series: { id: 's1', name: 'Weekly site', projectId: 'p1', companyId: null, auto: true },
      meetings: series().meetings.map((m) => ({ ...m, repeats: true })),
    });
    renderPage();
    await screen.findByRole('navigation', { name: 'Meeting series' });
    await userEvent.click(screen.getByRole('button', { name: /more meeting actions/i }));
    expect(screen.getByRole('menuitem', { name: 'Add to a series…' })).toBeInTheDocument();
  });

  it('not for a meeting in a series made by hand (it is taken out first)', async () => {
    renderPage();
    await screen.findByRole('navigation', { name: 'Meeting series' });
    await userEvent.click(screen.getByRole('button', { name: /more meeting actions/i }));
    expect(screen.queryByRole('menuitem', { name: 'Add to a series…' })).not.toBeInTheDocument();
  });

  it('lists the series in date order with this meeting in its place, even when later meetings are past too', async () => {
    const now = Date.now();
    const day = (n: number) => new Date(now + n * 86_400_000).toISOString();
    meetingData = meeting({ id: 'm3', startAt: day(-40) });
    seriesData = series({
      meetings: [
        { id: 'm1', title: 'Monthly 1', status: 'COMPLETED', startAt: day(-70), endAt: null, timeZone: null, minutesFinal: false, repeats: false },
        { id: 'm3', title: 'Monthly 3', status: 'COMPLETED', startAt: day(-40), endAt: null, timeZone: null, minutesFinal: false, repeats: false, current: true },
        { id: 'm4', title: 'Monthly 4', status: 'COMPLETED', startAt: day(-10), endAt: null, timeZone: null, minutesFinal: false, repeats: false },
        { id: 'm5', title: 'Monthly 5', status: 'SCHEDULED', startAt: day(20), endAt: null, timeZone: null, minutesFinal: false, repeats: false },
      ],
    });
    renderPage();
    const section = (await screen.findByRole('heading', { name: /^Series/ })).closest('section')!;
    const order = [...section.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(order.map((t) => /Monthly \d/.exec(t)?.[0])).toEqual(['Monthly 1', 'Monthly 3', 'Monthly 4', 'Monthly 5']);
    expect(order[1]).toContain('This meeting');
  });

  it('offers New meeting in this series only to someone who may add one', async () => {
    seriesData = series({ canAdd: false });
    renderPage();
    await screen.findByRole('heading', { name: /^Series/ });
    expect(screen.queryByRole('button', { name: /new meeting in this series/i })).not.toBeInTheDocument();
  });
});

describe('1.23 integration: the Table view of a meeting in a series', () => {
  const topic = { id: 'a1', meetingId: 'm3', title: 'Site progress', ownerId: null, expectedMinutes: 15, position: 0, completed: false, linkedPrevActionId: null, createdAt: '' };

  it('shows "Open from earlier meetings" as the table’s last group (not a section of its own), noted "from 1 Sep"', async () => {
    agendaData = [topic];
    renderPage();
    await screen.findByRole('heading', { name: /open from earlier meetings/i });
    await userEvent.click(await screen.findByRole('button', { name: 'Table view' }));
    const table = await screen.findByRole('table', { name: 'Agenda and action items' });
    expect(screen.queryByRole('heading', { name: /open from earlier meetings/i })).toBeNull();
    const groups = within(table).getAllByRole('rowgroup').slice(1);
    const last = groups.at(-1)!;
    expect(last).toHaveTextContent('Open from earlier meetings');
    expect(last).toHaveTextContent('Send the drawings');
    expect(within(last).getByRole('link', { name: /^from 1 sep: monthly 1/i })).toHaveAttribute('href', '/meetings/m1');
  });

  it('changes a carried item’s status in the table, on the item itself — and nothing else of it', async () => {
    agendaData = [topic];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Table view' }));
    const table = await screen.findByRole('table', { name: 'Agenda and action items' });
    await waitFor(() => expect(table).toHaveTextContent('Send the drawings'));
    await userEvent.click(within(table).getByRole('button', { name: 'Status of Send the drawings: Open' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Completed' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/action-items/ai1'))?.body).toEqual({ status: 'COMPLETED' }));
    expect(within(table).queryByRole('button', { name: /^Owner of Send the drawings/ })).toBeNull();
    expect(within(table).queryByRole('button', { name: /^Priority of Send the drawings/ })).toBeNull();
  });

  it('back in the List view the section is there again, after the action items', async () => {
    agendaData = [topic];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Table view' }));
    await screen.findByRole('table', { name: 'Agenda and action items' });
    await userEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(await screen.findByRole('heading', { name: /open from earlier meetings/i })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Agenda and action items' })).toBeNull();
  });
});
