import { el, mount, Loader, ErrorState, Empty, timeAgo } from '../dom.js';
import { describeConversations, badgeText } from '../../src/chat.js';

/**
 * Chat — two modes chosen by ctx.params.conversationId:
 *   inbox  (no id): project channels + direct messages
 *   thread (id)   : one conversation's messages + a composer
 * Sending follows the offline pattern (ApiError → show; network fail → enqueue), then appends optimistically.
 */
export function ChatScreen(ctx) {
  // Declare ALL screen state BEFORE load()/return so re-render closures never hit a TDZ error.
  const conversationId = ctx.params.conversationId;
  const root = el('div');
  let directory = [];       // /users/directory rows (author + DM names)
  let projects = [];        // inbox: project list (for channels)
  let conversations = [];   // inbox: conversation summaries
  let messages = [];        // thread: message list
  let stale = false;
  let draft = '';           // thread: composer text (survives re-render)
  let sendError = '';       // thread: last send failure (ApiError)

  load();
  return root;

  async function load() {
    mount(root, Loader());
    try {
      if (conversationId) await loadThread();
      else await loadInbox();
    } catch {
      mount(root, ErrorState('Could not load chat.', load));
    }
  }

  // ---------- INBOX ----------
  async function loadInbox() {
    const [pRes, cRes, dRes] = await Promise.all([
      ctx.api.projects.list(),
      ctx.api.chat.conversations(),
      ctx.api.directory(),
    ]);
    projects = pRes.data ?? [];
    conversations = cRes.data ?? [];
    directory = dRes.data ?? [];
    stale = !!(pRes.stale || cRes.stale || dRes.stale);
    renderInbox();
  }

  function renderInbox() {
    const projectNames = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const dms = describeConversations(conversations, { directory, myId: ctx.me.id, projectNames })
      .filter((r) => r.kind === 'DIRECT');

    const channels = projects.map((p) => {
      const summary = conversations.find(
        (s) => s.conversation && s.conversation.kind === 'PROJECT' && s.conversation.projectId === p.id,
      );
      const preview = summary && summary.lastMessage && summary.lastMessage.body;
      return inboxRow(`# ${p.name}`, preview, summary ? summary.unread : 0, () => openChannel(p));
    });

    mount(root,
      stale ? el('div', { class: 'toolbar' }, el('span', { class: 'stale-tag' }, 'offline · saved')) : null,
      channels.length === 0 && dms.length === 0
        ? Empty('No conversations', 'Project channels and direct messages show up here.')
        : el('div', {},
            channels.length ? section('Channels', channels) : null,
            dms.length ? section('Direct messages', dms.map((r) => inboxRow(r.title, r.preview, r.unread, () => ctx.navigate(`#/chat/${r.id}`)))) : null,
          ),
    );
  }

  async function openChannel(project) {
    try {
      const res = await ctx.api.chat.openProjectChannel(project.id); // raw() → { conversation, messages }
      const conv = res && res.conversation;
      if (conv && conv.id) ctx.navigate(`#/chat/${conv.id}`);
    } catch {
      /* offline — a fresh channel can't be opened without the network */
    }
  }

  function inboxRow(title, preview, unread, onClick) {
    return el('button', { class: 'nrow', type: 'button', onClick },
      el('span', { class: 'nb' },
        el('span', { class: 'ntitle' }, title),
        preview ? el('div', { class: 'muted', style: { fontSize: '13px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, preview) : null,
      ),
      unread ? el('span', { class: 'badge', style: { alignSelf: 'center' } }, badgeText(unread)) : null,
    );
  }

  // ---------- THREAD ----------
  async function loadThread() {
    const [mRes, dRes] = await Promise.all([
      ctx.api.chat.messages(conversationId),
      ctx.api.directory(),
    ]);
    messages = mRes.data ?? [];
    directory = dRes.data ?? [];
    stale = !!(mRes.stale || dRes.stale);
    renderThread();
    // Best-effort: clear the unread badge for this conversation. Ignore failures (incl. offline).
    try { await ctx.api.chat.markRead(conversationId); } catch { /* ignore */ }
    ctx.afterMutation();
  }

  function renderThread() {
    const textarea = el('textarea', {
      class: 'field', placeholder: 'Write a message…', rows: '2', value: draft,
      onInput: (e) => { draft = e.target.value; },
    });
    mount(root,
      el('div', { class: 'toolbar' },
        el('button', { class: 'btn sm', type: 'button', onClick: () => ctx.navigate('#/chat') }, '← Back'),
        stale ? el('span', { class: 'stale-tag' }, 'offline · saved') : null,
      ),
      messages.length === 0
        ? Empty('No messages yet', 'Be the first to say something.')
        : el('div', { class: 'thread' }, messages.map((m) => msgBlock(m))),
      sendError ? el('div', { class: 'errbar', role: 'alert', style: { marginTop: '12px' } }, el('span', {}, sendError)) : null,
      el('div', { class: 'composer' },
        textarea,
        el('button', { class: 'btn primary', type: 'button', onClick: send }, 'Send'),
      ),
    );
  }

  function msgBlock(m) {
    const deleted = !!m.deletedAt;
    const edited = !!m.editedAt && !deleted;
    return el('div', { class: 'msg' },
      el('div', { class: 'mh' },
        el('span', { class: 'author' }, authorName(m.userId)),
        el('span', { class: 'time' }, timeAgo(m.createdAt)),
        edited ? el('span', { class: 'time' }, '(edited)') : null,
      ),
      el('div', { class: 'txt', style: deleted ? { fontStyle: 'italic', color: 'var(--ink3)' } : null },
        deleted ? 'This message was deleted.' : m.body),
    );
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    sendError = '';
    try {
      await ctx.api.chat.send(conversationId, body);
      draft = '';
      messages = [...messages, optimistic(body)];
    } catch (e) {
      if (e && e.name === 'ApiError') sendError = 'Message could not be sent. Please try again.';
      else { await ctx.enqueue('chat.send', { conversationId, body }); draft = ''; messages = [...messages, optimistic(body)]; }
    } finally {
      ctx.afterMutation();
    }
    renderThread();
  }

  function optimistic(body) {
    return { id: `tmp-${Date.now()}`, userId: ctx.me.id, body, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, attachments: [], reactions: [] };
  }

  function authorName(userId) {
    if (userId === ctx.me.id) return 'You';
    const u = directory.find((d) => d.id === userId);
    if (!u) return 'Unknown';
    return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username || 'Unknown';
  }

  function section(title, children) {
    return el('div', { style: { marginTop: '20px' } },
      el('div', { class: 'section-title' }, title),
      el('div', { class: 'list' }, children),
    );
  }
}
