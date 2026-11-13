import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar, SidebarBody } from './Sidebar';
import { useAppearanceStore } from '../lib/appearance';
import { useAuthStore } from '../stores/auth-store';

/**
 * Owner, 13 Nov (batch 4b): the left menu's Admin group is now User Management, Third Party ▾ (Clients, Guest
 * contacts), AI Management, System Settings. The Recycle Bin, Error Log and Audit Logs moved to the account
 * menu; Companies into System Settings. Routes and page titles are unchanged.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function screenIs(kind: 'desktop' | 'tablet') {
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
function renderMenu(opts: { path?: string; isAdmin?: boolean; canLead?: boolean; adminMenu?: boolean } = {}) {
  const { path = '/dashboard', isAdmin = true, canLead = isAdmin, adminMenu = isAdmin } = opts;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar isAdmin={isAdmin} adminMenu={adminMenu} canLead={canLead} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const nav = () => screen.getByRole('navigation', { name: 'Main' });
const linkNames = () => within(nav()).getAllByRole('link').map((l) => l.textContent);
const MOVED = ['Recycle Bin', 'Error Log', 'Audit Logs', 'Companies'];

beforeEach(() => {
  useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['ADMIN'] }, accessToken: 'at', refreshToken: 'rt' });
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
  act(() => useAppearanceStore.getState().set({ sidebarCollapsed: false }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
});

describe('the Admin group (expanded menu)', () => {
  it('is User Management, Third Party, AI Management, System Settings — nothing that moved', () => {
    screenIs('desktop');
    renderMenu();
    const names = linkNames();
    expect(names.slice(names.indexOf('User Management'), names.indexOf('System Settings') + 1)).toEqual(['User Management', 'AI Management', 'System Settings']);
    const third = within(nav()).getByRole('button', { name: 'Third Party' });
    // Right after User Management, before AI Management.
    const order = Array.from(nav().querySelectorAll('a, button')).map((e) => e.textContent?.trim());
    expect(order.indexOf('Third Party')).toBe(order.indexOf('User Management') + 1);
    expect(third).toHaveAttribute('aria-expanded', 'false');
    for (const gone of [...MOVED, 'Clients', 'Guest contacts']) expect(within(nav()).queryByRole('link', { name: gone })).toBeNull();
  });

  it('Third Party opens and closes on click, its two links under it', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    const third = within(nav()).getByRole('button', { name: 'Third Party' });
    await user.click(third);
    expect(third).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(third.getAttribute('aria-controls')!)!;
    expect(within(list).getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/admin/clients');
    expect(within(list).getByRole('link', { name: 'Guest contacts' })).toHaveAttribute('href', '/admin/guests');
    await user.click(third);
    expect(third).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByRole('link', { name: 'Clients' })).toBeNull();
  });

  it('is open on the Clients and Guest contacts pages, the page you are on marked', () => {
    screenIs('desktop');
    renderMenu({ path: '/admin/guests' });
    expect(within(nav()).getByRole('button', { name: 'Third Party' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav()).getByRole('link', { name: 'Guest contacts' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('link', { name: 'Clients' })).not.toHaveAttribute('aria-current');
  });

  it('keyboard: Enter and Space open and close it', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    const third = within(nav()).getByRole('button', { name: 'Third Party' });
    third.focus();
    await user.keyboard('{Enter}');
    expect(third).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(document.activeElement).toBe(within(nav()).getByRole('link', { name: 'Clients' }));
    third.focus();
    await user.keyboard(' ');
    expect(third).toHaveAttribute('aria-expanded', 'false');
  });

  it('no Recycle Bin in the left menu for anyone (admin, project runner, employee); no Admin group without the Admin menu', () => {
    screenIs('desktop');
    for (const who of [{ isAdmin: true }, { isAdmin: false, canLead: true }, { isAdmin: false, canLead: false }, { isAdmin: true, adminMenu: false }]) {
      const view = renderMenu(who);
      expect(within(nav()).queryByRole('link', { name: 'Recycle Bin' })).toBeNull();
      if (!who.isAdmin || who.adminMenu === false) expect(within(nav()).queryByRole('button', { name: 'Third Party' })).toBeNull();
      view.unmount();
    }
  });
});

describe('the Admin group on the icon rail (folded menu, tablet)', () => {
  beforeEach(() => act(() => useAppearanceStore.getState().set({ sidebarCollapsed: true })));

  it('the Admin fly-out lists User Management, Third Party, AI Management, System Settings', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    await user.click(within(nav()).getByRole('button', { name: 'Admin' }));
    const menu = screen.getByRole('menu', { name: 'Admin' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['User Management', 'Third Party', 'AI Management', 'System Settings']);
    expect(within(menu).getByRole('menuitem', { name: 'Third Party' })).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('Third Party opens a small list beside it by click; Escape closes it and gives focus back; a link goes there', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    await user.click(within(nav()).getByRole('button', { name: 'Admin' }));
    const third = within(screen.getByRole('menu', { name: 'Admin' })).getByRole('menuitem', { name: 'Third Party' });
    await user.click(third);
    const sub = screen.getByRole('menu', { name: 'Third Party' });
    expect(third).toHaveAttribute('aria-expanded', 'true');
    expect(within(sub).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Clients', 'Guest contacts']);
    expect(document.activeElement).toBe(within(sub).getByRole('menuitem', { name: 'Clients' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Third Party' })).toBeNull();
    expect(document.activeElement).toBe(third);
    await user.keyboard('{ArrowRight}');
    const again = screen.getByRole('menu', { name: 'Third Party' });
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(within(again).getByRole('menuitem', { name: 'Guest contacts' }));
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('menu', { name: 'Third Party' })).toBeNull();
    expect(document.activeElement).toBe(third);
    await user.keyboard('{Enter}');
    await user.click(within(screen.getByRole('menu', { name: 'Third Party' })).getByRole('menuitem', { name: 'Guest contacts' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/guests');
    expect(screen.queryByRole('menu', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('menu', { name: 'Third Party' })).toBeNull();
  });

  it('hover opens it; a click outside closes everything', () => {
    screenIs('tablet');
    renderMenu();
    fireEvent.pointerEnter(within(nav()).getByRole('button', { name: 'Admin' }));
    fireEvent.pointerEnter(within(screen.getByRole('menu', { name: 'Admin' })).getByRole('menuitem', { name: 'Third Party' }));
    expect(screen.getByRole('menu', { name: 'Third Party' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Third Party' })).toBeNull();
    expect(screen.queryByRole('menu', { name: 'Admin' })).toBeNull();
  });

  it('on a Clients page the Admin icon and Third Party say the page is inside them', async () => {
    screenIs('desktop');
    renderMenu({ path: '/admin/clients' });
    const group = within(nav()).getByRole('button', { name: 'Admin' });
    expect(group.getAttribute('data-current')).toBe('true');
    await userEvent.setup().click(group);
    expect(within(screen.getByRole('menu', { name: 'Admin' })).getByRole('menuitem', { name: 'Third Party' }).getAttribute('data-current')).toBe('true');
  });
});

describe('the phone and tablet ☰ menu', () => {
  it('has the same expandable Third Party item', async () => {
    screenIs('desktop');
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <nav aria-label="Main">
          <SidebarBody isAdmin canLead />
        </nav>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const third = within(nav()).getByRole('button', { name: 'Third Party' });
    await user.click(third);
    expect(within(nav()).getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/admin/clients');
    for (const gone of MOVED) expect(within(nav()).queryByRole('link', { name: gone })).toBeNull();
  });
});

describe('review minors: the rail’s Third Party list and keyboard focus', () => {
  beforeEach(() => act(() => useAppearanceStore.getState().set({ sidebarCollapsed: true })));

  it('Escape with focus on Third Party (its list opened by hover) closes only that list first', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    await user.click(within(nav()).getByRole('button', { name: 'Admin' }));
    const third = within(screen.getByRole('menu', { name: 'Admin' })).getByRole('menuitem', { name: 'Third Party' });
    third.focus();
    fireEvent.pointerEnter(third);
    expect(screen.getByRole('menu', { name: 'Third Party' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Third Party' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Admin' })).toBeInTheDocument();
    expect(document.activeElement).toBe(third);
  });

  it('the pointer passing over another item never drops keyboard focus inside Third Party’s list', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    await user.click(within(nav()).getByRole('button', { name: 'Admin' }));
    const admin = screen.getByRole('menu', { name: 'Admin' });
    await user.click(within(admin).getByRole('menuitem', { name: 'Third Party' }));
    const clients = within(screen.getByRole('menu', { name: 'Third Party' })).getByRole('menuitem', { name: 'Clients' });
    expect(document.activeElement).toBe(clients);
    fireEvent.pointerEnter(within(admin).getByRole('menuitem', { name: 'AI Management' }));
    // Either the list stays (focus inside it) or focus goes back to Third Party — never to the page.
    expect(document.activeElement === clients || document.activeElement === within(admin).getByRole('menuitem', { name: 'Third Party' })).toBe(true);
  });

  it('a scroll elsewhere on the page keeps Third Party’s list open, and the keyboard where it was', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    await user.click(within(nav()).getByRole('button', { name: 'Admin' }));
    await user.click(within(screen.getByRole('menu', { name: 'Admin' })).getByRole('menuitem', { name: 'Third Party' }));
    await user.keyboard('{ArrowDown}');
    const guests = within(screen.getByRole('menu', { name: 'Third Party' })).getByRole('menuitem', { name: 'Guest contacts' });
    expect(document.activeElement).toBe(guests);
    // jsdom draws nothing (every box is 0×0, read as "out of sight"): give the boxes a size, as a browser does.
    const realRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 0, right: 64, width: 64, height: 40, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    await act(async () => {
      fireEvent.scroll(window);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    Element.prototype.getBoundingClientRect = realRect;
    expect(screen.getByRole('menu', { name: 'Third Party' })).toBeInTheDocument();
    expect(document.activeElement?.textContent).toBe('Guest contacts');
  });

  it('the Admin list owns Third Party’s list for screen readers', async () => {
    screenIs('desktop');
    renderMenu();
    const user = userEvent.setup();
    await user.click(within(nav()).getByRole('button', { name: 'Admin' }));
    await user.click(within(screen.getByRole('menu', { name: 'Admin' })).getByRole('menuitem', { name: 'Third Party' }));
    const sub = screen.getByRole('menu', { name: 'Third Party' });
    expect(screen.getByRole('menu', { name: 'Admin' }).getAttribute('aria-owns')).toBe(sub.id);
  });
});
