/**
 * Comments, newest first (owner, 10 Nov 2026) — the rules every comment section on the website shares (the task
 * panel on every page, and the Client portal's task page): the newest comment at the top, the write box above them,
 * 30 at a time, a comment being sent shown at once, and new ones from others arriving live.
 */

/** How many comments (each with its replies) show at first, and how many more "Show older comments" adds. */
export const COMMENTS_PAGE = 30;

/** How long a comment that just arrived stays highlighted. */
export const FRESH_FOR_MS = 4000;

/**
 * Threads with the newest comment first, by the comment's own time (a reply doesn't move its comment). Replies stay
 * under their comment in their own order. Two with the same time: the later-listed one first (the server lists
 * oldest first). A missing time sorts last.
 */
export function newestFirst<T extends { comment: unknown }>(threads: T[], timeOf: (c: T['comment']) => string | null | undefined): T[] {
  const ms = (c: T['comment']) => {
    const t = timeOf(c);
    const n = t ? Date.parse(t) : NaN;
    return Number.isNaN(n) ? -Infinity : n;
  };
  return threads
    .map((t, i) => ({ t, i, at: ms(t.comment) }))
    .sort((a, b) => (b.at === a.at ? b.i - a.i : b.at - a.at))
    .map((x) => x.t);
}

/** "1 new comment", "3 new comments". */
export const newCommentsText = (n: number) => `${n} new comment${n === 1 ? '' : 's'}`;

/** A comment of mine on its way to the server (shown at once, at the top), or one that didn't go. */
export interface PendingComment {
  key: string;
  body: string;
  /** On its way; saved (shown as sent until its saved copy is in the list); or it didn't go. */
  status: 'sending' | 'sent' | 'failed';
  /** Why it didn't go (a failed one). */
  error?: string;
  /** Every comment id in the list when it was sent: its saved copy is a comment of mine NOT among them. */
  before: Set<string>;
  /** The saved comment's id, once the server answered. */
  savedId?: string;
}

/**
 * The sending comments whose saved copy is already in the list (so they aren't shown twice): by the saved id once the
 * answer came, else — the live copy can arrive first — by a comment of mine with the same words that wasn't in the
 * list when it was sent. One saved comment answers one sending comment. A "Not sent" one whose copy shows up was
 * saved after all (the answer was lost — a timeout after saving): it goes too, so Try again can't post it twice.
 */
export function matchedPending(pending: PendingComment[], list: { id: string; mine: boolean; body: string }[]): Set<string> {
  const ids = new Set(list.map((c) => c.id));
  const claimed = new Set<string>();
  const matched = new Set<string>();
  for (const p of pending) {
    if (p.savedId && ids.has(p.savedId)) {
      claimed.add(p.savedId);
      matched.add(p.key);
    }
  }
  for (const p of pending) {
    if (matched.has(p.key)) continue;
    const words = p.body.trim();
    const copy = list.find((c) => c.mine && !claimed.has(c.id) && !p.before.has(c.id) && c.body.trim() === words);
    if (copy) {
      claimed.add(copy.id);
      matched.add(p.key);
    }
  }
  return matched;
}

/** The nearest box that scrolls `el` up and down (the task panel's body), or null for the page itself. */
export function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at && at !== document.body && at !== document.documentElement; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (/(auto|scroll|overlay)/.test(overflowY) && at.scrollHeight > at.clientHeight) return at;
  }
  return null;
}

/**
 * Has the reader scrolled down the list, away from its top? True once the list's top (`listTop`) has gone under the
 * write box (`edge`: it stays in view at the top while the comments scroll) — or above the view, past the whole
 * section. Comments still further down the page don't count: adding one at their top moves nothing being read.
 */
export function scrolledPast(listTop: HTMLElement | null, edge: HTMLElement | null): boolean {
  if (!listTop) return false;
  const top = listTop.getBoundingClientRect().top;
  let limit: number;
  if (edge) limit = edge.getBoundingClientRect().bottom;
  else {
    const parent = scrollParentOf(listTop);
    limit = parent ? parent.getBoundingClientRect().top : 0;
  }
  return top < limit - 4;
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Bring the comments' section (its heading, the write box, the newest comment) to the top of what scrolls it — the
 * task panel's body, else the page — smoothly, or at once with reduced motion. Only that box scrolls (never the page
 * behind a panel).
 */
export function scrollToListTop(section: HTMLElement | null): void {
  if (!section) return;
  const parent = scrollParentOf(section);
  const behavior: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth';
  const top = section.getBoundingClientRect().top - (parent ? parent.getBoundingClientRect().top : 0) - 8;
  if (parent) {
    if (typeof parent.scrollBy === 'function') parent.scrollBy({ top, behavior });
    else parent.scrollTop += top;
  } else if (typeof window.scrollBy === 'function') window.scrollBy({ top, behavior });
}
