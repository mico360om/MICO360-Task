import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface PickerOption {
  id: string;
  /** The option's name (what a screen reader reads). */
  label: string;
  /** Shown before the label (an avatar, a task key). */
  lead?: ReactNode;
  /** Shown after the label, muted (a status). */
  trail?: ReactNode;
}

/**
 * A search box with a list of matches (the ARIA combobox pattern): typing filters, ↑/↓ move, Enter
 * picks the highlighted match (the first by default), Escape clears or closes. `options` are the
 * matches for the current `query` — the caller filters.
 */
export function ComboPicker({
  label,
  placeholder,
  query,
  onQuery,
  options,
  onPick,
  emptyText,
  alwaysOpen = false,
  openOnFocus = false,
  inline = false,
  autoFocus = false,
  onClose,
  disabled = false,
  required,
  invalid,
  describedBy,
}: {
  label: string;
  placeholder?: string;
  query: string;
  onQuery: (q: string) => void;
  options: PickerOption[];
  onPick: (id: string) => void;
  emptyText: string;
  /** Keep the list showing even while the box is empty or not focused (inside a popover). */
  alwaysOpen?: boolean;
  /** Show every option as soon as the box is focused, before anything is typed. */
  openOnFocus?: boolean;
  /** Show the list in the page flow (pushing what follows down) rather than floating over it. */
  inline?: boolean;
  autoFocus?: boolean;
  /** Escape with nothing typed (e.g. to close the popover around it). */
  onClose?: () => void;
  disabled?: boolean;
  /** Something must be picked (said to a screen reader). */
  required?: boolean;
  /** The pick is wrong or missing (with the problem's id in `describedBy`). */
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Closing the list moves what is below it. When focus leaves because of a press elsewhere, wait
  // until that press has finished (its click has landed) — otherwise the target can move away from
  // under the pointer between "down" and "up", and the click is lost.
  const pressing = useRef(false);
  const blurAfterPress = useRef(false);
  useEffect(() => {
    const down = () => { pressing.current = true; };
    const up = () => {
      setTimeout(() => {
        pressing.current = false;
        if (blurAfterPress.current) {
          blurAfterPress.current = false;
          setFocused(false);
        }
      }, 0);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    };
  }, []);
  const open = alwaysOpen || (focused && (openOnFocus || query.trim() !== ''));
  // The list exists only with matches in it; "nothing matches" is said as a message instead.
  const listed = open && options.length > 0;
  // A list opening near the bottom of a scrolling panel scrolls itself into view.
  useEffect(() => {
    if (open && !alwaysOpen) listRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open, alwaysOpen]);
  const current = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Escape is ours while there's something to clear or a popover to close (native: the drawer's
  // own Escape listener sits on an element around this one).
  const escapeTo = useRef<() => boolean>(() => false);
  escapeTo.current = () => {
    if (query) {
      onQuery('');
      return true;
    }
    if (onClose) {
      onClose();
      return true;
    }
    return false;
  };
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escapeTo.current()) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  const optionId = (i: number) => `${listId}-o${i}`;
  return (
    <div className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={listed}
        aria-controls={listed ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listed ? optionId(current) : undefined}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onQuery(e.target.value)}
        onFocus={() => {
          blurAfterPress.current = false;
          setFocused(true);
        }}
        onBlur={() => {
          if (pressing.current) blurAfterPress.current = true;
          else setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && options.length > 0) {
            e.preventDefault();
            setActive((current + 1) % options.length);
          } else if (e.key === 'ArrowUp' && options.length > 0) {
            e.preventDefault();
            setActive((current - 1 + options.length) % options.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const pick = options[current];
            if (pick) onPick(pick.id);
          }
        }}
        className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 sm:h-9"
      />
      {open && !listed ? (
        <p role="status" className={`${alwaysOpen || inline ? 'mt-1' : 'absolute inset-x-0 top-full z-30 mt-1 shadow-lift'} rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-3`}>
          {emptyText}
        </p>
      ) : null}
      {listed ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          // Never a Tab stop: Chrome makes a scrolling list with nothing focusable in it one, and
          // focus moving here would close the list under it (the options follow aria-activedescendant).
          tabIndex={-1}
          className={`${alwaysOpen || inline ? 'mt-1' : 'absolute inset-x-0 top-full z-30 mt-1 shadow-lift'} max-h-60 overflow-y-auto rounded-lg border border-line bg-surface py-1`}
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the box
                onPick(o.id);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-[40px] cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === current ? 'bg-brand/10' : 'hover:bg-ground'}`}
            >
              {o.lead}
              <span dir="auto" className="min-w-0 flex-1 truncate text-start text-ink">
                {o.label}
              </span>
              {o.trail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
