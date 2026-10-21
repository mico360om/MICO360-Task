import { el, mount, Loader, ErrorState, Empty, timeAgo } from '../dom.js';
import { writeErrorMessage, SAVED_ON_DEVICE } from '../components.js';
import { notificationTarget } from '../../src/notify.js';

/**
 * Notifications list. A click marks one read and opens what it is about (a task, a conversation, a
 * meeting on the website), as on the web (M7). Marking one or all read works offline (queued) and
 * syncs on reconnect; a change that fails is shown and undone, never swallowed.
 */
export function NotificationsScreen(ctx) {
  const root = el('div');
  let current = [];
  let stale = false;
  let err = '';
  let note = '';
  load();
  return root;

  async function load() {
    mount(root, Loader());
    try {
      const r = await ctx.api.notifications.list();
      current = r.data ?? [];
      stale = !!r.stale;
      render();
    } catch (e) {
      mount(root, ErrorState(writeErrorMessage(e, 'Could not load notifications.'), () => load()));
    }
  }

  async function markRead(n) {
    if (n.readAt) return;
    n.readAt = new Date().toISOString();
    err = '';
    render();
    try {
      const r = await ctx.write('notification.read', { id: n.id }); // sent now or queued for later
      if (r && r.queued) note = SAVED_ON_DEVICE;
    } catch (e) {
      n.readAt = null; // couldn't be sent or saved — show it as unread again
      err = writeErrorMessage(e, 'Could not mark the notification as read.');
    }
    render();
    ctx.afterMutation();
  }

  /** Open a notification: mark it read, then go to what it is about. */
  function open(n) {
    void markRead(n);
    const target = notificationTarget(n, ctx.appBase);
    if (!target) return;
    if (target.hash) ctx.navigate(target.hash);
    else if (target.url && ctx.openExternal) ctx.openExternal(target.url);
  }

  async function markAll() {
    const unread = current.filter((n) => !n.readAt);
    const at = new Date().toISOString();
    for (const n of unread) n.readAt = at;
    err = '';
    render();
    try {
      // Queued like every other change when the server can't be reached (M7).
      const r = await ctx.write('notification.readAll', {});
      if (r && r.queued) note = SAVED_ON_DEVICE;
    } catch (e) {
      for (const n of unread) n.readAt = null;
      err = writeErrorMessage(e, 'Could not mark your notifications as read.');
    }
    render();
    ctx.afterMutation();
  }

  function render() {
    const hasUnread = current.some((n) => !n.readAt);
    mount(root,
      el('div', { class: 'toolbar' },
        hasUnread ? el('button', { class: 'btn sm', onClick: markAll }, 'Mark all as read') : null,
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null,
      ),
      err ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, err)) : null,
      note ? el('div', { class: 'infobar', role: 'status' }, note) : null,
      current.length === 0
        ? Empty("You're all caught up", 'New notifications show up here.')
        : el('div', { class: 'list' }, current.map((n) => row(n))),
    );
  }

  function row(n) {
    return el('button', {
      class: `nrow${n.readAt ? '' : ' unread'}`, type: 'button',
      'aria-label': `${n.readAt ? '' : 'Unread. '}${n.title}`,
      onClick: () => open(n),
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
