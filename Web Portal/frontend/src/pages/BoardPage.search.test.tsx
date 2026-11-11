import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardPage } from './BoardPage';
import { ShortcutProvider } from '../components/shortcuts/ShortcutProvider';
import { useAuthStore } from '../stores/auth-store';
import { userStorageKey } from '../lib/user-storage';

// Board search (owner, 10 Nov): a search box at the top of the board.
vi.mock('../lib/useBoardRealtime', () => ({ useBoardRealtime: () => {} }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const project = (id: string, code: string, name: string) => ({ id, code, name, description: null, clientName: null, status: 'ACTIVE', priority: 'HIGH', color: '#8B1E1E', icon: null, imageUrl: null, createdAt: '', updatedAt: '' });
const PROJECTS = [project('p1', 'MICO', 'MICO360 Platform'), project('p2', 'OPS', 'Operations')];
const COLUMNS: Record<string, unknown[]> = {
  p1: [
    { id: 'p1-todo', projectId: 'p1', name: 'To Do', category: 'TODO', position: 0, color: '', enabled: true },
    { id: 'p1-doing', projectId: 'p1', name: 'Doing', category: 'IN_PROGRESS', position: 1, color: '', enabled: true },
    { id: 'p1-done', projectId: 'p1', name: 'Done', category: 'DONE', position: 2, color: '', enabled: true },
  ],
  p2: [{ id: 'p2-todo', projectId: 'p2', name: 'Ops To Do', category: 'TODO', position: 0, color: '', enabled: true }],
};
type T = Record<string, unknown>;
const task = (id: string, key: string, title: string, projectId: string, columnId: string, columnCategory: string, more: T = {}): T => ({
  id, key, title, description: null, projectId, columnId, columnCategory, position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', assignees: [], tags: [], ...more,
});
const BASE_TASKS = (): T[] => [
  task('t1', 'MICO-1', 'Pump overhaul', 'p1', 'p1-todo', 'TODO', { position: 0, assignees: [{ id: 'u7', name: 'Bilal Khan' }] }),
  task('t2', 'MICO-2', 'Crane hire', 'p1', 'p1-todo', 'TODO', { position: 1, description: 'Pump spares for the crane.', externalSummary: { count: 1, name: 'Salim', company: 'PDO', names: ['Salim'], companies: ['PDO'] } }),
  task('t3', 'MICO-3', 'Fence repair', 'p1', 'p1-doing', 'IN_PROGRESS', { dueDate: '2026-11-12T00:00:00.000Z' }),
  task('t4', 'MICO-12', 'Check gauges', 'p1', 'p1-doing', 'IN_PROGRESS', { position: 1, tags: [{ id: 'g1', name: 'Safety', color: '#0a0' }] }),
  task('t5', 'MICO-5', 'زيارة الموقع مع أحمد', 'p1', 'p1-doing', 'IN_PROGRESS', { position: 2 }),
  task('t6', 'OPS-1', 'Fleet pump check', 'p2', 'p2-todo', 'TODO'),
];
let TASKS: T[] = BASE_TASKS();
/** What POST /tasks answers (a task made in the New task form). */
let created: T | null = null;
let calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];

beforeEach(() => {
  TASKS = BASE_TASKS();
  created = null;
  calls = [];
  localStorage.clear();
  useAuthStore.getState().setSession({ user: { id: 'u1', email: 'a@b.c', username: 'ada', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'p1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith('/config')) return json({ data: { timeZone: 'UTC', productName: 'x', companyName: 'y', serverTime: new Date().toISOString() } });
      const cols = /\/projects\/(p\d)\/columns/.exec(u);
      if (cols) return json({ data: COLUMNS[cols[1]!] ?? [] });
      if (u.includes('/members')) return json({ data: [] });
      if (method === 'POST' && u.endsWith('/tasks')) return json({ data: created }, 201);
      if (u.includes('/tasks?')) {
        const pid = new URL(u, 'http://x').searchParams.get('projectId');
        return json({ data: pid ? TASKS.filter((t) => t.projectId === pid) : TASKS });
      }
      if (u.endsWith('/projects')) return json({ data: PROJECTS });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}
function renderPage(path = '/board') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ShortcutProvider>
          <BoardPage />
          <Where />
        </ShortcutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}
const box = () => screen.getByRole('searchbox', { name: 'Search this board' });
const cardKeys = () => Array.from(document.querySelectorAll('[data-card-key]')).map((el) => el.getAttribute('data-card-key'));
const card = (key: string) => document.querySelector<HTMLElement>(`[data-card-key="${key}"]`)!;
const column = (name: string) => screen.getByRole('region', { name });
async function ready() {
  await screen.findByText('Pump overhaul');
}

describe('Kanban board: search', () => {
  it('a search box at the top of the board; / jumps to it', async () => {
    renderPage();
    await ready();
    expect(box()).toHaveAttribute('data-page-search');
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: '/', code: 'Slash' });
    expect(box()).toHaveFocus();
  });

  it('as you type, only the matching cards show, in every column, each column saying how many of its cards', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.type(box(), 'pump');
    // By title (MICO-1) and by description (MICO-2); another project's card isn't on this board.
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-1', 'MICO-2']));
    expect(within(column('To Do')).getByText('2 of 2')).toBeInTheDocument();
    expect(within(column('Doing')).getByText('0 of 3')).toBeInTheDocument();
    // Empty columns stay (a card can still be dropped there).
    expect(within(column('Done')).getByText('0 of 0')).toBeInTheDocument();
    expect(within(column('Doing')).getByText(/no matching cards/i)).toBeInTheDocument();
    expect(screen.getByText('2 of 5 cards')).toBeInTheDocument();
  });

  it('marks the words found: in the title, and a line of the description when the word is only there', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.type(box(), 'pump');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-1', 'MICO-2']));
    expect(within(card('MICO-1')).getByText('Pump', { selector: 'mark' })).toBeInTheDocument();
    const line = within(card('MICO-2')).getByTestId('card-found');
    expect(line).toHaveTextContent('Pump spares for the crane.');
    expect(within(line).getByText('Pump', { selector: 'mark' })).toBeInTheDocument();
  });

  it('finds the people on a card, its tags and Arabic words in any spelling, and marks them', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.type(box(), 'bilal');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-1']));
    expect(within(card('MICO-1')).getByText('Bilal', { selector: 'mark' })).toBeInTheDocument();
    await user.clear(box());
    await user.type(box(), 'safety');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-12']));
    expect(within(card('MICO-12')).getByTestId('card-tags')).toHaveTextContent('Safety');
    await user.clear(box());
    await user.type(box(), 'احمد');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-5']));
    expect(within(card('MICO-5')).getByText('أحمد', { selector: 'mark' })).toBeInTheDocument();
  });

  it('a task number matches exactly, or as the number alone', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.type(box(), 'mico-12');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-12']));
    await user.clear(box());
    await user.type(box(), '1');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-1']));
    await user.type(box(), '2');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-12']));
  });

  it('✕ and Escape clear it, and the whole board is back', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    await user.type(box(), 'fence');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-3']));
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(box()).toHaveValue('');
    await waitFor(() => expect(cardKeys()).toHaveLength(5));
    expect(within(column('To Do')).queryByText(/ of /)).toBeNull();
    await user.type(box(), 'fence');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-3']));
    await user.keyboard('{Escape}');
    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
    await waitFor(() => expect(cardKeys()).toHaveLength(5));
  });

  it('the words stay in the address (?q=), so a refresh or a shared link keeps them', async () => {
    const user = userEvent.setup();
    renderPage('/board?q=fence');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-3']));
    expect(box()).toHaveValue('fence');
    expect(cardKeys()).toEqual(['MICO-3']);
    await user.clear(box());
    await user.type(box(), 'crane hire');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('q=crane+hire'));
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toContain('q='));
  });

  it('nothing found: it says so and offers to search all tasks, with the same words', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.type(box(), 'zebra crossing');
    expect(await screen.findByText(/No cards on this board match “zebra crossing”/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search all tasks' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/search?q=zebra+crossing&type=task');
  });

  // tgc: 1.24 — the "External company" filter is "Guest company" now (an older row's contacts count as guests).
  it('works with the guest company filter: both apply', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Filter by guest company' }));
    await user.click(await screen.findByRole('option', { name: 'PDO' }));
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-2']));
    await user.type(box(), 'pump');
    expect(await within(column('To Do')).findByText('1 of 1')).toBeInTheDocument();
    expect(cardKeys()).toEqual(['MICO-2']);
    await user.clear(box());
    await user.type(box(), 'overhaul');
    expect(await screen.findByText(/No cards on this board match “overhaul”/)).toBeInTheDocument();
  });

  it('works in the month view: it searches the month the board shows', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.type(box(), 'fence');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-3']));
    await user.click(screen.getByRole('button', { name: 'Month view' }));
    await screen.findByRole('group', { name: /^Month: / });
    expect(box()).toHaveValue('fence');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-3']));
    expect(calls.some((c) => c.url.includes('month='))).toBe(true);
  });

  it('review: in the month view, cards found only behind "No date" are counted there — no "nothing matches" line', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Month view' }));
    await screen.findByRole('group', { name: /^Month: / });
    // MICO-1 and MICO-2 have no dates: the month keeps them behind "No date".
    await user.type(box(), 'pump');
    expect(await screen.findByRole('button', { name: /No date \(2\)/ })).toBeInTheDocument();
    expect(screen.queryByText(/No cards on this board match/)).toBeNull();
  });

  it('review: a task added while searching that the words don’t find says it is hidden by the search', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.type(box(), 'pump');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-1', 'MICO-2']));
    created = task('t9', 'MICO-9', 'Order cement', 'p1', 'p1-todo', 'TODO');
    await user.click(screen.getByRole('button', { name: /\+ new task/i }));
    const dialog = await screen.findByRole('dialog', { name: /new task/i });
    await user.type(within(dialog).getByLabelText(/task title/i), 'Order cement');
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText(/MICO-9 was saved, but your search “pump” hides it/)).toBeInTheDocument();
  });

  it('the Table view uses the same box: it filters the rows (the table has no words box of its own here)', async () => {
    const user = userEvent.setup();
    renderPage();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Table view' }));
    await screen.findByRole('table');
    expect(screen.queryByRole('searchbox', { name: 'Filter rows' })).toBeNull();
    await user.type(box(), 'pump');
    await waitFor(() => expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([expect.stringContaining('Pump overhaul'), expect.stringContaining('Crane hire')]));
  });

  it('All projects: finds by project and marks the card’s project', async () => {
    const user = userEvent.setup();
    localStorage.setItem(userStorageKey('u1', 'board.projectId'), 'all');
    renderPage();
    await screen.findByText('Fleet pump check');
    await user.type(box(), 'operations');
    await waitFor(() => expect(cardKeys()).toEqual(['OPS-1']));
    expect(within(card('OPS-1')).getByText('Operations', { selector: 'mark' })).toBeInTheDocument();
    await user.clear(box());
    await user.type(box(), 'pump');
    await waitFor(() => expect(cardKeys().sort()).toEqual(['MICO-1', 'MICO-2', 'OPS-1']));
  });

  it('a card that stops matching after a live update fades out, then goes', async () => {
    const user = userEvent.setup();
    const qc = renderPage();
    await ready();
    await user.type(box(), 'pump');
    await waitFor(() => expect(cardKeys()).toEqual(['MICO-1', 'MICO-2']));
    TASKS = TASKS.map((t) => (t.id === 't1' ? { ...t, title: 'Valve overhaul' } : t));
    await act(() => qc.invalidateQueries({ queryKey: ['board'] }));
    await waitFor(() => expect(document.querySelector('[data-leaving="MICO-1"]')).not.toBeNull());
    expect(document.querySelector('[data-leaving="MICO-1"]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(column('To Do')).getByText('1 of 2')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-leaving="MICO-1"]')).toBeNull());
    expect(cardKeys()).toEqual(['MICO-2']);
  });
});
