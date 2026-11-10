import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar, SidebarBody } from './Sidebar';
import { useAppearanceStore } from '../lib/appearance';
import { useAuthStore } from '../stores/auth-store';

/** Pretend the window is a tablet (the slim rail shows) or not. */
function tablet(isTablet: boolean) {
  // jsdom has no PointerEvent: a MouseEvent carries the same relatedTarget.
  if (typeof window.PointerEvent === 'undefined') vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: isTablet && /max-width/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
}
function renderSidebar(path = '/dashboard', chatUnread = 0) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar isAdmin chatUnread={chatUnread} canLead />
    </MemoryRouter>,
  );
}
const tip = () => document.querySelector('[data-rail-tooltip]');
afterEach(() => {
  vi.unstubAllGlobals();
  useAppearanceStore.getState().set({ sidebarCollapsed: false, boardColumnWidth: 'normal' });
});

describe('the menu as a slim rail on a tablet (768–1023px), or folded on a desktop (rail: variant)', () => {
  it('is a 64px rail on a tablet and the full menu from 1024px', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toHaveClass('md:flex', 'w-16', 'lg:w-60', 'rail:w-16');
  });

  it('keeps every link’s name for screen readers while its words are hidden beside the icon', () => {
    renderSidebar();
    const projects = screen.getByRole('link', { name: 'Projects' });
    expect(within(projects).getByText('Projects')).toHaveClass('rail:sr-only');
    expect(projects).toHaveClass('rail:justify-center');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveClass('rail:justify-center');
  });

  it('hides the group labels visually (a thin line separates the groups instead)', () => {
    renderSidebar();
    expect(screen.getByText('Communication')).toHaveClass('rail:sr-only');
    expect(document.querySelectorAll('[data-rail-divider]').length).toBe(2);
  });

  it('keeps the Chat count on the icon', () => {
    renderSidebar('/dashboard', 7);
    expect(screen.getByRole('link', { name: 'Chat, 7 unread messages' }).querySelector('[data-chat-badge]')).toHaveTextContent('7');
  });

  it('marks the page you are on', () => {
    renderSidebar('/projects');
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the small app mark instead of the wide logo, and only the version number at the bottom', () => {
    renderSidebar();
    expect(document.querySelector('[data-rail-mark]')).toHaveClass('hidden', 'rail:block');
    expect(document.querySelector('[data-rail-wordmark]')).toHaveClass('rail:hidden');
    expect(document.querySelector('[data-rail-version-brand]')).toHaveClass('rail:hidden');
  });

  describe('the name beside an icon (a tooltip)', () => {
    it('appears when a link is focused from the keyboard, and Escape puts it away', () => {
      tablet(true);
      renderSidebar();
      fireEvent.focusIn(screen.getByRole('link', { name: 'Projects' }));
      expect(tip()).toHaveTextContent('Projects');
      expect(tip()).toHaveAttribute('aria-hidden', 'true'); // the link already says its name
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(tip()).toBeNull();
    });

    it('appears on hover and goes when the pointer leaves the menu', () => {
      tablet(true);
      renderSidebar();
      const calendar = screen.getByRole('link', { name: 'Calendar' });
      fireEvent.pointerOver(calendar);
      expect(tip()).toHaveTextContent('Calendar');
      fireEvent.pointerOut(calendar, { relatedTarget: document.body });
      expect(tip()).toBeNull();
    });

    it('stays while the pointer moves onto it (it can be read without losing it)', () => {
      tablet(true);
      renderSidebar();
      const calendar = screen.getByRole('link', { name: 'Calendar' });
      fireEvent.pointerOver(calendar);
      fireEvent.pointerOut(calendar, { relatedTarget: tip() });
      expect(tip()).toHaveTextContent('Calendar');
    });

    it('never appears with the full menu (its names are on screen)', () => {
      tablet(false);
      renderSidebar();
      fireEvent.focusIn(screen.getByRole('link', { name: 'Projects' }));
      expect(tip()).toBeNull();
    });
  });

  it('gives every item its own icon (on the rail the icon is all that tells them apart)', () => {
    for (const isAdmin of [true, false]) {
      const view = render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar isAdmin={isAdmin} canLead />
        </MemoryRouter>,
      );
      const icons = screen.getAllByRole('link').map((link) => link.querySelector('svg')!.innerHTML);
      expect(new Set(icons).size).toBe(icons.length);
      view.unmount();
    }
  });

  it('the phone menu is never a rail', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <nav aria-label="Phone menu"><SidebarBody isAdmin canLead /></nav>
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Phone menu' });
    expect(within(nav).getByText('Projects')).not.toHaveClass('rail:sr-only');
    expect(nav.querySelectorAll('[data-rail-divider]')).toHaveLength(0);
    expect(nav.querySelector('[data-rail-mark]')).toBeNull();
  });
});

describe('folding the menu on a desktop (1.23.8)', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let saved: unknown[];
  beforeEach(() => {
    saved = [];
    useAuthStore.getState().setSession({ user: { id: 'me', email: 'me@x', username: 'me', roles: ['EMPLOYEE'] }, accessToken: 'at', refreshToken: 'rt' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).endsWith('/users/me/preferences') && init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          saved.push(body);
          return json({ data: { timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal', ...body } });
        }
        if (String(input).endsWith('/users/me/preferences')) return json({ data: { timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' } });
        return json({ data: [] });
      }),
    );
  });
  afterEach(() => useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }));
  /** A desktop window (1024px or more), not a tablet. */
  function desktop() {
    if (typeof window.PointerEvent === 'undefined') vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: /min-width: 64em/.test(query) && !/max-width/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList);
  }
  const renderWithData = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Sidebar isAdmin canLead />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('a « button folds it to the icons — desktop only (a tablet is always the rail, a phone has ☰)', async () => {
    desktop();
    renderWithData();
    const fold = screen.getByRole('button', { name: 'Collapse the menu' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    // 1.23.8: tablets have it too (it opens the menu over the page there).
    expect(fold).toHaveClass('hidden', 'md:flex');
    await userEvent.setup().click(fold);
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('collapsed');
    const unfold = screen.getByRole('button', { name: 'Expand the menu' });
    expect(unfold).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(saved).toEqual([{ sidebarCollapsed: true }]));
    await userEvent.setup().click(unfold);
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('open');
    await waitFor(() => expect(saved).toEqual([{ sidebarCollapsed: true }, { sidebarCollapsed: false }]));
  });

  it('folded, each icon names itself beside it (a tooltip), on hover and keyboard focus', () => {
    desktop();
    act(() => useAppearanceStore.getState().set({ sidebarCollapsed: true }));
    renderWithData();
    fireEvent.focusIn(screen.getByRole('link', { name: 'Projects' }));
    expect(tip()).toHaveTextContent('Projects');
    fireEvent.pointerOver(screen.getByRole('link', { name: 'Calendar' }));
    expect(tip()).toHaveTextContent('Calendar');
    // The fold button names itself too.
    fireEvent.focusIn(screen.getByRole('button', { name: 'Expand the menu' }));
    expect(tip()).toHaveTextContent('Expand the menu');
  });

  it('open on a desktop: no tooltips (the names are on screen)', () => {
    desktop();
    renderWithData();
    fireEvent.focusIn(screen.getByRole('link', { name: 'Projects' }));
    expect(tip()).toBeNull();
  });

  it('the phone menu has no fold button', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <nav aria-label="Phone menu"><SidebarBody isAdmin canLead /></nav>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(within(screen.getByRole('navigation', { name: 'Phone menu' })).queryByRole('button', { name: /the menu/ })).toBeNull();
  });
});
