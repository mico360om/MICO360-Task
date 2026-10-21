import { NO_ANSWER_TEXT, waitingTooLong, type QueuedMutation, type SyncQueue } from './sync-queue';
import type { ReplyQuote } from './types';

/**
 * The chat outbox (3a): every message is kept on the phone — in the offline queue (sync-queue),
 * which survives a restart — until the server has it, and is shown in its thread meanwhile.
 *
 * - A message is queued as it is sent, with a client id that is also its idempotency key. The queue
 *   sends the messages one at a time, in the order written, and again when the connection is back;
 *   the server recognises a retry by the client id and hands back the first copy, so a message is
 *   never stored twice.
 * - In the thread a message still on the phone says "Sending…" (or "Waiting for connection" while
 *   offline); one the server refused, or that kept failing, says "Not sent" with Retry and Discard.
 * - It is dropped from view as soon as its saved copy is in the thread (the live event may come
 *   before the send's answer).
 *
 * Pure, so it is tested here; the thread screen shows it.
 */

export const CHAT_SEND = 'chat.send';

/** The server's longest message. */
export const CHAT_MAX_LENGTH = 4000;

/** `unanswered`: a try got no answer in time; it is tried again (and can be discarded). */
export type OutboxState = 'sending' | 'waiting' | 'unanswered' | 'failed';

/** A message of this conversation still on this phone. */
export interface OutboxEntry {
  /** The queued change's id (for Retry and Discard). */
  queueId: string;
  /** Matches the server's copy (null for a message kept by an older version). */
  clientId: string | null;
  conversationId: string;
  body: string;
  createdAt: string;
  state: OutboxState;
  /** Why it was not sent (failed only). */
  reason?: string;
  /** Still waiting, but too long (no answer, or a long wait): it can be discarded, as in the sync list. */
  canDiscard?: true;
  /** The message it answers (3b). */
  replyTo?: ReplyQuote | null;
}

interface ChatSendPayload {
  conversationId?: unknown;
  body?: unknown;
  clientId?: unknown;
  replyTo?: unknown;
}

const isQuote = (v: unknown): v is ReplyQuote => !!v && typeof v === 'object' && typeof (v as ReplyQuote).id === 'string' && typeof (v as ReplyQuote).userId === 'string';

const payloadOf = (m: Pick<QueuedMutation, 'payload'>): ChatSendPayload => (m.payload ?? {}) as ChatSendPayload;
const clientIdOf = (m: Pick<QueuedMutation, 'payload'>): string | null => {
  const id = payloadOf(m).clientId;
  return typeof id === 'string' && id ? id : null;
};

const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export interface EnqueueDeps {
  queue: Pick<SyncQueue, 'enqueue'>;
  /** The signed-in user (the message's owner). */
  userId: () => string | null;
  /** Start sending what is waiting. */
  sync: () => void;
  /** A new key for one message (its client id and idempotency key). */
  newKey: () => string;
}

/**
 * Keep a message on the phone and start sending it; or why it can't be sent. A reply keeps the
 * message it answers: its id goes to the server, its quote shows in the thread meanwhile (3b).
 */
export async function enqueueChatMessage(
  deps: EnqueueDeps,
  conversationId: string,
  text: string,
  replyTo?: ReplyQuote | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = text.trim();
  if (!body) return { ok: false, error: 'Type a message first.' };
  if (body.length > CHAT_MAX_LENGTH) {
    return { ok: false, error: `Messages can be up to ${withCommas(CHAT_MAX_LENGTH)} characters. This one has ${withCommas(body.length)}.` };
  }
  const userId = deps.userId();
  if (!userId) return { ok: false, error: 'You’re signed out. Sign in again to send messages.' };
  const key = deps.newKey();
  const reply = replyTo ? { replyToId: replyTo.id, replyTo } : {};
  await deps.queue.enqueue(CHAT_SEND, { conversationId, body, clientId: key, ...reply }, { userId, idempotencyKey: key });
  deps.sync();
  return { ok: true };
}

/**
 * Why a message was not sent, in the website's words (3a review): the server's own reason only when
 * it refused the message (a 4xx), "Couldn't reach the server." when no answer ever came, and
 * otherwise "The server had a problem." — never the raw text of its own failure.
 */
export function notSentReason(m: Pick<QueuedMutation, 'lastError' | 'refused' | 'timeouts'>): string {
  const text = (m.lastError ?? '').trim();
  if (m.refused && text && !/^Request failed/i.test(text) && text !== 'Could not be saved.') return text;
  if (!m.refused && (m.lastError === NO_ANSWER_TEXT || (m.timeouts ?? 0) > 0)) return 'Couldn’t reach the server.';
  return 'The server had a problem.';
}

/**
 * This conversation's messages still on this phone, oldest first: waiting or being sent (pending),
 * or not sent (failed). One whose saved copy is already in the thread (`confirmed` client ids) is
 * left out.
 */
export function outboxFor(
  conversationId: string,
  queued: { pending: readonly QueuedMutation[]; failed: readonly QueuedMutation[] },
  opts: { online: boolean; confirmed: ReadonlySet<string>; now?: number },
): OutboxEntry[] {
  const now = opts.now ?? Date.now();
  const entries: Array<OutboxEntry & { at: number }> = [];
  const add = (m: QueuedMutation, state: OutboxState) => {
    if (m.kind !== CHAT_SEND) return;
    const p = payloadOf(m);
    if (p.conversationId !== conversationId || typeof p.body !== 'string') return;
    const clientId = clientIdOf(m);
    if (clientId && opts.confirmed.has(clientId)) return;
    entries.push({
      at: m.createdAt,
      queueId: m.id,
      clientId,
      conversationId,
      body: p.body,
      createdAt: new Date(m.createdAt).toISOString(),
      state,
      ...(state === 'failed' ? { reason: notSentReason(m) } : {}),
      ...(isQuote(p.replyTo) ? { replyTo: p.replyTo } : {}),
      // The same rule as the sync list: a message stuck waiting can be discarded (2c review).
      ...(state !== 'failed' && waitingTooLong(m, now) ? { canDiscard: true as const } : {}),
    });
  };
  for (const m of queued.pending) add(m, (m.timeouts ?? 0) > 0 ? 'unanswered' : opts.online ? 'sending' : 'waiting');
  for (const m of queued.failed) add(m, 'failed');
  return entries.sort((a, b) => a.at - b.at).map(({ at: _at, ...e }) => e);
}

/** Refused messages the server has after all (their saved copy is in the thread): nothing left to do. */
export function settledByServer(failed: readonly QueuedMutation[], confirmed: ReadonlySet<string>): string[] {
  return failed.filter((m) => m.kind === CHAT_SEND && !!clientIdOf(m) && confirmed.has(clientIdOf(m)!)).map((m) => m.id);
}

/** What TalkBack reads for a message still on the phone. */
export function outboxLabel(e: Pick<OutboxEntry, 'body' | 'state' | 'reason'>): string {
  const said = `You: ${e.body}.`;
  if (e.state === 'waiting') return `${said} Waiting for connection. It will be sent when you’re back online.`;
  if (e.state === 'unanswered') return `${said} The server hasn’t answered yet. It will be tried again.`;
  if (e.state === 'failed') return `${said} Not sent. ${e.reason ?? 'The server had a problem.'}`;
  return `${said} Sending.`;
}

/** Said above the thread while the phone is offline (null when all is well), like the website. */
export function connectionNote({ online, waiting }: { online: boolean; waiting: number }): string | null {
  if (online) return null;
  const queued = waiting > 0 ? ` ${waiting} ${waiting === 1 ? 'message is' : 'messages are'} waiting to be sent.` : '';
  return `You’re offline. Messages you send will go out when you’re back online.${queued}`;
}
