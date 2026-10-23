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

describe('GlobalSearch', () => {
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

  it('a found task that moved shows the key it had too, so it can be told apart', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: { tasks: [{ id: 't4', key: 'OPS-17', title: 'Inspect the rig', projectId: 'p2', formerKeys: ['RIG-4'] }], projects: [], users: [] } }))));
    setup(<GlobalSearch debounceMs={0} />);
    await userEvent.type(screen.getByRole('searchbox', { name: /search/i }), 'rig-4');
    expect(await screen.findByText('OPS-17 (was RIG-4)')).toBeInTheDocument();
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
    const many = { tasks: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, key: `MICO-${i}`, title: `Task ${i}`, projectId: 'p1' })), projects: [], users: [] };
    const type = async (text: string) => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ data: many }))));
      setup(<GlobalSearch debounceMs={0} />);
      const box = screen.getByRole('searchbox', { name: /search/i });
      await userEvent.type(box, text);
      await screen.findByText('Task 5');
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
        row(`Task ${i}`).getBoundingClientRect = () => ({ top: top - list.scrollTop, bottom: top + 40 - list.scrollTop, left: 0, right: 300, width: 300, height: 40, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      }
      const first = [...list.querySelectorAll('button')].indexOf(row('Task 0'));
      for (let i = 0; i < first + 5; i++) fireEvent.keyDown(box, { key: 'ArrowDown' }); // onto "Task 5" (rows before it are "Go to" items)
      expect(row('Task 5').className).toContain('bg-brand/10');
      expect(list.scrollTop).toBeGreaterThan(0);
      const at = row('Task 5').getBoundingClientRect();
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

