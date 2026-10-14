import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string };

/** How long "Saved" stays up after a save. */
const SAVED_FOR_MS = 2500;

/** The message to show for a failed save: the server's reason when there is one. */
export function failureMessage(err: unknown, fallback = 'Couldn’t save. Please try again.'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * The saving → saved / error state of one inline edit. `run` awaits the save and reports whether it
 * worked, so the caller can keep the user's input on a failure.
 */
export function useSaveState() {
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const run = useCallback(async (save: () => unknown): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    setState({ status: 'saving' });
    try {
      await save();
      setState({ status: 'saved' });
      timer.current = setTimeout(() => setState({ status: 'idle' }), SAVED_FOR_MS);
      return true;
    } catch (err) {
      setState({ status: 'error', message: failureMessage(err) });
      return false;
    }
  }, []);
  const fail = useCallback((message: string) => setState({ status: 'error', message }), []);
  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { state, run, fail, reset, busy: state.status === 'saving' };
}

/**
 * "Saving…" / "✓ Saved" (announced politely) or the error (an alert). The polite region is always
 * there, so screen readers hear the change.
 */
export function SaveIndicator({ state, className = '' }: { state: SaveState; className?: string }) {
  return (
    <>
      {/* A block that is empty (no height) when there is nothing to say. */}
      <div aria-live="polite" className={`text-[11px] font-medium ${className}`}>
        {state.status === 'saving' ? (
          <span className="mt-1 inline-flex items-center gap-1 text-ink-3">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-ink-3/30 border-t-ink-3" aria-hidden />
            Saving…
          </span>
        ) : state.status === 'saved' ? (
          <span className="mt-1 inline-flex items-center gap-1 text-success">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Saved
          </span>
        ) : null}
      </div>
      {state.status === 'error' ? (
        <p role="alert" className="mt-1 rounded-md bg-danger-soft px-2 py-1 text-xs font-medium text-danger">
          {state.message}
        </p>
      ) : null}
    </>
  );
}

/**
 * Escape handled on the element itself (a native listener) and stopped there, so the dialog around
 * it — whose own Escape listener sits on an outer element — doesn't close as well.
 */
export function useOwnEscape(ref: RefObject<HTMLElement | null>, onEscape: () => void, active = true) {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      handler.current();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });
}
