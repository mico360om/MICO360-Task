import { useEffect, useRef } from 'react';

/** Everything the browser can Tab to — used for the focus trap and initial focus. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Real form fields, preferred for initial focus so a dialog opens on its first input, not a close button. */
const FIELD = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Open dialogs, oldest first — the last one is on top. */
const openDialogs: HTMLElement[] = [];

/**
 * Standard modal-dialog behaviour for a `role="dialog"` element, generalised from the
 * TaskDrawer's Escape handler: Escape closes, focus moves to the first field on open,
 * Tab is trapped inside the dialog, and focus returns to the trigger on close.
 *
 * Attach the returned ref to the dialog container. The keydown listener lives on that
 * element (not `document`), so a portaled child that manages its own Escape — e.g. an
 * open SearchableSelect panel — closes only itself, never the whole dialog.
 *
 * One exception: when focus has fallen out of everything (it sits on `<body>` — e.g. the focused
 * Save button was disabled while the request ran), no element receives the key. The topmost dialog
 * then answers it from `document`, so Escape still closes and Tab comes back inside.
 */
export interface UseDialogOptions {
  /**
   * Where focus goes on open: `'field'` (default) = the first form field; `'container'` = the dialog
   * element itself (give it tabIndex={-1}) — for panels like the task drawer whose content loads in
   * after opening, so Escape and the Tab trap work from the first moment.
   */
  initialFocus?: 'field' | 'container';
}

export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void, options: UseDialogOptions = {}) {
  const initialFocus = options.initialFocus ?? 'field';
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
      initialFocus === 'container'
        ? dialog
        : dialog.querySelector<HTMLElement>(FIELD) ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
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

    const onLostFocusKey = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      const active = document.activeElement as (HTMLElement & { disabled?: boolean }) | null;
      // Lost = on <body> (Chrome, Safari) or still on a control that has since been disabled (Firefox).
      const lost = !active || active === document.body || active.disabled === true;
      if (!lost) return;
      onKeyDown(e);
    };

    openDialogs.push(dialog);
    dialog.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onLostFocusKey);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', onLostFocusKey);
      const at = openDialogs.indexOf(dialog);
      if (at >= 0) openDialogs.splice(at, 1);
      previouslyFocused?.focus?.();
    };
    // Runs once for the life of the dialog; onClose is always read through onCloseRef.
  }, []);

  return dialogRef;
}
