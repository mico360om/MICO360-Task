import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A short line under the label ("computers only"). */
  hint?: string;
  icon?: ReactNode;
}

/**
 * 1.23.8 A small toolbar button that opens a menu of a few choices, one of them chosen (menuitemradio):
 * the Rows button (Compact · Comfortable · Detailed) and the board's Column width (Narrow · Normal · Wide).
 * The menu opens in the page layer, so a toolbar's edge never cuts it; Enter or Space opens it on the chosen
 * item, the arrow keys move, Escape (or a click elsewhere) closes it back to its button.
 */
export function ChoiceMenu<T extends string>({
  label,
  value,
  choices,
  onChoose,
  icon,
  title,
  size = 'md',
  menuLabel,
}: {
  /** The button's name: "Rows: Comfortable". */
  label: string;
  value: T;
  choices: Choice<T>[];
  onChoose: (v: T) => void;
  icon: ReactNode;
  title?: string;
  /** 'sm': beside 34px controls. */
  size?: 'md' | 'sm';
  /** The menu's name ("Rows"). */
  menuLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const toggle = () => {
    if (open) return setOpen(false);
    const r = trigger.current?.getBoundingClientRect();
    setPlace({ top: (r?.bottom ?? 0) + 4, right: Math.max(8, window.innerWidth - (r?.right ?? window.innerWidth)) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !place) return;
    (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      all[e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      all[e.key === 'Home' ? 0 : all.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // Back on the button first (the menu is at the end of the page): Tab then moves on from there.
      trigger.current?.focus();
      close(false);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
        className={`grid flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink aria-expanded:bg-ground aria-expanded:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'}`}
      >
        {icon}
      </button>
      {open && place
        ? createPortal(
            <div
              ref={menu}
              id={id}
              role="menu"
              aria-label={menuLabel}
              onKeyDown={onMenuKey}
              style={{ top: place.top, right: place.right }}
              className="fixed z-50 w-56 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lift animate-scale-in"
            >
              <p aria-hidden="true" className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {menuLabel}
              </p>
              {choices.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={c.value === value}
                  onClick={() => {
                    close();
                    if (c.value !== value) onChoose(c.value);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm text-ink outline-none hover:bg-ground focus-visible:bg-ground [@media(pointer:coarse)]:min-h-11"
                >
                  <span aria-hidden="true" className={`grid h-4 w-4 flex-none place-items-center ${c.value === value ? 'text-brand' : 'text-transparent'}`}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  {c.icon ? <span aria-hidden="true" className="flex-none text-ink-2">{c.icon}</span> : null}
                  <span className="min-w-0">
                    <span className="block font-medium">{c.label}</span>
                    {c.hint ? <span className="block text-xs text-ink-2">{c.hint}</span> : null}
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
