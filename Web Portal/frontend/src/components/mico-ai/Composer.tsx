import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

/** The box grows with what is typed up to this height (px), then scrolls. */
const MAX_BOX = 200;

export interface ComposerHandle {
  /** Focus the box (unless it is off). */
  focus: () => void;
  /** Put a question back in the box (it couldn't be sent). */
  restore: (text: string) => void;
}

export interface ComposerProps {
  /** MICO AI is set up (else the box is off and says so). */
  ready: boolean;
  /** A question can be sent now (nothing is being written or sent). */
  canAsk: boolean;
  /** An answer is being written: Send turns into Stop. */
  pending: boolean;
  /** The question is on its way. */
  sending: boolean;
  /** A wide enough screen for the long placeholder and the keyboard hint. */
  wide: boolean;
  error: string | null;
  maxLength: number;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * The box at the bottom of MICO AI, the same width as the conversation's reading column: a textarea
 * that grows as you type (Enter sends, Shift+Enter adds a line; a phone keyboard's key says Send),
 * Send — or Stop with "MICO AI is working…" while an answer is written — and a hint line. One row on a
 * phone. What is typed lives here, so typing never redraws the conversation.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ ready, canAsk, pending, sending, wide, error, maxLength, onSend, onStop }, ref) {
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (box.current && !box.current.disabled) box.current.focus();
    },
    restore: (text: string) => setDraft(text),
  }));

  // The box grows with what is typed (up to MAX_BOX) and shrinks back once it is sent.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    if (draft) el.style.height = `${Math.min(el.scrollHeight, MAX_BOX)}px`;
  }, [draft]);

  const submit = () => {
    if (!canAsk || !draft.trim()) return;
    const text = draft;
    setDraft('');
    onSend(text);
  };

  return (
    <form
      aria-label="Ask MICO AI"
      className="mx-auto max-w-3xl px-4 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {error ? (
        <p role="alert" dir="auto" className="mb-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {/* One row on a phone (the box and its button side by side); on a wider screen the button sits under the box with the hint. */}
      <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface py-1.5 pe-1.5 ps-3.5 shadow-card transition-colors focus-within:border-brand/60 focus-within:ring-4 focus-within:ring-brand/10 sm:block sm:px-4 sm:pb-2 sm:pt-2.5">
        <textarea
          ref={box}
          rows={1}
          dir="auto"
          aria-label="Ask MICO AI"
          enterKeyHint="send"
          placeholder={!ready ? 'MICO AI isn’t set up yet' : wide ? 'Ask about tasks, projects, meetings or reports…' : 'Ask MICO AI…'}
          disabled={!ready}
          maxLength={maxLength}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="block max-h-[200px] min-h-[1.75rem] min-w-0 flex-1 resize-none self-center bg-transparent px-0.5 py-1 text-[0.9375rem] leading-6 text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed sm:w-full"
        />
        <div className="flex flex-none items-center gap-2 sm:pt-1">
          <p className="hidden min-w-0 flex-1 truncate text-xs text-ink-3 sm:block">
            {pending ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-ink-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
                MICO AI is working…
              </span>
            ) : sending ? (
              'Sending…'
            ) : ready ? (
              'Enter to send · Shift+Enter for a new line'
            ) : null}
          </p>
          {/* Keyed apart: Stop is removed (not turned into Send), so focus moves on to the answer. */}
          {pending ? (
            <button key="stop" type="button" onClick={onStop} className="inline-flex h-9 flex-none items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-ground">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-ink" />
              Stop
            </button>
          ) : (
            <button
              key="send"
              type="submit"
              aria-label="Send"
              disabled={!canAsk || !draft.trim()}
              className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-gradient text-white shadow-brand transition-opacity disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {sending ? (
                <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" />
              ) : (
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs leading-snug text-ink-3">MICO AI answers only from MICO360 data you can see, and links its sources. Check important figures before sharing.</p>
    </form>
  );
});
