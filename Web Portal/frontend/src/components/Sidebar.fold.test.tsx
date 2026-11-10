import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Sidebar } from './Sidebar';
import { useAppearanceStore } from '../lib/appearance';
import { useAuthStore } from '../stores/auth-store';

/**
 * 1.23.8 The collapsible left menu (owner, 10 Nov): one toggle; icons with words open, icons alone folded (named on
 * hover and focus); a smooth 200 ms width change (instant with reduced motion); the page re-measures afterwards;
 * remembered on the account (lib/appearance.test.tsx); every item reachable folded — the Admin group through a
 * fly-out list; tablets get the same toggle, folded by default, unfolding over the page.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let saved: unknown[];
type Screen = 'desktop' | 'tablet';
function screenIs(kind: Screen) {
  if (typeof window.PointerEvent === 'undefined') vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('matchMedia', (query: string) => {
    const tablet = /max-width/.test(query) && /48em/.test(query);
    const desktop = /min-width: 64em/.test(query) && !/max-width/.test(query);
    return { matches: kind === 'tablet' ? tablet : desktop, media: query, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
  });
}
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
const renderMenu = (path = '/dashboard') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar isAdmin canLead />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const nav = () => screen.getByRole('navigation', { name: 'Main' });

beforeEach(() => {
  saved = [];
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input).endsWith('/users/me/preferences') && init?.method === 'PUT') {
        saved.push(JSON.parse(String(init.body)));
        return json({ data: { timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: true, boardColumnWidth: 'normal' } });
      }
      return json({ data: [] });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  act(() => useAppearanceStore.getState().set({ sidebarCollapsed: false, boardColumnWidth: 'normal' }));
});

describe('the toggle and its animation', () => {
  it('one toggle folds and unfolds; the width changes smoothly in 200 ms (and nothing else moves)', () => {
    screenIs('desktop');
    renderMenu();
    expect(nav().className).toMatch(/transition-\[width\]/);
    expect(nav().className).toMatch(/duration-200/);
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    // Reduced motion: every transition and animation is instant.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.001ms !important/);
  });

  it('after folding, the page is told to measure again (board, Timeline and Calendar fit the new room)', async () => {
    screenIs('desktop');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderMenu();
    const resized = vi.fn();
    window.addEventListener('resize', resized);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the menu' }));
    expect(resized).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(260));
    expect(resized).toHaveBeenCalled();
    window.removeEventListener('resize', resized);
  });
});

describe('folded: every item still reachable', () => {
  it('the Admin items sit behind one Admin icon with a fly-out list (open: each a plain link)', () => {
    screenIs('desktop');
    const open = renderMenu();
    expect(within(nav()).getByRole('link', { name: 'User Management' })).toBeInTheDocument();
    expect(within(nav()).queryByRole('button', { name: 'Admin' })).toBeNull();
    open.unmount();
    act(() => useAppearanceStore.getState().set({ sidebarCollapsed: true }));
    renderMenu();
    expect(within(nav()).queryByRole('link', { name: 'User Management' })).toBeNull();
    const group = within(nav()).getByRole('button', { name: 'Admin' });
    expect(group).toHaveAttribute('aria-haspopup', 'menu');
    expect(group).toHaveAttribute('aria-expanded', 'false');
    // The workspace items keep their own icons.
    expect(within(nav()).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });

  it('click opens the list; the arrow keys move; Escape closes it and gives focus back', async () => {
    screenIs('desktop');
    act(() => useAppearanceStore.getState().set({ sidebarCollapsed: true }));
    renderMenu();
    const user = userEvent.setup();
    const group = within(nav()).getByRole('button', { name: 'Admin' });
    await user.click(group);
    const menu = screen.getByRole('menu', { name: 'Admin' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['User Management', 'Clients', 'Companies', 'AI Management', 'System Settings', 'Error Log', 'Audit Logs']);
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(items[items.length - 1]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Admin' })).toBeNull();
    expect(document.activeElement).toBe(group);
  });

  it('Enter opens it from the keyboard; choosing an item goes there and closes the list', async () => {
    screenIs('desktop');
    act(() => useAppearanceStore.getState().set({ sidebarCollapsed: true }));
    renderMenu();
    const user = userEvent.setup();
    within(nav()).getByRole('button', { name: 'Admin' }).focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'Admin' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Clients' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/clients');
    expect(screen.queryByRole('menu', { name: 'Admin' })).toBeNull();
  });

  it('hover opens it too, and the group says when the page you are on is inside it', () => {
    screenIs('desktop');
    act(() => useAppearanceStore.getState().set({ sidebarCollapsed: true }));
    renderMenu('/admin/audit');
    const group = within(nav()).getByRole('button', { name: 'Admin' });
    expect(group.getAttribute('data-current')).toBe('true');
    fireEvent.pointerEnter(group);
    expect(screen.getByRole('menu', { name: 'Admin' })).toBeInTheDocument();
    expect(within(screen.getByRole('menu', { name: 'Admin' })).getByRole('menuitem', { name: 'Audit Logs' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('tablets (768–1023px): the same toggle, folded by default, unfolding over the page', () => {
  it('the toggle is there; it opens the full menu over the page (nothing saved to the account)', async () => {
    screenIs('tablet');
    renderMenu();
    const user = userEvent.setup();
    const toggle = within(nav()).getByRole('button', { name: 'Expand the menu' });
    expect(toggle.className).toMatch(/\bmd:flex\b/);
    expect(within(nav()).getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    await user.click(toggle);
    const over = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(over).getByRole('link', { name: 'User Management' })).toBeInTheDocument();
    expect(saved).toEqual([]);
    // Escape closes it, and focus goes back to the toggle.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
    expect(document.activeElement).toBe(toggle);
  });

  it('picking an item closes it; so does a tap outside, and its own Collapse button', async () => {
    screenIs('tablet');
    renderMenu();
    const user = userEvent.setup();
    await user.click(within(nav()).getByRole('button', { name: 'Expand the menu' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('link', { name: 'Calendar' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/calendar');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
    await user.click(within(nav()).getByRole('button', { name: 'Expand the menu' }));
    fireEvent.click(document.querySelector('[data-menu-scrim]')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
    await user.click(within(nav()).getByRole('button', { name: 'Expand the menu' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('button', { name: 'Collapse the menu' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
  });

  it('it slides in and out (not a jump); reduced motion makes that instant (index.css)', async () => {
    screenIs('tablet');
    renderMenu();
    await userEvent.setup().click(within(nav()).getByRole('button', { name: 'Expand the menu' }));
    const panel = screen.getByRole('dialog', { name: 'Menu' });
    expect(panel.getAttribute('data-state')).toBe('open');
    expect(panel.className).toMatch(/animate-menu-in/);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(panel.getAttribute('data-state')).toBe('closing');
    expect(panel.className).toMatch(/animate-menu-out/);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
  });
});
