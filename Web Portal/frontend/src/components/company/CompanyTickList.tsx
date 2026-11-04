import { useId, useState, type ReactNode } from 'react';
import { fieldClass } from '../ui/Field';
import { CompanyLogo } from './CompanyLogo';

export interface TickListCompany {
  id: string;
  name: string;
  code?: string;
  logoUrl: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | string;
}

/** With more than this many companies the list gets a search box. */
export const COMPANY_SEARCH_FROM = 7;

export interface CompanyTickListProps {
  legend: ReactNode;
  legendClassName?: string;
  /** The companies offered (any order). */
  companies: readonly TickListCompany[];
  /** The ticked companies' ids. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** One company only: round buttons instead of tick boxes. */
  single?: boolean;
}

const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');

/**
 * A list of companies to tick (a person's companies; the bulk "Add to a company" choice): one per
 * line with its logo and its whole name, which wraps rather than being cut off. The companies ticked
 * when it opens come first (A–Z), then the others (A–Z); ticking doesn't move a row under the pointer.
 * More than 6: a search box (part of the name, or the code) — what is ticked stays ticked while hidden.
 */
export function CompanyTickList({ legend, legendClassName = 'mb-1.5 text-sm font-medium text-ink', companies, value, onChange, single = false }: CompanyTickListProps) {
  const id = useId();
  const [tickedAtOpen] = useState(() => new Set(value));
  const [query, setQuery] = useState('');
  const searchable = companies.length >= COMPANY_SEARCH_FROM;
  const ordered = [...companies].sort((a, b) => Number(!tickedAtOpen.has(a.id)) - Number(!tickedAtOpen.has(b.id)) || a.name.localeCompare(b.name, 'en'));
  const q = fold(query.trim());
  const shown = q ? ordered.filter((c) => fold(c.name).includes(q) || (c.code ? fold(c.code).includes(q) : false)) : ordered;

  const toggle = (companyId: string) => {
    if (single) return onChange([companyId]);
    onChange(value.includes(companyId) ? value.filter((x) => x !== companyId) : [...value, companyId]);
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={legendClassName}>{legend}</legend>
      {searchable ? (
        <div className="relative">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="Search companies"
            aria-controls={`${id}-list`}
            placeholder="Search companies"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={fieldClass(false, 'w-full ps-9 [@media(pointer:coarse)]:!min-h-11')}
          />
        </div>
      ) : null}
      <ul id={`${id}-list`} aria-label={typeof legend === 'string' ? legend : undefined} className="flex flex-col gap-1.5">
        {shown.map((c) => {
          const checked = value.includes(c.id);
          return (
            <li key={c.id}>
              <label
                className={`flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors hover:bg-ground [@media(pointer:coarse)]:!min-h-11 ${checked ? 'border-brand/40 bg-brand/[0.04]' : 'border-line'}`}
              >
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name={single ? `${id}-company` : undefined}
                  checked={checked}
                  onChange={() => toggle(c.id)}
                  className="h-4 w-4 flex-none accent-brand"
                />
                <CompanyLogo company={c} size={20} />
                <span className="min-w-0 flex-1 text-sm leading-snug text-ink [overflow-wrap:anywhere]">
                  <bdi>{c.name}</bdi>
                  {c.status === 'ARCHIVED' ? <span className="text-ink-2"> (archived)</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && q ? <p role="status" className="px-1 text-sm text-ink-2">No company matches “{query.trim()}”.</p> : null}
    </fieldset>
  );
}
