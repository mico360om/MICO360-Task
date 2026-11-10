import { useCallback, useEffect, useReducer, useRef } from 'react';
import { FRESH_FOR_MS, newCommentsText } from '../lib/comment-feed';

type Seen = 'held' | 'fresh' | 'seen';

export interface CommentArrivals {
  /** New comments from others kept back while the reader is further down the list (shown by `reveal`). */
  held: Set<string>;
  /** Comments that just arrived (or were just revealed): highlighted for a few seconds. */
  fresh: Set<string>;
  /** Every comment that came after the first read (mine too) — the list grows by these, so nothing older drops off. */
  arrived: Set<string>;
  /** Show the held comments (highlighted). */
  reveal: () => void;
  /** For a polite live region: "New comment from Omar Ahmed", "2 new comments above", or nothing. */
  announcement: string;
}

/**
 * Comments, newest first: what to do with comments that arrive while a list is open (live, or after sending). The
 * first list read is taken as read. Each later comment from someone else is decided on ONCE, as it arrives: shown
 * at once and highlighted when the reader is at the top of the list (or hasn't reached it), else held back — so what
 * they are reading doesn't move — and counted for the "N new comments ↑" button, until they press it or scroll back
 * to the top by themselves. My own comments are never held or highlighted (they showed the moment I sent them).
 */
export function useCommentArrivals({
  ids,
  ready,
  mine,
  parentOf,
  isAway,
  nameOf,
}: {
  /** Every comment now in the list (replies too). */
  ids: string[];
  /** The list has loaded (until then an empty list isn't "no comments"). */
  ready: boolean;
  mine: (id: string) => boolean;
  /**
   * A reply's comment (null for a comment). A reply shows at once in its thread (its thread keeps its place, marked
   * "New reply") — unless its comment is itself waiting behind the button: then it waits with it.
   */
  parentOf?: (id: string) => string | null | undefined;
  /** Is the reader scrolled down the list, away from its top? (Read as a comment arrives.) */
  isAway: () => boolean;
  nameOf?: (id: string) => string | undefined;
}): CommentArrivals {
  const known = useRef<Set<string> | null>(null);
  const decided = useRef(new Map<string, Seen>());
  const arrivedRef = useRef(new Set<string>());
  const said = useRef('');
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const awayRef = useRef(isAway);
  awayRef.current = isAway;

  // Decided while rendering, from the page as it is now (before the new comment is drawn), so a held comment never
  // flashes in first. Each comment once: a later render (or React's double render) gives the same answer.
  if (ready) {
    if (known.current === null) known.current = new Set(ids);
    else {
      const shownNow: string[] = [];
      for (const id of ids) {
        if (known.current.has(id)) continue;
        known.current.add(id);
        arrivedRef.current.add(id);
        if (mine(id)) continue;
        const parent = parentOf?.(id);
        if (parent ? decided.current.get(parent) === 'held' : isAway()) decided.current.set(id, 'held');
        else {
          decided.current.set(id, 'fresh');
          shownNow.push(id);
        }
      }
      if (shownNow.length === 1) {
        const who = nameOf?.(shownNow[0]!);
        const what = parentOf?.(shownNow[0]!) ? 'New reply' : 'New comment';
        said.current = who ? `${what} from ${who}` : what;
      } else if (shownNow.length > 1) said.current = newCommentsText(shownNow.length);
    }
  }

  const present = new Set(ids);
  const held = new Set<string>();
  const fresh = new Set<string>();
  for (const [id, seen] of decided.current) {
    if (!present.has(id)) continue;
    if (seen === 'held') held.add(id);
    else if (seen === 'fresh') fresh.add(id);
  }

  const reveal = useCallback(() => {
    let changed = false;
    for (const [id, seen] of decided.current) {
      if (seen === 'held') {
        decided.current.set(id, 'fresh');
        changed = true;
      }
    }
    if (changed) {
      said.current = '';
      rerender();
    }
  }, []);

  // The highlight fades after a few seconds.
  const freshKey = [...fresh].sort().join(',');
  useEffect(() => {
    if (!freshKey) return;
    const t = setTimeout(() => {
      for (const id of freshKey.split(',')) if (decided.current.get(id) === 'fresh') decided.current.set(id, 'seen');
      said.current = '';
      rerender();
    }, FRESH_FOR_MS);
    return () => clearTimeout(t);
  }, [freshKey]);

  // Back at the top by themselves: the held comments show (any scroll, the panel's or the page's).
  const holding = held.size > 0;
  useEffect(() => {
    if (!holding) return;
    const onScroll = () => {
      if (!awayRef.current()) reveal();
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [holding, reveal]);

  return {
    held,
    fresh,
    arrived: arrivedRef.current,
    reveal,
    announcement: held.size > 0 ? `${newCommentsText(held.size)} above` : said.current,
  };
}
