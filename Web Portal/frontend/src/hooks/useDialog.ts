import { useEffect, useRef } from 'react';

/** Everything the browser can Tab to — used for the focus trap and initial focus. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Real form fields, preferred for initial focus so a dialog opens on its first input, not a close button. */
const FIELD = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Standard modal-dialog behaviour for a `role="dialog"` element, generalised from the
 * TaskDrawer's Escape handler: Escape closes, focus moves to the first field on open,
 * Tab is trapped inside the dialog, and focus returns to the trigger on close.
 *
 * Attach the returned ref to the dialog container. The keydown listener lives on that
 * element (not `document`), so a portaled child that manages its own Escape — e.g. an
 * open SearchableSelect panel — closes only itself, never the whole dialog.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const dialogRef = useRef<T>(null);
  // Keep the latest onClose without re-running the mount effect (which would steal focus mid-edit).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Remember the trigger so focus can return to it when the dialog closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first field (or, failing that, the first focusable element) on open.
    const initial =
      dialog.querySelector<HTMLElement>(FIELD) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
    // Runs once for the life of the dialog; onClose is always read through onCloseRef.
  }, []);

  return dialogRef;
}
