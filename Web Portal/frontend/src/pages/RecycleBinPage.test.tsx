import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecycleBinPage } from './RecycleBinPage';
import { useAuthStore } from '../stores/auth-store';
import type { BinRow } from '../api/recycle-bin';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const project = { id: 'p1', name: 'Rig works', code: 'RIG', color: '#2F6FAE', icon: null, imageUrl: null };
const row = (id: string, over: Partial<BinRow> = {}): BinRow => ({
  id,
  key: `RIG-${id.slice(1)}`,
  title: `Task ${id}`,
  project,
  status: { name: 'Doing', category: 'IN_PROGRESS' },
  deletedAt: '2026-11-03T06:00:00.000Z',
  deletedBy: { id: 'u-ali', name: 'Ali Hassan' },
  binExpiresAt: '2027-01-02T20:00:00.000Z',
  daysLeft: 53,
  assignees: [{ id: 'u-omar', name: 'Omar Ahmed' }],
  batch: null,
  ...over,
});

let rows: BinRow[] = [];
let canErase = false;
let status = 200;
let calls: { url: string; method: string; body?: unknown }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T06:00:00.000Z'));
  rows = [row('t12'), row('t7', { deletedBy: null, daysLeft: 5, title: 'Old pump' }), row('t9', { daysLeft: 0, batch: { id: 'b1', size: 2 } })];
  canErase = false;
  status = 200;
  calls = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/config')) return json({ data: { timeZone: 'Asia/Muscat', productName: '', companyName: '', serverTime: '' } });
      if (url.includes('/recycle-bin/restore')) return json({ data: { restored: [{ id: 't12', key: 'RIG-12', title: '', projectId: 'p1' }, { id: 't7', key: 'RIG-7', title: '', projectId: 'p1' }], notRestored: [] } });
      if (url.includes('/recycle-bin/erase')) return json({ data: { erased: [{ id: 't12', key: 'RIG-12', title: 'Task t12' }], notErased: [] } });
      if (url.includes('/recycle-bin')) {
        if (status === 403) return json({ error: { code: 'FORBIDDEN', message: 'The Recycle Bin is for administrators and the people who run a project.' } }, 403);
        return json({ data: rows, meta: { total: rows.length, offset: 0, limit: 50, canErase, facets: { projects: [project], deleters: [{ id: 'u-ali', name: 'Ali Hassan' }, { id: 'unknown', name: 'Unknown' }] } } });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let where = '';
function Where() {
  const l = useLocation();
  where = `${l.pathname}${l.search}`;
  return null;
}
function renderPage(path = '/recycle-bin') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/recycle-bin" element={<RecycleBinPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const listCalls = () => calls.filter((c) => c.method === 'GET' && /\/recycle-bin(\?|$)/.test(c.url));

describe('RecycleBinPage', () => {
  it('lists each deleted task: number and title, project, who deleted it (Unknown when not recorded), when, days left in colour, status', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Recycle Bin' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Deleted tasks' });
    const first = within(table).getByText('Task t12').closest('tr')!;
    expect(first).toHaveTextContent('RIG-12');
    expect(first).toHaveTextContent('Rig works');
    expect(first).toHaveTextContent('Ali Hassan');
    expect(first).toHaveTextContent('3 Nov');
    expect(within(first).getByText('53 days left')).toHaveAttribute('data-tone', 'neutral');
    const unknown = within(table).getByText('Old pump').closest('tr')!;
    expect(unknown).toHaveTextContent('Unknown');
    expect(within(unknown).getByText('5 days left')).toHaveAttribute('data-tone', 'warning');
    const last = within(table).getByText('Task t9').closest('tr')!;
    expect(within(last).getByText('Erased tonight')).toHaveAttribute('data-tone', 'danger');
    expect(last).toHaveTextContent('Deleted with its series (2 tasks)');
    // Delete forever is for administrators only.
    expect(screen.queryByRole('button', { name: /forever/ })).toBeNull();
    // Phones get cards with the same rows.
    expect(screen.getByRole('list', { name: 'Deleted tasks' }).querySelectorAll('[data-bin-card]')).toHaveLength(3);
  });

  it('opened from a project page, it is filtered to that project; the search asks once typing pauses', async () => {
    renderPage('/recycle-bin?project=p1');
    await screen.findByRole('table', { name: 'Deleted tasks' });
    expect(listCalls()[0]!.url).toContain('project=p1');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search deleted tasks' }), 'pump');
    await waitFor(() => expect(listCalls().some((c) => c.url.includes('q=pump'))).toBe(true), { timeout: 2000 });
    expect(where).toContain('q=pump');
    await userEvent.click(screen.getByRole('checkbox', { name: '7 days or less left' }));
    await waitFor(() => expect(listCalls().at(-1)!.url).toContain('soon=1'));
  });

  it('select many, Restore: one request, and says what came back', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Deleted tasks' });
    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select RIG-12' }));
    await userEvent.click(within(table).getByRole('checkbox', { name: 'Select RIG-7' }));
    const bar = screen.getByRole('region', { name: 'Selected tasks' });
    expect(bar).toHaveTextContent('2 selected');
    await userEvent.click(within(bar).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Restored 2 tasks.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/restore'))!.body).toEqual({ taskIds: ['t12', 't7'], wholeBatch: false });
  });

  it('a task deleted with its series: Restore asks — all of them, or only this one', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Deleted tasks' });
    await userEvent.click(within(table).getByRole('button', { name: 'Restore RIG-9' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Restore RIG-9?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore all 2' }));
    await waitFor(() => expect(calls.find((c) => c.url.includes('/restore'))!.body).toEqual({ taskIds: ['t9'], wholeBatch: true }));
  });

  it('an administrator may delete forever, after confirming it can’t be undone', async () => {
    canErase = true;
    renderPage();
    const table = await screen.findByRole('table', { name: 'Deleted tasks' });
    await userEvent.click(within(table).getByRole('button', { name: 'Delete RIG-12 forever' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete forever?' });
    expect(dialog).toHaveTextContent('This can’t be undone.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    expect(await screen.findByText('Deleted RIG-12 forever.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/erase'))!.body).toEqual({ taskIds: ['t12'] });
  });

  it('someone who runs no project is told the bin isn’t theirs', async () => {
    status = 403;
    renderPage();
    expect(await screen.findByText('The Recycle Bin is for administrators and the people who run a project.')).toBeInTheDocument();
  });

  it('an empty bin says what it is for', async () => {
    rows = [];
    renderPage();
    expect(await screen.findByText('The Recycle Bin is empty')).toBeInTheDocument();
    expect(screen.getByText('Deleted tasks are kept here for 60 days, then erased.')).toBeInTheDocument();
  });
});
