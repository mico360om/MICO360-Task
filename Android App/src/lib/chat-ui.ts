/**
 * The chat's screens, the website's way (3b): the people a new direct message can go to (and the
 * conversation with them that already exists), a conversation's members and its header line,
 * my settings for a conversation (favorite, mute, archive), the words for a receipt, and a picked
 * file. Pure, so it is tested here.
 */
import { ApiError, isNetworkError } from './api-client';
import { uploadErrorMessage, uploadMimeType } from './attachments';
import { lastActiveLabel, NO_PREFS, validateAttachment, type ReceiptStatus } from './chat-model';
import { dateFormat } from './intl-cache';
import type { ApiConversationSummary, ApiDirectoryUser, ConversationPrefs } from './types';

const fullName = (u: Pick<ApiDirectoryUser, 'firstName' | 'lastName' | 'username'>) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username;

// ── New direct message ──────────────────────────────────────────────────────

/** The people a direct message can go to: active ones other than me, by name; a search keeps names or usernames that contain it. */
export function dmCandidates(directory: readonly ApiDirectoryUser[], myId: string, query: string): { id: string; label: string; hint: string }[] {
  const q = query.trim().toLocaleLowerCase();
  return directory
    .filter((u) => u.id !== myId && u.active !== false)
    .map((u) => ({ id: u.id, label: fullName(u), hint: `@${u.username}` }))
    .filter((o) => !q || o.label.toLocaleLowerCase().includes(q) || o.hint.toLocaleLowerCase().includes(q))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The direct conversation with this person that already exists, or null (one is then started). */
export function directWith(inbox: readonly ApiConversationSummary[] | undefined, myId: string, userId: string): string | null {
  if (!inbox || !Array.isArray(inbox)) return null;
  const list: readonly ApiConversationSummary[] = inbox;
  return (
    list.find((s) => s.conversation.kind === 'DIRECT' && s.participants.some((p) => p.userId === userId) && s.participants.every((p) => p.userId === userId || p.userId === myId))
      ?.conversation.id ?? null
  );
}

/** Why a direct conversation couldn't be started (it needs a connection). */
export function startDirectError(e: unknown, name: string): string {
  if (isNetworkError(e)) return `Couldn’t start a conversation with ${name} — you’re offline. Try again when connected.`;
  if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.message && !/^Request failed/.test(e.message)) return `Couldn’t start a conversation with ${name}. ${e.message}`;
  return `Couldn’t start a conversation with ${name}.`;
}

// ── Members and the header ──────────────────────────────────────────────────

export interface MemberRow {
  id: string;
  name: string;
  username?: string;
  online: boolean;
  presence: string;
  me: boolean;
}

/** A conversation's members as the website lists them: me first, then who is online, then by name. */
export function memberRows(memberIds: readonly string[], directory: readonly ApiDirectoryUser[], myId: string, isOnline: (userId: string) => boolean, now: Date = new Date()): MemberRow[] {
  const people = new Map(directory.map((u) => [u.id, u]));
  return [...new Set(memberIds)]
    .map((id) => {
      const u = people.get(id);
      const online = id === myId || isOnline(id);
      return {
        id,
        name: u ? fullName(u) : id === myId ? 'You' : 'Someone',
        username: u?.username,
        online,
        presence: id === myId ? 'Active now' : lastActiveLabel(u?.lastActiveAt ?? null, online, now),
        me: id === myId,
      };
    })
    .sort((a, b) => Number(b.me) - Number(a.me) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

/** The line under a conversation's name: when the other person was last active, or a channel's people. */
export function conversationSubtitle(x: { kind: 'DIRECT' | 'PROJECT'; partner?: Pick<ApiDirectoryUser, 'lastActiveAt'> | null; online: boolean; members: readonly MemberRow[]; now?: Date }): string {
  if (x.kind === 'DIRECT') return lastActiveLabel(x.partner?.lastActiveAt ?? null, x.online, x.now);
  if (!x.members.length) return 'Project channel';
  const online = x.members.filter((m) => m.online && !m.me).length;
  return `Project channel · ${x.members.length} members${online ? ` · ${online} online` : ''}`;
}

// ── My settings for a conversation ──────────────────────────────────────────

/** Favorite, mute and archive, each offered the way round it is (the website's words). */
export function prefsMenu(prefs: ConversationPrefs): { key: keyof ConversationPrefs; label: string; patch: Partial<ConversationPrefs> }[] {
  return [
    { key: 'favorite', label: prefs.favorite ? 'Remove from favorites' : 'Add to favorites', patch: { favorite: !prefs.favorite } },
    { key: 'muted', label: prefs.muted ? 'Unmute notifications' : 'Mute notifications', patch: { muted: !prefs.muted } },
    { key: 'archived', label: prefs.archived ? 'Move out of archive' : 'Archive', patch: { archived: !prefs.archived } },
  ];
}

/** The list with a conversation's settings changed at once (a channel not in it yet is added). */
export function withPrefs(
  inbox: readonly ApiConversationSummary[] | undefined,
  target: { id: string; kind: 'DIRECT' | 'PROJECT'; projectId?: string },
  prefs: Partial<ConversationPrefs>,
): ApiConversationSummary[] {
  const list = Array.isArray(inbox) ? inbox : [];
  if (list.some((s) => s.conversation.id === target.id)) {
    return list.map((s) => (s.conversation.id === target.id ? { ...s, prefs: { ...NO_PREFS, ...s.prefs, ...prefs } } : s));
  }
  return [
    ...list,
    { conversation: { id: target.id, kind: target.kind, projectId: target.projectId ?? null, createdAt: '' }, participants: [], unread: 0, lastMessage: null, prefs: { ...NO_PREFS, ...prefs } },
  ];
}

/** Why a setting wasn't changed: it needs a connection, or the server's reason. */
export function prefsFailure(e: unknown): string {
  if (isNetworkError(e)) return 'Changing this needs a connection. Try again when you’re online.';
  if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.message && !/^Request failed/.test(e.message)) return `Couldn’t change that setting. ${e.message}`;
  return 'Couldn’t change that setting.';
}

/** When a conversation's last message came (the website's list): the time today, "Yesterday", the weekday this week, else the date. */
export function listTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) return dateFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 864e5) return dateFormat(undefined, { weekday: 'short' }).format(d);
  return dateFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

/** Trailing punctuation that belongs to the sentence, not to a web address in it. */
const TRAILING = /[.,;:!?)\]}'"»]+$/;

/** A message's words with its http(s) addresses picked out (nothing else is ever a link), as the website does. */
export function linkParts(text: string): Array<{ text: string; url: string | null }> {
  const pieces = text.split(/(https?:\/\/[^\s<>]+)/g);
  if (pieces.length === 1) return [{ text, url: null }];
  const out: Array<{ text: string; url: string | null }> = [];
  const plain = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.url === null) last.text += t;
    else out.push({ text: t, url: null });
  };
  pieces.forEach((piece, i) => {
    if (i % 2 === 0) return plain(piece);
    const tail = TRAILING.exec(piece)?.[0] ?? '';
    const url = tail ? piece.slice(0, -tail.length) : piece;
    out.push({ text: url, url });
    plain(tail);
  });
  return out;
}

// ── Receipts and files ──────────────────────────────────────────────────────

const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  queued: 'Waiting for connection',
  sending: 'Sending',
  failed: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
};

/** Where my message stands, in the website's words (for TalkBack) and as ticks. */
export function receiptText(r: { status: ReceiptStatus | string; seenBy?: number }): { label: string; ticks: string } {
  const status = r.status as ReceiptStatus;
  const label = status === 'read' && r.seenBy ? `Seen by ${r.seenBy}` : RECEIPT_LABEL[status] ?? '';
  if (status === 'sent') return { label, ticks: '✓' };
  if (status === 'delivered' || status === 'read') return { label, ticks: r.seenBy ? `✓✓ ${r.seenBy}` : '✓✓' };
  return { label, ticks: '' };
}

/**
 * A file from the picker, ready to check and send: its type from its name when the picker gives
 * none; its size null when the picker doesn't know it.
 */
export function pickedFile(f: { uri: string; name: string; size?: number | null; mimeType?: string | null }): { uri: string; name: string; size: number | null; type: string } {
  return { uri: f.uri, name: f.name, size: typeof f.size === 'number' ? f.size : null, type: uploadMimeType(f.name, f.mimeType) };
}

/** Why a picked file can't be sent (the website's checks), or null; an unknown size is left to the server. */
export function fileProblem(f: { name: string; size: number | null; type: string }): string | null {
  return validateAttachment({ name: f.name, size: f.size ?? 1, type: f.type });
}

/** Why a file wasn't sent: offline, or the server's own reason (as for task files). */
export function uploadFailure(e: unknown): string {
  if (isNetworkError(e) && (e as { timedOut?: unknown }).timedOut !== true) return 'You’re offline — files can be sent when you’re connected.';
  return uploadErrorMessage(e);
}
