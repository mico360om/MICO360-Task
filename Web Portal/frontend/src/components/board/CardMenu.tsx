import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

/** One action in a board card's menu; with `unavailable`, it is shown but can't be chosen, saying why. */
export interface CardMenuItem {
  label: string;
  onSelect: () => void;
  unavailable?: string | null;
}

const itemClass = 'flex w-full items-start gap-2 px-3 py-2 text-start text-sm text-ink outline-none hover:bg-ground focus-visible:bg-ground sm:py-1.5 sm:text-xs';

/**
 * A board card's "⋯" menu. It sits beside the card (not inside it: the card is the drag handle and
 * its own button), shows on hover or keyboard focus (always on touch screens), and opens its menu in
 * the page layer, so a column's edge never cuts it off. Enter or Space opens it on its first item,
 * the arrow keys move between items, Escape (or a click elsewhere) closes it back to its button.
 */
export function CardMenu({ taskKey, items }: { taskKey: string; items: CardMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPlace({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    // The board scrolls sideways and the page scrolls: a menu left behind would point at nothing.
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
      all[next]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`More actions for ${taskKey}`}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-1.5 top-1.5 z-[1] grid h-7 w-7 place-items-center rounded-md bg-surface/90 text-ink-2 opacity-0 transition-opacity hover:bg-ground hover:text-brand focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand group-hover/card:opacity-100 aria-expanded:opacity-100 [@media(pointer:coarse)]:opacity-100"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={`Actions for ${taskKey}`}
              onKeyDown={onMenuKey}
              style={place ? { top: place.top, right: place.right } : { visibility: 'hidden' }}
              className="fixed z-50 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lift"
            >
              {items.map((item) =>
                item.unavailable ? (
                  <button key={item.label} role="menuitem" type="button" aria-disabled="true" className={`${itemClass} cursor-default text-ink-3 hover:bg-transparent`}>
                    <span className="min-w-0">
                      <span className="block">{item.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{item.unavailable}</span>
                    </span>
                  </button>
                ) : (
                  <button
                    key={item.label}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      close();
                      item.onSelect();
                    }}
                    className={itemClass}
                  >
                    {item.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
