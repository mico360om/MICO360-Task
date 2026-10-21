/**
 * The thread's rows (3b), as the website shows them (buildTimeline): a line for each day, the
 * "unread" line before the first new message from someone else, and each sender's run of messages
 * grouped — then turned newest first for the inverted list (the newest at the bottom of the screen).
 * Messages still on this phone (chat-outbox) and files on their way come at the newest end, marked as
 * waiting; this phone's waiting edits, deletions and reactions show over the server's copy
 * (chat-actions). Pure, so it is tested here.
 */
import { failedChatChanges, withQueuedChatChanges, type FailedChatChange } from './chat-actions';
import { buildTimeline, type ShownMessage } from './chat-model';
import type { OutboxEntry } from './chat-outbox';
import { threadMessages, type ThreadPages } from './chat-thread';
import type { QueuedMutation } from './sync-queue';
import type { ApiConversationSummary, ReplyQuote } from './types';

/** A file being sent (it needs a connection, so it lives on screen only, as on the website). */
export interface UploadEntry {
  key: string;
  /** Its client id: a retried upload gets the first one back from the server, never a second. */
  clientId: string;
  conversationId: string;
  name: string;
  /** null when the picker didn't know it. */
  size: number | null;
  type: string;
  uri: string;
  /** How much has been sent (0–1). */
  progress: number;
  state: 'sending' | 'failed';
  error?: string;
  /** The words sent with it (the first file of a pick carries the message box's text). */
  caption: string;
  replyTo: ReplyQuote | null;
  createdAt: string;
}

/** A message as the thread shows it: the server's, or one on its way (with what it stands for). */
export type ThreadMessage = ShownMessage & { outbox?: OutboxEntry; upload?: UploadEntry; changeFailed?: FailedChatChange };

export type ThreadRow =
  | { type: 'day'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'message'; key: string; message: ThreadMessage; groupStart: boolean; groupEnd: boolean };

const outboxPending = (e: OutboxEntry): string => (e.state === 'failed' ? 'failed' : e.state === 'waiting' ? 'queued' : 'sending');

export function threadRows(input: {
  data: ThreadPages | undefined;
  outbox: readonly OutboxEntry[];
  uploads: readonly UploadEntry[];
  pending: readonly QueuedMutation[];
  /** This phone's changes that weren't saved: a refused edit or deletion shows on its message (3b review). */
  failed?: readonly QueuedMutation[];
  myId: string;
  unreadAfter: string | null;
  now?: Date;
  timeZone?: string;
}): ThreadRow[] {
  const notSaved = failedChatChanges(input.failed ?? []);
  const shown = withQueuedChatChanges([...threadMessages(input.data)].reverse(), input.pending, input.myId);
  const server: ThreadMessage[] = notSaved.size ? shown.map((m) => (notSaved.has(m.id) ? { ...m, changeFailed: notSaved.get(m.id) } : m)) : shown;
  const waiting: ThreadMessage[] = [
    ...input.outbox.map<ThreadMessage>((e) => ({
      id: `out-${e.queueId}`,
      conversationId: e.conversationId,
      userId: input.myId,
      body: e.body,
      editedAt: null,
      deletedAt: null,
      createdAt: e.createdAt,
      reactions: [],
      attachments: [],
      replyTo: e.replyTo ?? null,
      clientId: e.clientId,
      pending: outboxPending(e),
      outbox: e,
    })),
    ...input.uploads.map<ThreadMessage>((u) => ({
      id: `upload-${u.key}`,
      conversationId: u.conversationId,
      userId: input.myId,
      body: u.caption,
      editedAt: null,
      deletedAt: null,
      createdAt: u.createdAt,
      reactions: [],
      attachments: [],
      replyTo: u.replyTo,
      clientId: u.clientId,
      pending: u.state,
      upload: u,
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const items = buildTimeline([...server, ...waiting], { myId: input.myId, unreadAfter: input.unreadAfter, now: input.now, timeZone: input.timeZone });
  return (items as ThreadRow[]).reverse();
}

/** Where a message is among the rows (to jump to it), or -1 when it isn't loaded. */
export function rowIndexOf(rows: readonly ThreadRow[], messageId: string): number {
  return rows.findIndex((r) => r.type === 'message' && r.message.id === messageId);
}

/**
 * Where the "unread" line goes, taken as the thread opens (so reading it doesn't move it): after my
 * last read when something is unread, nowhere when all is read.
 */
export function unreadAfterOf(summary: ApiConversationSummary | undefined, myId: string): string | null {
  if (!summary || summary.unread <= 0) return null;
  return summary.participants.find((p) => p.userId === myId)?.lastReadAt ?? new Date(0).toISOString();
}
