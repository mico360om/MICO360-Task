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
 *
 * Each entry names the tab (one open chat page) that wrote it. While that tab is open, its messages are
 * its own business — it sends them in its order (a file before a later text) and no other tab waits on
 * its requests. Once the tab is gone (closed, or its chat page left), any other tab picks them up.
 */
import type { PendingMessage } from './chat-model';

/** A message as kept in the outbox: which open chat page (tab) wrote it, when known. */
export type StoredMessage = PendingMessage & { owner?: string };

const PREFIX = 'mico360.chat.outbox.';
/** The list an older version kept for this person. */
const legacyKey = (userId: string) => `${PREFIX}${userId}`;
const entryPrefix = (userId: string) => `${PREFIX}${userId}.`;
const entryKey = (userId: string, clientId: string) => `${entryPrefix(userId)}${clientId}`;

/** What is stored for one message: no files, and only "waiting" or "failed" (a send in progress comes back waiting). */
function stored(p: StoredMessage): StoredMessage {
  return { ...p, files: [], state: p.state === 'failed' ? 'failed' : 'queued' };
}

/** One stored message, checked (null when it isn't one). */
function readEntry(raw: unknown): StoredMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as StoredMessage;
  if (typeof p.clientId !== 'string' || typeof p.conversationId !== 'string' || typeof p.body !== 'string') return null;
  const { owner, ...rest } = p;
  return stored({
    ...rest,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date(0).toISOString(),
    replyTo: p.replyTo ?? null,
    ...(typeof owner === 'string' ? { owner } : {}),
  });
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
function legacyList(userId: string): StoredMessage[] {
  const list = parse(localStorage.getItem(legacyKey(userId)));
  return Array.isArray(list) ? list.map(readEntry).filter((p): p is StoredMessage => !!p) : [];
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
export function loadOutbox(userId: string): StoredMessage[] {
  try {
    const byId = new Map<string, StoredMessage>();
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

/** Keep (or update) one text message, written by this tab. False when it can't be kept: it has files, or storage refused. */
export function keepInOutbox(userId: string, p: PendingMessage, owner?: string): boolean {
  if (p.files.length > 0) return false;
  try {
    const entry: StoredMessage = { ...p };
    if (owner) entry.owner = owner;
    else delete entry.owner;
    localStorage.setItem(entryKey(userId, p.clientId), JSON.stringify(stored(entry)));
    return true;
  } catch {
    return false; // storage unavailable or full: kept for this visit only
  }
}

/**
 * The message as stored now: null when it isn't there (finished — perhaps by another tab), undefined
 * when storage can't be read (nothing can be told).
 */
export function readOutboxEntry(userId: string, clientId: string): StoredMessage | null | undefined {
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

const TAB_LOCK = 'mico360.chat.tab.';
const SEND_LOCK = 'mico360.chat.send.';
/** How long a tab waits for another tab already sending the same message before leaving it to that tab. */
export const SEND_WAIT_MS = 15_000;
/** withSendClaim's answer when another tab was still sending the message after the wait. */
export const BUSY_ELSEWHERE = Symbol('another tab is still sending it');

function webLocks(): LockManager | undefined {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks && typeof locks.request === 'function' ? locks : undefined;
}

/**
 * This chat page is open: hold its lock (Web Locks, shared by the site's tabs, let go by the browser when
 * the tab closes) so other tabs leave its messages to it. Returns the function that lets go (page left).
 */
export function holdTab(tabId: string): () => void {
  const locks = webLocks();
  if (!locks) return () => {};
  let release: () => void = () => {};
  const open = new Promise<void>((resolve) => { release = resolve; });
  void locks.request(`${TAB_LOCK}${tabId}`, () => open).catch(() => {});
  return () => release();
}

/** The chat pages open now (null when the browser can't tell). */
async function openTabs(): Promise<Set<string> | null> {
  const locks = webLocks();
  if (!locks || typeof locks.query !== 'function') return null;
  try {
    const now = await locks.query();
    return new Set((now.held ?? []).map((l) => l.name ?? '').filter((n) => n.startsWith(TAB_LOCK)).map((n) => n.slice(TAB_LOCK.length)));
  } catch {
    return null;
  }
}

/**
 * The messages this tab should take over (`take`, oldest first): those whose tab is gone (closed, or its
 * chat page left) and those an older version kept (no tab named) — never this tab's own (already on its
 * page), nor those of another chat page that is still open (`open`: the tabs to wait for, see whenTabGone).
 * When the browser can't tell which tabs are open, every message not this tab's own (the send lock and
 * the server's one-copy-per-id still keep each sent once). `gone`: tabs already known to be gone (their
 * lock may look held a moment longer).
 */
export async function orphanedOutbox(userId: string, tabId: string, gone: ReadonlySet<string> = new Set()): Promise<{ take: StoredMessage[]; open: string[] }> {
  const others = loadOutbox(userId).filter((p) => p.owner !== tabId);
  if (!others.some((p) => p.owner && !gone.has(p.owner))) return { take: others, open: [] };
  const found = await openTabs();
  if (!found) return { take: others, open: [] };
  const live = new Set([...found].filter((t) => !gone.has(t)));
  return {
    take: others.filter((p) => !p.owner || !live.has(p.owner)),
    open: [...new Set(others.map((p) => p.owner).filter((o): o is string => !!o && live.has(o)))],
  };
}

/**
 * Be told once another chat page is gone (its tab closed, or Chat left there) — the browser hands its
 * lock on then — so its waiting messages are picked up even with nothing else happening here. Returns
 * the function that stops waiting (this page is left first).
 */
export function whenTabGone(tabId: string, gone: () => void): () => void {
  const locks = webLocks();
  if (!locks || typeof AbortController === 'undefined') return () => {};
  const stop = new AbortController();
  locks
    .request(`${TAB_LOCK}${tabId}`, { signal: stop.signal }, async () => {
      // Let go of the lock at once; act after (unless this page was left meanwhile).
      setTimeout(() => {
        if (!stop.signal.aborted) gone();
      }, 0);
    })
    .catch(() => {});
  return () => stop.abort();
}

/**
 * Run a send of this message while holding its lock, shared by every tab of the site (Web Locks), so
 * two tabs never send the same message at the same time: the second waits (up to `waitMs`, then answers
 * BUSY_ELSEWHERE and leaves it to the other tab), then finds it finished. Without Web Locks (or when the
 * lock is refused) the send just goes — the server still keeps a message only once per id.
 */
export async function withSendClaim<T>(clientId: string, send: () => Promise<T>, waitMs = SEND_WAIT_MS): Promise<T | typeof BUSY_ELSEWHERE> {
  const locks = webLocks();
  if (!locks) return send();
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(waitMs) : undefined;
  let started = false;
  try {
    return (await locks.request(`${SEND_LOCK}${clientId}`, signal ? { signal } : {}, () => {
      started = true;
      return send();
    })) as T;
  } catch (err) {
    if (started) throw err;
    if (signal?.aborted) return BUSY_ELSEWHERE;
    return send(); // the browser refused the lock: this tab decides alone
  }
}
