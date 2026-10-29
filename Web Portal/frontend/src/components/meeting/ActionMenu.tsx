import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMenu } from '../task-drawer/menus';
import { ShortcutHint, useShortcutSettings } from '../shortcuts/ShortcutProvider';
import { SHORTCUTS, ariaKeyshortcuts, type ShortcutAction } from '../../lib/shortcuts';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  /** Destructive: shown in red, after a divider. */
  danger?: boolean;
  /** The keyboard shortcut that does the same, shown beside the item. */
  shortcut?: ShortcutAction;
  icon?: ReactNode;
}

const DOTS = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

const ALIGN = { right: 'right-0', left: 'left-0', 'start-below-lg': 'left-0 lg:left-auto lg:right-0' } as const;

/**
 * A "⋯" (or labelled) button with a popup menu. Opening it focuses the first item; ↑/↓, Home and
 * End move between items; Escape closes it and returns to the button. Destructive items sit at the
 * bottom after a divider.
 */
export function ActionMenu({
  label,
  items,
  children,
  align = 'right',
  className = '',
  buttonClassName,
}: {
  /** Accessible name of the button (and the menu). */
  label: string;
  items: ActionMenuItem[];
  /** Visible button content; defaults to "⋯". */
  children?: ReactNode;
  /** Which edge of the button the menu lines up with. 'start-below-lg': the left edge on a phone or
   *  tablet (where the button sits at the left under a title), the right edge from lg up. */
  align?: 'left' | 'right' | 'start-below-lg';
  className?: string;
  buttonClassName?: string;
}) {
  const { open, setOpen, wrap, trigger } = useMenu();
  const { platform, singleKeys } = useShortcutSettings();
  const ariaFor = (a?: ShortcutAction) =>
    a && (singleKeys || !SHORTCUTS.find((s) => s.action === a)?.single) ? ariaKeyshortcuts(a, platform) : undefined;
  const menuRef = useRef<HTMLDivElement>(null);
  // How far the open menu moves sideways to stay on screen (8px from either edge): a button near an
  // edge of a narrow phone would otherwise open it partly off the screen.
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const r = menuRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    if (r.right > vw - 8) setShift(Math.max(8 - r.left, vw - 8 - r.right));
    else if (r.left < 8) setShift(8 - r.left);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  if (items.length === 0) return null;
  const safe = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const all = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  }

  const item = (it: ActionMenuItem) => (
    <button
      key={it.label}
      role="menuitem"
      type="button"
      tabIndex={-1}
      aria-keyshortcuts={ariaFor(it.shortcut)}
      onClick={() => {
        setOpen(false);
        // Back to the menu's button first: a dialog the item opens returns focus there when it closes
        // (the item itself is about to disappear).
        trigger.current?.focus();
        it.onSelect();
      }}
      className={`flex min-h-10 w-full items-center gap-2 px-3 py-2 text-start text-sm focus-visible:outline-none sm:min-h-0 sm:py-1.5 ${
        it.danger ? 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft' : 'text-ink hover:bg-ground focus-visible:bg-ground'
      }`}
    >
      {it.icon}
      {it.label}
      {it.shortcut ? <ShortcutHint action={it.shortcut} className="ms-auto" /> : null}
    </button>
  );

  return (
    <div className={`relative ${className}`} ref={wrap}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={children ? undefined : label}
        title={children ? undefined : label}
        className={
          buttonClassName ??
          'grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'
        }
      >
        {children ?? DOTS}
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className={`absolute top-full z-30 mt-1 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lift ${ALIGN[align]}`}
        >
          {safe.map(item)}
          {danger.length > 0 && safe.length > 0 ? <div role="separator" className="my-1 border-t border-line" /> : null}
          {danger.map(item)}
        </div>
      ) : null}
    </div>
  );
}
