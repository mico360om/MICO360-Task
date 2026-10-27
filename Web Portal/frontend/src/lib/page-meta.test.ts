import { describe, it, expect, beforeEach } from 'vitest';
import { applyPageMeta, pageMetaFor, PRODUCT_NAME } from './page-meta';

describe('pageMetaFor', () => {
  it('names every page of the portal', () => {
    const titles: Record<string, string> = {
      '/login': 'Sign in',
      '/forgot': 'Forgot password',
      '/reset': 'Reset password',
      '/privacy': 'Privacy policy',
      '/terms': 'Terms of use',
      '/dashboard': 'Dashboard',
      '/board': 'Kanban Board',
      '/projects': 'Projects',
      '/projects/abc123': 'Project',
      '/my-tasks': 'My Tasks',
      '/calendar': 'Calendar',
      '/timeline': 'Timeline',
      '/workload': 'Workload',
      '/meetings': 'Meetings',
      '/meetings/abc123': 'Meeting',
      '/my-action-items': 'My Action Items',
      '/templates': 'Templates',
      '/chat': 'Chat',
      '/mico-ai': 'MICO AI',
      '/activity': 'Activity',
      '/notifications': 'Notifications',
      '/settings': 'Settings',
      '/profile': 'Your profile',
      '/reports': 'Reports',
      '/admin/settings': 'System Settings',
      '/admin/ai': 'AI Management',
      '/admin/audit': 'Audit Logs',
      '/admin/users': 'User Management',
      '/client/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde': 'Shared project',
    };
    for (const [path, title] of Object.entries(titles)) expect(pageMetaFor(path).title, path).toBe(title);
    // Every title is different, so browser tabs and history can be told apart.
    expect(new Set(Object.values(titles)).size).toBe(Object.keys(titles).length);
  });

  it('only the sign-in, privacy and terms pages may be listed by search engines', () => {
    for (const path of ['/login', '/login/', '/privacy', '/terms']) expect(pageMetaFor(path).indexable, path).toBe(true);
    for (const path of ['/dashboard', '/projects/abc', '/admin/users', '/reset', '/forgot', '/somewhere-new', '/client/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde']) {
      expect(pageMetaFor(path).indexable, path).toBe(false);
    }
  });

  it('an unknown address gets the product name and stays private', () => {
    expect(pageMetaFor('/somewhere-new')).toEqual({ title: '', indexable: false });
  });
});

describe('applyPageMeta', () => {
  beforeEach(() => {
    document.title = '';
    document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
  });

  it('sets the tab title as "Page · Product"', () => {
    applyPageMeta('/calendar');
    expect(document.title).toBe(`Calendar · ${PRODUCT_NAME}`);
    applyPageMeta('/somewhere-new');
    expect(document.title).toBe(PRODUCT_NAME);
  });

  it('puts a specific name first when the page knows one (a project, a meeting)', () => {
    applyPageMeta('/projects/abc', 'Rig Inspection Portal');
    expect(document.title).toBe(`Rig Inspection Portal · Project · ${PRODUCT_NAME}`);
  });

  it('marks private pages noindex and clears the mark on public pages', () => {
    const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
    applyPageMeta('/dashboard');
    expect(robots()).toBe('noindex, nofollow');
    applyPageMeta('/login');
    expect(robots()).toBeNull();
    applyPageMeta('/reset');
    expect(robots()).toBe('noindex, nofollow');
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });
});
