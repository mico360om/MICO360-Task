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
  const { search, hash, pathname } = useLocation();
  return <output data-testid="where">{`${pathname}${search}${hash}`}</output>;
}

const comment = { field: 'comment', label: 'Comment by Bilal · 28 Oct 2026', snippet: '…who has the scaffold permit?', ranges: [{ start: 13, end: 18 }] };
const project = { id: 'p1', code: 'RIG', name: 'Rig Inspection', archived: false, color: '#123456', icon: null, imageUrl: null };
const task = (n: number, extra: Record<string, unknown> = {}) => ({
  kind: 'task',
  id: `t${n}`,
  key: `RIG-${n}`,
  formerKeys: [],
  title: `Check the scaffold ${n}`,
  titleRanges: [{ start: 10, end: 15 }],
  project,
  status: { label: 'To do', category: 'TODO', done: false },
  date: { at: '2026-10-30T00:00:00.000Z', kind: 'due' },
  people: { names: ['Bilal Ahmed', 'Sara Nasser'], count: 3 },
  matches: [],
  target: { type: 'task', taskId: `t${n}` },
  ...extra,
});
const note = {
  kind: 'note', id: 'n1', title: 'Weekly scaffold review', titleRanges: [{ start: 7, end: 12 }], context: 'Weekly scaffold review', project,
  status: { label: 'Scheduled', category: 'SCHEDULED', done: false }, date: { at: '2026-11-03T06:00:00.000Z', kind: 'written' }, people: { names: ['Sara Nasser'], count: 1 },
  matches: [{ field: 'note', label: 'Discussion note by Sara Nasser · 3 Nov 2026', snippet: 'Tag every scaffold', ranges: [{ start: 10, end: 15 }] }],
  target: { type: 'meeting', meetingId: 'm1', noteId: 'n1' },
};
const file = {
  kind: 'file', id: 'f1', title: 'scaffold-permit.pdf', titleRanges: [{ start: 0, end: 5 }], key: 'RIG-7', context: 'RIG-7 Permits', project,
  status: { label: 'To do', category: 'TODO', done: false }, date: { at: '2026-11-02T06:00:00.000Z', kind: 'added' }, people: null,
  matches: [{ field: 'file-text', label: 'Text in the file', snippet: 'scaffold tags', ranges: [{ start: 0, end: 5 }] }],
  target: { type: 'file', taskId: 't7', fileId: 'f1' },
};
const COUNTS = { task: 2, project: 0, meeting: 0, note: 1, minutes: 0, file: 1, inspection: 0, checklist: 0, contact: 0 };
const PROJECTS = [
  { id: 'p1', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE' },
  { id: 'p9', code: 'OLD', name: 'Old works', status: 'ARCHIVED' },
];
const PEOPLE = [{ id: 'u1', username: 'bilal', firstName: 'Bilal', lastName: 'Ahmed', avatarUrl: null }];

interface Served {
  asked: URL[];
  ai: unknown[];
}
/** The search requests made, and a server answering them page by page (and the AI panel). */
function serve(
  pages: Record<string, unknown>[] = [{ data: [task(1, { matches: [comment] }), note, file, task(2)], nextCursor: null, total: 4, totalCapped: false, counts: COUNTS, corrected: [] }],
  ai: { ready?: boolean; answer?: unknown; wait?: Promise<void> } = {},
): Served {
  const served: Served = { asked: [], ai: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      if (url.pathname.endsWith('/search/all')) {
        served.asked.push(url);
        return json(url.searchParams.get('cursor') ? pages[1] ?? pages[0] : pages[0]);
      }
      if (url.pathname.endsWith('/search/ai/status')) return json({ data: { ready: ai.ready ?? false, semantic: false } });
      if (url.pathname.endsWith('/search/ai')) {
        served.ai.push(JSON.parse(String(init?.body)));
        await ai.wait;
        return json({ data: ai.answer ?? { state: 'ok', answer: 'Two tasks are about the scaffold.', hits: [task(2)], semantic: false } });
      }
      if (url.pathname.endsWith('/projects')) return json({ data: PROJECTS });
      if (url.pathname.endsWith('/users/directory')) return json({ data: PEOPLE });
      return json({ data: {} });
    }),
  );
  return served;
}
function open(at = '/search?q=scaff') {
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
const row = (text: string) => screen.findByText((_, el) => (el?.tagName === 'BUTTON' || el?.tagName === 'A') && !!el.textContent?.includes(text));
const lastAsked = (s: Served) => Object.fromEntries(s.asked[s.asked.length - 1]!.searchParams);
const where = () => screen.getByTestId('where').textContent;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Search results page (search everything)', () => {
  it('searches everything for the words in the address: each result’s kind, words marked, project, state, date and people', async () => {
    const s = serve();
    open();
    const first = await row('Check the scaffold 1');
    expect(lastAsked(s)).toEqual({ q: 'scaff' });
    expect(screen.getByRole('searchbox', { name: 'Search everything' })).toHaveValue('scaff');
    expect(screen.getByText('4 results')).toBeInTheDocument();
    expect([...first.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['scaff', 'scaff']);
    expect(first).toHaveTextContent('Task');
    expect(first).toHaveTextContent('Comment by Bilal · 28 Oct 2026: …who has the scaffold permit?');
    expect(first).toHaveTextContent('Rig Inspection');
    expect(first).toHaveTextContent('To do');
    expect(first).toHaveTextContent('Due 30 Oct 2026');
    expect(first).toHaveTextContent('Bilal Ahmed +2');
    expect(first.querySelector('[data-task-key="RIG-1"]')).not.toBeNull();
    expect(first.querySelector('[data-kind-icon="task"]')).not.toBeNull();
    const n = await row('Tag every scaffold');
    expect(n).toHaveTextContent('Note');
    expect(n).toHaveTextContent('Written 3 Nov 2026');
    const f = await row('scaffold-permit.pdf');
    expect(f).toHaveTextContent('File');
    expect(f).toHaveTextContent('Task RIG-7 Permits');
    expect(f).toHaveTextContent('Text in the file: scaffold tags');
  });

  it('a task opens in its panel with the results’ tasks as its list; a file opens its task with the file; a note is a link to its place', async () => {
    useTaskSteps.getState().clear();
    serve();
    open();
    await userEvent.click(await row('Check the scaffold 2'));
    expect(where()).toContain('task=t2');
    expect(useTaskSteps.getState()).toMatchObject({ ids: ['t1', 't2'], path: '/search' });
    await userEvent.click(await row('scaffold-permit.pdf'));
    expect(where()).toContain('task=t7');
    expect(where()).toContain('file=f1');
    const link = (await row('Tag every scaffold')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/meetings/m1#note-n1');
  });

  it('asks again as the words change, and keeps them in the address', async () => {
    const s = serve();
    open();
    await row('Check the scaffold 1');
    const box = screen.getByRole('searchbox', { name: 'Search everything' });
    await userEvent.clear(box);
    await userEvent.type(box, '"hot work"');
    await waitFor(() => expect(lastAsked(s).q).toBe('"hot work"'));
    expect(where()).toContain('q=%22hot+work%22');
  });

  it('keeps a space typed before a pause (the next word does not run into the last)', async () => {
    const s = serve();
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
    const box = screen.getByRole('searchbox', { name: 'Search everything' });
    await userEvent.clear(box);
    await userEvent.type(box, '"hot ');
    await new Promise((r) => setTimeout(r, 120));
    await userEvent.type(box, 'work"');
    expect(box).toHaveValue('"hot work"');
    await waitFor(() => expect(lastAsked(s).q).toBe('"hot work"'));
  });

  it('a page whose items all changed since they were indexed asks for the next one', async () => {
    const s = serve([
      { data: [], nextCursor: 'b2s6Mg', total: 3, totalCapped: false, counts: COUNTS },
      { data: [task(3)], nextCursor: null },
    ]);
    open();
    await row('Check the scaffold 3');
    expect(lastAsked(s).cursor).toBe('b2s6Mg');
  });

  it('the type chips count each kind and filter by it; the task status is offered with tasks only', async () => {
    const s = serve();
    open();
    await row('Check the scaffold 1');
    const types = within(screen.getByRole('group', { name: 'Type' }));
    expect(types.getAllByRole('button').map((b) => b.textContent)).toEqual(['All 4', 'Tasks 2', 'Projects 0', 'Meetings 0', 'Notes 1', 'Minutes 0', 'Files 1', 'Inspections 0', 'Checklist items 0', 'Clients & contacts 0']);
    expect(screen.queryByLabelText('Status')).toBeNull();
    await userEvent.click(types.getByRole('button', { name: 'Tasks 2' }));
    await waitFor(() => expect(lastAsked(s)).toEqual({ q: 'scaff', type: 'task' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'IN_PROGRESS');
    await waitFor(() => expect(lastAsked(s)).toEqual({ q: 'scaff', type: 'task', status: 'IN_PROGRESS' }));
    await userEvent.click(types.getByRole('button', { name: 'Files 1' }));
    await waitFor(() => expect(lastAsked(s)).toEqual({ q: 'scaff', type: 'file' })); // the task status goes with tasks
    expect(where()).toBe('/search?q=scaff&type=file');
  });

  it('filters by project, person ("Only mine"), dates, open or done, and archived projects — all in the address', async () => {
    const s = serve();
    open();
    await row('Check the scaffold 1');
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'p1');
    await waitFor(() => expect(lastAsked(s)).toMatchObject({ projectId: 'p1' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Only mine' }));
    await waitFor(() => expect(lastAsked(s)).toMatchObject({ person: 'me' }));
    expect(screen.getByLabelText('Assignee or organizer')).toHaveValue('me');
    await userEvent.selectOptions(screen.getByLabelText('Assignee or organizer'), 'u1');
    expect(screen.getByRole('switch', { name: 'Only mine' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.type(screen.getByLabelText('From'), '2026-11-01');
    await userEvent.type(screen.getByLabelText('To'), '2026-11-07');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(lastAsked(s)).toEqual({ q: 'scaff', projectId: 'p1', person: 'u1', from: '2026-11-01', to: '2026-11-07', done: 'false' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Include archived projects' }));
    await waitFor(() => expect(lastAsked(s).archived).toBe('true'));
    expect(where()).toBe('/search?q=scaff&project=p1&person=u1&from=2026-11-01&to=2026-11-07&done=false&archived=true');
  });

  it('its chips are 44px tall on a touch screen (the ! form beats the base 32px button rule)', async () => {
    serve();
    open();
    await row('Check the scaffold 1');
    for (const name of ['All', 'Open', 'Done']) expect(screen.getByRole('button', { name }).className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
    expect(screen.getByRole('button', { name: 'Tasks 2' }).className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
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
    const s = serve();
    open('/search?q=rig&type=task&project=p1&status=DONE&person=u1&done=true&archived=true');
    await row('Check the scaffold 1');
    expect(lastAsked(s)).toEqual({ q: 'rig', type: 'task', projectId: 'p1', status: 'DONE', person: 'u1', done: 'true', archived: 'true' });
  });

  it('shows more, page by page, without repeats', async () => {
    const s = serve([
      { data: [task(1), task(2)], nextCursor: 'b2s6Mg', total: 3, totalCapped: false, counts: COUNTS },
      { data: [task(3)], nextCursor: null },
    ]);
    open();
    await row('Check the scaffold 2');
    expect(screen.getByText('3 results')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await row('Check the scaffold 3');
    expect(lastAsked(s).cursor).toBe('b2s6Mg');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('says “1000+ results” past the count, and which spellings it corrected', async () => {
    serve([{ data: [task(1, { match: 'close' })], nextCursor: null, total: 1001, totalCapped: true, counts: { ...COUNTS, task: 1001 }, corrected: [{ from: 'scafold', to: 'scaffold' }] }]);
    open('/search?q=scafold');
    expect(await screen.findByText('1000+ results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tasks 1000+' })).toBeInTheDocument(); // review M2
    expect(screen.getByRole('button', { name: 'All 1000+' })).toBeInTheDocument();
    expect(screen.getByText(/Also showing close matches/)).toHaveTextContent('Also showing close matches: “scaffold” for “scafold”.');
    expect(await row('Check the scaffold 1')).toHaveTextContent('Close match');
  });

  it('nothing found: says so, and offers to clear the filters', async () => {
    const s = serve([{ data: [], nextCursor: null, total: 0, totalCapped: false, counts: { ...COUNTS, task: 0, note: 0, file: 0 } }]);
    open('/search?q=zebra&done=true');
    expect(await screen.findByText('Nothing matches “zebra”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(lastAsked(s)).toEqual({ q: 'zebra' }));
  });

  it('asks nothing until 2 letters are typed', async () => {
    const s = serve();
    open('/search?q=s');
    expect(await screen.findByText(/Type 2 or more letters/)).toBeInTheDocument();
    expect(s.asked).toHaveLength(0);
  });
});

describe('1.23 integration: compact rows on the Search page', () => {
  it('offers the quick “Rows” button beside the type chips, and its rows take the compact steps', async () => {
    serve();
    open();
    const first = await row('Check the scaffold 1');
    expect(screen.getByRole('button', { name: 'Rows: Comfortable' })).toHaveAttribute('aria-haspopup', 'menu');
    // A third less padding, the title a step smaller, the number chip and the project picture smaller.
    expect(first.className).toContain('compact:p-2');
    expect(first.querySelector('[data-result-title]')?.className).toContain('compact:text-row');
    expect(first.querySelector('[data-task-key="RIG-1"]')?.className).toContain('compact:py-0');
  });
});

describe('the AI panel', () => {
  it('AI off: one line, and the normal results', async () => {
    serve(undefined, { ready: false });
    open();
    await row('Check the scaffold 1');
    expect(await screen.findByText('AI search is off — these are the normal results.')).toBeInTheDocument();
  });

  it('Enter asks the AI; the normal results show at once, the answer fills in above them with its best matches', async () => {
    let release = () => {};
    const s = serve(undefined, { ready: true, wait: new Promise<void>((r) => (release = r)) });
    open();
    await row('Check the scaffold 1');
    const panel = await screen.findByRole('region', { name: 'AI answer' });
    expect(within(panel).getByRole('button', { name: 'Ask AI' })).toBeInTheDocument();
    const box = screen.getByRole('searchbox', { name: 'Search everything' });
    await userEvent.type(box, '{Enter}');
    await waitFor(() => expect(s.ai).toHaveLength(1));
    expect(s.ai[0]).toEqual({ q: 'scaff' });
    expect(where()).toContain('ai=1');
    expect(await within(panel).findByText('AI is reading what you can open…')).toBeInTheDocument();
    expect(screen.getByText('4 results')).toBeInTheDocument(); // the normal results did not wait
    release();
    expect(await within(panel).findByText('Two tasks are about the scaffold.')).toBeInTheDocument();
    expect(within(within(panel).getByRole('list', { name: 'Best matches' })).getAllByRole('button')).toHaveLength(1);
  });

  it('a page opened with ai=1 asks at once, with the filters; slow or failing says so in one line', async () => {
    const s = serve(undefined, { ready: true, answer: { state: 'slow', message: 'The AI took too long (over 20 seconds). The normal results are below.' } });
    open('/search?q=overdue+electrical&type=task&person=me&ai=1');
    expect(await screen.findByText('The AI took too long (over 20 seconds). The normal results are below.')).toBeInTheDocument();
    expect(s.ai[0]).toEqual({ q: 'overdue electrical', type: 'task', person: 'me' });
  });

  it('review I5: a filter changed after asking waits to be asked again (no AI request per chip or date key)', async () => {
    const s = serve(undefined, { ready: true });
    open('/search?q=scaff&ai=1');
    await waitFor(() => expect(s.ai).toHaveLength(1));
    await userEvent.click(await screen.findByRole('button', { name: 'Tasks 2' }));
    await waitFor(() => expect(lastAsked(s)).toMatchObject({ type: 'task' }));
    await userEvent.type(screen.getByLabelText('From'), '2026-11-01');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(where()).not.toContain('ai=1');
    expect(s.ai).toHaveLength(1);
    await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(s.ai).toHaveLength(2));
    expect(s.ai[1]).toMatchObject({ q: 'scaff', type: 'task', from: '2026-11-01', done: false });
  });

  it('new words wait to be asked again (typing never sends every keystroke to the AI)', async () => {
    const s = serve(undefined, { ready: true });
    open('/search?q=scaff&ai=1');
    await waitFor(() => expect(s.ai).toHaveLength(1));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search everything' }), 'old');
    await waitFor(() => expect(lastAsked(s).q).toBe('scaffold'));
    expect(where()).not.toContain('ai=1');
    expect(s.ai).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Ask AI' })).toBeInTheDocument();
  });
});

// 1.23.1 — the task half failing on the server leaves the other kinds (`tasksUnavailable`): one quiet line.
describe('Search page — when tasks couldn’t be searched', () => {
  it('shows the other results and one quiet line with “try again”', async () => {
    const s = serve([{ data: [note, file], nextCursor: null, total: 2, totalCapped: false, counts: { ...COUNTS, task: 0 }, corrected: [], tasksUnavailable: true }]);
    open('/search?q=scaff');
    expect(await row('Weekly scaffold review')).toBeInTheDocument();
    expect(screen.getByText(/Tasks couldn’t be searched just now/)).toHaveTextContent('Tasks couldn’t be searched just now — try again');
    const before = s.asked.length;
    await userEvent.click(screen.getByRole('button', { name: 'try again' }));
    await waitFor(() => expect(s.asked.length).toBeGreaterThan(before));
  });

  it('with nothing else found, the line still says why tasks are missing', async () => {
    serve([{ data: [], nextCursor: null, total: 0, totalCapped: false, counts: { ...COUNTS, task: 0, note: 0, file: 0 }, tasksUnavailable: true }]);
    open('/search?q=zebra');
    expect(await screen.findByText(/Tasks couldn’t be searched just now/)).toBeInTheDocument();
  });

  it('no line when the search worked', async () => {
    serve();
    open('/search?q=scaff');
    expect(await row('Weekly scaffold review')).toBeInTheDocument();
    expect(screen.queryByText(/Tasks couldn’t be searched/)).toBeNull();
  });
});

describe('Search results page: archived tasks (task archive)', () => {
  it('an archived task is found and says so; the others don’t', async () => {
    serve([{ data: [task(1, { archived: true }), task(2)], nextCursor: null, total: 2, totalCapped: false, counts: COUNTS, corrected: [] }]);
    open();
    const archived = await row('Check the scaffold 1');
    expect(within(archived).getByText('Archived')).toBeInTheDocument();
    const live = await row('Check the scaffold 2');
    expect(within(live).queryByText('Archived')).toBeNull();
  });
});
