import { describe, it, expect } from 'vitest';
import { FULL_WIDTH_PAGES, WINDOW_FIT_PAGES, pageLayout } from './page-layout';

describe('pageLayout (how wide a page is, and whether it is sized to the window)', () => {
  it('caps reading pages (dashboard, projects, a project, meetings, settings, management, reports, admin…)', () => {
    for (const path of ['/dashboard', '/projects', '/projects/p1', '/meetings', '/meetings/m1', '/settings', '/profile', '/management', '/reports', '/admin/users', '/admin/audit', '/my-tasks', '/templates', '/notifications', '/inspections/i1']) {
      expect(pageLayout(path).wide, path).toBe(false);
    }
  });

  it('gives the pages built around a wide grid the full width: board, calendar, timeline, workload, chat, MICO AI', () => {
    for (const path of ['/board', '/calendar', '/timeline', '/workload', '/chat', '/mico-ai']) {
      expect(pageLayout(path).wide, path).toBe(true);
    }
    expect(FULL_WIDTH_PAGES).toEqual(['/board', '/calendar', '/timeline', '/workload', '/chat', '/mico-ai']);
  });

  it('matches a page and what is under it, never a page that merely starts the same way', () => {
    expect(pageLayout('/board/').wide).toBe(true);
    expect(pageLayout('/chat/abc').wide).toBe(true);
    expect(pageLayout('/boards').wide).toBe(false);
  });

  it('knows the pages that size themselves to the window (their footer stays in view)', () => {
    expect(WINDOW_FIT_PAGES).toEqual(['/chat', '/mico-ai', '/calendar']);
    expect(pageLayout('/chat').fitsWindow).toBe(true);
    expect(pageLayout('/dashboard').fitsWindow).toBe(false);
    expect(pageLayout('/board').fitsWindow).toBe(false);
  });
});
