/**
 * The chat page's logic, kept free of React so it can be tested on its own: how messages are
 * grouped into a timeline, how the sidebar's sections are built, what a sent message's status is,
 * how messages still on their way are shown next to the server's, which files can be attached, and
 * each conversation's unsent draft.
 */
import type { ApiMessage, ApiParticipant, ConversationPrefs, ConversationSummary, ReplyQuote } from '../api/chat';

/** Consecutive messages from one person within this window form one group (one name, one avatar). */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** The server's limits. */
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** File types the server accepts by default (UPLOAD_ALLOWED_MIME). */
export const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** A message the server doesn't have yet (or refused): shown in place with its state. */
export interface PendingMessage {
  clientId: string;
  conversationId: string;
  body: string;
  createdAt: string;
  /** queued = waiting for the connection; sending; failed = the server said no or was unreachable. */
  state: 'queued' | 'sending' | 'failed';
  error?: string;
  replyTo: ReplyQuote | null;
  /** Files going with it (a pending upload), with progress 0–1. */
  files: Array<{ name: string; size: number; type: string; progress: number; previewUrl?: string }>;
}

/** A message as shown: the server's, or a pending one standing in for it. */
export type ShownMessage = ApiMessage & { pending?: PendingMessage['state']; error?: string; pendingFiles?: PendingMessage['files'] };

export type TimelineItem =
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'message'; key: string; message: ShownMessage; groupStart: boolean; groupEnd: boolean };

function dayKey(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}

export function dayLabel(iso: string, now = new Date(), timeZone?: string): string {
  const key = dayKey(iso, timeZone);
  if (key === dayKey(now.toISOString(), timeZone)) return 'Today';
  if (key === dayKey(new Date(now.getTime() - 864e5).toISOString(), timeZone)) return 'Yesterday';
  const sameYear = key.slice(0, 4) === dayKey(now.toISOString(), timeZone).slice(0, 4);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
}

/**
 * Day separators, an "unread" line before the first message from someone else after `unreadAfter`,
 * and groups: one sender's messages on the same day, each within five minutes of the last.
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

/** One line in the sidebar: a project channel (opened or not yet) or a direct conversation. */
export interface InboxRow {
  key: string;
  kind: 'PROJECT' | 'DIRECT';
  conversationId: string | null;
  projectId?: string;
  partnerId?: string;
  title: string;
  unread: number;
  lastMessage: ConversationSummary['lastMessage'];
  prefs: ConversationPrefs;
  /** For sorting by recent activity. */
  activityAt: number;
}

const NO_PREFS: ConversationPrefs = { favorite: false, archived: false, muted: false };

/**
 * The sidebar's sections. Favorites first, then every project channel (even one nobody has opened
 * yet), then direct conversations — most recently active first — and archived ones apart. A search
 * keeps only names that contain it (any language, any case).
 */
export function inboxSections(input: {
  inbox: ConversationSummary[];
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
  ctx: { myId: string; kind: 'PROJECT' | 'DIRECT'; participants: Array<Pick<ApiParticipant, 'userId' | 'lastReadAt'> & { lastDeliveredAt?: string | null }>; isOnline: (userId: string) => boolean },
): { status: ReceiptStatus; seenBy?: number } {
  if (m.pending) return { status: m.pending };
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

/**
 * Server pages (newest page first, each oldest-first) flattened oldest-first without repeats, then
 * the pending messages the server hasn't confirmed (a confirmed one shares its clientId).
 */
export function mergeMessages(pages: ApiMessage[][], pending: PendingMessage[], myId: string): ShownMessage[] {
  const seen = new Set<string>();
  const out: ShownMessage[] = [];
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

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Why a file can't be sent (null when it can). */
export function validateAttachment(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (file.size === 0) return `“${file.name}” is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `“${file.name}” is ${mb(file.size)} — files can be up to 10 MB.`;
  if (!ALLOWED_TYPES.has(file.type)) return `“${file.name}” can’t be sent: only pictures, PDFs, text, CSV, ZIP and Word / Excel / PowerPoint files are allowed.`;
  return null;
}

const DRAFT_KEY = (conversationId: string) => `mico360.chat.draft.${conversationId}`;

/** This conversation's unsent text ('' when none). */
export function loadDraft(conversationId: string): string {
  try {
    return localStorage.getItem(DRAFT_KEY(conversationId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(conversationId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_KEY(conversationId), text);
    else localStorage.removeItem(DRAFT_KEY(conversationId));
  } catch {
    /* storage unavailable: the draft lives only in the page */
  }
}

/** A new id for a message being sent (lets the server recognise a retry). */
export function newClientId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** "512 B", "2 KB", "3.5 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * The sidebar's one line about a conversation's last message: who wrote it (in a channel; "You"
 * for your own), the text on one line, or what it was when there is no text.
 */
export function previewOf(
  last: ConversationSummary['lastMessage'],
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
 * Whether this app should tell the server it has received a direct conversation's newest message
 * (so its sender sees "Delivered"): the other person wrote it, and it is newer than what this
 * person's apps have already confirmed or read.
 */
export function needsDeliveryAck(s: ConversationSummary, myId: string): boolean {
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

const SECTIONS_KEY = 'mico360.chat.sections';

/** Which sidebar sections are closed (Archived starts closed). */
export function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === 'object') return { archived: true, ...(parsed as Record<string, boolean>) };
  } catch {
    /* unreadable: start from the default */
  }
  return { archived: true };
}

export function saveCollapsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: remembered for this visit only */
  }
}

const OUTBOX_KEY = (userId: string) => `mico360.chat.outbox.${userId}`;

/**
 * Text messages not confirmed by the server yet, kept in the browser so leaving the page (or a
 * reload) doesn't lose them. They come back waiting to be sent again — with the same id, so a
 * message that did reach the server isn't stored twice. Files can't be kept this way.
 */
export function saveOutbox(userId: string, pending: PendingMessage[]): void {
  try {
    const keep = pending.filter((p) => p.files.length === 0);
    if (keep.length) localStorage.setItem(OUTBOX_KEY(userId), JSON.stringify(keep));
    else localStorage.removeItem(OUTBOX_KEY(userId));
  } catch {
    /* storage unavailable: kept for this visit only */
  }
}

export function loadOutbox(userId: string): PendingMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OUTBOX_KEY(userId)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is PendingMessage => !!p && typeof p === 'object' && typeof (p as PendingMessage).clientId === 'string' && typeof (p as PendingMessage).conversationId === 'string' && typeof (p as PendingMessage).body === 'string')
      .map((p) => ({ ...p, files: [], state: p.state === 'failed' ? 'failed' : 'queued' }));
  } catch {
    return [];
  }
}
