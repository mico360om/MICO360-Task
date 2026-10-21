/**
 * The chat inbox (Stage 5), as the web's sidebar (components/chat/ChatSidebar.tsx): Favorites,
 * every project's channel, direct messages — most recently active first — and the Archive (closed
 * until opened). Each conversation's row says who wrote last and what, whether it is muted and how
 * many are unread, and its options add it to favorites, mute it or archive it. "New direct message"
 * starts a conversation with a teammate.
 *
 * The inbox reads itself again every few seconds while it is on screen, and tells the server which
 * direct messages have reached this device (their senders then see "Delivered"). Changing a
 * conversation's options needs the connection, as on the web.
 */
import { el, mount, Loader, ErrorState } from '../dom.js';
import { writeErrorMessage } from '../components.js';
import { menuButton } from '../menu.js';
import { inboxSections, previewOf, needsDeliveryAck, sanitizeSummaries, CHAT_POLL_MS, NO_PREFS } from '../../src/chat.js';
import { ApiError } from '../../src/errors.js';

const SECTIONS_KEY = 'mico360.chat.sections';

/** Which sections are closed (Archived starts closed), remembered on this device. */
function loadCollapsed() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SECTIONS_KEY) || 'null');
    if (parsed && typeof parsed === 'object') return { archived: true, ...parsed };
  } catch { /* unreadable: the default */ }
  return { archived: true };
}

function saveCollapsed(state) {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(state));
  } catch { /* remembered for this visit only */ }
}

/** "14:05" today, "Yesterday", a weekday this week, else a short date (as on the web). */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ChatInbox(ctx) {
  const pollMs = ctx.chatPollMs || CHAT_POLL_MS;
  const me = ctx.me.id;
  const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : null);

  // ---- state (declared before load()/return) ----
  let projects = [];
  let conversations = [];
  let directory = [];
  let stale = false;
  let problem = '';
  let dmOpen = false;
  let focusWant = null;       // a focus key to put focus on after the next draw
  let loaded = false;
  let dirty = false;          // read again while a menu was open: drawn once it closes
  const collapsed = loadCollapsed();
  const acked = new Set();    // "conversation:message" delivery reports made from here
  let timer = null;
  let polling = null;

  const root = el('div', { class: 'chat-inbox' });
  const live = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const body = el('div');
  mount(root, body, live);

  root.refresh = () => poll();
  load();
  return root;

  /** The first read. `quiet`: tried again on its own (a later read) — no spinner, and on failure the message stays. */
  async function load({ quiet = false } = {}) {
    if (!quiet) mount(body, Loader());
    try {
      const [p, c, d] = await Promise.all([ctx.api.projects.list(), ctx.api.chat.conversations(), call(ctx.api.directory)]);
      projects = rows(p && p.data);
      conversations = rows(c && c.data);
      directory = rows(d && d.data);
      stale = !!((p && p.stale) || (c && c.stale) || (d && d.stale));
      loaded = true;
      render();
      reportDeliveries();
    } catch {
      if (!quiet) mount(body, ErrorState('Could not load chat.', () => load()));
    }
    schedule();
  }

  function rows(v) {
    return Array.isArray(v) ? v : [];
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(tick, pollMs);
  }

  async function tick() {
    if (!root.isConnected) return; // the screen is gone: stop
    if (document.visibilityState !== 'hidden') await poll();
    if (root.isConnected) schedule();
  }

  function poll() {
    if (!loaded) return load({ quiet: true }); // the first read failed: try it again, as a later read
    if (polling) return polling;
    polling = (async () => {
      try {
        const c = await ctx.api.chat.conversations();
        const next = rows(c && c.data);
        const nextStale = !!(c && c.stale);
        // Nothing new: nothing is drawn again (a screen reader keeps its place in the list).
        if (JSON.stringify(next) === JSON.stringify(conversations) && nextStale === stale) return;
        conversations = next;
        stale = nextStale;
        if (busy()) dirty = true;
        else render();
        reportDeliveries();
      } catch {
        /* offline: what is shown stays */
      } finally {
        polling = null;
      }
    })();
    return polling;
  }

  /** A menu or the people picker in use: drawing the inbox again now would close it. */
  function busy() {
    const a = document.activeElement;
    return !!root.querySelector('[role="menu"]') || (!!a && root.contains(a) && a.tagName === 'SELECT');
  }

  /** Tell the server which direct messages reached this device — once each. */
  function reportDeliveries() {
    if (!ctx.api.chat.markDelivered) return;
    for (const s of conversations) {
      if (!s || !s.conversation || !Array.isArray(s.participants) || !needsDeliveryAck(s, me)) continue;
      const key = `${s.conversation.id}:${s.lastMessage.id}`;
      if (acked.has(key)) continue;
      acked.add(key);
      Promise.resolve(ctx.api.chat.markDelivered(s.conversation.id)).catch(() => acked.delete(key));
    }
  }

  function fullName(userId) {
    const u = directory.find((x) => x.id === userId);
    if (!u) return userId === me ? 'You' : 'Someone';
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username || 'Someone';
  }

  // ---- drawing ----

  function render() {
    dirty = false;
    const a = document.activeElement;
    const key = focusWant || (a && body.contains(a) ? a.dataset.focusKey : null);
    focusWant = null;
    const s = inboxSections({ inbox: sanitizeSummaries(conversations), projects, myId: me, nameOf: fullName, query: '' });
    mount(body,
      el('div', { class: 'toolbar chat-inbox-head' },
        el('button', {
          class: `btn sm${dmOpen ? ' on' : ''}`, type: 'button', 'aria-expanded': String(dmOpen), 'aria-label': 'New direct message', title: 'New direct message',
          dataset: { focusKey: 'dm' }, onClick: () => toggleDm(),
        }, el('span', { 'aria-hidden': 'true' }, dmOpen ? '✕ New direct message' : '＋ New direct message')),
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null),
      dmOpen ? dmPicker() : null,
      problem ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, problem)) : null,
      s.favorites.length ? section('favorites', 'Favorites', s.favorites, unreadOf(s.favorites), '') : null,
      section('channels', 'Project channels', s.channels, unreadOf(s.channels), 'No project channels yet.'),
      section('directs', 'Direct messages', s.directs, unreadOf(s.directs), null),
      s.archived.length ? section('archived', 'Archived', s.archived, s.archivedUnread, '') : null,
    );
    if (key) {
      const again = [...body.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === key);
      if (again) again.focus();
    }
  }

  function unreadOf(list) {
    return list.reduce((n, r) => n + (r.unread || 0), 0);
  }

  function section(id, title, list, unread, emptyText) {
    const open = !collapsed[id];
    const toggle = el('button', {
      class: 'chat-section-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': `chat-section-${id}`, dataset: { focusKey: `section:${id}` },
      onClick: () => { collapsed[id] = !collapsed[id]; saveCollapsed(collapsed); render(); },
    },
    el('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
    el('span', { class: 'chat-section-name' }, title),
    unread ? el('span', { class: 'badge', role: 'img', 'aria-label': `${unread} unread` }, String(unread)) : el('span', { class: 'muted chat-section-count' }, String(list.length)));
    let content = null;
    if (open) {
      content = el('ul', { class: 'list chat-rows', id: `chat-section-${id}` },
        list.length ? list.map(rowNode)
          : id === 'directs'
            ? el('li', { class: 'muted chat-empty' }, 'No direct messages yet. ',
              el('button', { class: 'linkbtn', type: 'button', dataset: { focusKey: 'dm-start' }, onClick: () => toggleDm(true) }, 'Start one'))
            : el('li', { class: 'muted chat-empty' }, emptyText));
    }
    return el('div', { class: 'chat-section', dataset: { section: id } }, el('h3', { class: 'chat-section-head' }, toggle), content);
  }

  function rowNode(r) {
    const preview = previewOf(r.lastMessage, { myId: me, kind: r.kind, nameOf: (id) => (id === me ? 'You' : fullName(id)) })
      || (r.kind === 'PROJECT' && !r.conversationId ? 'Project channel' : 'No messages yet');
    const wrap = el('li', { class: 'chat-row' });
    const open = el('button', {
      class: `chat-row-open nrow${r.unread ? ' unread' : ''}`, type: 'button', dataset: { focusKey: `open:${r.key}` }, onClick: () => openRow(r),
    },
    el('span', { class: 'nb' },
      el('span', { class: 'chat-row-top' },
        el('span', { class: 'chat-row-title ntitle', dir: 'auto' }, r.title),
        r.lastMessage ? el('span', { class: 'ntime' }, when(r.lastMessage.createdAt)) : null),
      el('span', { class: 'chat-row-preview muted', dir: 'auto' }, preview)),
    r.prefs.muted ? el('span', { class: 'chat-muted', role: 'img', 'aria-label': 'Muted', title: 'Muted' }, '🔕') : null,
    r.unread ? el('span', { class: 'badge', role: 'img', 'aria-label': `${r.unread} unread` }, r.unread > 99 ? '99+' : String(r.unread)) : null);
    const more = menuButton({
      className: 'iconbtn sm chat-row-more',
      text: el('span', { 'aria-hidden': 'true' }, '⋯'),
      label: `More options for ${r.title}`,
      menuLabel: `Options for ${r.title}`,
      title: 'More options',
      host: wrap,
      items: () => [
        { label: r.prefs.favorite ? 'Remove from favorites' : 'Add to favorites', onPick: () => changePrefs(r, { favorite: !r.prefs.favorite }) },
        { label: r.prefs.muted ? 'Unmute notifications' : 'Mute notifications', onPick: () => changePrefs(r, { muted: !r.prefs.muted }) },
        { label: r.prefs.archived ? 'Move out of archive' : 'Archive', onPick: () => changePrefs(r, { archived: !r.prefs.archived }) },
      ],
    });
    more.dataset.focusKey = `more:${r.key}`;
    more.addEventListener('click', () => { if (dirty && !root.querySelector('[role="menu"]')) render(); });
    wrap.append(open, more);
    return wrap;
  }

  function dmPicker() {
    const people = directory.filter((u) => u && u.id !== me);
    const pick = el('select', { class: 'field chat-dm', 'aria-label': 'Start a direct message', dataset: { focusKey: 'dm-pick' } },
      el('option', { value: '' }, 'Message a teammate…'),
      people.map((u) => el('option', { value: u.id }, `${`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username}${u.username ? ` (@${u.username})` : ''}`)));
    pick.addEventListener('change', () => { if (pick.value) startDirect(pick.value); });
    return el('div', { class: 'chat-dm-row' }, pick);
  }

  function toggleDm(open = !dmOpen) {
    dmOpen = open;
    focusWant = dmOpen ? 'dm-pick' : 'dm';
    render();
  }

  // ---- doing ----

  function say(text) {
    live.textContent = text;
  }

  async function openRow(r) {
    problem = '';
    if (r.kind === 'DIRECT' && r.conversationId) {
      ctx.navigate(`#/chat/${r.conversationId}`);
      return;
    }
    if (!r.projectId) return;
    try {
      const res = await ctx.api.chat.openProjectChannel(r.projectId);
      const id = res && res.conversation && res.conversation.id;
      if (id) ctx.navigate(`#/chat/${id}`);
    } catch (e) {
      problem = e instanceof ApiError && e.status === 403
        ? `You can’t open #${r.title} because you aren’t a member of this project. Ask the project’s manager to add you to the team.`
        : writeErrorMessage(e, `Couldn’t open #${r.title}.`);
      focusWant = `open:${r.key}`;
      render();
    }
  }

  async function startDirect(userId) {
    problem = '';
    try {
      const conv = await ctx.api.chat.startDirect(userId);
      if (conv && conv.id) ctx.navigate(`#/chat/${conv.id}`);
    } catch (e) {
      problem = writeErrorMessage(e, `Couldn’t start a conversation with ${fullName(userId)}.`);
      focusWant = 'dm-pick';
      render();
    }
  }

  /** A conversation's options: shown at once, saved on the server (a channel nobody opened yet is opened first). */
  async function changePrefs(r, patch) {
    problem = '';
    focusWant = `more:${r.key}`;
    let id = r.conversationId;
    try {
      if (!id && r.projectId) {
        const res = await ctx.api.chat.openProjectChannel(r.projectId);
        id = res && res.conversation && res.conversation.id;
      }
      if (!id) return;
    } catch (e) {
      problem = writeErrorMessage(e, 'Couldn’t change that setting.');
      render();
      return;
    }
    const before = conversations;
    applyPrefs(id, r, patch);
    render();
    try {
      const saved = await ctx.api.chat.setPrefs(id, patch);
      if (saved && typeof saved === 'object') applyPrefs(id, r, saved);
      say(doneText(r.title, patch));
    } catch (e) {
      conversations = before;
      problem = writeErrorMessage(e, 'Couldn’t change that setting.');
    }
    focusWant = `more:${r.key}`;
    render();
  }

  function applyPrefs(id, r, patch) {
    if (conversations.some((s) => s.conversation && s.conversation.id === id)) {
      conversations = conversations.map((s) => (s.conversation.id === id ? { ...s, prefs: { ...NO_PREFS, ...(s.prefs || {}), ...patch } } : s));
    } else {
      conversations = [...conversations, {
        conversation: { id, kind: r.kind, projectId: r.projectId ?? null, createdAt: '' }, participants: [], unread: 0, lastMessage: null, prefs: { ...NO_PREFS, ...patch },
      }];
    }
  }

  function doneText(title, patch) {
    if ('favorite' in patch) return patch.favorite ? `${title} added to favorites.` : `${title} removed from favorites.`;
    if ('muted' in patch) return patch.muted ? `Notifications muted for ${title}.` : `Notifications on for ${title}.`;
    if ('archived' in patch) return patch.archived ? `${title} archived.` : `${title} moved out of the archive.`;
    return 'Saved.';
  }
}
