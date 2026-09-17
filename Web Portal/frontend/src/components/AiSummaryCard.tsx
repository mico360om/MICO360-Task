import { useState } from 'react';

export interface AiSummaryCardProps {
  /** Produce the summary text (usually an AI call). */
  onSummarize: () => Promise<string>;
  /** Optional heading override. */
  title?: string;
}

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2zM18.5 14l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8.8-2.4z" />
    </svg>
  );
}

/**
 * Reusable "AI summary" card: a button that asks the AI for a plain-language summary,
 * then shows it with a regenerate option. Fully self-contained (busy/error/result state).
 */
export function AiSummaryCard({ onSummarize, title = 'AI summary' }: AiSummaryCardProps) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSummary(await onSummarize());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a summary right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="eyebrow flex items-center gap-1.5 text-brand"><Sparkle />{title}</h2>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:border-brand disabled:opacity-50"
        >
          {busy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden /> : <Sparkle />}
          {busy ? 'Thinking…' : summary ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>
      {error ? (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : summary ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{summary}</p>
      ) : (
        <p className="text-sm text-ink-3">Get a quick, plain-language read on where this project stands.</p>
      )}
    </section>
  );
}
