import { el, mount, Loader, ErrorState, Empty, timeAgo } from '../dom.js';
import { writeErrorMessage, SAVED_ON_DEVICE } from '../components.js';
import { notificationTarget, newestShown } from '../../src/notify.js';

/**
 * Notifications list. A click marks one read and opens what it is about (a task, a conversation, a
 * meeting's page — Stage 6), as on the web (M7). Marking one or all read works offline (queued) and
 * syncs on reconnect; a change that fails is shown and undone, never swallowed.
 *
 * It reads itself again in place (Stage 5) when the tab is shown again or the unread count changes
 * (app.js): the list stays on screen meanwhile, and focus stays on the same notification.
 */
export function NotificationsScreen(ctx) {
  const root = el('div');
  let current = [];
  let stale = false;
  let err = '';
  let note = '';
  let drawn = false;
  let loads = 0;
  root.refresh = () => load({ quiet: true });
  load();
  return root;

  async function load({ quiet = false } = {}) {
    const n = (loads += 1);
    const inPlace = quiet && drawn;
    if (!inPlace) mount(root, Loader());
    try {
      const r = await ctx.api.notifications.list();
      if (n !== loads) return;
      current = r.data ?? [];
      stale = !!r.stale;
      render();
    } catch (e) {
      if (n !== loads || inPlace) return; // a quiet read that failed: the list stays as it was
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
      // Queued like every other change when the server can't be reached (M7). Only up to the newest
      // one shown (`upTo`, kept for a later replay): one that comes in meanwhile stays unread.
      const upTo = newestShown(current);
      const r = await ctx.write('notification.readAll', upTo ? { upTo } : {});
      if (r && r.queued) note = SAVED_ON_DEVICE;
    } catch (e) {
      for (const n of unread) n.readAt = null;
      err = writeErrorMessage(e, 'Could not mark your notifications as read.');
    }
    render();
    ctx.afterMutation();
  }

  function render() {
    drawn = true;
    const hasUnread = current.some((n) => !n.readAt);
    // Drawing again replaces every row: focus goes back to the same notification.
    const a = document.activeElement;
    const keep = a && root.contains(a) ? a.dataset.notificationId || (a.classList.contains('mark-all') ? 'mark-all' : null) : null;
    mount(root,
      el('div', { class: 'toolbar' },
        hasUnread ? el('button', { class: 'btn sm mark-all', onClick: markAll }, 'Mark all as read') : null,
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null,
      ),
      err ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, err)) : null,
      note ? el('div', { class: 'infobar', role: 'status' }, note) : null,
      current.length === 0
        ? Empty("You're all caught up", 'New notifications show up here.')
        : el('div', { class: 'list' }, current.map((n) => row(n))),
    );
    if (keep) {
      const again = keep === 'mark-all' ? root.querySelector('.mark-all') : [...root.querySelectorAll('.nrow')].find((r) => r.dataset.notificationId === keep);
      if (again) again.focus();
    }
  }

  /** A notification's row, named by what it shows (whether it is unread, its title, words and time). */
  function row(n) {
    return el('button', {
      class: `nrow${n.readAt ? '' : ' unread'}`, type: 'button', dataset: { notificationId: n.id },
      onClick: () => open(n),
    },
      el('span', { class: 'ndot', 'aria-hidden': 'true' }),
      el('span', { class: 'nb' },
        n.readAt ? null : el('span', { class: 'sr-only' }, 'Unread: '),
        el('span', { class: 'ntitle', dir: 'auto' }, n.title || ''),
        n.body ? el('span', { class: 'muted nbody', dir: 'auto' }, n.body) : null,
        el('span', { class: 'ntime' }, timeAgo(n.createdAt)),
      ),
    );
  }
}
