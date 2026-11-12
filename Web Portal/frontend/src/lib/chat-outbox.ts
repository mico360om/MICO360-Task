/**
 * The chat outbox: text messages the server hasn't confirmed yet, kept in this browser so leaving the
 * page, a reload or closing the tab never loses them. They come back waiting to be sent again — with
 * the same id, so a message that did reach the server isn't stored twice. Files can't be kept this way.
 *
 * Every message has its own storage entry (`mico360.chat.outbox.<userId>.<clientId>`), so the tabs of
 * one person never overwrite each other: a tab writes only the message it changes and removes only one
 * that is finished (the server has it, or the person discarded it). Before 1.23.24 the site kept one
 * list per person (`mico360.chat.outbox.<userId>`) that each tab rewrote from its own copy — one tab
 * clearing its sent message wiped another tab's waiting one. That list is still read, and moved over.
 */
import type { PendingMessage } from './chat-model';

const PREFIX = 'mico360.chat.outbox.';
/** The list an older version kept for this person. */
const legacyKey = (userId: string) => `${PREFIX}${userId}`;
const entryPrefix = (userId: string) => `${PREFIX}${userId}.`;
const entryKey = (userId: string, clientId: string) => `${entryPrefix(userId)}${clientId}`;

/** What is stored for one message: no files, and only "waiting" or "failed" (a send in progress comes back waiting). */
function stored(p: PendingMessage): PendingMessage {
  return { ...p, files: [], state: p.state === 'failed' ? 'failed' : 'queued' };
}

/** One stored message, checked (null when it isn't one). */
function readEntry(raw: unknown): PendingMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as PendingMessage;
  if (typeof p.clientId !== 'string' || typeof p.conversationId !== 'string' || typeof p.body !== 'string') return null;
  return stored({ ...p, createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date(0).toISOString(), replyTo: p.replyTo ?? null });
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The older version's list (empty when there is none, or it can't be read). */
function legacyList(userId: string): PendingMessage[] {
  const list = parse(localStorage.getItem(legacyKey(userId)));
  return Array.isArray(list) ? list.map(readEntry).filter((p): p is PendingMessage => !!p) : [];
}

const time = (p: PendingMessage) => Date.parse(p.createdAt) || 0;
const oldestFirst = (a: PendingMessage, b: PendingMessage) => time(a) - time(b) || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0);

/** The clientId this storage key keeps a message for (null when it isn't one of this person's outbox entries). */
export function outboxClientId(userId: string, key: string | null): string | null {
  const prefix = entryPrefix(userId);
  return key && key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
}

/**
 * Everything waiting in this person's outbox, oldest first. A list kept by an older version is moved
 * over to one entry per message (and stays where it is, still read, if it can't be moved).
 */
export function loadOutbox(userId: string): PendingMessage[] {
  try {
    const byId = new Map<string, PendingMessage>();
    const legacy = legacyList(userId);
    if (legacy.length) {
      try {
        for (const p of legacy) if (localStorage.getItem(entryKey(userId, p.clientId)) === null) localStorage.setItem(entryKey(userId, p.clientId), JSON.stringify(p));
        localStorage.removeItem(legacyKey(userId));
      } catch {
        for (const p of legacy) byId.set(p.clientId, p); // storage full: read where it is
      }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const clientId = outboxClientId(userId, localStorage.key(i));
      if (!clientId) continue;
      const p = readEntry(parse(localStorage.getItem(entryKey(userId, clientId))));
      if (p && p.clientId === clientId) byId.set(clientId, p);
    }
    return [...byId.values()].sort(oldestFirst);
  } catch {
    return [];
  }
}

/** Keep (or update) one text message. False when it can't be kept: it has files, or storage refused. */
export function keepInOutbox(userId: string, p: PendingMessage): boolean {
  if (p.files.length > 0) return false;
  try {
    localStorage.setItem(entryKey(userId, p.clientId), JSON.stringify(stored(p)));
    return true;
  } catch {
    return false; // storage unavailable or full: kept for this visit only
  }
}

/**
 * The message as stored now: null when it isn't there (finished — perhaps by another tab), undefined
 * when storage can't be read (nothing can be told).
 */
export function readOutboxEntry(userId: string, clientId: string): PendingMessage | null | undefined {
  try {
    const own = readEntry(parse(localStorage.getItem(entryKey(userId, clientId))));
    if (own) return own;
    return legacyList(userId).find((p) => p.clientId === clientId) ?? null;
  } catch {
    return undefined;
  }
}

/** This message is finished (the server has it, or it was discarded): no tab keeps or sends it any more. */
export function dropFromOutbox(userId: string, clientId: string): void {
  try {
    localStorage.removeItem(entryKey(userId, clientId));
    const legacy = legacyList(userId);
    if (legacy.some((p) => p.clientId === clientId)) {
      const rest = legacy.filter((p) => p.clientId !== clientId);
      if (rest.length) localStorage.setItem(legacyKey(userId), JSON.stringify(rest));
      else localStorage.removeItem(legacyKey(userId));
    }
  } catch {
    /* storage unavailable: nothing was kept */
  }
}

/**
 * Run a send of this message while holding its lock, shared by every tab of the site (Web Locks), so
 * two tabs never send the same message at the same time: the second waits, then finds it finished.
 * Without Web Locks (or when the lock is refused) the send just goes — the server still keeps a
 * message only once per id.
 */
export async function withSendClaim<T>(clientId: string, send: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks || typeof locks.request !== 'function') return send();
  let started = false;
  try {
    return (await locks.request(`mico360.chat.send.${clientId}`, () => {
      started = true;
      return send();
    })) as T;
  } catch (err) {
    if (started) throw err;
    return send(); // the browser refused the lock: this tab decides alone
  }
}
