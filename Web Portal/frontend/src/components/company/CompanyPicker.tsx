import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useMyCompanies } from '../../hooks/useMyCompanies';
import { ALL_COMPANIES_LABEL, pickLabel } from '../../lib/companies';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useAuthStore } from '../../stores/auth-store';
import { useCompanyStore } from '../../stores/company-store';
import { CompanyLogo } from './CompanyLogo';

/** "All my companies": several buildings. */
function AllCompaniesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M3 21V9a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v12" />
      <path d="M11 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17" />
      <path d="M2 21h20M6 12h2M6 16h2M14 7h3M14 11h3M14 15h3" />
    </svg>
  );
}

type Option = { id: string | null; name: string; logoUrl: string | null };

/**
 * The company picker in the top bar, right after the search box — only for people with two or more
 * companies (administrators: the site's active companies). "All my companies" first, then each
 * company A–Z with its logo; the current one is ticked. Arrow keys move, Home/End jump, Enter picks,
 * Escape closes (back to the button). Below 1536px the button shows only the logo (the top bar has
 * no room for a name beside the clock and the search box); its name ("Company: Beta Co") and its
 * tooltip say which.
 *
 * `place="menu"`: the same picker in the phone's menu, for the smallest phones (< 360px), whose top
 * bar has no room for it — there it shows its name and opens upwards; it is hidden from 360px, where
 * the top bar's own picker shows. So exactly one is visible at any width.
 */
export function CompanyPicker({ place = 'bar' }: { place?: 'bar' | 'menu' } = {}): JSX.Element | null {
  const { companies, showPicker, pick } = useMyCompanies();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setPick = useCompanyStore((s) => s.setPick);
  // The name shows only where the top bar has room for it beside the clock and a full search box
  // (≥ 1536px, Tailwind's 2xl); narrower, the logo alone, its name on hover and in the button's name.
  const wideBar = useMediaQuery('(min-width: 96em)', true);
  // From 640px, a company without a logo shows its short code beside the building, so two such
  // companies don't look the same (on a phone: the icon alone, its name in the button's name).
  const notPhone = useMediaQuery('(min-width: 40em)', true);
  const inMenu = place === 'menu';
  const wide = inMenu || wideBar;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const current = companies.find((c) => c.id === pick) ?? null;
  const options: Option[] = [{ id: null, name: ALL_COMPANIES_LABEL, logoUrl: null }, ...[...companies].sort((x, y) => x.name.localeCompare(y.name, 'en'))];
  const checked = Math.max(0, options.findIndex((o) => o.id === (current?.id ?? null)));

  // Opened: the ticked one has focus (only when it opens — moving through the list stays put).
  useEffect(() => {
    if (open) items.current[checked]?.focus();
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

  if (!showPicker) return null;

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (id: string | null) => {
    if (userId) setPick(userId, id);
    close();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter((el): el is HTMLButtonElement => el !== null);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? list.length - 1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') setOpen(false);
  };

  const label = pickLabel(pick, companies);
  return (
    <div
      ref={root}
      data-company-picker-place={place}
      className={inMenu ? 'relative flex-none border-t border-line p-2 [@media(min-width:22.5em)]:hidden' : 'relative hidden flex-none [@media(min-width:22.5em)]:block'}
    >
      <button
        ref={button}
        type="button"
        data-company-picker
        aria-label={`Company: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={wide ? undefined : label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-9 min-w-9 items-center gap-2 rounded-lg border border-line px-2 text-sm font-medium text-ink transition-colors hover:bg-ground [@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!min-w-11 ${inMenu ? 'w-full' : 'justify-center'}`}
      >
        {current ? <CompanyLogo company={current} size={20} /> : <AllCompaniesIcon />}
        {!wide && notPhone && current && !current.logoUrl ? <span className="max-w-[5rem] truncate text-xs font-semibold">{current.code}</span> : null}
        {wide ? (
          <>
            <bdi className={`truncate ${inMenu ? 'min-w-0 flex-1 text-start' : 'max-w-[10rem]'}`}>{label}</bdi>
            <svg className="flex-none text-ink-2" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </>
        ) : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Company"
          onKeyDown={onMenuKey}
          className={`absolute start-0 z-40 max-h-[min(24rem,calc(100vh-5rem))] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lift animate-scale-in ${inMenu ? 'bottom-full mb-2 w-full' : 'mt-2 w-80 max-w-[calc(100vw-1.5rem)]'}`}
        >
          {options.map((o, i) => (
            <button
              key={o.id ?? 'all'}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={i === checked}
              tabIndex={-1}
              onClick={() => choose(o.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-ink transition-colors hover:bg-ground focus:bg-ground focus:outline-none [@media(pointer:coarse)]:!min-h-11"
            >
              {o.id === null ? <AllCompaniesIcon /> : <CompanyLogo company={o} size={20} />}
              {/* The whole name, wrapping (1.22): long company names were cut off. */}
              {o.id === null ? <span className="min-w-0 flex-1 leading-snug">{o.name}</span> : <bdi className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{o.name}</bdi>}
              <svg className={`flex-none text-brand ${i === checked ? '' : 'invisible'}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
