import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KanbanColumnData } from '../KanbanColumn';
import type { BoardSearch } from '../../lib/board-search';

/** The board follows the words this long after the last key (each key doesn't redraw a big board). */
export const SEARCH_DELAY_MS = 120;
/** A card no longer found after a live change fades out for this long, then goes. */
export const LEAVE_MS = 300;

/**
 * Board search (10 Nov): the words in the board's search box. `text` is the box as typed; `words` follow
 * it SEARCH_DELAY_MS after the last key (cleared at once). The words stay in the address (?q=, kept
 * with the page's other settings), so a reload or a shared link keeps them; an address changed from
 * elsewhere (Back, a link to the board without them) is followed.
 */
export function useBoardSearchWords() {
  const [params, setParams] = useSearchParams();
  const fromAddress = params.get('q') ?? '';
  const [text, setText] = useState(fromAddress);
  const [words, setWords] = useState(fromAddress);
  /** The words the address has (as last written here, or read). */
  const inAddress = useRef(fromAddress.trim());

  useEffect(() => {
    if (text === words) return;
    const timer = setTimeout(() => setWords(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, words]);

  // The address changed from elsewhere: the box follows it.
  useEffect(() => {
    const next = fromAddress.trim();
    if (next === inAddress.current) return;
    inAddress.current = next;
    setText(fromAddress);
    setWords(fromAddress);
  }, [fromAddress]);

  // The words changed here: the address follows them (replacing the entry: no Back step per word).
  useEffect(() => {
    const want = words.trim();
    if (want === inAddress.current) return;
    inAddress.current = want;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (want) next.set('q', want);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [words, setParams]);

  const clear = () => {
    setText('');
    setWords('');
  };
  return { text, setText, words, clear };
}

/**
 * The board's columns as the search shows them, with each card a live change has just left unfound
 * (its words edited elsewhere) kept for LEAVE_MS, marked `leaving`, so it fades out where it was
 * instead of vanishing. Only a card still on the board: one gone from it (deleted, moved off the day)
 * goes as on any board; new words or no words show the result at once.
 *
 * `before`: the columns the search ran over; `found`: searchBoard's result over them.
 */
export function useLeavingCards(before: KanbanColumnData[], found: KanbanColumnData[], search: BoardSearch | null): KanbanColumnData[] {
  const words = search ? search.terms.join('\n') + '\u0000' + search.text : null;
  const matched = useMemo(() => new Set(found.flatMap((c) => c.tasks.map((t) => t.key))), [found]);
  const [last, setLast] = useState({ words, matched });
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());

  // Worked out while drawing (React's "information from the last draw" pattern), so a card that
  // stops matching never blinks out before it fades.
  if (last.words !== words || last.matched !== matched) {
    setLast({ words, matched });
    if (words !== null && last.words === words) {
      const present = new Set(before.flatMap((c) => c.tasks.map((t) => t.key)));
      const gone = [...last.matched].filter((k) => !matched.has(k) && present.has(k));
      if (gone.length > 0) setLeaving(new Set([...leaving, ...gone]));
    } else if (leaving.size > 0) {
      setLeaving(new Set());
    }
  }

  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = setTimeout(() => setLeaving(new Set()), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return useMemo(() => {
    if (leaving.size === 0) return found;
    return found.map((column) => {
      const source = before.find((c) => c.id === column.id);
      if (!source || !source.tasks.some((t) => leaving.has(t.key) && !matched.has(t.key))) return column;
      const shown = new Map(column.tasks.map((t) => [t.key, t]));
      const tasks = source.tasks
        .filter((t) => shown.has(t.key) || leaving.has(t.key))
        .map((t) => shown.get(t.key) ?? { ...t, found: null, leaving: true });
      return { ...column, tasks };
    });
  }, [found, before, leaving, matched]);
}
