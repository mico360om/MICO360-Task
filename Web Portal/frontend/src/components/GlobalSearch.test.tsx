import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GlobalSearch } from './GlobalSearch';
import { useAuthStore } from '../stores/auth-store';
import { ShortcutProvider } from './shortcuts/ShortcutProvider';

/** Shows where the app is, so a test can see where a result led. */
function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function setup(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.restoreAllMocks());

/** Pretend the window is (or isn't) at least `minWidth` wide — what a CSS breakpoint would see. */
function windowWidth(px: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*([\d.]+)(em|px)/.exec(query);
    const need = min ? Number(min[1]) * (min[2] === 'em' ? 16 : 1) : 0;
    return { matches: px >= need, media: query, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
  });
}

describe('GlobalSearch', () => {
  it('words its hint for the room it has: the whole hint on a wide screen, just “Search…” on a phone or tablet', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: [] }))));
    windowWidth(1280);
    const { unmount } = setup(<GlobalSearch />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute('placeholder', 'Search or type a command…');
    unmount();
    for (const width of [375, 1024]) {
      windowWidth(width);
      const { unmount: done } = setup(<GlobalSearch />);
      expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveAttribute('placeholder', 'Search…');
      done();
    }
    vi.unstubAllGlobals();
  });

  it('queries the search endpoint (debounced) and shows results', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(json({ data: { tasks: [{ id: 't1', key: 'MICO-1', title: 'Prepare report', projectId: 'p1' }], projects: [{ id: 'p1', code: 'MICO', name: 'MICO Ops' }], users: [] } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'mico');

    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/search?q=mico'))).toBe(true));
    expect(await screen.findByText('Prepare report')).toBeInTheDocument();
    expect(screen.getByText('MICO Ops')).toBeInTheDocument();
  });

  it('shows a found project with its picture', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(String(url).endsWith('/projects')
      ? json({ data: [{ id: 'p1', code: 'MICO', name: 'MICO Ops', color: '#4338CA', icon: 'bolt' }] })
      : json({ data: { tasks: [], projects: [{ id: 'p1', code: 'MICO', name: 'MICO Ops' }], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'mico');
    const row = (await screen.findByText('MICO Ops')).closest('button')!;
    await waitFor(() => expect(row.querySelector('[data-project-avatar="icon"]')).not.toBeNull());
  });

  it('does not search for very short queries', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(json({ data: { tasks: [], projects: [], users: [] } })));
    vi.stubGlobal('fetch', fetchMock);
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'a');
    // give any debounce a chance
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/search'))).toBe(false);
  });

  it('people results are colleagues only: a teammate from another company is not offered (spec §3 directory search)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      if (u.endsWith('/users/directory')) {
        return Promise.resolve(json({ data: [
          { id: 'ana', username: 'ana', firstName: 'Ana', lastName: 'Alpha', avatarUrl: null, colleague: false },
          { id: 'bob', username: 'bob', firstName: 'Bob', lastName: 'Betaonly', avatarUrl: null, colleague: true },
        ] }));
      }
      return Promise.resolve(json({ data: { tasks: [], projects: [], users: [
        { id: 'ana', username: 'ana', email: '', firstName: 'Ana', lastName: 'Alpha' },
        { id: 'bob', username: 'bob', email: '', firstName: 'Bob', lastName: 'Betaonly' },
      ] } }));
    }));
    setup(<GlobalSearch />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'people');
    expect(await screen.findByText('Bob Betaonly')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Ana Alpha')).toBeNull());
  });

  it('offers a "go to" navigation command', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'go to calendar');
    expect(await screen.findByText(/Go to Calendar/i)).toBeInTheDocument();
  });

  it('offers to ask MICO AI what was typed, and opens MICO AI with the question', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [], projects: [], users: [] } }))));
    let state: unknown = null;
    function Spy() {
      const loc = useLocation();
      state = loc.state;
      return <div data-testid="at">{loc.pathname}</div>;
    }
    setup(<><GlobalSearch debounceMs={0} /><Spy /></>);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'who has the most overdue tasks');
    await userEvent.click(await screen.findByRole('button', { name: /Ask MICO AI.*who has the most overdue tasks/ }));
    expect(screen.getByTestId('at')).toHaveTextContent('/mico-ai');
    expect(state).toEqual({ ask: 'who has the most overdue tasks' });
  });

  it('says when nothing matched, above the offer to ask MICO AI (the offer alone read like a result)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [], projects: [], users: [], meetings: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'zebra');
    expect(await screen.findByText(/Nothing matches/)).toHaveTextContent('Nothing matches “zebra” in tasks, projects, people or meetings.');
    expect(screen.getByRole('button', { name: /Ask MICO AI.*zebra/ })).toBeInTheDocument();
  });

  it('does not say “nothing matches” when something did', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [{ id: 't1', key: 'MICO-1', title: 'Zebra crossing', projectId: 'p1' }], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'zebra');
    expect(await screen.findByText('Zebra crossing')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  });

  it('offers an "open" command for a bare task key', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'MICO-7');
    expect(await screen.findByText(/Open MICO-7/i)).toBeInTheDocument();
  });

  it('never acts on a different task when the typed key has no exact match (WEB-5 vs WEB-50)', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/search')) return Promise.resolve(json({ data: { tasks: [{ id: 't50', key: 'WEB-50', title: 'Other task', projectId: 'p1' }], projects: [], users: [] } }));
      return Promise.resolve(json({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'complete WEB-5{Enter}');
    expect(await screen.findByText('No task WEB-5.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/move') || String(c[0]).includes('/columns'))).toBe(false);
  });

  it('a task’s old key still opens it after it moved project (open RIG-4 → OPS-17)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(json(String(url).includes('/search')
      ? { data: { tasks: [{ id: 't4', key: 'OPS-17', title: 'Inspect the rig', projectId: 'p2', formerKeys: ['RIG-4'] }], projects: [], users: [] } }
      : { data: [] }))));
    setup(<><GlobalSearch debounceMs={0} /><Where /></>);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'open rig-4{Enter}');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/?task=t4'));
  });

  describe('a task number however it is typed (1.22.3)', () => {
    /** The search answers with these tasks, whatever was typed. */
    const found = (tasks: { id: string; key: string; title: string; formerKeys?: string[] }[]) =>
      vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(json(String(url).includes('/search') ? { data: { tasks: tasks.map((t) => ({ projectId: 'p1', ...t })), projects: [], users: [] } } : { data: [] }))));
    const box = () => screen.getByRole('searchbox', { name: /search/i });

    it('"open mico 142", "open MICO_142" and "open #mico-142" open MICO-142 — never MICO-1420', async () => {
      for (const typed of ['open mico 142', 'open MICO_142', 'open #mico-142']) {
        found([{ id: 't1420', key: 'MICO-1420', title: 'Longer number' }, { id: 't142', key: 'MICO-142', title: 'Valve check' }]);
        const { unmount } = setup(<><GlobalSearch debounceMs={0} /><Where /></>);
        await userEvent.type(box(), typed);
        expect(await screen.findByText('Open MICO-142')).toBeInTheDocument();
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(screen.getByTestId('where').textContent, typed).toBe('/?task=t142'));
        unmount();
      }
    });

    it('a run-together number tries every split: "open hr214" opens HR2-14', async () => {
      found([{ id: 'hr', key: 'HR2-14', title: 'Fence line' }]);
      setup(<><GlobalSearch debounceMs={0} /><Where /></>);
      await userEvent.type(box(), 'open hr214{Enter}');
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/?task=hr'));
    });

    it('typed without a verb ("mico142"), it is offered as "Open MICO-142" once the search finds it', async () => {
      found([{ id: 't142', key: 'MICO-142', title: 'Valve check' }]);
      setup(<><GlobalSearch debounceMs={0} /><Where /></>);
      await userEvent.type(box(), 'mico142');
      expect(await screen.findByText('Open MICO-142')).toBeInTheDocument();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/?task=t142'));
    });

    it('an old number typed any way opens the task it moved to ("rig 4" → OPS-17)', async () => {
      found([{ id: 't4', key: 'OPS-17', title: 'Inspect the rig', formerKeys: ['RIG-4'] }]);
      setup(<><GlobalSearch debounceMs={0} /><Where /></>);
      await userEvent.type(box(), 'rig 4');
      expect(await screen.findByText('Open OPS-17')).toBeInTheDocument();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/?task=t4'));
    });

    it('"phase 2" with no task numbered PHASE-2 stays a plain search: no Open command, MICO AI still offered', async () => {
      found([{ id: 'tp', key: 'MICO-9', title: 'Phase 2 handover' }]);
      setup(<><GlobalSearch debounceMs={0} /><Where /></>);
      await userEvent.type(box(), 'phase 2');
      expect(await screen.findByText('Phase 2 handover')).toBeInTheDocument();
      expect(screen.queryByText(/^Open /)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ask MICO AI.*phase 2/ })).toBeInTheDocument();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/?task=tp'));
    });
  });

  it('a found task that moved shows the key it had too, so it can be told apart', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [{ id: 't4', key: 'OPS-17', title: 'Inspect the rig', projectId: 'p2', formerKeys: ['RIG-4'] }], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'rig-4');
    expect(await screen.findByText('OPS-17 (was RIG-4)')).toBeInTheDocument();
  });

  it('a task found by one of its external contacts says which one', async () => {
    const contact = { field: 'contact', label: 'External contact', snippet: 'Ahmed Al Said · Occidental Oman', ranges: [{ start: 16, end: 26 }] };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [{ id: 't5', key: 'RIG-5', title: 'Inspect the rig', projectId: 'p2', external: ['Ahmed Al Said', 'Occidental Oman'], matches: [contact] }], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'occidental');
    const line = await screen.findByText((_, el) => el?.textContent === 'External contact: Ahmed Al Said · Occidental Oman' && el.tagName === 'SPAN' && el.classList.contains('block'));
    expect(line.querySelector('mark')?.textContent).toBe('Occidental');
  });

  describe('tasks found by the full task search', () => {
    const hit = (n: number, extra: Record<string, unknown> = {}) => ({ id: `t${n}`, key: `RIG-${n}`, title: `Check the scaffold ${n}`, titleRanges: [{ start: 10, end: 15 }], projectId: 'p1', matches: [], ...extra });
    const comment = { field: 'comment', label: 'Comment by Bilal · 28 Oct 2026', snippet: '…who has the scaffold permit?', ranges: [{ start: 13, end: 18 }] };
    // A row by its text (marks inside a word split its accessible name in jsdom, not in a browser).
    const taskRow = (text: string) => screen.findByText((_, el) => el?.tagName === 'BUTTON' && !!el.textContent?.includes(text));

    it('marks the words in the title and says where else it matched', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [hit(1, { matches: [comment] })], projects: [], users: [] } }))));
      setup(<GlobalSearch debounceMs={0} />);
      await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'scaff');
      const row = await taskRow('Check the scaffold 1');
      expect([...row.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['scaff', 'scaff']);
      expect(row).toHaveTextContent('Comment by Bilal · 28 Oct 2026: …who has the scaffold permit?');
    });

    it('shows the best five, then “See all results”, which opens the Search results page', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [1, 2, 3, 4, 5, 6].map((n) => hit(n)), projects: [], users: [] } }))));
      setup(<><GlobalSearch debounceMs={0} /><Where /></>);
      await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'scaff permit');
      await taskRow('Check the scaffold 5');
      expect(screen.queryByText((_, el) => el?.tagName === 'BUTTON' && !!el.textContent?.includes('Check the scaffold 6'))).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'See all results' }));
      expect(screen.getByTestId('where')).toHaveTextContent('/search?q=scaff+permit');
    });

    it('no “See all results” when no task was found', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [], projects: [{ id: 'p1', code: 'SCF', name: 'Scaffolds' }], users: [] } }))));
      setup(<GlobalSearch debounceMs={0} />);
      await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'scaff');
      await screen.findByRole('button', { name: /Scaffolds/ });
      expect(screen.queryByRole('button', { name: 'See all results' })).toBeNull();
    });
  });

  describe('a person in the results', () => {
    const people = { tasks: [], projects: [], users: [{ id: 'u7', username: 'sara', firstName: 'Sara', lastName: 'Ahmed' }, { id: 'me', username: 'me', firstName: 'Me', lastName: 'Myself' }] };
    const signIn = (roles: string[]) => useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles }, accessToken: 'at', refreshToken: 'rt' });
    afterEach(() => useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }));

    async function pick(name: string) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: people }))));
      setup(<><GlobalSearch debounceMs={0} /><Where /></>);
      await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'sar');
      await userEvent.click(await screen.findByText(name));
      return screen.getByTestId('where').textContent;
    }

    it('opens a conversation with them for an employee (the admin user list is closed to employees)', async () => {
      signIn(['EMPLOYEE']);
      expect(await pick('Sara Ahmed')).toBe('/chat?dm=u7');
    });

    it('opens the user list for an admin', async () => {
      signIn(['ADMIN']);
      expect(await pick('Sara Ahmed')).toBe('/admin/users');
    });

    it('opens your own profile when it is you', async () => {
      signIn(['EMPLOYEE']);
      expect(await pick('Me Myself')).toBe('/profile');
    });
  });

  describe('keyboard and mouse together', () => {
    // Five tasks (the search's best five) and “See all results”: six rows.
    const many = { tasks: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, key: `MICO-${i}`, title: `Task ${i}`, projectId: 'p1' })), projects: [], users: [] };
    const ROWS = ['Task 0', 'Task 1', 'Task 2', 'Task 3', 'Task 4', 'See all results'];
    const type = async (text: string) => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: many }))));
      setup(<GlobalSearch debounceMs={0} />);
      const box = screen.getByRole('searchbox', { name: /search/i });
      await userEvent.type(box, text);
      await screen.findByText('Task 4');
      return box;
    };
    const row = (title: string) => screen.getByText(title).closest('button')!;

    it('keeps the highlighted result in view while arrowing down a long list', async () => {
      const box = await type('task');
      const list = row('Task 0').closest('.overflow-y-auto') as HTMLElement;
      // The list shows 100px at a time; each row is 40px tall, stacked from the top.
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 100 });
      list.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 300, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      for (let i = 0; i < 6; i++) {
        const top = i * 40;
        row(ROWS[i]!).getBoundingClientRect = () => ({ top: top - list.scrollTop, bottom: top + 40 - list.scrollTop, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      }
      const first = [...list.querySelectorAll('button')].indexOf(row('Task 0'));
      for (let i = 0; i < first + 5; i++) fireEvent.keyDown(box, { key: 'ArrowDown' }); // onto "See all results" (rows before it are "Go to" items)
      expect(row('See all results').className).toContain('bg-brand/10');
      expect(list.scrollTop).toBeGreaterThan(0);
      const at = row('See all results').getBoundingClientRect();
      expect(at.bottom).toBeLessThanOrEqual(100);
    });

    it('Enter opens the first result even when the mouse pointer happens to rest over another row', async () => {
      const box = await type('task');
      // The list appears under a pointer that is not moving: the browser reports "enter", not "move".
      fireEvent.mouseEnter(row('Task 3'));
      expect(row('Task 3').className).not.toContain('bg-brand/10');
      // Moving the mouse onto a row does choose it.
      fireEvent.mouseMove(row('Task 4'));
      expect(row('Task 4').className).toContain('bg-brand/10');
      expect(box).toBeInTheDocument();
    });

    it('shows the shortcut the keyboard really has (Ctrl+K on Windows and Linux, ⌘K on a Mac)', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: many }))));
      const platform = vi.spyOn(navigator, 'platform', 'get');
      platform.mockReturnValue('Win32');
      const { unmount } = setup(<GlobalSearch debounceMs={0} />);
      expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
      unmount();
      platform.mockReturnValue('MacIntel');
      setup(<GlobalSearch debounceMs={0} />);
      expect(screen.getByText('⌘K')).toBeInTheDocument();
    });

    it('is reached with Ctrl+K from anywhere in the app', () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: many }))));
      setup(<ShortcutProvider><GlobalSearch debounceMs={0} /></ShortcutProvider>);
      const e = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
      act(() => {
        document.body.dispatchEvent(e);
      });
      expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search' }));
      expect(e.defaultPrevented).toBe(true);
    });

    it('reopens the list when the box is focused again straight after it closed', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: many }))));
        setup(<GlobalSearch debounceMs={0} />);
        const box = screen.getByRole('searchbox', { name: /search/i });
        fireEvent.focus(box);
        expect(await screen.findByText('Dashboard')).toBeInTheDocument();
        fireEvent.blur(box);   // starts the short "close" delay…
        fireEvent.focus(box);  // …and the box is focused again before it runs out
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

