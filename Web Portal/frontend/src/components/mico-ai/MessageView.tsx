import { useEffect, useState } from 'react';
import type { MicoAiMessage } from '../../api/mico-ai';
import { copyTextOf } from '../../lib/mico-ai';
import { CopyIcon } from '../chat/icons';
import { AnswerTable, AnswerText, MicoAiMark, SourceChips, Thinking } from './AnswerParts';
import { ProposalCard, type ProposalActions } from './ProposalCard';

export interface MessageActions {
  /** Ask this text as the next question (quick replies, follow-ups). */
  ask: (text: string) => void;
  /** Ask the question this answer was for again. */
  retry: () => void;
  /** Table n (1 = the first) as an Excel file. */
  download: (n: number, format: 'xlsx' | 'pdf') => void;
  /** The whole answer (its words, every table, its sources) as one PDF report. */
  report: () => void;
  /** Whether a new question can be sent now (no answer is being written). */
  canAsk: boolean;
  /** Confirm, cancel or undo a card of proposed changes (absent: the card can't be acted on). */
  proposal?: ProposalActions;
}

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
  </svg>
);
const RetryIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.34 5.66" />
    <path d="M20 4v7h-7" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

const quiet = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink disabled:cursor-not-allowed disabled:opacity-50';
const download = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground';
const pill =
  'inline-flex min-h-9 max-w-full items-center rounded-full border border-brand/25 bg-brand/5 px-3.5 py-1.5 text-start text-sm font-medium text-brand transition-colors hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * One message, as in a ChatGPT-style conversation: your question in a bubble on the right; MICO AI's
 * answer as full-width text beside its mark (no bubble), with its tables, sources and actions.
 */
export function MessageView({ message, actions, latest }: { message: MicoAiMessage; actions: MessageActions; latest: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (message.role === 'user') {
    return (
      <div data-mico-message="user" className="flex justify-end ps-8 sm:ps-16">
        <p data-bubble="" dir="auto" className="min-w-0 max-w-full whitespace-pre-wrap rounded-3xl bg-ground px-4 py-2.5 text-[0.9375rem] leading-relaxed text-ink [overflow-wrap:anywhere]">
          <span className="sr-only">You: </span>
          <span>{message.text}</span>
        </p>
      </div>
    );
  }

  const a = message.answer;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyTextOf(message));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  let body;
  if (message.status === 'pending') body = <Thinking step={message.step} />;
  else if (message.status === 'stopped') body = <p className="text-sm text-ink-2">Stopped.</p>;
  else if (message.status === 'error' || !a)
    body = (
      <p dir="auto" className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {message.error ?? 'Something went wrong while answering. Try again.'}
      </p>
    );
  else if (a.unavailable)
    body = (
      <div role="note" className="rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-2.5">
        <AnswerText text={message.text} />
      </div>
    );
  else body = <AnswerText text={message.text} />;
  // A card of proposed changes: MICO AI's words, then the card to check, edit and confirm.
  const card = a?.kind === 'proposal' && a.proposal && message.status === 'done' ? <ProposalCard proposal={a.proposal} actions={actions.proposal} /> : null;

  return (
    // Focus lands here when an answer finishes or is stopped (so it isn't lost when Stop disappears).
    <article
      id={`mico-ai-message-${message.id}`}
      data-mico-message="assistant"
      tabIndex={-1}
      aria-label="MICO AI’s answer"
      className="flex gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-4 focus-visible:ring-offset-surface sm:gap-4"
    >
      <span className="pt-0.5">
        <MicoAiMark size="sm" />
      </span>
      <div className="min-w-0 flex-1 space-y-3.5">
        <span className="sr-only">MICO AI: </span>
        {body}
        {card}
        {a?.kind === 'clarify' && a.options.length ? (
          <div role="group" aria-label="Quick replies" className="flex flex-wrap gap-2">
            {a.options.map((o) => (
              <button key={o} type="button" dir="auto" className={pill} disabled={!actions.canAsk} onClick={() => actions.ask(o)}>
                {o}
              </button>
            ))}
          </div>
        ) : null}
        {a?.tables.map((t, i) => <AnswerTable key={i} table={t} onExcel={message.status === 'done' ? () => actions.download(i + 1, 'xlsx') : undefined} />)}
        {a ? <SourceChips sources={a.sources} /> : null}
        {message.status !== 'pending' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* The whole answer as one report: its words, every table and its sources (text-only answers too). */}
            {a && message.status === 'done' && a.kind === 'answer' && (message.text.trim() || a.tables.length) ? (
              <>
                <button type="button" aria-label="Download this answer as a PDF report" onClick={actions.report} className={download}>
                  <DownloadIcon />
                  PDF report
                </button>
                <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line" />
              </>
            ) : null}
            {a && message.status === 'done' ? (
              <button type="button" className={quiet} onClick={() => void copy()}>
                {copied ? <CheckIcon /> : <CopyIcon size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            ) : null}
            <button type="button" className={quiet} disabled={!actions.canAsk} onClick={actions.retry}>
              <RetryIcon />
              Retry
            </button>
          </div>
        ) : null}
        {latest && a?.followUps.length && message.status === 'done' && a.kind === 'answer' ? (
          <div role="group" aria-label="Suggested follow-ups" className="flex flex-wrap gap-2">
            {a.followUps.map((f) => (
              <button key={f} type="button" dir="auto" className={pill} disabled={!actions.canAsk} onClick={() => actions.ask(f)}>
                {f}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}
