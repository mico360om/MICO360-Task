import type { Query, QueryClient } from '@tanstack/react-query';

/**
 * 1.23.29 Private file links (design §7.5): the server gives task and chat files as links signed for the
 * person (`/uploads/<key>?u=…&e=…&s=…`) that stop working 24–30 hours after they were given. Pages read
 * those lists once and keep them, so a tab left open would one day hold links that no longer open. This
 * keeps them working, for every list that carries them (a task's files, a conversation's history):
 *
 *   - a list is read again an hour before its earliest link ends (sooner for a short test life);
 *   - a picture of a signed file that fails to load anywhere on the page, or a preview the server refuses
 *     (reportFileLinkFailed), has the lists holding that file read again.
 *
 * Never more than once a minute per list, so someone who really lost access never causes a loop (their
 * list then answers "no access" itself).
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** setTimeout can't wait longer (about 24.8 days). */
const MAX_DELAY = 2 ** 31 - 1;
/** How deep an answer is searched for links (a history page: pages → messages → files → url). */
const MAX_DEPTH = 8;

/** The lists whose answers carry signed file links. */
function carriesFileLinks(key: readonly unknown[]): boolean {
  return key[0] === 'attachments' || (key[0] === 'chat' && key[1] === 'messages');
}

/** A signed file link's path (`/uploads/<key>`) and expiry (ms), or null for any other address. */
function signedLink(url: string): { path: string; expiresAt: number } | null {
  if (typeof url !== 'string' || !url.includes('/uploads/') || !url.includes('?')) return null;
  let u: URL;
  try {
    u = new URL(url, 'http://local.invalid');
  } catch {
    return null;
  }
  if (!/^\/uploads\/[^/]+$/.test(u.pathname)) return null;
  const e = u.searchParams.get('e');
  if (!u.searchParams.get('u') || !u.searchParams.get('s') || !e || !/^[0-9a-z]{1,12}$/.test(e)) return null;
  return { path: u.pathname, expiresAt: parseInt(e, 36) * 1000 };
}

/** When a signed file link stops working (ms), or null for an address that isn't one. */
export function linkExpiry(url: string): number | null {
  return signedLink(url)?.expiresAt ?? null;
}

/** The signed links in an answer: their paths and the earliest expiry. */
function linksIn(data: unknown): { paths: Set<string>; earliest: number | null } {
  const paths = new Set<string>();
  let earliest: number | null = null;
  const walk = (v: unknown, depth: number) => {
    if (typeof v === 'string') {
      const link = signedLink(v);
      if (link) {
        paths.add(link.path);
        if (earliest === null || link.expiresAt < earliest) earliest = link.expiresAt;
      }
      return;
    }
    if (!v || typeof v !== 'object' || depth > MAX_DEPTH) return;
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
  };
  walk(data, 0);
  return { paths, earliest };
}

interface Watched {
  query: Query;
  paths: Set<string>;
  earliest: number | null;
  receivedAt: number;
}

let reportFailure: ((url: string) => void) | null = null;

/** A file link the page couldn't open (a preview's fetch answered 403): its lists are read again (once a minute at most). */
export function reportFileLinkFailed(url: string): void {
  reportFailure?.(url);
}

/** Keeps the signed file links the app holds working (see above). Returns the way to stop. */
export function bindFileLinkRefresh(qc: QueryClient, opts: { now?: () => number; target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null } = {}): () => void {
  const now = opts.now ?? (() => Date.now());
  const watched = new Map<string, Watched>();
  const lastTimed = new Map<string, number>();
  const lastFailed = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const invalidate = (w: Watched) => void qc.invalidateQueries({ queryKey: w.query.queryKey, exact: true }).catch(() => undefined);

  /** When a list is read again: an hour before its earliest link ends (a fifth of a short life), never within a minute of the last time. */
  function dueAt(hash: string, w: Watched): number | null {
    if (w.earliest === null || w.query.state.isInvalidated) return null;
    const lead = Math.min(HOUR, Math.max(0, (w.earliest - w.receivedAt) / 5));
    return Math.max(w.earliest - lead, w.receivedAt + MINUTE, (lastTimed.get(hash) ?? -Infinity) + MINUTE);
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    let next: number | null = null;
    for (const [hash, w] of watched) {
      const at = dueAt(hash, w);
      if (at !== null && (next === null || at < next)) next = at;
    }
    if (next !== null) timer = setTimeout(fire, Math.min(MAX_DELAY, Math.max(0, next - now())));
  }

  function fire(): void {
    timer = null;
    const t = now();
    for (const [hash, w] of watched) {
      const at = dueAt(hash, w);
      if (at === null || at > t) continue;
      lastTimed.set(hash, t);
      invalidate(w);
    }
    schedule();
  }

  function read(query: Query): void {
    if (!carriesFileLinks(query.queryKey)) return;
    const { paths, earliest } = linksIn(query.state.data);
    if (paths.size === 0) watched.delete(query.queryHash);
    else watched.set(query.queryHash, { query, paths, earliest, receivedAt: now() });
    schedule();
  }

  for (const q of qc.getQueryCache().getAll()) read(q);
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (!carriesFileLinks(event.query.queryKey)) return;
    if (event.type === 'removed') {
      watched.delete(event.query.queryHash);
      lastTimed.delete(event.query.queryHash);
      lastFailed.delete(event.query.queryHash);
      schedule();
    } else if (event.type === 'added' || (event.type === 'updated' && (event.action.type === 'success' || event.action.type === 'invalidate'))) {
      read(event.query);
    }
  });

  function failed(url: string): void {
    const link = signedLink(url);
    if (!link) return;
    const t = now();
    for (const [hash, w] of watched) {
      if (!w.paths.has(link.path)) continue;
      const last = lastFailed.get(hash);
      if (last !== undefined && t - last < MINUTE) continue;
      lastFailed.set(hash, t);
      invalidate(w);
    }
  }

  // A picture anywhere on the page (task panel, chat, previews): error events don't bubble, so listen as they go down.
  const target = opts.target === undefined ? (typeof window === 'undefined' ? null : window) : opts.target;
  const onError = (e: Event) => {
    const el = e.target as { tagName?: unknown; src?: unknown } | null;
    if (el && typeof el.tagName === 'string' && el.tagName.toLowerCase() === 'img' && typeof el.src === 'string') failed(el.src);
  };
  target?.addEventListener('error', onError, true);
  reportFailure = failed;

  return () => {
    unsubscribe();
    target?.removeEventListener('error', onError, true);
    if (timer) clearTimeout(timer);
    timer = null;
    if (reportFailure === failed) reportFailure = null;
  };
}
