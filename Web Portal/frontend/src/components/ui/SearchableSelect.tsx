import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TOUCH_TALL } from '../../lib/touch';

interface PanelRect {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

export interface SelectOption {
  value: string;
  label: string;
  /** Optional secondary text shown to the right of the label (e.g. a code or status). */
  hint?: string;
  /** Optional picture before the label (a project's icon, a status dot) — decorative. */
  icon?: ReactNode;
}

export interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name for the trigger (maps to aria-label). */
  ariaLabel?: string;
  disabled?: boolean;
  emptyText?: string;
  className?: string;
  id?: string;
  /** Marks the field as wrong (with its message's id in `describedBy`). */
  invalid?: boolean;
  describedBy?: string;
  /** 'lg': as tall as the large form fields (44px). */
  size?: 'md' | 'lg';
}

/**
 * Accessible, dependency-free combobox: a trigger button that opens a filterable option list.
 * Type to filter, click or Enter to select, arrow keys to move, Escape / click-outside to close.
 * A drop-in replacement for a native <select> where the option set benefits from search.
 * After a choice, Escape or Tab, focus goes back to the trigger (the panel is portaled to
 * <body>, so otherwise keyboard focus would fall to the end of the page).
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  ariaLabel,
  disabled,
  emptyText = 'No matches',
  className,
  id,
  invalid,
  describedBy,
  size = 'md',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<PanelRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // The trigger's words, and whether the trigger cuts them short (then they are its tooltip).
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelCut, setLabelCut] = useState(false);

  // Anchor the (portaled) panel to the trigger, flipping upward when there's no room below.
  const position = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const PANEL_MAX = 300; // filter input + max list height
    const dropUp = below < PANEL_MAX && r.top > below;
    setRect(
      dropUp
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 }
        : { left: r.left, width: r.width, top: r.bottom + 4 },
    );
  };

  useLayoutEffect(() => {
    if (!open) return;
    position();
    const onReflow = () => position();
    // capture:true also catches scrolling inside any ancestor (cards, panes).
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const shownLabel = selected ? selected.label : placeholder;
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const measure = () => setLabelCut(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [shownLabel]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel is portaled outside rootRef, so it must be excluded explicitly.
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  /** Close the panel and put keyboard focus back on the trigger. */
  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (v: string) => {
    onChange(v);
    closeToTrigger();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[active];
      if (o) choose(o.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // close just this panel, not a dialog it sits in
      closeToTrigger();
    } else if (e.key === 'Tab') {
      // Leave the (portaled) panel from where it was opened, so Tab continues through the form.
      closeToTrigger();
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 border bg-surface text-left text-sm text-ink ${size === 'lg' ? '!min-h-[44px] rounded-xl px-3.5 py-2' : `rounded-lg px-3 py-2 ${TOUCH_TALL}`} outline-none transition-colors focus:ring-2 disabled:opacity-50 ${invalid ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-line focus:border-brand focus:ring-brand/20'}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon ? <span aria-hidden="true" className="flex flex-none">{selected.icon}</span> : null}
          <span ref={labelRef} dir="auto" title={labelCut ? shownLabel : undefined} className={`truncate text-start ${selected ? 'text-ink' : 'text-ink-2'}`}>
            {shownLabel}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-ink-2">▾</span>
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              data-searchable-select-panel=""
              style={{
                position: 'fixed',
                left: rect?.left ?? 0,
                width: rect?.width,
                top: rect?.top,
                bottom: rect?.bottom,
                zIndex: 70,
              }}
              className="overflow-hidden rounded-lg border border-line bg-surface shadow-lift"
            >
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={`Filter ${ariaLabel ?? 'options'}`}
            aria-controls={listId}
            aria-expanded
            aria-autocomplete="list"
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            value={query}
            placeholder="Type to filter…"
            dir="auto"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="w-full border-b border-line bg-surface px-3 py-2 text-sm text-ink outline-none"
          />
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {/* The <li>s are layout only: the listbox's children, to a screen reader, are its options. */}
            {filtered.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-sm text-ink-2">{emptyText}</li>
            ) : (
              filtered.map((o, i) => (
                <li key={o.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    id={`${listId}-${i}`}
                    aria-selected={o.value === value}
                    onClick={() => choose(o.value)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                      i === active ? 'bg-brand/10 text-brand' : 'text-ink hover:bg-ground'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {o.icon ? <span aria-hidden="true" className="flex flex-none">{o.icon}</span> : null}
                      <span dir="auto" className="truncate text-start">{o.label}</span>
                    </span>
                    {o.hint ? <span className="shrink-0 text-xs text-ink-2">{o.hint}</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
