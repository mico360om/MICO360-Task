import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { MicoAiSource, MicoAiTable } from '../../api/mico-ai';
import { answerBlocks, cellDisplay, type Run } from '../../lib/mico-ai';

/**
 * MICO AI's mark: a sparkle drawn on the brand tile (decorative: the text around it names it). Drawn,
 * not a ✦ character, so every browser and phone shows the same shape.
 */
export function MicoAiMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-2xl' : size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-8 w-8 rounded-lg';
  const icon = size === 'lg' ? 26 : size === 'sm' ? 15 : 17;
  return (
    <span aria-hidden="true" data-mico-mark="" className={`grid flex-none place-items-center bg-brand-gradient text-white shadow-sm ${box}`}>
      <svg viewBox="0 0 24 24" width={icon} height={icon} fill="currentColor" aria-hidden="true">
        <path d="M11 3.5c.55 4.3 2.9 6.65 7.2 7.2-4.3.55-6.65 2.9-7.2 7.2-.55-4.3-2.9-6.65-7.2-7.2 4.3-.55 6.65-2.9 7.2-7.2z" />
        <path d="M18.5 14.5c.25 1.85 1.15 2.75 3 3-1.85.25-2.75 1.15-3 3-.25-1.85-1.15-2.75-3-3 1.85-.25 2.75-1.15 3-3z" opacity=".85" />
      </svg>
    </span>
  );
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => (r.bold ? <strong key={i} className="font-semibold text-ink">{r.text}</strong> : <span key={i}>{r.text}</span>))}
    </>
  );
}

/**
 * An answer's words: paragraphs, bullets and bold, always as text — React escapes every character,
 * so markup in an answer (or in the data it quotes) is shown, never run.
 */
export function AnswerText({ text }: { text: string }) {
  return (
    <div dir="auto" className="space-y-3 text-[0.9375rem] leading-7 text-ink [overflow-wrap:anywhere]">
      {answerBlocks(text).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.lines.map((line, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                <Runs runs={line} />
              </span>
            ))}
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 ps-5 marker:text-brand">
            {b.items.map((item, j) => (
              <li key={j}>
                <Runs runs={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

const NUMERIC = new Set(['number', 'percent', 'days']);
const FIRST_ROWS = 25;

/**
 * How a text column wraps in a table that may scroll sideways: short phrases stay on one line, and
 * longer text gets a readable width before it wraps (a browser would otherwise squeeze every column of
 * a wide table to its narrowest, one or two words a line). A long link breaks rather than widening it.
 */
function textColumnClass(table: MicoAiTable, col: number): string {
  const longest = Math.max(table.columns[col]?.label.length ?? 0, ...table.rows.map((r) => String(r.cells[col] ?? '').length));
  if (longest <= 24) return 'whitespace-nowrap';
  return longest <= 60 ? 'min-w-[10rem] max-w-[20rem] [overflow-wrap:anywhere]' : 'min-w-[13rem] max-w-[26rem] [overflow-wrap:anywhere]';
}

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
  </svg>
);

/** Which sides of a sideways-scrolling box still have more to show (updated on scroll and on resize). */
function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = Math.abs(el.scrollLeft);
    const more = el.scrollWidth - el.clientWidth;
    const next = { start: more > 1 && left > 1, end: more > 1 && left < more - 1 };
    setEdges((e) => (e.start === next.start && e.end === next.end ? e : next));
  }, []);
  useEffect(() => {
    const el = ref.current;
    update();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [update]);
  return { ref, edges, update };
}

/**
 * A table copied by the server from the data (its figures are the data's, never the AI's), with its
 * Excel download. On a wide screen a table wider than the reading column may break out of it, up to
 * the message area's width, centred on the answer; wider still, it scrolls sideways in its own box,
 * with a fade at each side that has more to show.
 *
 * The widths come from the message area (a size container): the answer's text is
 * min(48rem, 100cqw) - 92px wide from 40em (the column's 1.5rem padding each side, the mark and its
 * gap), 100cqw - 72px on a phone.
 */
export function AnswerTable({ table, onExcel }: { table: MicoAiTable; onExcel?: () => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, FIRST_ROWS);
  const textClass = useMemo(() => table.columns.map((c, j) => (c.kind === 'text' || !c.kind ? textColumnClass(table, j) : '')), [table]);
  const { ref, edges, update } = useScrollEdges();
  useEffect(update, [all, update]);
  return (
    // Breaks out of the reading column (equally on both sides of the answer) by as much as the message area allows.
    <div data-answer-table="" className="min-w-0 [margin-inline:min(0px,calc((100%_-_100cqw_+_92px)/2))]">
      {/* As wide as the table needs: at least the answer's width, at most the room there is. */}
      <div className="mx-auto w-fit min-w-[min(100%,calc(100cqw_-_72px))] max-w-full sm:min-w-[min(100%,calc(min(48rem,100cqw)_-_92px))]">
        <div className="relative">
          {/* Scrolls sideways when it is wider than the room: a region the keyboard can reach and scroll. */}
          <div ref={ref} onScroll={update} role="region" aria-label={table.title} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            <table className="w-full border-collapse text-sm">
              <caption className="border-b border-line bg-ground/60 px-3 py-2 text-start text-xs font-semibold text-ink-2">{table.title}</caption>
              <thead>
                <tr className="border-b border-line bg-ground/40 text-xs text-ink-2">
                  {table.columns.map((c) => (
                    <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2 font-semibold ${NUMERIC.has(c.kind ?? '') ? 'text-end' : 'text-start'}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-line first:border-t-0 even:bg-ground/30">
                    {r.cells.map((v, j) => {
                      const kind = table.columns[j]?.kind;
                      const text = cellDisplay(kind, v);
                      return (
                        <td key={j} dir={kind === 'text' || !kind ? 'auto' : undefined} className={`px-3 py-2 align-top text-ink ${NUMERIC.has(kind ?? '') ? 'whitespace-nowrap text-end tabular-nums' : kind === 'date' || kind === 'datetime' ? 'whitespace-nowrap' : ''}`}>
                          {kind === 'text' || !kind ? (
                            <span className={`block ${textClass[j]}`}>{text}</span>
                          ) : kind === 'key' && text ? (
                            <span className="whitespace-nowrap rounded-md bg-ground px-1.5 py-0.5 font-mono text-xs text-ink-2">{text}</span>
                          ) : kind === 'days' && text ? (
                            <span className="font-semibold text-danger">{text}</span>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* More to see that way: a fade over that edge (drawn, not a scrollbar, which a phone or a Mac hides). */}
          {edges.start ? <div aria-hidden="true" data-scroll-cue="start" className="pointer-events-none absolute inset-y-px start-px w-10 rounded-s-xl bg-gradient-to-r from-surface via-surface/70 to-transparent shadow-[inset_8px_0_8px_-8px_rgb(var(--c-ink)/0.18)]" /> : null}
          {edges.end ? <div aria-hidden="true" data-scroll-cue="end" className="pointer-events-none absolute inset-y-px end-px w-10 rounded-e-xl bg-gradient-to-l from-surface via-surface/70 to-transparent shadow-[inset_-8px_0_8px_-8px_rgb(var(--c-ink)/0.18)]" /> : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {onExcel ? (
            <button
              type="button"
              aria-label={`Download ${table.title} as Excel`}
              onClick={onExcel}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground"
            >
              <DownloadIcon />
              Excel
            </button>
          ) : null}
          {table.total !== undefined && table.total > table.rows.length ? <p className="text-xs text-ink-3">{`Showing ${table.rows.length} of ${table.total}`}</p> : null}
          {table.rows.length > FIRST_ROWS ? (
            <button type="button" onClick={() => setAll((v) => !v)} className="tap text-xs font-medium text-brand hover:underline">
              {all ? 'Show fewer rows' : `Show all ${table.rows.length} rows`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Where a source opens: a task in the task panel on this page (?task=), anything else at its own page. */
function useSourceTarget() {
  const location = useLocation();
  return (url: string) => {
    if (!url.startsWith('?')) return url;
    const params = new URLSearchParams(location.search);
    for (const [k, v] of new URLSearchParams(url)) params.set(k, v);
    return { pathname: location.pathname, search: `?${params.toString()}` };
  };
}

/** The records an answer used, each a link that opens it. */
export function SourceChips({ sources }: { sources: MicoAiSource[] }) {
  const target = useSourceTarget();
  if (!sources.length) return null;
  const chip = 'inline-flex min-h-7 max-w-full items-center rounded-full bg-info-soft px-2.5 text-xs font-semibold text-info';
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
      <span aria-hidden="true">Sources:</span>
      <ul aria-label="Sources" className="flex min-w-0 flex-wrap gap-1.5">
        {sources.map((s) => (
          <li key={`${s.type}:${s.id}`} className="min-w-0">
            {s.url ? (
              <Link to={target(s.url)} className={`${chip} hover:brightness-95`}>
                <span dir="auto" className="truncate">{s.label}</span>
              </Link>
            ) : (
              <span className={chip}>
                <span dir="auto" className="truncate">{s.label}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "MICO AI is working": three dots and what it is doing now. */
export function Thinking({ step }: { step: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none" style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </span>
      <span dir="auto">{step || 'Thinking…'}</span>
    </div>
  );
}
