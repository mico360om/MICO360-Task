import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NotificationsPage } from './NotificationsPage';
import { NotificationsBell } from '../components/NotificationsBell';
import { useAuthStore } from '../stores/auth-store';

// The Notifications page (1.22): All / Unread tabs and type chips (remembered per person in this
// browser), day groups with each kind's icon and the project, Mark read / unread, Remove with Undo,
// several at once, pages of 50 ("Show older", "That's everything"), and the bell still right.

type Row = { id: string; type: string; title: string; body?: string | null; readAt: string | null; createdAt: string; projectId?: string | null; project?: unknown; entityType?: string | null; entityId?: string | null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const today = (hh: number, mm: number) => {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};
const daysAgo = (n: number, hh = 9) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hh, 0, 0, 0);
  return d.toISOString();
};
const RIG = { id: 'p1', name: 'Rig Inspection', color: '#0E7490', icon: null, imageUrl: null };
const ROWS: Row[] = [
  { id: 'n1', type: 'MENTION', title: 'You were mentioned in a comment', body: 'RIG-4 · Pressure test', readAt: null, createdAt: today(9, 5), projectId: 'p1', project: RIG, entityType: 'task', entityId: 't1' },
  { id: 'n2', type: 'TASK_ASSIGNED', title: 'You were assigned a task', body: null, readAt: '2026-11-01T00:00:00.000Z', createdAt: daysAgo(1), projectId: null, project: null },
  { id: 'n3', type: 'MEETING_REMINDER', title: 'Meeting in 15 minutes: Review', body: null, readAt: null, createdAt: daysAgo(3), projectId: null, project: null, entityType: 'meeting', entityId: 'm1' },
];
const COUNTS = { unread: 2, kinds: { mentions: 1, assigned: 0, due: 0, comments: 0, approvals: 0, meetings: 1 } };

let calls: { method: string; url: string; body: unknown }[];
let pages: (url: URL) => { data: Row[]; nextCursor: string | null };
let failRemove = false;
/** Review fixes: an older page that fails, a read-all that fails, a remove answered 404. */
let failOlder = false;
let failReadAll = false;
let removeStatus = 200;
function server() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://x');
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ method, url: `${url.pathname}${url.search}`, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const path = url.pathname.replace(/^\/api\/v1/, '');
      if (path === '/notifications/counts') return json({ data: COUNTS });
      if (path === '/notifications/unread-count') return json({ data: { count: COUNTS.unread } });
      if (path === '/notifications' && method === 'GET' && failOlder && url.searchParams.get('cursor')) {
        // As over a network: the page is drawn loading before the answer comes.
        await new Promise((r) => setTimeout(r, 50));
        return json({ error: { code: 'X', message: 'down' } }, 500);
      }
      if (path === '/notifications' && method === 'GET') return json(pages(url));
      if (method === 'DELETE' && failRemove) return json({ error: { code: 'X', message: 'down' } }, 500);
      if (method === 'DELETE' && removeStatus !== 200) return json({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } }, removeStatus);
      if (path === '/notifications/read-all' && failReadAll) return json({ error: { code: 'X', message: 'down' } }, 500);
      if (path.startsWith('/notifications/')) return json({ data: { ok: true, count: 1 } });
      if (path === '/projects') return json({ data: [{ id: 'p1' }] });
      // The rows are made in this machine's zone: the page groups days in the same one.
      if (path === '/config') return json({ data: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      return json({ data: {} });
    }),
  );
}
const sent = (method: string, prefix: string) => calls.filter((c) => c.method === method && c.url.startsWith(prefix));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}
function renderPage(ui = <NotificationsPage undoMs={60} />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/notifications']}>
          <Routes>
            <Route path="*" element={<>{ui}<LocationProbe /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  localStorage.clear();
  failRemove = false;
  failOlder = false;
  failReadAll = false;
  removeStatus = 200;
  useAuthStore.setState({ user: { id: 'u1', email: 'a@x', username: 'a', roles: ['EMPLOYEE'] } as never, accessToken: 'at', refreshToken: 'rt', isAuthenticated: true });
  pages = () => ({ data: ROWS, nextCursor: null });
  server();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tabs and type chips', () => {
  it('All and “Unread (2)”; the Unread tab asks the server for unread ones only', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    const unread = await screen.findByRole('button', { name: 'Unread (2)' });
    await userEvent.click(unread);
    expect(unread).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(sent('GET', '/api/v1/notifications?').some((c) => c.url.includes('unread=1'))).toBe(true));
    expect(sent('GET', '/api/v1/notifications?')[0]!.url).toContain('limit=50');
  });

  it('chips (with their unread number) ask for their kinds, combine, and “All types” clears them', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    const mentions = await screen.findByRole('button', { name: 'Mentions, 1 unread' });
    await userEvent.click(mentions);
    await waitFor(() => expect(sent('GET', '/api/v1/notifications?').at(-1)!.url).toContain('kinds=mentions'));
    await userEvent.click(screen.getByRole('button', { name: 'Due & overdue' }));
    await waitFor(() => expect(sent('GET', '/api/v1/notifications?').at(-1)!.url).toContain(`kinds=${encodeURIComponent('mentions,due')}`));
    // The Unread tab counts what the chips show.
    expect(screen.getByRole('button', { name: 'Unread (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All types' }));
    await waitFor(() => expect(sent('GET', '/api/v1/notifications?').at(-1)!.url).not.toContain('kinds='));
    expect(screen.getByRole('button', { name: 'All types' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('two clicks before the page draws again both count (the tab and a chip)', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    const unread = screen.getByRole('button', { name: /^Unread/ });
    const meetings = screen.getByRole('button', { name: /^Meetings/ });
    act(() => {
      unread.click();
      meetings.click();
    });
    expect(screen.getByRole('button', { name: /^Unread/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Meetings/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('remembers the tab and chips per person in this browser', async () => {
    const first = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Unread/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Meetings/ }));
    expect(JSON.parse(localStorage.getItem('mico360.u.u1.notifications.filter')!)).toEqual({ tab: 'unread', kinds: ['meetings'] });
    first.unmount();
    calls = [];
    renderPage();
    await waitFor(() => expect(sent('GET', '/api/v1/notifications?')[0]!.url).toMatch(/unread=1.*kinds=meetings|kinds=meetings.*unread=1/));
    expect(screen.getByRole('button', { name: /^Meetings/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('an empty tab or chip says so, with a way back', async () => {
    pages = (url) => ({ data: url.searchParams.get('unread') ? [] : ROWS, nextCursor: null });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Unread/ }));
    expect(await screen.findByText('No unread notifications')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all notifications' }));
    expect(await screen.findByText('You were mentioned in a comment')).toBeInTheDocument();

    pages = (url) => ({ data: url.searchParams.get('kinds') ? [] : ROWS, nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: /^Approvals/ }));
    expect(await screen.findByText('No approvals')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all types' }));
    expect(await screen.findByText('You were mentioned in a comment')).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('grouped by day (Today, Yesterday, then the day), each with its kind, its project and its time', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual(['Today', 'Yesterday']);
    expect(headings[2]).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}( \d{4})?$/);
    const row = screen.getByText('You were mentioned in a comment').closest('li')!;
    expect(within(row).getByText('Rig Inspection')).toBeInTheDocument();
    expect(row.querySelector('[data-project-avatar]')).not.toBeNull();
    expect(within(row).getByText('Mention:')).toHaveClass('sr-only'); // its kind, for screen readers
    expect(row.querySelector('[data-kind-icon="mention"]')).not.toBeNull();
    expect(within(row).getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(row).getByText('RIG-4 · Pressure test')).toHaveAttribute('dir', 'auto');
  });

  it('says a read one more quietly than an unread one', async () => {
    renderPage();
    expect(await screen.findByText('You were mentioned in a comment')).toHaveClass('font-medium', 'text-ink');
    expect(screen.getByText('You were assigned a task')).toHaveClass('text-ink-2');
  });

  it('a click opens what it is about and marks it read', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Meeting in 15 minutes: Review'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/meetings/m1'));
    expect(sent('PUT', '/api/v1/notifications/n3/read')).toHaveLength(1);
  });

  it('links to Settings → Notifications', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Notification settings' })).toHaveAttribute('href', '/settings#notifications');
  });
});

describe('actions on each', () => {
  it('Mark read and Mark unread', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    await userEvent.click(screen.getByRole('button', { name: 'Mark read: You were mentioned in a comment' }));
    await waitFor(() => expect(sent('PUT', '/api/v1/notifications/n1/read')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Mark unread: You were assigned a task' }));
    await waitFor(() => expect(sent('POST', '/api/v1/notifications/n2/unread')).toHaveLength(1));
  });

  it('Remove hides it at once with “Removed · Undo”; Undo brings it back and nothing is removed', async () => {
    const { unmount } = renderPage(<NotificationsPage undoMs={60_000} />);
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    expect(screen.queryByText('You were assigned a task')).not.toBeInTheDocument();
    const toast = await screen.findByRole('status', { name: 'Removed' });
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('You were assigned a task')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Removed' })).not.toBeInTheDocument();
    // Leaving the page sends what is waiting — after Undo nothing is.
    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(sent('DELETE', '/api/v1/notifications/')).toHaveLength(0);
  });

  it('without Undo, it is removed on the server after the toast’s time', async () => {
    renderPage();
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    await waitFor(() => expect(sent('DELETE', '/api/v1/notifications/n2')).toHaveLength(1));
  });

  it('leaving the page removes at once what is waiting', async () => {
    const { unmount } = renderPage(<NotificationsPage undoMs={60_000} />);
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    unmount();
    await waitFor(() => expect(sent('DELETE', '/api/v1/notifications/n2')).toHaveLength(1));
  });

  it('a remove the server refuses brings the row back and says so', async () => {
    failRemove = true;
    renderPage();
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t remove');
    expect(await screen.findByText('You were assigned a task')).toBeInTheDocument();
  });
});

describe('several at once', () => {
  it('tick some → Mark read, Mark unread, Remove for all of them; “Select all shown” ticks every row', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select: You were mentioned in a comment' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select: Meeting in 15 minutes: Review' }));
    const bar = screen.getByRole('region', { name: 'Selected notifications' });
    expect(bar).toHaveTextContent('2 selected');
    await userEvent.click(within(bar).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(sent('POST', '/api/v1/notifications/bulk').map((c) => c.body)).toEqual([{ ids: ['n1', 'n3'], action: 'read' }]));

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
    expect(screen.getAllByRole('checkbox', { name: /^Select: / }).every((b) => (b as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected notifications' })).getByRole('button', { name: 'Mark unread' }));
    await waitFor(() => expect(sent('POST', '/api/v1/notifications/bulk').at(-1)!.body).toEqual({ ids: ['n1', 'n2', 'n3'], action: 'unread' }));
  });

  it('Remove several: gone at once, “Removed 2 notifications · Undo”, then removed on the server together', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select: You were mentioned in a comment' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select: You were assigned a task' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Selected notifications' })).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('You were mentioned in a comment')).not.toBeInTheDocument();
    expect(await screen.findByRole('status', { name: 'Removed 2 notifications' })).toBeInTheDocument();
    await waitFor(() => expect(sent('POST', '/api/v1/notifications/bulk').at(-1)!.body).toEqual({ ids: ['n1', 'n2'], action: 'remove' }));
  });

  it('on a phone the tick boxes appear after “Select”', async () => {
    const mm = vi.fn((q: string) => ({ matches: !/min-width/.test(q) && !/pointer: fine/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('matchMedia', mm);
    Object.defineProperty(window, 'matchMedia', { value: mm, configurable: true, writable: true });
    try {
      renderPage();
      await screen.findByText('You were mentioned in a comment');
      expect(screen.queryByRole('checkbox', { name: /^Select: / })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Select' }));
      expect(screen.getAllByRole('checkbox', { name: /^Select: / })).toHaveLength(3);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe('Mark all read follows the tab and chips', () => {
  it('sends the chips and the newest shown', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    await userEvent.click(await screen.findByRole('button', { name: /^Mentions/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(sent('POST', '/api/v1/notifications/read-all').at(-1)!.body).toEqual({ upTo: ROWS[0]!.createdAt, kinds: ['mentions'] }));
  });
});

describe('more than one page', () => {
  it('“Show older” asks for the next page by its cursor; at the end, “That’s everything”', async () => {
    const older: Row = { id: 'n9', type: 'TASK_COMMENT', title: 'An older comment', readAt: null, createdAt: daysAgo(10) };
    pages = (url) => (url.searchParams.get('cursor') === 'c1' ? { data: [older], nextCursor: null } : { data: ROWS, nextCursor: 'c1' });
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    expect(screen.queryByText('That’s everything')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('An older comment')).toBeInTheDocument();
    expect(sent('GET', '/api/v1/notifications?').at(-1)!.url).toContain('cursor=c1');
    expect(screen.getByText('That’s everything')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).not.toBeInTheDocument();
  });

  it('loads the next page by itself when the end of the list comes into view', async () => {
    let seen: IntersectionObserverCallback | null = null;
    class IO {
      constructor(cb: IntersectionObserverCallback) { seen = cb; }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', IO);
    pages = (url) => (url.searchParams.get('cursor') === 'c1' ? { data: [{ id: 'n9', type: 'TASK_COMMENT', title: 'An older comment', readAt: null, createdAt: daysAgo(10) }], nextCursor: null } : { data: ROWS, nextCursor: 'c1' });
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    await waitFor(() => expect(seen).not.toBeNull());
    seen!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(await screen.findByText('An older comment')).toBeInTheDocument();
  });
});

describe('the bell still works beside the page', () => {
  it('its badge is the unread count and its list the newest, unchanged', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NotificationsBell />
          <NotificationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    await waitFor(() => expect(sent('GET', '/api/v1/notifications').some((c) => c.url === '/api/v1/notifications')).toBe(true));
    expect(screen.getAllByText('You were mentioned in a comment').length).toBeGreaterThanOrEqual(2); // in the bell and on the page
  });
});

describe('review fixes', () => {
  const openOf = (title: string) => screen.getByText(title).closest('li')!.querySelector<HTMLElement>('[data-open]');
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a failed older page is not asked for again by itself; “Show older” still asks', async () => {
    class IO {
      constructor(private cb: IntersectionObserverCallback) {}
      observe() { this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('IntersectionObserver', IO);
    failOlder = true;
    pages = () => ({ data: ROWS, nextCursor: 'c1' });
    renderPage();
    expect(await screen.findByText('Couldn’t load older notifications.', { exact: false })).toBeInTheDocument();
    const asked = () => sent('GET', '/api/v1/notifications?').filter((c) => c.url.includes('cursor=c1')).length;
    const once = asked();
    await pause(1500);
    expect(asked()).toBe(once);
    await userEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(asked()).toBeGreaterThan(once));
  });

  it('after Remove the keyboard is on the next notification; after Undo, on the one brought back', async () => {
    renderPage(<NotificationsPage undoMs={60_000} />);
    await screen.findByText('You were mentioned in a comment');
    act(() => screen.getByRole('button', { name: 'Remove: You were mentioned in a comment' }).focus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(openOf('You were assigned a task')));
    act(() => within(screen.getByRole('status', { name: 'Removed' })).getByRole('button', { name: 'Undo' }).focus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(openOf('You were mentioned in a comment')));
  });

  it('the Undo time waits while the toast is pointed at or has the keyboard', async () => {
    renderPage(<NotificationsPage undoMs={150} />);
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    const toast = screen.getByRole('status', { name: 'Removed' });
    await userEvent.hover(toast);
    await pause(400);
    expect(sent('DELETE', '/api/v1/notifications/')).toHaveLength(0);
    const undo = within(toast).getByRole('button', { name: 'Undo' });
    act(() => undo.focus());
    await userEvent.unhover(toast);
    await pause(400);
    expect(sent('DELETE', '/api/v1/notifications/')).toHaveLength(0);
    act(() => undo.blur());
    await waitFor(() => expect(sent('DELETE', '/api/v1/notifications/n2')).toHaveLength(1));
  });

  it('switching away from the tab sends a waiting remove at once', async () => {
    renderPage(<NotificationsPage undoMs={60_000} />);
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(sent('DELETE', '/api/v1/notifications/n2')).toHaveLength(1));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  it('on the Unread tab a notification marked read stays (quieter) until the list is read again; only the counts are asked again', async () => {
    pages = (url) => ({ data: url.searchParams.get('unread') ? ROWS.filter((r) => !r.readAt) : ROWS, nextCursor: null });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Unread/ }));
    await waitFor(() => expect(screen.queryByText('You were assigned a task')).not.toBeInTheDocument());
    const lists = () => sent('GET', '/api/v1/notifications?').length;
    const counts = () => sent('GET', '/api/v1/notifications/counts').length;
    const [l0, c0] = [lists(), counts()];
    await userEvent.click(screen.getByRole('button', { name: 'Mark read: You were mentioned in a comment' }));
    await waitFor(() => expect(counts()).toBeGreaterThan(c0));
    await pause(200);
    expect(screen.getByText('You were mentioned in a comment')).toHaveClass('text-ink-2');
    expect(lists()).toBe(l0);
  });

  it('a remove already done elsewhere (404) is not an error', async () => {
    removeStatus = 404;
    renderPage();
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    await waitFor(() => expect(sent('DELETE', '/api/v1/notifications/n2')).toHaveLength(1));
    await pause(100);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('You were assigned a task')).not.toBeInTheDocument();
  });

  it('a Mark all read that fails says so', async () => {
    failReadAll = true;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t mark them read');
  });

  it('clicking the tab that is already on keeps the ticks; another tab clears them', async () => {
    renderPage();
    await screen.findByText('You were mentioned in a comment');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select: You were mentioned in a comment' }));
    await userEvent.click(screen.getByRole('button', { name: /^All$/ }));
    expect(screen.getByRole('checkbox', { name: 'Select: You were mentioned in a comment' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /^Unread/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected notifications' })).not.toBeInTheDocument());
  });

  it('in React’s strict mode a remove is sent once, after its time', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <StrictMode>
        <QueryClientProvider client={qc}>
          <MemoryRouter>
            <NotificationsPage undoMs={60} />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByText('You were assigned a task');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: You were assigned a task' }));
    await waitFor(() => expect(sent('DELETE', '/api/v1/notifications/n2')).toHaveLength(1));
    await pause(150);
    expect(sent('DELETE', '/api/v1/notifications/')).toHaveLength(1);
  });
});
