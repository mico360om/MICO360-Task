import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SearchPage } from './SearchPage';

// 1.23.6 Advanced search on the Search page: what the reader understood (chips, each removable, or the
// words instead), filters without words, and saved searches (save, open, pin, manage, shared).
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function Where() {
  const { search, pathname } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}
const project = { id: 'p1', code: 'MICO', name: 'MICO360', archived: false, color: '#123456', icon: null, imageUrl: null };
const task = {
  kind: 'task', id: 't1', key: 'MICO-1', formerKeys: [], title: 'Fix the pump', titleRanges: [], project,
  status: { label: 'To do', category: 'TODO', done: false }, date: { at: '2026-11-01T00:00:00.000Z', kind: 'due' }, people: null, matches: [], target: { type: 'task', taskId: 't1' },
};
const item = {
  kind: 'checklist', id: 'i1', key: 'MICO-1', title: 'Label circuits', titleRanges: [], context: 'MICO-1 Fix the pump · Checklist ‘Electrical’', project,
  status: { label: 'Open', category: 'TODO', done: false }, date: { at: '2026-11-02T00:00:00.000Z', kind: 'due' }, people: { names: ['Ana Alpha'], count: 1 }, matches: [], target: { type: 'checklist', taskId: 't1', itemId: 'i1' },
};
const contact = {
  kind: 'contact', sub: 'external', id: 'contact:c1', title: 'Khalid Al Balushi', titleRanges: [], context: 'External contact on MICO-1 Fix the pump', project,
  status: { label: 'To do', category: 'TODO', done: false }, date: null, people: null, matches: [], target: { type: 'contact', taskId: 't1', contactId: 'c1' },
};
const client = {
  kind: 'contact', sub: 'client', id: 'client:nwt', title: 'Northwind Trading', titleRanges: [], context: 'Client of 3 projects', project: null,
  status: null, date: null, people: null, matches: [], target: { type: 'client', name: 'Northwind Trading' },
};
const COUNTS = { task: 1, project: 0, meeting: 0, note: 0, minutes: 0, file: 0, inspection: 0, checklist: 1, contact: 2 };
const OWNER_CHIPS = {
  chips: [
    { key: 'kind', label: 'Tasks', text: 'tasks' },
    { key: 'due', label: 'Overdue', text: 'overdue' },
    { key: 'project', label: 'MICO', text: 'MICO' },
    { key: 'assignee', label: 'Assigned to me', text: 'assigned to me' },
  ],
  words: '',
  removed: [],
  kinds: ['task'],
};
const saved = (over: Record<string, unknown>) => ({ id: 's1', name: 'Overdue of mine', q: 'Show overdue MICO tasks assigned to me', filters: {}, owner: { id: 'me', name: 'Me' }, mine: true, shared: null, pinned: false, updatedAt: '2026-11-07T08:00:00.000Z', ...over });

interface Served {
  asked: URL[];
  sent: { method: string; path: string; body: unknown }[];
}
function serve({ page, list = { mine: [], shared: [], pinned: [] }, refusePin = false }: { page?: Record<string, unknown>; list?: Record<string, unknown>; refusePin?: boolean } = {}): Served {
  const served: Served = { asked: [], sent: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = init?.method ?? 'GET';
      if (method !== 'GET') served.sent.push({ method, path: url.pathname.replace(/^.*\/api\/v1/, ''), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname.endsWith('/search/all')) {
        served.asked.push(url);
        return json(page ?? { data: [task, item, contact, client], nextCursor: null, total: 4, totalCapped: false, counts: COUNTS, corrected: [], understood: { chips: [], words: url.searchParams.get('q') ?? '', removed: [] } });
      }
      if (url.pathname.endsWith('/search/saved/share-options')) return json({ data: [project] });
      if (url.pathname.endsWith('/pin')) return refusePin ? json({ error: { code: 'PIN_LIMIT', message: 'You can pin up to 5 searches. Unpin one first.' } }, 409) : json({ data: { ...list, pinned: ['s1'] } });
      if (url.pathname.endsWith('/search/saved') && method === 'POST') return json({ data: saved({ id: 's9', name: 'New one' }) }, 201);
      if (url.pathname.endsWith('/search/saved')) return json({ data: list });
      if (url.pathname.endsWith('/search/ai/status')) return json({ data: { ready: false, semantic: false } });
      if (url.pathname.endsWith('/projects')) return json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO360', status: 'ACTIVE' }] });
      if (url.pathname.endsWith('/users/directory')) return json({ data: [] });
      return json({ data: {} });
    }),
  );
  return served;
}
function open(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/search" element={<><SearchPage debounceMs={0} /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const where = () => screen.getByTestId('where').textContent ?? '';
const lastAsked = (s: Served) => Object.fromEntries(s.asked[s.asked.length - 1]!.searchParams);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const OWNER_Q = 'Show overdue MICO tasks assigned to me';

describe('Search page — what the reader understood', () => {
  it('the owner’s example: a chip per filter; the Tasks type chip pressed', async () => {
    serve({ page: { data: [task], nextCursor: null, total: 1, totalCapped: false, counts: { ...COUNTS, checklist: 0, contact: 0 }, corrected: [], understood: OWNER_CHIPS } });
    open(`/search?q=${encodeURIComponent(OWNER_Q)}`);
    const chips = await screen.findByRole('list', { name: 'Understood as:' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Tasks', 'Overdue', 'MICO', 'Assigned to me']);
    expect(within(screen.getByRole('group', { name: 'Type' })).getByRole('button', { name: /^Tasks/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });

  it('removing a chip takes it off; "Search the words instead" searches every word; both can be undone', async () => {
    const s = serve({ page: { data: [task], nextCursor: null, total: 1, totalCapped: false, counts: COUNTS, corrected: [], understood: OWNER_CHIPS } });
    open(`/search?q=${encodeURIComponent(OWNER_Q)}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove the filter Overdue' }));
    await waitFor(() => expect(lastAsked(s)).toMatchObject({ q: OWNER_Q, off: 'due' }));
    expect(where()).toContain('off=due');
    await userEvent.click(screen.getByRole('button', { name: 'Search the words instead' }));
    await waitFor(() => expect(lastAsked(s)).toMatchObject({ q: OWNER_Q, plain: 'true' }));
    expect(lastAsked(s).off).toBeUndefined();
    expect(await screen.findByText('Searching every word as typed.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Read them as filters' }));
    await waitFor(() => expect(lastAsked(s).plain).toBeUndefined());
  });

  it('"All" takes the read type’s chip off', async () => {
    const s = serve({ page: { data: [task], nextCursor: null, total: 1, totalCapped: false, counts: COUNTS, corrected: [], understood: OWNER_CHIPS } });
    open(`/search?q=${encodeURIComponent(OWNER_Q)}`);
    await screen.findByRole('list', { name: 'Understood as:' });
    await userEvent.click(within(screen.getByRole('group', { name: 'Type' })).getByRole('button', { name: /^All/ }));
    await waitFor(() => expect(lastAsked(s)).toMatchObject({ off: 'kind' }));
  });

  it('review M12: “Include archived projects” alone is no search (as before)', async () => {
    const s = serve();
    open('/search?q=&archived=true');
    expect(await screen.findByText(/Type 2 or more letters/)).toBeInTheDocument();
    expect(s.asked).toEqual([]);
  });

  it('review M11: a filter changed while a task is open keeps its marked checklist item or contact', async () => {
    serve();
    open('/search?q=pump&task=t1&contact=c1');
    await screen.findByText('Fix the pump');
    await userEvent.click(within(screen.getByRole('group', { name: 'Done or open' })).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(where()).toContain('done=false'));
    expect(where()).toContain('task=t1');
    expect(where()).toContain('contact=c1');
  });

  it('filters without words search too', async () => {
    const s = serve();
    open('/search?q=&type=task&person=me');
    await screen.findByText('Fix the pump');
    expect(lastAsked(s)).toEqual({ q: '', type: 'task', person: 'me' });
  });
});

describe('Search page — the new kinds', () => {
  it('a checklist item and an external contact open their task with them marked; a client opens the Projects page', async () => {
    serve();
    open('/search?q=pump');
    const i = await screen.findByText('Label circuits');
    const itemRow = i.closest('button')!;
    expect(itemRow).toHaveTextContent('Checklist item');
    expect(itemRow).toHaveTextContent('Task MICO-1 Fix the pump · Checklist ‘Electrical’');
    await userEvent.click(itemRow);
    expect(where()).toContain('task=t1');
    expect(where()).toContain('item=i1');
    await userEvent.click(screen.getByText('Khalid Al Balushi').closest('button')!);
    expect(where()).toContain('contact=c1');
    expect(where()).not.toContain('item=');
    const c = screen.getByText('Northwind Trading').closest('a')!;
    expect(c).toHaveTextContent('Client');
    expect(c).toHaveTextContent('Client of 3 projects');
    expect(c).toHaveAttribute('href', '/projects?client=Northwind%20Trading');
  });
});

describe('Search page — saved searches', () => {
  it('saves the words and the page’s filters under a name, then says it is saved', async () => {
    const s = serve();
    open('/search?q=pump&type=task&off=due');
    await screen.findByText('Fix the pump');
    await userEvent.click(screen.getByRole('button', { name: /Save this search/ }));
    const name = screen.getByLabelText('Name of the saved search');
    await userEvent.clear(name);
    await userEvent.type(name, 'Pump tasks');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.sent.find((x) => x.path === '/search/saved')?.body).toEqual({ name: 'Pump tasks', q: 'pump', filters: { type: 'task', off: ['due'] } }));
  });

  it('a search already saved says so (one line, the name in quotes)', async () => {
    serve({ list: { mine: [saved({ name: 'Pump tasks', q: 'pump', filters: { type: 'task' } })], shared: [], pinned: [] } });
    open('/search?q=pump&type=task');
    // One run of text (a flex gap between its pieces spread the quotes apart).
    expect(await screen.findByText((_, el) => el?.hasAttribute('data-saved-as') === true && el.textContent === 'Saved as “Pump tasks”')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save this search/ })).toBeNull();
  });

  it('the panel: yours and shared with you; pin; a refused pin says why', async () => {
    const list = { mine: [saved({ shared: { projectId: 'p1', code: 'MICO', name: 'MICO360' } })], shared: [saved({ id: 's2', name: 'Team overdue', mine: false, owner: { id: 'u2', name: 'Cat Both' }, shared: { projectId: 'p1', code: 'MICO', name: 'MICO360' } })], pinned: [] };
    const s = serve({ list, refusePin: true });
    open('/search');
    const panel = await screen.findByRole('region', { name: 'Saved searches' });
    expect(within(panel).getByRole('button', { name: /Saved searches/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByRole('link', { name: 'Overdue of mine' })).toHaveAttribute('href', `/search?q=${encodeURIComponent(OWNER_Q).replace(/%20/g, '+')}`);
    expect(within(panel).getByRole('link', { name: 'Team overdue' })).toBeInTheDocument();
    expect(within(panel).getByText('Shared with you')).toBeInTheDocument();
    // Theirs: no Manage button (use and pin only).
    expect(within(panel).queryByRole('button', { name: 'Manage “Team overdue”' })).toBeNull();
    await userEvent.click(within(panel).getByRole('button', { name: 'Pin “Team overdue” to the side menu' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('You can pin up to 5 searches. Unpin one first.');
    expect(s.sent.some((x) => x.method === 'PUT' && x.path === '/search/saved/s2/pin')).toBe(true);
  });

  it('manage one of yours: rename, share with a team you run', async () => {
    const list = { mine: [saved({})], shared: [], pinned: [] };
    const s = serve({ list });
    open('/search');
    const panel = await screen.findByRole('region', { name: 'Saved searches' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Manage “Overdue of mine”' }));
    const share = within(panel).getByLabelText(/Share with a team/);
    await within(panel).findByRole('option', { name: 'MICO360 team' });
    await userEvent.selectOptions(share, 'p1');
    await waitFor(() => expect(s.sent.find((x) => x.path === '/search/saved/s1/share')?.body).toEqual({ projectId: 'p1' }));
    const name = within(panel).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Late MICO');
    await userEvent.click(within(panel).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(s.sent.find((x) => x.method === 'PATCH')?.body).toEqual({ name: 'Late MICO' }));
  });
});
