// @vitest-environment jsdom
/**
 * Stage 5: the Notifications screen stays current — it reads itself again in place (coming back to
 * the tab, or when the unread count changes), keeping focus on the same notification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsScreen } from '../app/screens/notifications.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  document.body.innerHTML = '';
});

const N = (id, title, over = {}) => ({ id, title, body: null, readAt: null, createdAt: '2026-10-21T09:00:00Z', ...over });

describe('Notifications read themselves again in place', () => {
  it('a new notification shows; focus stays on the one it was on; no loading screen meanwhile', async () => {
    let list = [N('n1', 'Task assigned'), N('n2', 'Comment added', { readAt: '2026-10-21T09:30:00Z' })];
    const ctx = {
      appBase: 'https://task.mico360.com',
      api: { notifications: { list: vi.fn(async () => ({ data: list })) } },
      write: vi.fn(async () => ({ queued: false })),
      navigate: vi.fn(),
      afterMutation: vi.fn(),
    };
    const root = NotificationsScreen(ctx);
    document.body.append(root);
    await settle();
    expect(typeof root.refresh).toBe('function');
    const second = root.querySelectorAll('.nrow')[1];
    expect(second.dataset.notificationId).toBe('n2');
    second.focus();
    list = [N('n3', 'Omar sent you a message'), ...list];
    const p = root.refresh();
    expect(root.querySelector('.state')).toBeNull(); // still the list, not a spinner
    await p;
    await settle();
    expect([...root.querySelectorAll('.nrow')].map((r) => r.dataset.notificationId)).toEqual(['n3', 'n1', 'n2']);
    expect(document.activeElement.dataset.notificationId).toBe('n2');
  });
});
