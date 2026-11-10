import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { ProfileMenu } from './ProfileMenu';
import { ManagerViewBadge } from './ManagerViewBadge';
import { AdminRoute, AdminSettingsRoute } from '../features/auth/AdminRoute';
import { useAuthStore } from '../stores/auth-store';
import { MANAGER_VIEW_WORDS, noteManagerViewRefusal, useEffectiveAdmin, useManagerViewStore } from '../lib/manager-view';
import { ApiError } from '../lib/api-client';

// Manager View (owner, 10 Nov 2026) on the website: the switch in the Account menu (administrators only),
// the "Manager View" badge in the top bar, the Admin menu hidden, its pages' addresses showing "Manager View
// is on — turn it off to open this page" with Turn off, and Reports kept.

const ADMIN = { id: 'a1', username: 'admin', email: 'admin@x.test', roles: ['ADMIN'] };
const EMPLOYEE = { id: 'e1', username: 'sara', email: 'sara@x.test', roles: ['EMPLOYEE'] };

const badge = () => document.querySelector('[data-manager-view-badge]');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let serverOn = false;
let puts: unknown[] = [];

function signIn(user: typeof ADMIN) {
  useAuthStore.setState({ user, accessToken: 't', refreshToken: 'r', isAuthenticated: true } as never);
}

beforeEach(() => {
  localStorage.clear();
  useManagerViewStore.getState().clear();
  serverOn = false;
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/users/me/manager-view') && (init?.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(String(init!.body)) as { on: boolean };
        puts.push(body);
        serverOn = body.on;
        return json({ data: { available: true, managerView: serverOn } });
      }
      if (u.endsWith('/users/me/manager-view')) return json({ data: { available: true, managerView: serverOn } });
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false } as never);
});

const wrap = (ui: React.ReactNode, path = '/') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Manager View — the Account menu switch', () => {
  it('an administrator has the switch (off), and turning it on saves it and shows the badge', async () => {
    signIn(ADMIN);
    useManagerViewStore.getState().set('a1', false);
    wrap(
      <>
        <ManagerViewBadge />
        <ProfileMenu />
      </>,
    );
    expect(badge()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const sw = screen.getByRole('menuitemcheckbox', { name: /manager view/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(within(sw).getByText(MANAGER_VIEW_WORDS.hint)).toBeInTheDocument();
    await userEvent.click(sw);
    await waitFor(() => expect(puts).toEqual([{ on: true }]));
    await waitFor(() => expect(badge()).toHaveTextContent(MANAGER_VIEW_WORDS.badge));
    expect(useManagerViewStore.getState()).toMatchObject({ userId: 'a1', on: true });
    // Remembered on this device for the next visit.
    expect(JSON.parse(localStorage.getItem('mico360.managerView')!)).toEqual({ userId: 'a1', on: true });
  });

  it('turning it off from the menu takes the badge away', async () => {
    signIn(ADMIN);
    useManagerViewStore.getState().set('a1', true);
    serverOn = true;
    wrap(
      <>
        <ManagerViewBadge />
        <ProfileMenu />
      </>,
    );
    expect(badge()).toHaveTextContent(MANAGER_VIEW_WORDS.badge);
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const sw = screen.getByRole('menuitemcheckbox', { name: /manager view/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(sw);
    await waitFor(() => expect(puts).toEqual([{ on: false }]));
    await waitFor(() => expect(badge()).toBeNull());
  });

  it('nobody else has the switch, or the badge', async () => {
    signIn(EMPLOYEE);
    useManagerViewStore.getState().set('e1', true); // never on for anyone but an administrator
    wrap(
      <>
        <ManagerViewBadge />
        <ProfileMenu />
      </>,
    );
    expect(badge()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: /manager view/i })).toBeNull();
  });

  it('another person signing in on this device doesn’t inherit it (off until their own is read)', () => {
    useManagerViewStore.getState().set('someone-else', true);
    signIn(ADMIN);
    let effective: boolean | null = null;
    function Probe() {
      effective = useEffectiveAdmin();
      return null;
    }
    wrap(<Probe />);
    expect(effective).toBe(true);
  });

  it('a refusal from the server (turned on on another device) turns it on here', () => {
    signIn(ADMIN);
    useManagerViewStore.getState().set('a1', false);
    noteManagerViewRefusal(new ApiError(403, 'MANAGER_VIEW', 'Manager View is on — turn it off to change settings.'));
    expect(useManagerViewStore.getState().on).toBe(true);
  });
});

describe('Manager View — the menu', () => {
  it('on: the Admin menu is gone; Reports stays', () => {
    render(
      <MemoryRouter>
        <Sidebar isAdmin adminMenu={false} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'User Management' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'System Settings' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Audit Logs' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/reports');
  });

  it('off: the Admin menu is there', () => {
    render(
      <MemoryRouter>
        <Sidebar isAdmin />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'User Management' })).toBeInTheDocument();
  });
});

describe('Manager View — an admin page’s address', () => {
  const routes = (
    <Routes>
      <Route path="/dashboard" element={<p>Dashboard page</p>} />
      <Route element={<AdminRoute />}>
        <Route path="/reports" element={<p>Reports page</p>} />
      </Route>
      <Route element={<AdminSettingsRoute />}>
        <Route path="/admin/settings" element={<p>System Settings page</p>} />
      </Route>
    </Routes>
  );

  it('on: says Manager View is on, with Turn off — which opens the page at once', async () => {
    signIn(ADMIN);
    useManagerViewStore.getState().set('a1', true);
    serverOn = true;
    wrap(routes, '/admin/settings');
    expect(screen.getByRole('heading', { name: MANAGER_VIEW_WORDS.blockedTitle })).toBeInTheDocument();
    expect(screen.getByText(MANAGER_VIEW_WORDS.blockedText)).toBeInTheDocument();
    expect(screen.queryByText('System Settings page')).toBeNull();
    // 44px on a touch screen (gate browser check: it was 36px).
    expect(screen.getByRole('button', { name: MANAGER_VIEW_WORDS.turnOff }).className).toContain('[@media(pointer:coarse)]:!min-h-11');
    await userEvent.click(screen.getByRole('button', { name: MANAGER_VIEW_WORDS.turnOff }));
    await waitFor(() => expect(screen.getByText('System Settings page')).toBeInTheDocument());
    expect(puts).toEqual([{ on: false }]);
  });

  it('on: Reports still opens', () => {
    signIn(ADMIN);
    useManagerViewStore.getState().set('a1', true);
    wrap(routes, '/reports');
    expect(screen.getByText('Reports page')).toBeInTheDocument();
  });

  it('off: the page opens', () => {
    signIn(ADMIN);
    useManagerViewStore.getState().set('a1', false);
    wrap(routes, '/admin/settings');
    expect(screen.getByText('System Settings page')).toBeInTheDocument();
  });

  it('an employee is still sent to the dashboard', () => {
    signIn(EMPLOYEE);
    wrap(routes, '/admin/settings');
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });
});
