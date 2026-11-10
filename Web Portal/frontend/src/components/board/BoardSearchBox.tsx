import { useEffect, useRef, useState } from 'react';
import { MAX_QUERY_LETTERS } from '../../lib/search-highlight';
import { SEARCH_DELAY_MS } from './useBoardSearch';

/**
 * Board search (owner, 10 Nov): the board's search box. It finds cards by number, title, description, person,
 * project and tag as you type. ✕ or Escape clears it (focus stays in the box); "/" jumps here
 * (data-page-search, components/shortcuts). While it has words, how many cards are found is said
 * beside it ("3 of 12 cards") — and read out to screen readers as it changes.
 *
 * The box keeps what is typed itself and hands the board its words SEARCH_DELAY_MS after the last key
 * (review I1: a key typed redraws only the box, never a board of a thousand cards); cleared at once.
 * Words changed from elsewhere (the address: Back, a link) are shown in the box.
 */
export function BoardSearchBox({
  words,
  onWords,
  searching,
  shown,
  total,
}: {
  /** The words the board is searching for. */
  words: string;
  /** New words for the board (after the pause, or at once when cleared). Keep it stable (a state setter). */
  onWords: (words: string) => void;
  /** The board is showing only the cards found (the words have been read). */
  searching: boolean;
  shown: number;
  total: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(words);
  /** The words last handed to the board (or shown from it). */
  const sent = useRef(words);

  // The board's words changed from elsewhere: the box shows them.
  useEffect(() => {
    if (words === sent.current) return;
    sent.current = words;
    setText(words);
  }, [words]);

  // What is typed reaches the board after a short pause.
  useEffect(() => {
    if (text === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = text;
      onWords(text);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, onWords]);

  const clear = () => {
    setText('');
    sent.current = '';
    onWords('');
    input.current?.focus();
  };
  return (
    <div className="flex min-w-0 items-center gap-2 max-sm:basis-full">
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={input}
          type="search"
          data-page-search
          dir="auto"
          aria-label="Search this board"
          title="Search by number, title, description, person, project or tag"
          placeholder="Search this board…"
          maxLength={MAX_QUERY_LETTERS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Escape empties the box first (and nothing else closes); an empty box lets it through.
            if (e.key === 'Escape' && text) {
              e.preventDefault();
              e.stopPropagation();
              clear();
            }
          }}
          className="h-9 w-full rounded-lg border border-line bg-surface ps-8 pe-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:pe-11 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {text ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            title="Clear search (Esc)"
            className="absolute end-0.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand [@media(pointer:coarse)]:end-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        ) : null}
      </div>
      <p className="flex-none whitespace-nowrap text-xs tabular-nums text-ink-2" aria-live="polite">
        {searching ? `${shown} of ${total} ${total === 1 ? 'card' : 'cards'}` : ''}
      </p>
    </div>
  );
}
