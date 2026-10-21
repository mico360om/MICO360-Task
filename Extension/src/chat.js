/**
 * Pure chat helpers for the Chat screen and the read cache. Framework-free and testable.
 * The screen fetches `/conversations` (inbox summaries) and `/users/directory`; these turn
 * that raw data into display rows, and keep deleted messages' text out of storage.
 */

/** Inbox preview shown for a conversation whose latest message was deleted. */
export const DELETED_PREVIEW = 'Message deleted';

/**
 * A chat message that is safe to store and show: a deleted message keeps no text and no
 * attachments (CHAT-01), whatever an older server sent. Applied before anything is cached.
 */
export function sanitizeMessage(m) {
  if (!m || !m.deletedAt) return m;
  return { ...m, body: '', attachments: [] };
}

export function sanitizeMessages(list) {
  return Array.isArray(list) ? list.map(sanitizeMessage) : list;
}

/** Inbox summaries with each `lastMessage` sanitized. */
export function sanitizeSummaries(list) {
  return Array.isArray(list)
    ? list.map((s) => (s && s.lastMessage ? { ...s, lastMessage: sanitizeMessage(s.lastMessage) } : s))
    : list;
}

/** One-line inbox preview of a conversation's latest message — never a deleted message's text. */
export function messagePreview(m) {
  if (!m) return '';
  if (m.deletedAt) return DELETED_PREVIEW;
  return m.body || '';
}

/**
 * Turn inbox summaries into compact display rows, most-unread first.
 * @param summaries  the `/conversations` payload
 * @param opts.directory   `/users/directory` rows (id + name), for DM titles
 * @param opts.myId        the current user's id (to find the "other" DM participant)
 * @param opts.projectNames map of projectId → project name, for channel titles
 */
export function describeConversations(summaries, { directory = [], myId, projectNames = {} } = {}) {
  return (summaries ?? [])
    .map((s) => {
      const conv = s.conversation;
      let title;
      if (conv.kind === 'PROJECT') {
        title = projectNames[conv.projectId] || 'Project channel';
      } else {
        const otherId = (s.participants || []).map((p) => p.userId).find((id) => id !== myId);
        const u = directory.find((d) => d.id === otherId);
        title = u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Direct message';
      }
      return {
        id: conv.id,
        kind: conv.kind,
        title,
        unread: s.unread || 0,
        preview: messagePreview(s.lastMessage),
      };
    })
    .sort((a, b) => b.unread - a.unread);
}

/** Badge text for a count: '' for 0, the number up to 9, then '9+'. */
export function badgeText(count) {
  if (!count || count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

// ---- Stage 5: chat as the web shows it ------------------------------------------------------
// A plain-JavaScript copy of the web's Web Portal/frontend/src/lib/chat-model.ts (the parts the
// extension uses); src/chat-stage5.test.js runs both over the same inputs, so they can't drift.

/** The server's limits. */
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Messages in one page of history (the server's default, and the web's page size). */
export const CHAT_PAGE_SIZE = 50;
/**
 * How often an open chat screen reads itself again (the extension has no live connection: polling
 * every 10–15 seconds while a conversation is on screen was chosen over a socket).
 */
export const CHAT_POLL_MS = 12000;
/** File types the server accepts by default (UPLOAD_ALLOWED_MIME). */
export const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** A conversation's own settings when the server sends none (an older server): all off. */
export const NO_PREFS = Object.freeze({ favorite: false, archived: false, muted: false });

/**
 * The inbox's sections. Favorites first, then every project channel (even one nobody has opened
 * yet), then direct conversations — most recently active first — and archived ones apart. A search
 * keeps only names that contain it (any language, any case).
 */
export function inboxSections({ inbox, projects, myId, nameOf, query }) {
  const rows = [];
  const byProject = new Map(inbox.filter((s) => s.conversation.kind === 'PROJECT').map((s) => [s.conversation.projectId, s]));
  for (const p of projects) {
    const s = byProject.get(p.id);
    rows.push({
      key: `p-${p.id}`,
      kind: 'PROJECT',
      conversationId: s?.conversation.id ?? null,
      projectId: p.id,
      title: p.name,
      unread: s?.unread ?? 0,
      lastMessage: s?.lastMessage ?? null,
      prefs: s?.prefs ?? NO_PREFS,
      activityAt: s?.lastMessage ? new Date(s.lastMessage.createdAt).getTime() : 0,
    });
  }
  for (const s of inbox.filter((x) => x.conversation.kind === 'DIRECT')) {
    const partnerId = s.participants.find((pt) => pt.userId !== myId)?.userId;
    rows.push({
      key: `d-${s.conversation.id}`,
      kind: 'DIRECT',
      conversationId: s.conversation.id,
      partnerId,
      title: partnerId ? nameOf(partnerId) : 'Direct message',
      unread: s.unread,
      lastMessage: s.lastMessage,
      prefs: s.prefs ?? NO_PREFS,
      activityAt: s.lastMessage ? new Date(s.lastMessage.createdAt).getTime() : new Date(s.conversation.createdAt || 0).getTime() || 0,
    });
  }
  const q = String(query || '').trim().toLocaleLowerCase();
  const shown = q ? rows.filter((r) => r.title.toLocaleLowerCase().includes(q)) : rows;
  const recent = (a, b) => b.activityAt - a.activityAt || a.title.localeCompare(b.title);
  const live = shown.filter((r) => !r.prefs.archived);
  const archived = shown.filter((r) => r.prefs.archived).sort(recent);
  return {
    favorites: live.filter((r) => r.prefs.favorite).sort(recent),
    channels: live.filter((r) => !r.prefs.favorite && r.kind === 'PROJECT').sort(recent),
    directs: live.filter((r) => !r.prefs.favorite && r.kind === 'DIRECT').sort(recent),
    archived,
    archivedUnread: rows.filter((r) => r.prefs.archived).reduce((n, r) => n + r.unread, 0),
  };
}

/**
 * The inbox's one line about a conversation's last message: who wrote it (in a channel; "You" for
 * your own), the text on one line, or what it was when there is no text.
 */
export function previewOf(last, { myId, kind, nameOf }) {
  if (!last) return '';
  if (last.deletedAt) return 'Message deleted';
  const text = last.body.replace(/\s+/g, ' ').trim();
  const file = last.attachments?.[0];
  const what = text || (file ? `📎 ${file.fileName}` : 'Sent a file');
  if (last.userId === myId) return `You: ${what}`;
  if (kind === 'PROJECT') return `${nameOf(last.userId).split(' ')[0]}: ${what}`;
  return what;
}

/**
 * Whether to tell the server a direct conversation's newest message has reached this person (so its
 * sender sees "Delivered"): the other person wrote it, and it is newer than what this person's apps
 * have already confirmed or read.
 */
export function needsDeliveryAck(s, myId) {
  const last = s.lastMessage;
  if (s.conversation.kind !== 'DIRECT' || !last || last.userId === myId || last.deletedAt) return false;
  const me = s.participants.find((p) => p.userId === myId);
  const at = new Date(last.createdAt).getTime();
  const covered = (iso) => !!iso && new Date(iso).getTime() >= at;
  return !covered(me?.lastDeliveredAt) && !covered(me?.lastReadAt);
}

/**
 * Server pages (newest page first, each oldest-first) flattened oldest-first without repeats, then
 * the messages on their way the server hasn't confirmed (a confirmed one shares its clientId):
 * `{ clientId, conversationId, body, createdAt, state: 'queued' | 'sending' | 'failed', error?, replyTo, files }`.
 */
export function mergeMessages(pages, pending, myId) {
  const seen = new Set();
  const out = [];
  for (let i = pages.length - 1; i >= 0; i--) {
    for (const m of pages[i] ?? []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  const confirmed = new Set(out.map((m) => m.clientId).filter(Boolean));
  for (const p of pending) {
    if (confirmed.has(p.clientId)) continue;
    out.push({
      id: `pending-${p.clientId}`,
      conversationId: p.conversationId,
      userId: myId,
      body: p.body,
      editedAt: null,
      deletedAt: null,
      createdAt: p.createdAt,
      reactions: [],
      attachments: [],
      replyTo: p.replyTo,
      clientId: p.clientId,
      pending: p.state,
      error: p.error,
      pendingFiles: p.files,
    });
  }
  return out;
}

/** A full page of history: there may be older messages before it. */
export function hasOlderPage(page) {
  return Array.isArray(page) && page.length >= CHAT_PAGE_SIZE;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Why a file can't be sent (null when it can). */
export function validateAttachment(file) {
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `“${file.name}” is ${mb(file.size)} — files can be up to 10 MB.`;
  if (!ALLOWED_TYPES.has(file.type)) return `“${file.name}” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.`;
  return null;
}

/** "512 B", "2 KB", "3.5 MB". */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** A name inside a sentence keeps its own direction (Arabic in English text, or the other way round). */
const isolate = (name) => `⁨${name}⁩`;

/** "Message #Channel" — kept short so the empty box stays one line (as on the web). */
export function placeholderFor(kind, title) {
  const name = isolate(title.length > 22 ? `${title.slice(0, 20).trim()}…` : title);
  return kind === 'PROJECT' ? `Message #${name}` : `Message ${name}`;
}

/** "👍 2: You and Omar Ahmed" — a reaction's count and who reacted, for screen readers and on hover. */
export function reactionLabel(r, { myId, nameOf }) {
  const who = r.userIds.map((id) => (id === myId ? 'You' : nameOf(id)));
  const list = who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}` : who.join('');
  return `${r.emoji} ${r.userIds.length}: ${list}`;
}
