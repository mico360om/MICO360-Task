import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Sidebar, SidebarBody } from './Sidebar';

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
afterEach(() => vi.unstubAllGlobals());

describe('the menu as a slim rail on a tablet (768–1023px)', () => {
  it('is a 64px rail on a tablet and the full menu from 1024px', () => {
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toHaveClass('md:flex', 'w-16', 'lg:w-60');
  });

  it('keeps every link’s name for screen readers while its words are hidden beside the icon', () => {
    renderSidebar();
    const projects = screen.getByRole('link', { name: 'Projects' });
    expect(within(projects).getByText('Projects')).toHaveClass('md:max-lg:sr-only');
    expect(projects).toHaveClass('md:max-lg:justify-center');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveClass('md:max-lg:justify-center');
  });

  it('hides the group labels visually (a thin line separates the groups instead)', () => {
    renderSidebar();
    expect(screen.getByText('Communication')).toHaveClass('md:max-lg:sr-only');
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
    expect(document.querySelector('[data-rail-mark]')).toHaveClass('hidden', 'md:max-lg:block');
    expect(document.querySelector('[data-rail-wordmark]')).toHaveClass('md:max-lg:hidden');
    expect(document.querySelector('[data-rail-version-brand]')).toHaveClass('md:max-lg:hidden');
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

  it('the phone menu is never a rail', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <nav aria-label="Phone menu"><SidebarBody isAdmin canLead /></nav>
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Phone menu' });
    expect(within(nav).getByText('Projects')).not.toHaveClass('md:max-lg:sr-only');
    expect(nav.querySelectorAll('[data-rail-divider]')).toHaveLength(0);
    expect(nav.querySelector('[data-rail-mark]')).toBeNull();
  });
});
