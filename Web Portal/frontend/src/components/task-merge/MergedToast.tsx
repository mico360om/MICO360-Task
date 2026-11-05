import { useEffect, useRef } from 'react';

/**
 * The plain notice after a merge — "Merged MICO-14 and MICO-15 into MICO-12" — with Open (the main
 * task) and Undo (asks first). It stays a while (longer than other notices: Undo is in it) and keeps
 * still while the pointer or keyboard is on it.
 */
export function MergedToast({ text, onOpen, onUndo, onDismiss, ms = 12_000 }: { text: string; onOpen?: () => void; onUndo?: () => void; onDismiss: () => void; ms?: number }) {
  const holding = useRef(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const t = setInterval(() => {
      if (!holding.current) dismiss.current();
    }, ms);
    return () => clearInterval(t);
  }, [ms]);
  const hold = (on: boolean) => () => {
    holding.current = on;
  };
  const action = 'rounded-full px-2.5 py-1 text-sm font-semibold text-brand transition-colors hover:bg-ground [@media(pointer:coarse)]:!min-h-11';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex justify-center px-4 sm:bottom-6" onClick={(e) => e.stopPropagation()}>
      <div
        role="status"
        onMouseEnter={hold(true)}
        onMouseLeave={hold(false)}
        onFocus={hold(true)}
        onBlur={hold(false)}
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-lift"
      >
        <span>{text}</span>
        {onOpen ? (
          <button type="button" onClick={onOpen} className={action}>
            Open
          </button>
        ) : null}
        {onUndo ? (
          <button type="button" onClick={onUndo} className={action}>
            Undo
          </button>
        ) : null}
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          ✕
        </button>
      </div>
    </div>
  );
}
