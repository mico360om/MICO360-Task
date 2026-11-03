import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CompanyLogo } from './CompanyLogo';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';

/** A company as the field names it. */
export interface CompanyChoice {
  id: string;
  name: string;
  logoUrl: string | null;
}

/** The server's words for a project left without a company. */
const NEEDS_ONE = 'A project needs at least one company.';

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * A project's companies: chips, the main company first (badged "Main") and the others with
 * "Make main"; "Add company" opens a menu of the `usable` companies not chosen yet (A–Z). A company
 * that isn't usable (not an administrator, not one of mine) is locked: it stays, can't be taken off
 * or made main, and says who can change it (`lockedTitle`). The last company can't be taken off.
 * `all` names chips (usable companies and the project's own); `error` is the server's refusal,
 * shown under the field and tied to it.
 */
export function CompanyChipsField({
  value,
  onChange,
  usable,
  all,
  lockedTitle,
  error,
  disabled = false,
  unlocked = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  usable: readonly CompanyChoice[];
  all: readonly CompanyChoice[];
  lockedTitle: (name: string) => string;
  error?: string | null;
  disabled?: boolean;
  /** An administrator: every chip may be changed (an archived company too), though only `usable` ones are added. */
  unlocked?: boolean;
}) {
  const labelId = useId();
  const noteId = useId();
  const errorId = useId();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menu = useRef<HTMLDivElement>(null);

  const known = new Map<string, CompanyChoice>();
  for (const c of [...all, ...usable]) if (!known.has(c.id)) known.set(c.id, c);
  const usableIds = new Set(usable.map((c) => c.id));
  const nameOf = (id: string) => known.get(id)?.name ?? 'A company';
  const addable = usable.filter((c) => !value.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'en'));

  // Opened: the first company has focus.
  useEffect(() => {
    if (open) items.current[0]?.focus();
  }, [open]);
  // Escape closes only the menu (native: the dialog's own Escape listener sits on an element around it).
  useEffect(() => {
    const el = menu.current;
    if (!open || !el) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      addButton.current?.focus();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [open]);
  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    addButton.current?.focus();
  };
  const add = (id: string) => {
    onChange([...value, id]);
    close();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} role="group" aria-labelledby={labelId} aria-describedby={error ? `${errorId} ${noteId}` : noteId}>
      <span id={labelId} className="mb-1.5 block text-sm font-semibold text-ink">
        Companies
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <ul className="flex max-w-full flex-wrap items-center gap-1.5">
          {value.map((id, i) => {
            const name = nameOf(id);
            const company = known.get(id) ?? { name, logoUrl: null };
            const locked = !unlocked && !usableIds.has(id);
            const only = value.length === 1;
            return (
              <li
                key={id}
                title={locked ? lockedTitle(name) : undefined}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pe-1 ps-2 text-sm text-ink ${i === 0 ? 'border-brand/40 bg-brand/5' : 'border-line bg-ground'}`}
              >
                <CompanyLogo company={company} size={16} />
                <bdi className="min-w-0 truncate">{name}</bdi>
                {i === 0 ? (
                  <span className="flex-none rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">Main</span>
                ) : !locked ? (
                  <button
                    type="button"
                    onClick={() => onChange([id, ...value.filter((x) => x !== id)])}
                    disabled={disabled}
                    aria-label={`Make ${name} the main company`}
                    className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/10 disabled:opacity-50 ${TOUCH_TALL}`}
                  >
                    Make main
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x !== id))}
                  disabled={disabled || locked || only}
                  aria-label={`Remove ${name}`}
                  title={!locked && only ? NEEDS_ONE : undefined}
                  className={`grid h-6 w-6 flex-none place-items-center rounded-full text-ink-2 transition-colors enabled:hover:bg-danger-soft enabled:hover:text-danger disabled:cursor-not-allowed disabled:opacity-60 [@media(pointer:coarse)]:-my-2.5 ${TOUCH_SQUARE}`}
                >
                  {locked ? (
                    <LockIcon />
                  ) : (
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {addable.length > 0 ? (
          <div className="relative">
            <button
              ref={addButton}
              type="button"
              onClick={() => setOpen((o) => !o)}
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? menuId : undefined}
              className={`inline-flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1 text-sm font-semibold text-brand transition-colors hover:border-brand disabled:opacity-50 ${TOUCH_TALL}`}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add company
            </button>
            {open ? (
              <div
                ref={menu}
                id={menuId}
                role="menu"
                aria-label="Add company"
                onKeyDown={onMenuKey}
                className="absolute start-0 top-full z-20 mt-1 max-h-64 min-w-[12rem] max-w-[min(18rem,80vw)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lift"
              >
                {addable.map((c, i) => (
                  <button
                    key={c.id}
                    ref={(el) => {
                      items.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => add(c.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm text-ink hover:bg-ground focus:bg-ground focus:outline-none ${TOUCH_TALL}`}
                  >
                    <CompanyLogo company={c} size={20} />
                    <bdi className="min-w-0 truncate">{c.name}</bdi>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
      <p id={noteId} className="mt-1.5 text-xs text-ink-2">
        The main company’s logo and name go on the project’s PDFs and emails.
      </p>
    </div>
  );
}
