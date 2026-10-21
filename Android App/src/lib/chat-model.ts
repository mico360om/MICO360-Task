/**
 * The chat's logic as the website has it (3b) — a copy of Web Portal/frontend/src/lib/chat-model.ts
 * (with lastActive.ts and presence.ts), checked against it by chat-model.test.ts: the thread's day
 * lines, groups and "unread" line; the conversation list's sections; where one of my messages
 * stands (receipts); a conversation's last message in the list; telling the server a message
 * arrived; search highlights; which files can be sent; and who is online. Pure, so it is tested here.
 */
import { dateFormat } from './intl-cache';
import type { ApiChatMessage, ApiChatParticipant, ApiConversationSummary, ConversationPrefs } from './types';

/** Consecutive messages from one person within this window form one group (one name). */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** The server's limits. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** File types the server accepts by default (UPLOAD_ALLOWED_MIME). */
export const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** A message as shown: the server's, or one on its way standing in for it. */
export type ShownMessage = ApiChatMessage & { pending?: 'queued' | 'sending' | 'failed' | string };

export type TimelineItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'message'; key: string; message: ShownMessage; groupStart: boolean; groupEnd: boolean };

function dayKey(iso: string, timeZone?: string): string {
  return dateFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}

/** "Today", "Yesterday", "Mon, Oct 12" (a past year with it). */
export function dayLabel(iso: string, now = new Date(), timeZone?: string): string {
  const key = dayKey(iso, timeZone);
  if (key === dayKey(now.toISOString(), timeZone)) return 'Today';
  if (key === dayKey(new Date(now.getTime() - 864e5).toISOString(), timeZone)) return 'Yesterday';
  const sameYear = key.slice(0, 4) === dayKey(now.toISOString(), timeZone).slice(0, 4);
  return dateFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}

/**
 * Day separators, an "unread" line before the first message from someone else after `unreadAfter`,
 * and groups: one sender's messages on the same day, each within five minutes of the last.
 * `messages` oldest first.
 */
export function buildTimeline(messages: ShownMessage[], opts: { myId: string; unreadAfter: string | null; timeZone?: string; now?: Date }): TimelineItem[] {
  const items: TimelineItem[] = [];
  let unreadPlaced = !opts.unreadAfter;
  const unreadAt = opts.unreadAfter ? new Date(opts.unreadAfter).getTime() : 0;
  const sameGroup = (a: ShownMessage | undefined, b: ShownMessage | undefined) =>
    !!a && !!b && a.userId === b.userId && dayKey(a.createdAt, opts.timeZone) === dayKey(b.createdAt, opts.timeZone) && Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= GROUP_WINDOW_MS;
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    if (!prev || dayKey(prev.createdAt, opts.timeZone) !== dayKey(m.createdAt, opts.timeZone)) {
      items.push({ type: 'day', key: `day-${m.id}`, label: dayLabel(m.createdAt, opts.now, opts.timeZone) });
    }
    if (!unreadPlaced && m.userId !== opts.myId && !m.pending && new Date(m.createdAt).getTime() > unreadAt) {
      items.push({ type: 'unread', key: `unread-${m.id}` });
      unreadPlaced = true;
    }
    items.push({ type: 'message', key: m.id, message: m, groupStart: !sameGroup(prev, m), groupEnd: !sameGroup(m, next) });
  });
  return items;
}

/** One line in the conversation list: a project channel (opened or not yet) or a direct conversation. */
export interface InboxRow {
  key: string;
  kind: 'PROJECT' | 'DIRECT';
  conversationId: string | null;
  projectId?: string;
  partnerId?: string;
  title: string;
  unread: number;
  lastMessage: ApiConversationSummary['lastMessage'];
  prefs: ConversationPrefs;
  /** For sorting by recent activity. */
  activityAt: number;
}

export const NO_PREFS: ConversationPrefs = { favorite: false, archived: false, muted: false };

/**
 * The list's sections. Favorites first, then every project channel (even one nobody has opened
 * yet), then direct conversations — most recently active first — and archived ones apart. A search
 * keeps only names that contain it (any language, any case).
 */
export function inboxSections(input: {
  inbox: ApiConversationSummary[];
  projects: Array<{ id: string; name: string }>;
  myId: string;
  nameOf: (userId: string) => string;
  query: string;
}) {
  const rows: InboxRow[] = [];
  const byProject = new Map(input.inbox.filter((s) => s.conversation.kind === 'PROJECT').map((s) => [s.conversation.projectId, s]));
  for (const p of input.projects) {
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
  for (const s of input.inbox.filter((x) => x.conversation.kind === 'DIRECT')) {
    const partnerId = s.participants.find((pt) => pt.userId !== input.myId)?.userId;
    rows.push({
      key: `d-${s.conversation.id}`,
      kind: 'DIRECT',
      conversationId: s.conversation.id,
      partnerId,
      title: partnerId ? input.nameOf(partnerId) : 'Direct message',
      unread: s.unread,
      lastMessage: s.lastMessage,
      prefs: s.prefs ?? NO_PREFS,
      activityAt: s.lastMessage ? new Date(s.lastMessage.createdAt).getTime() : new Date(s.conversation.createdAt || 0).getTime() || 0,
    });
  }
  const q = input.query.trim().toLocaleLowerCase();
  const shown = q ? rows.filter((r) => r.title.toLocaleLowerCase().includes(q)) : rows;
  const recent = (a: InboxRow, b: InboxRow) => b.activityAt - a.activityAt || a.title.localeCompare(b.title);
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

export type ReceiptStatus = 'queued' | 'sending' | 'failed' | 'sent' | 'delivered' | 'read';

/**
 * Where one of my messages stands. Direct: read once the other person read past it, delivered once
 * their app received it (or they're online right now), else sent. Channel: how many have seen it.
 */
export function receiptState(
  m: ShownMessage,
  ctx: { myId: string; kind: 'PROJECT' | 'DIRECT'; participants: Array<Pick<ApiChatParticipant, 'userId' | 'lastReadAt'> & { lastDeliveredAt?: string | null }>; isOnline: (userId: string) => boolean },
): { status: ReceiptStatus; seenBy?: number } {
  if (m.pending) return { status: m.pending as ReceiptStatus };
  const at = new Date(m.createdAt).getTime();
  const others = ctx.participants.filter((p) => p.userId !== ctx.myId);
  const after = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() >= at;
  if (ctx.kind === 'PROJECT') {
    const seenBy = others.filter((p) => after(p.lastReadAt)).length;
    return seenBy > 0 ? { status: 'read', seenBy } : { status: 'sent' };
  }
  const other = others[0];
  if (!other) return { status: 'sent' };
  if (after(other.lastReadAt)) return { status: 'read' };
  if (after(other.lastDeliveredAt) || ctx.isOnline(other.userId)) return { status: 'delivered' };
  return { status: 'sent' };
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Why a file can't be sent (null when it can). */
export function validateAttachment(file: { name: string; size: number; type: string }): string | null {
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `“${file.name}” is ${mb(file.size)} — files can be up to 10 MB.`;
  if (!ALLOWED_TYPES.has(file.type)) return `“${file.name}” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.`;
  return null;
}

/** "512 B", "2 KB", "3.5 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * The list's one line about a conversation's last message: who wrote it (in a channel; "You" for
 * your own), the text on one line, or what it was when there is no text.
 */
export function previewOf(
  last: ApiConversationSummary['lastMessage'],
  ctx: { myId: string; kind: 'PROJECT' | 'DIRECT'; nameOf: (userId: string) => string },
): string {
  if (!last) return '';
  if (last.deletedAt) return 'Message deleted';
  const text = last.body.replace(/\s+/g, ' ').trim();
  const file = last.attachments?.[0];
  const what = text || (file ? `📎 ${file.fileName}` : 'Sent a file');
  if (last.userId === ctx.myId) return `You: ${what}`;
  if (ctx.kind === 'PROJECT') return `${ctx.nameOf(last.userId).split(' ')[0]}: ${what}`;
  return what;
}

/**
 * Whether this phone should tell the server it has received a direct conversation's newest message
 * (so its sender sees "Delivered"): the other person wrote it, and it is newer than what this
 * person's apps have already confirmed or read.
 */
export function needsDeliveryAck(s: ApiConversationSummary, myId: string): boolean {
  const last = s.lastMessage;
  if (s.conversation.kind !== 'DIRECT' || !last || last.userId === myId || last.deletedAt) return false;
  const me = s.participants.find((p) => p.userId === myId);
  const at = new Date(last.createdAt).getTime();
  const covered = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() >= at;
  return !covered(me?.lastDeliveredAt) && !covered(me?.lastReadAt);
}

/** The text cut into matching and non-matching runs (case-insensitive), for highlighting. */
export function highlightParts(text: string, q: string): Array<{ text: string; match: boolean }> {
  const needle = q.trim().toLocaleLowerCase();
  const hay = text.toLocaleLowerCase();
  // Lower-casing can change a string's length in a few scripts; then positions would not line up.
  if (!needle || hay.length !== text.length) return [{ text, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  let from = 0;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

/** A long message cut down to about `radius` characters either side of the first match. */
export function searchSnippet(body: string, q: string, radius = 60): string {
  const text = body.replace(/\s+/g, ' ').trim();
  const at = text.toLocaleLowerCase().indexOf(q.trim().toLocaleLowerCase());
  if (text.length <= radius * 2 + q.length || at === -1) return text.length > radius * 3 ? `${text.slice(0, radius * 3)}…` : text;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + q.trim().length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

// ── Presence (the website's lib/lastActive.ts and lib/presence.ts) ──────────

/**
 * Human "last active" label for a user, given their last-active timestamp and live online state.
 * "Active now" when online; "Offline" when never seen; otherwise a relative or dated "Last active …".
 */
export function lastActiveLabel(lastActiveAt: string | null, online: boolean, now: Date = new Date()): string {
  if (online) return 'Active now';
  if (!lastActiveAt) return 'Offline';
  const then = new Date(lastActiveAt).getTime();
  const s = Math.round((now.getTime() - then) / 1000);
  if (s < 45) return 'Last active just now';
  const m = Math.round(s / 60);
  if (m < 60) return `Last active ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Last active ${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `Last active ${d}d ago`;
  return `Last active on ${new Date(lastActiveAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

/** Presence updates pushed over the socket. */
export type PresenceEvent =
  | { type: 'state'; userIds: string[] } // full snapshot (sent on connect)
  | { type: 'online'; userId: string } // a user connected
  | { type: 'offline'; userId: string }; // a user's last socket disconnected

/** Fold a presence event into the set of online user ids (immutably). */
export function presenceReducer(state: Set<string>, ev: PresenceEvent): Set<string> {
  switch (ev.type) {
    case 'state':
      return new Set(ev.userIds);
    case 'online': {
      if (state.has(ev.userId)) return new Set(state);
      const next = new Set(state);
      next.add(ev.userId);
      return next;
    }
    case 'offline': {
      if (!state.has(ev.userId)) return new Set(state);
      const next = new Set(state);
      next.delete(ev.userId);
      return next;
    }
  }
}
