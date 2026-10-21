import { useState } from 'react';
import { aiMessage } from './ai-message';

/**
 * "Write description": the AI writes the invitation's description (from the title, the agenda and
 * the sentence). It is offered, never put in by itself, and says when it would replace your words.
 */
export function WriteDescription({ current, onWrite, onUse, disabled }: { current: string; onWrite: () => Promise<string>; onUse: (text: string) => void; disabled: boolean }) {
  const [writing, setWriting] = useState(false);
  const [offer, setOffer] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function write() {
    setWriting(true);
    setProblem(null);
    setOffer(null);
    try {
      setOffer(await onWrite());
    } catch (err) {
      setProblem(aiMessage(err, 'Couldn’t write a description. Try again, or write it yourself.'));
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void write()}
        disabled={disabled || writing}
        className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2l1.6 4.9L18.5 8.5 13.6 10 12 15l-1.6-5L5.5 8.5 10.4 6.9 12 2z" /></svg>
        {writing ? 'Writing…' : 'Write description'}
      </button>
      <div aria-live="polite">
        {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
        {offer ? (
          <div role="group" aria-label="Suggested description" className="rounded-xl border border-brand/20 bg-brand/[0.04] p-3">
            <p dir="auto" className="whitespace-pre-line text-sm text-ink">{offer}</p>
            {current.trim() ? <p className="mt-1 text-xs text-ink-2">Replaces your description.</p> : null}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setOffer(null)} className="min-h-[36px] rounded-lg px-3 text-sm font-semibold text-ink-2 hover:bg-ground">
                {current.trim() ? 'Keep mine' : 'Dismiss'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onUse(offer);
                  setOffer(null);
                }}
                className="min-h-[36px] rounded-lg bg-brand-gradient px-3 text-sm font-semibold text-white"
              >
                Use this description
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
