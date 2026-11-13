import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MeetingSeriesPage } from './MeetingSeriesPage';
import { useAuthStore } from '../stores/auth-store';

// 1.23 The Series page: its meetings (coming up / earlier), open action items, New meeting in this
// series, Add existing meetings, Remove a meeting, Rename, Merge, Delete — as the person may.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString();
const page = (over: Record<string, unknown> = {}) => ({
  series: { id: 's1', name: 'Monthly site review', projectId: 'p1', companyId: null, auto: false, createdById: 'me' },
  meetings: [
    { id: 'm1', title: 'Monthly 1', status: 'COMPLETED', startAt: day(-60), endAt: null, timeZone: null, minutesFinal: true, repeats: false },
    { id: 'm2', title: 'Monthly 2', status: 'COMPLETED', startAt: day(-30), endAt: null, timeZone: null, minutesFinal: false, repeats: false },
    { id: 'm3', title: 'Monthly 3', status: 'SCHEDULED', startAt: day(5), endAt: null, timeZone: null, minutesFinal: false, repeats: false },
  ],
  openActionItems: [
    { id: 'ai1', description: 'Send the drawings', assigneeId: 'u2', assigneeName: 'Bilal Said', status: 'OPEN', priority: 'NORMAL', dueDate: null, overdue: false, taskId: null, taskKey: null, createdById: 'me', meeting: { id: 'm1', title: 'Monthly 1', startAt: day(-60) } },
  ],
  canManage: true, canDelete: true, keepsRepeat: false, canAdd: true, removable: ['m1', 'm2', 'm3'],
  mergeOptions: [{ id: 's2', name: 'Old schedule' }],
  ...over,
});
let calls: { url: string; method: string; body?: Record<string, unknown> }[];
let pageData: ReturnType<typeof page> | null;

beforeEach(() => {
  calls = [];
  pageData = page();
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, method, body });
    if (u.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: new Date().toISOString() } });
    if (u.endsWith('/meeting-series/s1') && method === 'GET') return pageData ? json({ data: pageData }) : json({ error: { code: 'NOT_FOUND', message: 'Series not found.' } }, 404);
    if (u.endsWith('/meeting-series/s1') && method === 'PATCH') return json({ data: { id: 's1', name: body?.name } });
    if (u.endsWith('/meeting-series/s1/candidates')) return json({ data: [{ id: 'm9', title: 'Kick-off', status: 'SCHEDULED', startAt: day(-90), endAt: null, timeZone: null, minutesFinal: false, repeats: false }] });
    if (u.endsWith('/meeting-series/s1/prefill')) return json({ data: { seriesId: 's1', seriesName: 'Monthly site review', title: 'Monthly site review', projectId: 'p1', companyId: null, location: null, onlineLink: null, durationMinutes: 60, description: null, people: [], agendaItems: [] } });
    if (method === 'DELETE' || method === 'POST') return new Response(null, { status: 204 });
    if (u.endsWith('/projects')) return json({ data: [{ id: 'p1', name: 'Pump Station', code: 'PUMP', status: 'ACTIVE' }] });
    if (u.endsWith('/users/directory')) return json({ data: [] });
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
    <MemoryRouter initialEntries={['/meetings/series/s1']}>
      <QueryClientProvider client={qc}>
        <Routes>
          <Route path="/meetings/series/:id" element={<MeetingSeriesPage />} />
          <Route path="/meetings" element={<p>Meetings list</p>} />
          <Route path="/meetings/:id" element={<p>A meeting</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the Series page', () => {
  it('shows the series, its meetings to come and earlier ones, and its open action items', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Monthly site review' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Pump Station')).toBeInTheDocument());
    const upcoming = screen.getByRole('heading', { name: /^Coming up/ }).closest('section')!;
    expect(within(upcoming).getByRole('link', { name: /Monthly 3/ })).toHaveAttribute('href', '/meetings/m3');
    const earlier = screen.getByRole('heading', { name: /^Earlier/ }).closest('section')!;
    // Most recent first.
    expect(within(earlier).getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('Monthly 2'), expect.stringContaining('Monthly 1')]);
    expect(within(earlier).getByRole('link', { name: /Monthly 1/ })).toHaveTextContent('Minutes final');
    const items = screen.getByRole('heading', { name: /^Open action items/ }).closest('section')!;
    expect(items).toHaveTextContent('Send the drawings');
  });

  it('removes a meeting from the series after asking', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Remove Monthly 2, .+, from the series$/ }));
    const ask = await screen.findByRole('alertdialog', { name: 'Remove from the series?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Remove from series' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/meeting-series/s1/meetings/m2'))).toBe(true));
  });

  it('adds existing meetings from the picker', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add existing meetings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add meetings to “Monthly site review”' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Kick-off/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add meeting' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/meeting-series/s1/meetings'))?.body).toEqual({ meetingIds: ['m9'] }));
  });

  it('renames, merges and deletes from its menu', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'More series actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    const rename = await screen.findByRole('dialog', { name: 'Rename the series' });
    await userEvent.clear(within(rename).getByLabelText(/series name/i));
    await userEvent.type(within(rename).getByLabelText(/series name/i), 'Acme monthly');
    await userEvent.click(within(rename).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Acme monthly' }));

    await userEvent.click(screen.getByRole('button', { name: 'More series actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Merge another series into this one…' }));
    const merge = await screen.findByRole('dialog', { name: 'Merge another series into this one' });
    expect(within(merge).getByRole('radio', { name: 'Old schedule' })).toBeChecked();
    await userEvent.click(within(merge).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/meeting-series/s1/merge'))?.body).toEqual({ seriesId: 's2' }));

    await userEvent.click(screen.getByRole('button', { name: 'More series actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete series…' }));
    const del = await screen.findByRole('alertdialog', { name: 'Delete this series?' });
    expect(del).toHaveTextContent('its meetings stay as they are');
    await userEvent.click(within(del).getByRole('button', { name: 'Delete series' }));
    expect(await screen.findByText('Meetings list')).toBeInTheDocument();
  });

  it('opens the new-meeting form pre-filled for "New meeting in this series"', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '+ New meeting in this series' }));
    expect(await screen.findByRole('dialog', { name: 'New meeting' })).toHaveTextContent('In the series “Monthly site review”');
  });

  it('offers only what the person may do: no buttons for someone who may only look', async () => {
    pageData = page({ canManage: false, canDelete: false, canAdd: false, removable: [], mergeOptions: [] });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Monthly site review' });
    expect(screen.queryByRole('button', { name: 'More series actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new meeting in this series/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove .* from the series/i })).not.toBeInTheDocument();
  });

  it('says why a repeating meeting’s series can’t be deleted', async () => {
    pageData = page({ canDelete: false, keepsRepeat: true });
    renderPage();
    expect(await screen.findByText(/always in a series — so it can’t be deleted/)).toBeInTheDocument();
  });

  it('says plainly when the series isn’t there for this person', async () => {
    pageData = null;
    renderPage();
    expect(await screen.findByText('Series not found')).toBeInTheDocument();
  });
});
