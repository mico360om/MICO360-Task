import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 8;

/**
 * A small floating panel next to the button that opened it (a menu, the emoji picker). It is drawn
 * at the end of <body>, so the scrolling message list never clips it, and placed below the button —
 * or above when there is more room there — inside the window.
 *
 * It follows its button when the page or a list scrolls, and closes once the button is out of sight,
 * on Escape or on a click elsewhere; focus starts inside and goes back to the button after.
 */
export function Popover({
  anchor,
  onClose,
  children,
  label,
  role = 'dialog',
  align = 'start',
  className = '',
  initialFocus,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  label: string;
  role?: 'dialog' | 'menu';
  align?: 'start' | 'end';
  className?: string;
  /** Selector for what gets focus first (default: the first menu item or field or button). */
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      const below = window.innerHeight - a.bottom;
      const top = below >= h + MARGIN || below >= a.top ? a.bottom + 4 : a.top - h - 4;
      const rtl = getComputedStyle(anchor).direction === 'rtl';
      const fromStart = (align === 'start') !== rtl;
      let left = fromStart ? a.left : a.right - w;
      left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - w - MARGIN));
      setPos({ top: Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN)), left });
    };
    // Scrolling moves the button: follow it, and close once it has left the screen.
    const follow = (e: Event) => {
      if (e.target instanceof Node && panel.contains(e.target)) return;
      const a = anchor.getBoundingClientRect();
      if (!anchor.isConnected || a.bottom < 0 || a.top > window.innerHeight) closeRef.current();
      else place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', follow, true);
    };
  }, [anchor, align]);

  useEffect(() => {
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>(initialFocus ?? '[role="menuitem"], input, button');
    first?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel?.contains(t) || anchor?.contains(t)) return;
      closeRef.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      // Back to the button, unless focus has already moved somewhere on purpose.
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) anchor?.focus({ preventScroll: true });
    };
  }, [anchor, initialFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (role !== 'menu') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') closeRef.current();
    else return;
    e.preventDefault();
  };

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className={`z-50 rounded-xl border border-line bg-surface shadow-lift animate-scale-in ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** A menu of actions in a Popover (arrow keys move, Enter picks, Escape closes). */
export function Menu({ anchor, label, items, onClose, align = 'end' }: { anchor: HTMLElement | null; label: string; items: MenuItem[]; onClose: () => void; align?: 'start' | 'end' }) {
  return (
    <Popover anchor={anchor} onClose={onClose} label={label} role="menu" align={align} className="min-w-[11rem] py-1">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm outline-none transition-colors hover:bg-ground focus-visible:bg-ground ${item.danger ? 'text-danger' : 'text-ink'}`}
        >
          {item.icon ? <span className={item.danger ? 'text-danger' : 'text-ink-2'}>{item.icon}</span> : null}
          {item.label}
        </button>
      ))}
    </Popover>
  );
}
