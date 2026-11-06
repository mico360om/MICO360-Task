import { useId, useRef, useState } from 'react';
import type { Rag, RagReason } from '../../api/management';
import { RAG_WORD } from '../../lib/management';
import { healthSummary } from '../../lib/project-health';
import { AnchoredPopover } from '../ui/AnchoredPopover';

const LOOK: Record<Rag, { chip: string; dot: string; text: string }> = {
  RED: { chip: 'bg-danger-soft text-danger', dot: 'bg-danger', text: 'text-danger' },
  AMBER: { chip: 'bg-warning-soft text-warning', dot: 'bg-warning', text: 'text-warning' },
  GREEN: { chip: 'bg-success-soft text-success', dot: 'bg-success', text: 'text-success' },
};

/**
 * 1.23.5: a project's health mark — a dot and a word (never colour alone), the Management page's words —
 * with its reasons shown on hover (its title), on a tap or Enter (a small panel), and to screen readers
 * (its name). The reasons are the one rule's, worst first.
 */
export function HealthBadge({ rag, reasons, projectName, className = '' }: { rag: Rag; reasons: RagReason[]; projectName?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const summary = healthSummary({ rag, reasons });
  const look = LOOK[rag];
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-rag={rag}
        data-health-badge
        title={summary}
        aria-label={projectName ? `${summary}. ${projectName}` : summary}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 [@media(pointer:coarse)]:min-h-11 ${look.chip} ${className}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${look.dot}`} />
        {RAG_WORD[rag]}
      </button>
      {open ? (
        <AnchoredPopover anchor={anchor} labelledBy={heading} onClose={() => setOpen(false)} className="w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-3 shadow-lift">
          <p id={heading} data-popover-heading tabIndex={-1} className="text-xs font-semibold uppercase tracking-wide text-ink-2 outline-none">
            Health · {RAG_WORD[rag]}
          </p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {reasons.map((r) => (
              <li key={r.code + r.text} className={`flex items-start gap-2 ${r.level === 'GREEN' ? 'text-ink-2' : LOOK[r.level].text}`}>
                <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${LOOK[r.level].dot}`} />
                <bdi>{r.text}</bdi>
              </li>
            ))}
          </ul>
        </AnchoredPopover>
      ) : null}
    </>
  );
}
