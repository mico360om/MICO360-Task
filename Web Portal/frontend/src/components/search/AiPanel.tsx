import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { searchEverythingApi } from '../../api/search';
import { Button } from '../ui/Button';
import { ResultRow } from './ResultRow';
import type { EverythingFilters, SearchHit } from '../../lib/search-everything';

const Sparkle = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9z" />
    <path d="M19 3.5v3M17.5 5h3" />
  </svg>
);

/**
 * The AI panel above the normal results (1.23): when AI is set up and the question was asked (Enter,
 * "Ask AI", or the top bar's "See all results"), it fills in with an answer from the items the person
 * may open and the best of them; the normal results below never wait for it. AI off, over a limit,
 * slow (20 s) or failing: one line saying so.
 */
export function AiPanel({
  filters,
  asked,
  onAsk,
  onOpen,
  timeZone,
}: {
  filters: EverythingFilters;
  asked: boolean;
  onAsk: () => void;
  onOpen: (hit: SearchHit) => void;
  timeZone: string;
}) {
  const status = useQuery({ queryKey: ['search-ai-status'], queryFn: () => searchEverythingApi(apiClient).aiStatus(), staleTime: 60_000, retry: false });
  const { ai: _ai, ...question } = filters;
  void _ai;
  const ready = status.data?.ready === true;
  const answer = useQuery({
    queryKey: ['search-ai', question],
    queryFn: () => searchEverythingApi(apiClient).ask(question),
    enabled: ready && asked && question.q.trim().length >= 2,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });

  if (status.isLoading) return null;
  const frame = 'mb-4 rounded-xl border border-brand/30 bg-brand/5 p-3';
  const heading = (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
      <Sparkle />
      AI answer
    </span>
  );
  if (!ready) {
    return (
      <p role="note" className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink-2">
        <Sparkle />
        AI search is off — these are the normal results.
      </p>
    );
  }
  if (!asked) {
    return (
      <section aria-label="AI answer" className={`${frame} flex flex-wrap items-center justify-between gap-2`}>
        <span className="flex items-center gap-2 text-sm text-ink-2">
          {heading}
          <span>Ask AI to answer from what you can open.</span>
        </span>
        <Button size="sm" variant="secondary" onClick={onAsk}>
          Ask AI
        </Button>
      </section>
    );
  }
  const data = answer.data;
  return (
    <section aria-label="AI answer" aria-busy={answer.isFetching} className={frame}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        {heading}
        {data?.state === 'ok' && data.semantic ? <span className="text-[11px] text-ink-3">Matched by meaning too</span> : null}
      </div>
      <div aria-live="polite">
        {answer.isFetching || !data ? (
          answer.isError ? (
            <p className="text-sm text-ink-2">The AI couldn’t answer this time. The normal results are below.</p>
          ) : (
            <div className="flex flex-col gap-1.5" aria-label="AI is reading what you can open…">
              <p className="text-sm text-ink-2">AI is reading what you can open…</p>
              <div className="skeleton h-3 w-11/12 rounded" />
              <div className="skeleton h-3 w-8/12 rounded" />
            </div>
          )
        ) : data.state === 'ok' ? (
          <>
            <p dir="auto" className="text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">
              {data.answer}
            </p>
            {data.hits.length ? (
              <ul aria-label="Best matches" className="mt-2 flex flex-col gap-1.5">
                {data.hits.map((h) => (
                  <li key={`${h.kind}:${h.id}`}>
                    <ResultRow hit={h} timeZone={timeZone} onOpen={onOpen} compact />
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[11px] text-ink-3">AI can make mistakes — check the items before acting on them.</p>
          </>
        ) : (
          <p className="text-sm text-ink-2">{data.message}</p>
        )}
      </div>
    </section>
  );
}
