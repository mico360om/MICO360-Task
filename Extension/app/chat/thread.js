/**
 * One conversation (Stage 5): its messages, read again every few seconds while it is on screen (no
 * live connection — the person's own choice of polling over a socket), with "Load older messages"
 * at the top, and the message box at the bottom.
 *
 * Reading again never draws the thread from scratch: the messages already shown stay where they
 * are (focus and the reading place with them), new ones are added — a screen reader hears them, as
 * the list is a log — and the message box, with what is being typed, is never drawn again. New
 * messages from others are marked read while the tab is in front.
 *
 * Sending follows the web's pending messages: each message keeps one clientId through every try, so
 * the server never stores it twice. Text is sent now, or kept on this device and sent later ("saved
 * on this device, not sent yet"); one the server refuses stays with why, and Retry (a new try: a new
 * Idempotency-Key, the same clientId) or Discard. Files and pasted pictures go up online only, as on
 * the web. Messages go in the order written: one written while an earlier one is kept on this device
 * waits behind it (the queue keeps a conversation's messages in order), and a file first has the
 * kept ones sent — if they can't go yet, it says so, with Retry.
 *
 * Nothing typed is lost: what is in the box, and messages the server refused, are kept for this
 * conversation (src/chat-drafts.js) and come back on return; a kept message the sync gave up on
 * shows here as not sent, with why, Retry and Discard (as in Settings → Sync).
 */
import { el, mount, Loader, ErrorState, Empty } from '../dom.js';
import { writeErrorMessage } from '../components.js';
import { messageNode, messageSignature } from './message.js';
import {
  mergeMessages, hasOlderPage, validateAttachment, placeholderFor, MAX_MESSAGE_LENGTH, CHAT_POLL_MS, NO_PREFS,
} from '../../src/chat.js';
import { newIdempotencyKey, getQueue, retryQueued, removeQueued } from '../../src/queue.js';
import { tempId } from '../../src/pending-overlay.js';
import { pastedFiles } from '../../src/clipboard-files.js';
import { hasFiles } from '../../src/file-drop-guard.js';
import { fileFailure } from '../../src/quick-add.js';

const OFFLINE_FILES = 'Files can’t be sent offline. Send them when you’re connected.';
const EARLIER_WAITING = 'An earlier message is still waiting to be sent. Try again once it has gone.';
/** Within this distance of the bottom, the thread follows new messages. */
const NEAR_BOTTOM_PX = 120;

export function ChatThread(ctx, conversationId) {
  const pollMs = ctx.chatPollMs || CHAT_POLL_MS;
  const me = ctx.me.id;
  const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : null);
  const online = () => (typeof ctx.isOnline === 'function' ? ctx.isOnline() : true);

  // ---- state (declared before load()/return: see the TDZ pitfall in the screen contract) ----
  let pages = [];          // the server's pages, newest first (the newest with messages waiting on this device)
  let hasOlder = false;
  let loadingOlder = false;
  let olderError = false;
  let loaded = false;
  let outgoing = [];       // messages sent from here that the server hasn't confirmed: { clientId, body, state, error, files, … }
  let keptFailed = [];     // kept messages the sync gave up on (from the queue): { queueId, clientId, body, error, … }
  let waiting = new Set(); // clientIds of this conversation's messages still kept, waiting to be sent
  const files = new Map(); // clientId → the File it sends (kept for Retry)
  const drafts = ctx.chatDrafts || null;
  let chain = Promise.resolve(); // one send at a time, in the order written
  let directory = [];
  let projects = [];
  let summary = null;      // this conversation's inbox summary (its kind, people and own settings)
  let problem = '';
  let unseen = 0;
  let nodes = new Map();   // message id → its node
  let timer = null;
  let polling = null;

  // ---- the parts that are never drawn again ----
  const titleEl = el('h2', { class: 'chat-title', dir: 'auto' }, 'Conversation');
  const actions = el('span', { class: 'chat-head-actions' });
  const staleTag = el('span', { class: 'stale-tag hidden' }, 'offline · saved');
  const header = el('div', { class: 'toolbar chat-head' },
    el('button', { class: 'btn sm', type: 'button', onClick: () => ctx.navigate('#/chat') }, '← Back'),
    titleEl, staleTag, actions);
  const alertBox = el('div', { class: 'chat-alert' });
  const olderBtn = el('button', { class: 'btn sm ghost', type: 'button', onClick: () => loadOlder() }, 'Load older messages');
  const olderBox = el('div', { class: 'chat-older' });
  const list = el('div', { class: 'thread' });
  const log = el('div', { class: 'chat-log', role: 'log', 'aria-label': 'Messages', tabindex: '-1' }, olderBox, list);
  const newBtn = el('button', { class: 'btn sm primary chat-new hidden', type: 'button', onClick: () => toBottom() });
  const box = el('textarea', { class: 'field', rows: '2', 'aria-label': 'Message', placeholder: 'Write a message…', enterkeyhint: 'send' });
  // One control for files: the (visually hidden) file input, shown as a paperclip.
  const fileInput = el('input', { type: 'file', multiple: 'multiple', class: 'sr-only', 'aria-label': 'Attach files' });
  const attach = el('label', { class: 'iconbtn chat-attach', title: 'Attach files (up to 10 MB each)' },
    el('span', { 'aria-hidden': 'true' }, '📎'), fileInput);
  const send = el('button', { class: 'btn primary', type: 'button', onClick: () => sendText() }, 'Send');
  const composer = el('form', { class: 'composer', 'aria-label': 'Send a message' }, attach, box, send);
  const hint = el('div', { class: 'muted chat-hint' }, 'Enter to send · Shift+Enter for a new line · paste or drop a picture to send it');
  const root = el('div', { class: 'chat-thread' }, header, alertBox, log, newBtn, composer, hint);

  composer.addEventListener('submit', (e) => e.preventDefault()); // Send and Enter send; the page never reloads
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendText();
    }
  });
  box.addEventListener('input', () => keepDraft());
  box.addEventListener('paste', (e) => {
    const got = pastedFiles(e.clipboardData, { typing: true });
    if (!got.length) return;
    e.preventDefault();
    sendFiles(got);
  });
  fileInput.addEventListener('change', () => {
    const chosen = Array.from(fileInput.files || []);
    try { fileInput.value = ''; } catch { /* some browsers */ }
    sendFiles(chosen);
  });
  composer.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    composer.classList.add('dragging');
  });
  composer.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !composer.contains(e.relatedTarget)) composer.classList.remove('dragging'); });
  composer.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    composer.classList.remove('dragging');
    sendFiles(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
  });

  /** Coming back to the tab (app.js): read the conversation now. */
  root.refresh = () => poll();
  load();
  return root;

  // ---- reading ----

  /** The first read. `quiet`: tried again on its own (a later read) — no spinner, and on failure the message stays. */
  async function load({ quiet = false } = {}) {
    if (!quiet) mount(list, Loader());
    if (!quiet) await restoreDrafts();
    try {
      const [m, d] = await Promise.all([ctx.api.chat.messages(conversationId), call(ctx.api.directory)]);
      await readKept();
      pages = [rows(m && m.data)];
      directory = rows(d && d.data);
      hasOlder = hasOlderPage(serverRows(pages[0]));
      staleTag.classList.toggle('hidden', !(m && m.stale));
      loaded = true;
      clear(list);
      nodes = new Map();
      render();
      toBottom();
      markRead();
    } catch {
      if (!quiet) mount(list, ErrorState('Could not load chat.', () => load()));
    }
    void loadSummary();
    schedule();
  }

  /** The conversation's name and own settings, from the inbox (best effort: the header waits for them). */
  async function loadSummary() {
    try {
      const [c, p] = await Promise.all([call(ctx.api.chat.conversations), call(ctx.api.projects && ctx.api.projects.list)]);
      projects = rows(p && p.data);
      summary = rows(c && c.data).find((s) => s && s.conversation && s.conversation.id === conversationId) || summary;
    } catch { /* offline with nothing saved */ }
    renderHeader();
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

  /** Read the newest page again and add what is new; older pages already loaded stay. */
  function poll() {
    if (!loaded) return load({ quiet: true }); // the first read failed: try it again, as a later read
    if (polling) return polling;
    polling = (async () => {
      try {
        const m = await ctx.api.chat.messages(conversationId);
        const fresh = rows(m && m.data);
        await readKept(); // after the read: a message kept meanwhile is still waiting
        const before = new Set(shown().map((x) => x.id));
        pages[0] = mergeNewest(pages[0] || [], fresh);
        if (pages.length === 1) hasOlder = hasOlderPage(serverRows(pages[0]));
        staleTag.classList.toggle('hidden', !(m && m.stale));
        const follow = nearBottom();
        render();
        const arrived = fresh.filter((x) => !before.has(x.id) && x.userId !== me && !x.pending);
        if (arrived.length) {
          if (follow) toBottom();
          else { unseen += arrived.length; renderNew(); }
          if (document.visibilityState !== 'hidden') markRead();
        }
      } catch {
        /* offline: what is shown stays */
      } finally {
        polling = null;
      }
    })();
    return polling;
  }

  /**
   * The newest page read again, over the one shown: messages already shown are kept (a message an
   * older page doesn't hold yet must not fall out) and updated, new ones added. A message that was
   * waiting on this device is gone once it is sent (the fresh page has the server's copy, by its
   * clientId) — but stays while it is still waiting: a read that began before it was kept doesn't
   * have it yet.
   */
  function mergeNewest(old, fresh) {
    const byId = new Map(fresh.map((x) => [x.id, x]));
    const confirmed = new Set(fresh.map((x) => x.clientId).filter(Boolean));
    const kept = old.filter((x) => !byId.has(x.id) && (!x.pending || (waiting.has(x.clientId) && !confirmed.has(x.clientId))));
    return [...kept, ...fresh].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  /** This conversation's messages in the queue: those still waiting, and those the sync gave up on. */
  async function readKept() {
    if (!ctx.storage) return;
    let mine = [];
    try {
      mine = (await getQueue(ctx.storage)).filter((i) => i.userId === me && i.kind === 'chat.send' && i.payload && i.payload.conversationId === conversationId);
    } catch {
      return;
    }
    const clientOf = (i) => i.payload.clientId || i.idempotencyKey;
    waiting = new Set(mine.filter((i) => i.status !== 'failed').map(clientOf));
    keptFailed = mine.filter((i) => i.status === 'failed').map((i) => ({
      queueId: i.id, clientId: clientOf(i), body: i.payload.body || '', state: 'failed', replyTo: null, files: [],
      createdAt: new Date(typeof i.queuedAt === 'number' ? i.queuedAt : Date.now()).toISOString(),
      error: String(i.lastError || '').replace(/^\d{3}\s*—\s*/, '') || 'Your message wasn’t sent.',
    }));
  }

  /** What was being typed, and the messages the server refused, as they were left. */
  async function restoreDrafts() {
    if (!drafts) return;
    let saved;
    try {
      saved = await drafts.get(conversationId);
    } catch {
      return;
    }
    if (!box.value && saved.draft) box.value = saved.draft;
    for (const f of saved.failed) {
      if (outgoing.some((p) => p.clientId === f.clientId)) continue;
      outgoing.push({ clientId: f.clientId, key: newIdempotencyKey(), body: f.body, createdAt: f.createdAt || new Date().toISOString(), state: 'failed', error: f.error, replyTo: null, files: [] });
    }
  }

  function keepDraft() {
    if (drafts) void drafts.setDraft(conversationId, box.value);
  }

  /** The messages from here the server refused (text only: a file is never kept), for next time. */
  function keepFailed() {
    if (!drafts) return;
    void drafts.setFailed(conversationId, outgoing.filter((p) => p.state === 'failed' && !files.has(p.clientId))
      .map((p) => ({ clientId: p.clientId, body: p.body, createdAt: p.createdAt, error: p.error || '' })));
  }

  async function loadOlder() {
    if (loadingOlder || !hasOlder) return;
    const oldest = serverRows(shown())[0];
    if (!oldest) return;
    loadingOlder = true;
    olderError = false;
    log.setAttribute('aria-busy', 'true');
    renderOlder();
    try {
      const page = await ctx.api.chat.older(conversationId, oldest.createdAt);
      const s = scroller();
      const height = s.scrollHeight;
      const top = s.scrollTop;
      pages.push(rows(page));
      hasOlder = hasOlderPage(page);
      render();
      s.scrollTop = top + (s.scrollHeight - height); // what was being read stays in place
    } catch {
      olderError = true;
    }
    loadingOlder = false;
    log.removeAttribute('aria-busy');
    const hadFocus = document.activeElement === olderBtn;
    renderOlder();
    if (hadFocus && !olderBtn.isConnected) log.focus();
  }

  function markRead() {
    const p = call(ctx.api.chat.markRead, conversationId);
    if (p && typeof p.then === 'function') {
      p.then(() => { if (ctx.afterMutation) ctx.afterMutation(); }, () => { /* best effort: the badge stays until the next read */ });
    }
  }

  // ---- drawing ----

  function rows(v) {
    return Array.isArray(v) ? v : [];
  }

  /** Messages from the server (not ones waiting on this device). */
  function serverRows(list_) {
    return list_.filter((x) => !x.pending);
  }

  function shown() {
    return mergeMessages(pages, [...outgoing, ...keptFailed].map((p) => ({ ...p, conversationId })), me);
  }

  function nameOf(userId) {
    if (userId === me) return 'You';
    const u = directory.find((d) => d.id === userId);
    if (!u) return 'Someone';
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username || 'Someone';
  }

  /** Add new messages, draw changed ones again, drop the ones gone — the rest stay as they are. */
  function render() {
    renderAlert();
    if (!loaded) return;
    const all = shown();
    if (!all.length) {
      if (!list.querySelector('.empty')) mount(list, Empty('No messages yet', 'Say hello to get the conversation started.'));
      nodes = new Map();
      renderOlder();
      return;
    }
    const empty = list.querySelector('.empty');
    if (empty) clear(list);
    const opts = { me, nameOf, apiBase: ctx.apiBase, onRetry: retry, onDiscard: discard };
    const next = new Map();
    let at = list.firstChild;
    for (const m of all) {
      const sig = messageSignature(m);
      let node = nodes.get(m.id);
      if (!node || node.dataset.sig !== sig) {
        const fresh = messageNode(m, opts);
        fresh.dataset.sig = sig;
        if (node) {
          if (at === node) at = fresh;
          node.replaceWith(fresh);
        }
        node = fresh;
      }
      if (node === at) at = at.nextSibling;
      else list.insertBefore(node, at);
      next.set(m.id, node);
    }
    for (const [id, node] of nodes) if (!next.has(id)) node.remove();
    nodes = next;
    renderOlder();
    if (summary) box.setAttribute('placeholder', placeholderFor(kind(), title()));
  }

  function renderOlder() {
    const items = [];
    if (loaded && shown().length) {
      if (hasOlder) {
        olderBtn.textContent = loadingOlder ? 'Loading older messages…' : 'Load older messages';
        olderBtn.setAttribute('aria-disabled', loadingOlder ? 'true' : 'false');
        items.push(olderBtn);
      } else {
        items.push(el('p', { class: 'muted chat-beginning' }, 'This is the beginning of the conversation.'));
      }
      if (olderError) items.push(el('p', { class: 'error chat-older-error', role: 'alert' }, 'Couldn’t load older messages.'));
    }
    if (items.length === olderBox.childNodes.length && items.every((n, i) => n === olderBox.childNodes[i])) return;
    mount(olderBox, items);
  }

  function renderAlert() {
    if (alertBox.textContent === problem) return;
    mount(alertBox, problem ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, problem)) : null);
  }

  function renderNew() {
    newBtn.textContent = unseen ? `↓ ${unseen} new message${unseen === 1 ? '' : 's'}` : '';
    newBtn.classList.toggle('hidden', !unseen);
  }

  function kind() {
    return (summary && summary.conversation && summary.conversation.kind) || 'DIRECT';
  }

  function title() {
    if (!summary) return 'Conversation';
    if (kind() === 'PROJECT') {
      const p = projects.find((x) => x.id === summary.conversation.projectId);
      return p ? p.name : 'Project channel';
    }
    const other = (summary.participants || []).map((x) => x.userId).find((id) => id !== me);
    return other ? nameOf(other) : 'Direct message';
  }

  function renderHeader() {
    titleEl.textContent = kind() === 'PROJECT' && summary ? `# ${title()}` : title();
    if (!summary) { mount(actions); return; }
    const prefs = { ...NO_PREFS, ...(summary.prefs || {}) };
    const focused = document.activeElement && actions.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    mount(actions,
      el('button', {
        class: `btn sm${prefs.muted ? ' on' : ''}`, type: 'button', 'aria-pressed': String(prefs.muted), 'aria-label': 'Mute notifications',
        title: prefs.muted ? 'Notifications are muted for this conversation' : 'Mute notifications for this conversation', onClick: () => changePrefs({ muted: !prefs.muted }),
      }, el('span', { 'aria-hidden': 'true' }, prefs.muted ? '🔕 Muted' : '🔔 Mute')),
      el('button', {
        class: `btn sm${prefs.favorite ? ' on' : ''}`, type: 'button', 'aria-pressed': String(prefs.favorite), 'aria-label': 'Favorite',
        title: prefs.favorite ? 'Remove from favorites' : 'Add to favorites', onClick: () => changePrefs({ favorite: !prefs.favorite }),
      }, el('span', { 'aria-hidden': 'true' }, prefs.favorite ? '★ Favorite' : '☆ Favorite')));
    if (focused) {
      const again = [...actions.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === focused);
      if (again) again.focus();
    }
    box.setAttribute('placeholder', placeholderFor(kind(), title()));
  }

  /** This conversation's own settings (muted, favorite): shown at once, saved on the server. */
  async function changePrefs(patch) {
    const before = summary.prefs;
    summary = { ...summary, prefs: { ...NO_PREFS, ...(summary.prefs || {}), ...patch } };
    problem = '';
    renderHeader();
    renderAlert();
    try {
      const saved = await ctx.api.chat.setPrefs(conversationId, patch);
      if (saved && typeof saved === 'object') summary = { ...summary, prefs: { ...summary.prefs, ...saved } };
    } catch (e) {
      summary = { ...summary, prefs: before };
      problem = writeErrorMessage(e, 'Couldn’t change that setting.');
    }
    renderHeader();
    renderAlert();
  }

  // ---- scrolling ----

  function scroller() {
    return document.scrollingElement || document.documentElement;
  }

  function nearBottom() {
    const s = scroller();
    return s.scrollHeight - s.scrollTop - s.clientHeight <= NEAR_BOTTOM_PX;
  }

  function toBottom() {
    const s = scroller();
    s.scrollTop = s.scrollHeight;
    unseen = 0;
    renderNew();
  }

  // ---- sending ----

  function setProblem(text) {
    problem = text;
    renderAlert();
  }

  function sendText() {
    const text = box.value.trim();
    if (!text) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setProblem(`Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters. This one has ${text.length.toLocaleString()}.`);
      return;
    }
    setProblem('');
    box.value = '';
    keepDraft();
    queueSend({ body: text, files: [] });
  }

  /** Files (and pasted pictures) as messages, one each — the first with what was typed. Online only. */
  function sendFiles(chosen) {
    if (!chosen.length) return;
    if (!online()) {
      setProblem(OFFLINE_FILES);
      return;
    }
    const problems = chosen.map((f) => validateAttachment(f)).filter(Boolean);
    const ok = chosen.filter((f) => !validateAttachment(f));
    setProblem(problems.join(' '));
    if (!ok.length) return;
    const caption = box.value.trim();
    if (caption.length > MAX_MESSAGE_LENGTH) {
      setProblem(`Captions can be up to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`);
      return;
    }
    box.value = '';
    keepDraft();
    ok.forEach((file, i) => queueSend({ body: i === 0 ? caption : '', files: [{ name: file.name, size: file.size, type: file.type, progress: 0 }] }, file));
  }

  function queueSend({ body, files: shownFiles }, file) {
    const clientId = newIdempotencyKey();
    // `key`: this try's Idempotency-Key (the first is the clientId; Retry makes a new one).
    const p = { clientId, key: clientId, body, createdAt: new Date().toISOString(), state: 'sending', error: undefined, replyTo: null, files: shownFiles };
    if (file) files.set(p.clientId, file);
    outgoing = [...outgoing, p];
    render();
    toBottom();
    deliver(p);
  }

  function deliver(p) {
    chain = chain.then(() => deliverNow(p));
    return chain;
  }

  async function deliverNow(p) {
    if (!outgoing.includes(p)) return; // discarded meanwhile
    p.state = 'sending';
    p.error = undefined;
    render();
    const file = files.get(p.clientId);
    try {
      if (file) {
        if (!online()) throw Object.assign(new Error(OFFLINE_FILES), { userMessage: OFFLINE_FILES });
        await earlierSent();
        take(await ctx.api.chat.upload(conversationId, file, { clientId: p.clientId, body: p.body || undefined }));
        settle(p);
      } else {
        const r = await ctx.write('chat.send', { conversationId, body: p.body, clientId: p.clientId }, { idempotencyKey: p.key });
        if (r && r.queued) {
          // Kept on this device: the same row a later read shows from the queue (until it is sent).
          take({
            id: r.item ? tempId(r.item) : `tmp-${p.clientId}`, conversationId, userId: me, body: p.body, createdAt: p.createdAt,
            editedAt: null, deletedAt: null, attachments: [], reactions: [], pending: true, clientId: p.clientId,
          });
        } else {
          take(r && r.data);
        }
        settle(p);
      }
    } catch (e) {
      p.state = 'failed';
      p.error = file ? (e && e.userMessage) || fileFailure(e) : writeErrorMessage(e, 'Your message wasn’t sent.');
    } finally {
      if (ctx.afterMutation) ctx.afterMutation();
    }
    keepFailed();
    render();
  }

  /** Whether a message of this conversation is kept on this device, waiting to be sent. */
  async function keptWaiting() {
    if (!ctx.storage) return false;
    try {
      return (await getQueue(ctx.storage)).some((i) => i.userId === me && i.kind === 'chat.send' && i.status !== 'failed'
        && i.payload && i.payload.conversationId === conversationId);
    } catch {
      return false;
    }
  }

  /** A file goes after the messages kept before it: they are sent first; when they can't go yet, it waits. */
  async function earlierSent() {
    if (!(await keptWaiting())) return;
    if (typeof ctx.requestSync === 'function') {
      try { await ctx.requestSync(); } catch { /* checked below */ }
    }
    if (await keptWaiting()) throw Object.assign(new Error(EARLIER_WAITING), { userMessage: EARLIER_WAITING });
  }

  /** The server's copy of a message sent from here goes into the newest page. */
  function take(message) {
    if (!message || !message.id) return;
    const page = pages[0] || (pages[0] = []);
    const at = page.findIndex((x) => x.id === message.id);
    if (at >= 0) page[at] = { ...page[at], ...message };
    else page.push(message);
  }

  function settle(p) {
    outgoing = outgoing.filter((x) => x !== p);
    files.delete(p.clientId);
  }

  function findOutgoing(m) {
    return outgoing.find((p) => p.clientId === m.clientId) || null;
  }

  function findKept(m) {
    return keptFailed.find((k) => k.clientId === m.clientId) || null;
  }

  /**
   * Send it again: a new try (a new Idempotency-Key — the server keeps its refusal of the last one),
   * the same message. One kept on this device goes back in line for the sync (as Settings → Sync's Retry).
   */
  async function retry(m) {
    const k = findKept(m);
    if (k) {
      await retryQueued(ctx.storage, k.queueId);
      keptFailed = keptFailed.filter((x) => x !== k);
      render();
      if (typeof ctx.requestSync === 'function') {
        try { await ctx.requestSync(); } catch { /* the next sync sends it */ }
      }
      await poll();
      return;
    }
    const p = findOutgoing(m);
    if (!p) return;
    p.key = newIdempotencyKey();
    deliver(p);
  }

  async function discard(m) {
    const k = findKept(m);
    if (k) {
      await removeQueued(ctx.storage, k.queueId);
      keptFailed = keptFailed.filter((x) => x !== k);
    } else {
      const p = findOutgoing(m);
      if (!p) return;
      settle(p);
      keepFailed();
    }
    render();
    box.focus();
  }
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
