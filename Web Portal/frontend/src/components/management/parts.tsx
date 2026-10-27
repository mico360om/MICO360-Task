import type { ReactNode } from 'react';
import type { ItemQuery, Rag } from '../../api/management';
import { RAG_WORD } from '../../lib/management';

const RAG_LOOK: Record<Rag, { chip: string; dot: string }> = {
  RED: { chip: 'bg-danger-soft text-danger', dot: 'bg-danger' },
  AMBER: { chip: 'bg-warning-soft text-warning', dot: 'bg-warning' },
  GREEN: { chip: 'bg-success-soft text-success', dot: 'bg-success' },
};

/** A project's mark as a word with a dot ("Red"): never colour alone. */
export function RagMark({ rag, className = '' }: { rag: Rag; className?: string }) {
  const look = RAG_LOOK[rag];
  return (
    <span data-rag={rag} className={`inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold ${look.chip} ${className}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${look.dot}`} />
      {RAG_WORD[rag]}
    </span>
  );
}

export type OpenList = (q: ItemQuery, opener: HTMLElement) => void;
type Tone = 'danger' | 'warning' | 'neutral';
const NUMBER_TONE: Record<Tone, string> = { danger: 'text-danger', warning: 'text-warning', neutral: 'text-ink' };

/**
 * A number that opens the list behind it (a side sheet). Zero has nothing behind it: plain text.
 * `label` names it for screen readers, e.g. "4 late tasks in Rig Inspection Portal".
 */
export function NumberButton({
  value,
  label,
  query,
  onOpen,
  tone = 'neutral',
  suffix,
  display,
}: {
  value: number;
  label: string;
  query: ItemQuery;
  onOpen: OpenList;
  tone?: Tone;
  suffix?: ReactNode;
  /** Shown instead of the number (e.g. "88%" for a pass rate over `value` inspections). */
  display?: ReactNode;
}) {
  if (value === 0) {
    return (
      <span className="inline-flex min-w-[2rem] justify-center px-2 py-1 tabular-nums text-ink-3">
        {display ?? 0}
        {suffix}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => onOpen(query, e.currentTarget)}
      aria-label={`${label}: show the list`}
      title="Show the list"
      className={`inline-flex min-h-8 min-w-[2rem] items-center justify-center gap-1 rounded-lg px-2 py-1 font-semibold tabular-nums underline decoration-dotted underline-offset-4 transition-colors hover:bg-ground hover:decoration-solid [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 ${NUMBER_TONE[tone]}`}
    >
      {display ?? value}
      {suffix}
    </button>
  );
}

/** A section card whose heading is its accessible name (a landmark region). */
export function Section({ id, title, action, children, note }: { id: string; title: string; action?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="card min-w-0 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="font-display text-lg font-bold text-ink">{title}</h2>
          {note ? <p className="text-xs text-ink-2">{note}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
