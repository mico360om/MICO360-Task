import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SearchPage } from './SearchPage';
import { useTaskSteps } from '../lib/task-steps';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function Where() {
  const { search } = useLocation();
  return <output data-testid="where">{search}</output>;
}

const comment = { field: 'comment', label: 'Comment by Bilal · 28 Oct 2026', snippet: '…who has the scaffold permit?', ranges: [{ start: 13, end: 18 }] };
const hit = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `t${n}`,
  key: `RIG-${n}`,
  formerKeys: [],
  title: `Check the scaffold ${n}`,
  titleRanges: [{ start: 10, end: 15 }],
  projectId: 'p1',
  project: { id: 'p1', code: 'RIG', name: 'Rig Inspection', archived: false },
  status: { columnId: 'c1', name: 'To do', category: 'TODO' },
  done: false,
  dueDate: '2026-10-30T00:00:00.000Z',
  assignees: [{ id: 'u1', name: 'Bilal Ahmed' }, { id: 'u2', name: 'Sara Nasser' }],
  assigneeCount: 3,
  matches: [],
  external: [],
  ...extra,
});
const PROJECTS = [
  { id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE' },
  { id: 'p9', code: 'OLD', name: 'Old works', status: 'ARCHIVED' },
];
const PEOPLE = [{ id: 'u1', username: 'bilal', firstName: 'Bilal', lastName: 'Ahmed', avatarUrl: null }];

/** The search requests made, and a server answering them page by page. */
function serve(pages: Record<string, unknown>[] = [{ data: [hit(1, { matches: [comment] }), hit(2)], nextCursor: null, total: 2, totalCapped: false }]) {
  const asked: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname.endsWith('/search/tasks')) {
        asked.push(url);
        return json(url.searchParams.get('cursor') ? pages[1] ?? pages[0] : pages[0]);
      }
      if (url.pathname.endsWith('/projects')) return json({ data: PROJECTS });
      if (url.pathname.endsWith('/users/directory')) return json({ data: PEOPLE });
      return json({ data: {} });
    }),
  );
  return asked;
}
function open(at = '/search?q=scaff') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/search" element={<><SearchPage debounceMs={0} /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const row = (text: string) => screen.findByText((_, el) => el?.tagName === 'BUTTON' && !!el.textContent?.includes(text));
const lastAsked = (asked: URL[]) => Object.fromEntries(asked[asked.length - 1]!.searchParams);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Search results page', () => {
  it('searches every task for the words in the address and lists them, the words marked', async () => {
    const asked = serve();
    open();
    const first = await row('Check the scaffold 1');
    expect(lastAsked(asked)).toEqual({ q: 'scaff' });
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('scaff');
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
    expect([...first.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['scaff', 'scaff']);
    expect(first).toHaveTextContent('Comment by Bilal · 28 Oct 2026: …who has the scaffold permit?');
    expect(first).toHaveTextContent('Rig Inspection');
    expect(first).toHaveTextContent('To do');
    expect(first).toHaveTextContent('Due 30 Oct 2026');
    expect(first).toHaveTextContent('Bilal Ahmed +2');
    expect(first.querySelector('[data-task-key="RIG-1"]')).not.toBeNull(); // 1.22.3: the number is the chip
  });

  it('opens a task in its panel, with the results as its list (Previous / Next)', async () => {
    useTaskSteps.getState().clear();
    serve();
    open();
    await userEvent.click(await row('Check the scaffold 2'));
    expect(screen.getByTestId('where').textContent).toContain('task=t2');
    expect(useTaskSteps.getState()).toMatchObject({ ids: ['t1', 't2'], path: '/search' });
  });

  it('asks again as the words change, and keeps them in the address', async () => {
    const asked = serve();
    open();
    await row('Check the scaffold 1');
    const box = screen.getByRole('searchbox', { name: 'Search tasks' });
    await userEvent.clear(box);
    await userEvent.type(box, '"hot work"');
    await waitFor(() => expect(lastAsked(asked).q).toBe('"hot work"'));
    expect(screen.getByTestId('where').textContent).toContain('q=%22hot+work%22');
  });

  it('keeps a space typed before a pause (the next word does not run into the last)', async () => {
    const asked = serve();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/search?q=scaff']}>
          <Routes>
            <Route path="/search" element={<SearchPage debounceMs={40} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const box = screen.getByRole('searchbox', { name: 'Search tasks' });
    await userEvent.clear(box);
    await userEvent.type(box, '"hot ');
    await new Promise((r) => setTimeout(r, 120)); // past the pause: the search runs
    await userEvent.type(box, 'work"');
    expect(box).toHaveValue('"hot work"');
    await waitFor(() => expect(lastAsked(asked).q).toBe('"hot work"'));
  });

  it('a page whose tasks all changed since they were indexed asks for the next one', async () => {
    const asked = serve([
      { data: [], nextCursor: 'b2s6Mg', total: 3, totalCapped: false },
      { data: [hit(3)], nextCursor: null },
    ]);
    open();
    await row('Check the scaffold 3');
    expect(lastAsked(asked).cursor).toBe('b2s6Mg');
  });

  it('filters by project, status, assignee, done or not, and archived projects', async () => {
    const asked = serve();
    open();
    await row('Check the scaffold 1');
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'p1');
    await waitFor(() => expect(lastAsked(asked)).toMatchObject({ projectId: 'p1' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'me');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(lastAsked(asked)).toEqual({ q: 'scaff', projectId: 'p1', status: 'IN_PROGRESS', assigneeId: 'me', done: 'false' }));
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(lastAsked(asked).done).toBe('true'));
    await userEvent.click(screen.getByRole('switch', { name: 'Include archived projects' }));
    await waitFor(() => expect(lastAsked(asked).archived).toBe('true'));
    expect(screen.getByTestId('where').textContent).toBe('?q=scaff&project=p1&status=IN_PROGRESS&assignee=me&done=true&archived=true');
  });

  it('its All / Open / Done chips are 44px tall on a touch screen (the ! form beats the base 32px button rule)', async () => {
    serve();
    open();
    await row('Check the scaffold 1');
    for (const name of ['All', 'Open', 'Done']) expect(screen.getByRole('button', { name }).className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
  });

  it('offers archived projects only with “Include archived projects” on', async () => {
    serve();
    open();
    await row('Check the scaffold 1');
    const projects = () => within(screen.getByLabelText('Project')).getAllByRole('option').map((o) => o.textContent);
    expect(projects()).toEqual(['All projects', 'Rig Inspection']);
    await userEvent.click(screen.getByRole('switch', { name: 'Include archived projects' }));
    expect(projects()).toEqual(['All projects', 'Rig Inspection', 'Old works (archived)']);
  });

  it('starts from the filters in the address', async () => {
    const asked = serve();
    open('/search?q=rig&project=p1&status=DONE&assignee=u1&done=true&archived=true');
    await row('Check the scaffold 1');
    expect(lastAsked(asked)).toEqual({ q: 'rig', projectId: 'p1', status: 'DONE', assigneeId: 'u1', done: 'true', archived: 'true' });
  });

  it('shows more, page by page, without repeats', async () => {
    const asked = serve([
      { data: [hit(1), hit(2)], nextCursor: 'b2s6Mg', total: 3, totalCapped: false },
      { data: [hit(3)], nextCursor: null },
    ]);
    open();
    await row('Check the scaffold 2');
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await row('Check the scaffold 3');
    expect(lastAsked(asked).cursor).toBe('b2s6Mg');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(screen.getAllByText((_, el) => el?.tagName === 'BUTTON' && !!el.textContent?.includes('Check the scaffold'))).toHaveLength(3);
  });

  it('says “1000+ tasks” past the count', async () => {
    serve([{ data: [hit(1)], nextCursor: 'b2s6MjA', total: 1001, totalCapped: true }]);
    open();
    expect(await screen.findByText('1000+ tasks')).toBeInTheDocument();
  });

  it('nothing found: says so, and offers to clear the filters', async () => {
    const asked = serve([{ data: [], nextCursor: null, total: 0, totalCapped: false }]);
    open('/search?q=zebra&done=true');
    expect(await screen.findByText('No tasks match “zebra”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastAsked(asked)).toEqual({ q: 'zebra' }));
  });

  it('asks nothing until 2 letters are typed', async () => {
    const asked = serve();
    open('/search?q=s');
    expect(await screen.findByText(/Type 2 or more letters/)).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });
});
