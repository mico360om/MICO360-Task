import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { chatApi, type ApiMessage } from '../../api/chat';
import { dayLabel, highlightParts, searchSnippet } from '../../lib/chat-model';
import { clockTime } from './MessageItem';

/** Shortest search the server runs. */
export const SEARCH_MIN = 2;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Messages containing the search words — in every conversation you can open, or in one — newest
 * first, with the words marked. Picking one opens it where it was written.
 */
export function SearchResults({
  q,
  conversationId,
  titleOf,
  nameOf,
  onPick,
}: {
  q: string;
  conversationId?: string;
  titleOf?: (conversationId: string) => string;
  nameOf: (userId: string) => string;
  onPick: (m: ApiMessage) => void;
}) {
  const term = useDebounced(q.trim(), 250);
  const ready = term.length >= SEARCH_MIN;
  const results = useQuery({
    queryKey: ['chat', 'search', conversationId ?? 'all', term],
    queryFn: () => chatApi(apiClient).search(term, conversationId),
    enabled: ready,
    staleTime: 15_000,
  });

  if (q.trim().length < SEARCH_MIN) {
    return <p className="px-3 py-3 text-xs text-ink-2">Type at least {SEARCH_MIN} letters to search messages.</p>;
  }
  if (!ready || results.isLoading) return <p role="status" className="px-3 py-3 text-xs text-ink-2">Searching…</p>;
  if (results.isError) {
    return (
      <p role="alert" className="px-3 py-3 text-xs text-danger">
        Couldn’t search messages.{' '}
        <button type="button" onClick={() => void results.refetch()} className="font-semibold underline">Retry</button>
      </p>
    );
  }
  const list = Array.isArray(results.data) ? results.data : [];
  if (list.length === 0) return <p role="status" className="px-3 py-3 text-xs text-ink-2">No messages match “{term}”.</p>;
  return (
    <>
      <p role="status" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
        {list.length} {list.length === 1 ? 'message' : 'messages'}
      </p>
      <ul aria-label="Message results" className="flex flex-col gap-0.5 px-1.5 pb-2">
        {list.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onPick(m)}
              className="w-full rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-ground focus-visible:bg-ground"
            >
              <span className="flex items-baseline gap-2 text-[11px] text-ink-2">
                {titleOf ? <span dir="auto" className="min-w-0 truncate font-semibold text-ink">{titleOf(m.conversationId)}</span> : null}
                <span dir="auto" className="min-w-0 truncate">{nameOf(m.userId)}</span>
                <span className="ms-auto flex-none">{dayLabel(m.createdAt)} {clockTime(m.createdAt)}</span>
              </span>
              <span dir="auto" className="mt-0.5 block text-sm text-ink [overflow-wrap:anywhere]">
                {highlightParts(searchSnippet(m.body, term), term).map((part, i) =>
                  part.match ? <mark key={i} className="rounded bg-warning-soft px-0.5 text-ink">{part.text}</mark> : <span key={i}>{part.text}</span>,
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
