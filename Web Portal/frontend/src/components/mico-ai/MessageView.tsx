import { useEffect, useState } from 'react';
import type { MicoAiMessage } from '../../api/mico-ai';
import { copyTextOf } from '../../lib/mico-ai';
import { AnswerTable, AnswerText, MicoAiMark, SourceChips, Thinking } from './AnswerParts';

export interface MessageActions {
  /** Ask this text as the next question (quick replies, follow-ups). */
  ask: (text: string) => void;
  /** Ask the question this answer was for again. */
  retry: () => void;
  download: (n: number, format: 'xlsx' | 'pdf') => void;
  /** Whether a new question can be sent now (no answer is being written). */
  canAsk: boolean;
}

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
  </svg>
);

const quiet = 'inline-flex min-h-8 items-center rounded-lg px-2 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink disabled:opacity-50';
const pill =
  'inline-flex min-h-9 items-center rounded-full border border-brand/25 bg-brand/5 px-3 text-sm font-medium text-brand transition-colors hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-50';

/** One message: yours on the right; MICO AI's on the left with its mark. */
export function MessageView({ message, actions, latest }: { message: MicoAiMessage; actions: MessageActions; latest: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p dir="auto" className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-ground px-4 py-2.5 text-sm text-ink">
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

  return (
    <div className="flex gap-3">
      <MicoAiMark />
      <div className="min-w-0 flex-1 space-y-3 pt-1">
        <span className="sr-only">MICO AI: </span>
        {body}
        {a?.kind === 'clarify' && a.options.length ? (
          <div role="group" aria-label="Quick replies" className="flex flex-wrap gap-2">
            {a.options.map((o) => (
              <button key={o} type="button" dir="auto" className={pill} disabled={!actions.canAsk} onClick={() => actions.ask(o)}>
                {o}
              </button>
            ))}
          </div>
        ) : null}
        {a?.tables.map((t, i) => <AnswerTable key={i} table={t} />)}
        {a ? <SourceChips sources={a.sources} /> : null}
        {message.status !== 'pending' ? (
          <div className="flex flex-wrap items-center gap-2">
            {a?.tables.map((t, i) => (
              <span key={i} className="contents">
                <button
                  type="button"
                  aria-label={`Download ${t.title} as Excel`}
                  onClick={() => actions.download(i + 1, 'xlsx')}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground"
                >
                  <DownloadIcon />
                  Excel
                </button>
                <button
                  type="button"
                  aria-label={`Download ${t.title} as a PDF report`}
                  onClick={() => actions.download(i + 1, 'pdf')}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground"
                >
                  <DownloadIcon />
                  PDF report
                </button>
              </span>
            ))}
            {a && message.status === 'done' ? (
              <button type="button" className={quiet} onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            ) : null}
            <button type="button" className={quiet} disabled={!actions.canAsk} onClick={actions.retry}>
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
    </div>
  );
}
