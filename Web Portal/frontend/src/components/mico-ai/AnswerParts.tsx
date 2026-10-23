import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { MicoAiSource, MicoAiTable } from '../../api/mico-ai';
import { answerBlocks, cellDisplay, type Run } from '../../lib/mico-ai';

/** The ✦ mark that stands for MICO AI (decorative: the text around it names it). */
export function MicoAiMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl text-xl' : size === 'sm' ? 'h-7 w-7 rounded-lg text-xs' : 'h-8 w-8 rounded-lg text-sm';
  return (
    <span aria-hidden="true" className={`grid flex-none place-items-center bg-brand-gradient font-semibold text-white shadow-sm ${box}`}>
      ✦
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
    <div dir="auto" className="space-y-2 text-sm leading-relaxed text-ink">
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
          <ul key={i} className="list-disc space-y-1 ps-5 marker:text-brand">
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

/** A table copied by the server from the data (its figures are the data's, never the AI's). */
export function AnswerTable({ table }: { table: MicoAiTable }) {
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, FIRST_ROWS);
  return (
    <div className="min-w-0">
      {/* Scrolls sideways when it is wider than the answer: a region the keyboard can reach and scroll. */}
      <div role="region" aria-label={table.title} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-line outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
        <table className="w-full border-collapse text-sm">
          <caption className="border-b border-line bg-ground/60 px-3 py-1.5 text-start text-xs font-semibold text-ink-2">{table.title}</caption>
          <thead>
            <tr className="bg-ground/60 text-xs text-ink-2">
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2 font-semibold ${NUMERIC.has(c.kind ?? '') ? 'text-end' : 'text-start'}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.cells.map((v, j) => {
                  const kind = table.columns[j]?.kind;
                  const text = cellDisplay(kind, v);
                  return (
                    <td key={j} dir={kind === 'text' || !kind ? 'auto' : undefined} className={`px-3 py-2 align-top text-ink ${NUMERIC.has(kind ?? '') ? 'whitespace-nowrap text-end tabular-nums' : ''}`}>
                      {kind === 'key' && text ? (
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
      {table.rows.length > FIRST_ROWS ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1.5 text-xs font-medium text-brand hover:underline">
          {all ? 'Show fewer rows' : `Show all ${table.rows.length} rows`}
        </button>
      ) : null}
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
