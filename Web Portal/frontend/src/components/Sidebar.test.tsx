import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

function renderSidebar(isAdmin: boolean, path = '/', chatUnread = 0, canLead = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar isAdmin={isAdmin} chatUnread={chatUnread} canLead={canLead} />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('shows the core navigation for every user', () => {
    renderSidebar(false);
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /kanban board/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /my tasks/i })).toBeInTheDocument();
  });

  it('puts Timeline and Workload right after Calendar, for everyone', () => {
    renderSidebar(false);
    const names = screen.getAllByRole('link').map((l) => l.textContent);
    const at = names.indexOf('Calendar');
    expect(names.slice(at, at + 3)).toEqual(['Calendar', 'Timeline', 'Workload']);
    expect(screen.getByRole('link', { name: 'Timeline' })).toHaveAttribute('href', '/timeline');
    expect(screen.getByRole('link', { name: 'Workload' })).toHaveAttribute('href', '/workload');
  });

  it('shows Templates in the Workspace group to every user, after My Action Items', () => {
    renderSidebar(false);
    const names = screen.getAllByRole('link').map((l) => l.textContent);
    expect(names[names.indexOf('My Action Items') + 1]).toBe('Templates');
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/templates');
  });

  it('shows MICO AI to every user', () => {
    renderSidebar(false);
    expect(screen.getByRole('link', { name: 'MICO AI' })).toHaveAttribute('href', '/mico-ai');
  });

  it('hides admin-only items from employees', () => {
    renderSidebar(false);
    expect(screen.queryByRole('link', { name: /user management/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /audit logs/i })).not.toBeInTheDocument();
    // Reports is admin-only on the API, so employees never see a link that can't open.
    expect(screen.queryByRole('link', { name: /reports/i })).not.toBeInTheDocument();
  });

  it('shows admin-only items to admins', () => {
    renderSidebar(true);
    expect(screen.getByRole('link', { name: /user management/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ai management/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /system settings/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /audit logs/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument();
  });
});

describe('Sidebar: the Management page', () => {
  it('is shown to administrators and to the people who run a project, before Reports', () => {
    renderSidebar(true);
    const names = screen.getAllByRole('link').map((l) => l.textContent);
    expect(names[names.indexOf('Management') + 1]).toBe('Reports');
    expect(screen.getByRole('link', { name: 'Management' })).toHaveAttribute('href', '/management');
  });

  it('a project runner (not an admin) sees it, without Reports', () => {
    renderSidebar(false, '/', 0, true);
    expect(screen.getByRole('link', { name: 'Management' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /reports/i })).not.toBeInTheDocument();
  });

  it('anyone else has no link', () => {
    renderSidebar(false);
    expect(screen.queryByRole('link', { name: 'Management' })).not.toBeInTheDocument();
  });
});

describe('Sidebar on a short screen', () => {
  const originalRect = Element.prototype.getBoundingClientRect;
  const originalScroll = Element.prototype.scrollIntoView;
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
    Element.prototype.scrollIntoView = originalScroll;
  });

  const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 240, width: 240, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  it('scrolls the list so the link of the current page is in view', () => {
    // The list scrolls when the window is short: the page you are on must not hide below the fold.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('overflow-y-auto')) return rect(64, 500);
      if (this.getAttribute('aria-current') === 'page') return rect(620, 656);
      return rect(0, 0);
    };
    renderSidebar(true, '/admin/audit');
    const list = screen.getByRole('link', { name: /audit logs/i }).closest('.overflow-y-auto')!;
    expect(list.scrollTop).toBeGreaterThanOrEqual(156); // 656 - 500: the link's bottom edge reaches the list's
  });

  it('leaves the list alone when the current link is already visible', () => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('overflow-y-auto')) return rect(64, 500);
      if (this.getAttribute('aria-current') === 'page') return rect(100, 136);
      return rect(0, 0);
    };
    renderSidebar(true, '/dashboard');
    expect(screen.getByRole('link', { name: /dashboard/i }).closest('.overflow-y-auto')!.scrollTop).toBe(0);
  });

  it('does not use scrollIntoView, which would make Tab skip the "Skip to content" link in Chrome', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    renderSidebar(true, '/admin/audit');
    expect(spy).not.toHaveBeenCalled();
  });

  describe('the unread badge on Chat', () => {
    it('shows the number of unread messages on the Chat icon, and says it to screen readers', () => {
      renderSidebar(false, '/dashboard', 3);
      const chat = screen.getByRole('link', { name: 'Chat, 3 unread messages' });
      expect(chat).toHaveAttribute('href', '/chat');
      const badge = chat.querySelector('[data-chat-badge]');
      expect(badge).toHaveTextContent('3');
      // The icon and its badge sit together; the number itself is not read twice.
      expect(badge).toHaveAttribute('aria-hidden', 'true');
      expect(badge!.parentElement!.querySelector('svg')).not.toBeNull();
    });

    it('shows 99+ above 99', () => {
      renderSidebar(false, '/dashboard', 150);
      expect(screen.getByRole('link', { name: 'Chat, 150 unread messages' }).querySelector('[data-chat-badge]')).toHaveTextContent('99+');
    });

    it('is hidden when nothing is unread', () => {
      renderSidebar(false, '/dashboard', 0);
      const chat = screen.getByRole('link', { name: 'Chat' });
      expect(chat.querySelector('[data-chat-badge]')).toBeNull();
    });

    it('stays readable on the highlighted Chat link while you are on the Chat page', () => {
      renderSidebar(false, '/chat', 2);
      const chat = screen.getByRole('link', { name: 'Chat, 2 unread messages' });
      expect(chat).toHaveAttribute('aria-current', 'page');
      // White with the dark brand ink: readable in the light and the dark theme.
      expect(chat.querySelector('[data-chat-badge]')).toHaveClass('bg-white', 'text-brand-ink');
    });

    it('is only on Chat', () => {
      renderSidebar(true, '/dashboard', 4);
      expect(document.querySelectorAll('[data-chat-badge]')).toHaveLength(1);
    });
  });

  it('marks the list as the scrolling part of the rail', () => {
    renderSidebar(true);
    const list = screen.getByRole('link', { name: /dashboard/i }).closest('.overflow-y-auto');
    expect(list).toHaveClass('scroll-shadows');
  });
});
