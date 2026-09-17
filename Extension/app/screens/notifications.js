import { el, mount, Loader, ErrorState, Empty, timeAgo } from '../dom.js';

/** Notifications list — mark one/all read; marking works offline (queued) and syncs on reconnect. */
export function NotificationsScreen(ctx) {
  const root = el('div');
  let current = [];
  load();
  return root;

  async function load() {
    mount(root, Loader());
    try {
      const { data, stale } = await ctx.api.notifications.list();
      render(data ?? [], stale);
    } catch {
      mount(root, ErrorState('Could not load notifications.', load));
    }
  }

  async function markRead(n) {
    if (n.readAt) return;
    n.readAt = new Date().toISOString();
    render(current, false);
    try {
      await ctx.api.notifications.markRead(n.id);
    } catch (e) {
      if (!(e && e.name === 'ApiError')) await ctx.enqueue('notification.read', { id: n.id });
    }
    ctx.afterMutation();
  }

  async function markAll() {
    for (const n of current) n.readAt = n.readAt || new Date().toISOString();
    render(current, false);
    try {
      await ctx.api.notifications.markAllRead();
    } catch { /* best-effort; queued reads catch up */ }
    ctx.afterMutation();
  }

  function render(items, stale) {
    current = items;
    const hasUnread = items.some((n) => !n.readAt);
    mount(root,
      el('div', { class: 'toolbar' },
        hasUnread ? el('button', { class: 'btn sm', onClick: markAll }, 'Mark all as read') : null,
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null,
      ),
      items.length === 0
        ? Empty("You're all caught up", 'New notifications show up here.')
        : el('div', { class: 'list' }, items.map((n) => row(n))),
    );
  }

  function row(n) {
    return el('button', {
      class: `nrow${n.readAt ? '' : ' unread'}`, type: 'button',
      'aria-label': `${n.readAt ? '' : 'Unread. '}${n.title}`,
      onClick: () => markRead(n),
    },
      el('span', { class: 'ndot' }),
      el('span', { class: 'nb' },
        el('span', { class: 'ntitle' }, n.title || ''),
        n.body ? el('div', { class: 'muted', style: { fontSize: '13px', marginTop: '2px' } }, n.body) : null,
        el('div', { class: 'ntime' }, timeAgo(n.createdAt)),
      ),
    );
  }
}
