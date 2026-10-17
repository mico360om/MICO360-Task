import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes a popover while it is open: on Escape (focus goes back to `returnFocus`, its button) or a
 * press outside `root`.
 */
export function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>, returnFocus?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeRef.current();
      returnFocus?.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, root, returnFocus]);
}
