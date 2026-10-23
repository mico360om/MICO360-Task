import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/**
 * A small non-modal dialog next to the control that opened it (a bar, a marker, a number). It is
 * placed right after that control in the page, so it is read where it belongs, and shown with fixed
 * positioning below it (above it when there's no room), so a scrolling table or chart doesn't cut
 * it off. Focus moves into it; Escape closes it back to its control; a press elsewhere or Tab out of
 * it closes it; a press on its own control is left to that control (which toggles it). When the part
 * that had focus goes away (a suggestion applied), focus moves to the next `[data-popover-action]`,
 * else the `[data-popover-heading]`, never back to the page.
 */
export function AnchoredPopover({
  anchor,
  label,
  labelledBy,
  onClose,
  children,
  className = '',
}: {
  anchor: RefObject<HTMLElement | null>;
  label?: string;
  labelledBy?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const close = useRef(onClose);
  close.current = onClose;
  /** Focus is (or was last) inside: keep it there if its element goes away. */
  const focusInside = useRef(false);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      const el = root.current;
      if (!a || !el) return;
      const r = a.getBoundingClientRect();
      const [w, h] = [el.offsetWidth, el.offsetHeight];
      const below = r.bottom + 8;
      const top = below + h > window.innerHeight - 8 && r.top - 8 - h >= 8 ? r.top - 8 - h : below;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      setPos((p) => (p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    root.current?.focus();
    focusInside.current = true;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      focusInside.current = false;
      close.current();
      anchor.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || anchor.current?.contains(t)) return;
      focusInside.current = false;
      close.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [anchor]);

  // After every change inside: if the focused part went away, keep focus in here.
  useLayoutEffect(() => {
    if (!focusInside.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const el = root.current;
    if (!el) return;
    (el.querySelector<HTMLElement>('[data-popover-action]:not([aria-disabled="true"])') ?? el.querySelector<HTMLElement>('[data-popover-heading]') ?? el).focus();
  });

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        // Lost (the focused part went away): handled above. Its own control: that control toggles it.
        if (!to || root.current?.contains(to) || anchor.current?.contains(to)) return;
        focusInside.current = false;
        close.current();
      }}
      className={`fixed z-40 text-start outline-none animate-fade-in ${className}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>
  );
}
