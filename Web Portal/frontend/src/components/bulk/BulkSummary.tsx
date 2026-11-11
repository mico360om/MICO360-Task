import { useEffect, useId, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { bulkApi, type BulkResult } from '../../api/bulk';
import { ApiError } from '../../lib/api-client';
import { BULK_UNDO_SECONDS, summaryText, undoText } from '../../lib/bulk-words';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { TaskKey } from '../TaskKey';

export interface BulkSummaryProps {
  /** What the change did. */
  result: BulkResult;
  /** "Select the 2 skipped": they become the selection (for another try). */
  onSelectSkipped: (ids: string[]) => void;
  /** Open a task (a duplicate's copy). */
  onOpenTask: (id: string) => void;
  onDismiss: () => void;
  /** Undo put tasks back: the views refresh. */
  onUndone: () => void;
}

/** How long Undo's answer stays (it can be dismissed sooner). */
const UNDONE_MS = 8000;

const linkButton = `rounded-full px-2 font-semibold text-brand hover:underline disabled:opacity-60 ${TOUCH_TALL}`;

/**
 * After a bulk change (owner, 10 Nov): "18 updated · 2 not changed", the skipped ones listed on demand
 * (number, title, reason — a task they can't open is never named), "Select the 2 skipped" for another
 * try, and Undo for 15 seconds (counting down; pointed at or focused, it waits) — then what Undo did
 * ("12 put back · 1 left as it was: changed since"). A duplicate's copies can be opened from it.
 */
export function BulkSummary({ result, onSelectSkipped, onOpenTask, onDismiss, onUndone }: BulkSummaryProps) {
  const [seconds, setSeconds] = useState(BULK_UNDO_SECONDS);
  const [held, setHeld] = useState(false);
  const [phase, setPhase] = useState<'result' | 'undoing' | 'undone'>('result');
  const [undone, setUndone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<'skipped' | 'copies' | null>(null);
  const listId = useId();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  const skipped = result.skipped;
  const copies = result.changed.flatMap((c) => (c.copy ? [c.copy] : []));
  const stays = skipped.length > 0 || copies.length > 1;

  // Undo's 15 seconds, one at a time (waiting while pointed at or focused).
  useEffect(() => {
    if (held || phase !== 'result') return;
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [held, phase]);
  // Time's up: a summary with nothing more to read goes.
  useEffect(() => {
    if (seconds === 0 && phase === 'result' && !stays) dismiss.current();
  }, [seconds, phase, stays]);
  // Undo's answer stays a while.
  useEffect(() => {
    if (phase !== 'undone' || held) return;
    const t = setTimeout(() => dismiss.current(), UNDONE_MS);
    return () => clearTimeout(t);
  }, [phase, held]);

  async function undo() {
    if (!result.undo || phase !== 'result') return;
    setPhase('undoing');
    setProblem(null);
    try {
      const r = await bulkApi(apiClient).undo(result.undo.id);
      setUndone(undoText(r));
      setPhase('undone');
      setOpen(null);
      onUndone();
    } catch (e) {
      setProblem(e instanceof ApiError && e.message ? e.message : 'Couldn’t undo it. Check your connection and try again.');
      setPhase('result');
      setSeconds(0);
    }
  }

  const canUndo = phase !== 'undone' && result.undo !== null && seconds > 0;
  return (
    <div
      data-bulk-summary
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      className="pointer-events-auto flex w-full max-w-xl flex-col gap-1 rounded-2xl border border-line bg-surface py-2 pe-2 ps-4 text-sm text-ink shadow-lift"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p role="status" className="me-auto font-semibold">
          {undone ?? summaryText(result)}
        </p>
        {canUndo ? (
          <button type="button" onClick={() => void undo()} disabled={phase === 'undoing'} className={linkButton}>
            {phase === 'undoing' ? 'Undoing…' : `Undo (${seconds} s)`}
          </button>
        ) : null}
        {phase === 'result' && skipped.length ? (
          <>
            <button type="button" aria-expanded={open === 'skipped'} aria-controls={open === 'skipped' ? listId : undefined} onClick={() => setOpen(open === 'skipped' ? null : 'skipped')} className={linkButton}>
              Show the {skipped.length} skipped
            </button>
            <button type="button" onClick={() => onSelectSkipped(skipped.map((s) => s.id))} className={linkButton}>
              Select the {skipped.length} skipped
            </button>
          </>
        ) : null}
        {phase === 'result' && copies.length === 1 ? (
          <button type="button" onClick={() => onOpenTask(copies[0]!.id)} className={linkButton}>
            Open {copies[0]!.key}
          </button>
        ) : null}
        {phase === 'result' && copies.length > 1 ? (
          <button type="button" aria-expanded={open === 'copies'} aria-controls={open === 'copies' ? listId : undefined} onClick={() => setOpen(open === 'copies' ? null : 'copies')} className={linkButton}>
            Show the {copies.length} copies
          </button>
        ) : null}
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={`grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:text-ink ${TOUCH_SQUARE}`}>
          ✕
        </button>
      </div>
      {problem ? (
        <p role="alert" className="me-2 rounded-lg bg-danger-soft px-3 py-1.5 text-danger">
          {problem}
        </p>
      ) : null}
      {open === 'skipped' ? (
        <ul id={listId} aria-label="Not changed" className="me-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto border-t border-line pt-2">
          {skipped.map((s) => (
            <li key={s.id} className="flex flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {s.key ? (
                  <>
                    <TaskKey value={s.key} dense="compact" />
                    <span dir="auto" className="min-w-0 truncate font-medium">
                      {s.title}
                    </span>
                  </>
                ) : (
                  <span className="font-medium text-ink-2">A task you can’t open</span>
                )}
              </span>
              <span className="text-xs text-ink-2">{s.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open === 'copies' ? (
        <ul id={listId} aria-label="Copies" className="me-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto border-t border-line pt-2">
          {copies.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onOpenTask(c.id)} className={`rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-brand hover:border-brand ${TOUCH_TALL}`}>
                Open {c.key}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
