import type { ApiCompany } from '../../api/companies';
import { FieldLabel, fieldClass } from '../ui/Field';
import { CompanyLogo } from './CompanyLogo';

export interface CompanyChecklistProps {
  /** Every company on the site (GET /companies): the active ones are offered; an archived one only while ticked. */
  companies: Pick<ApiCompany, 'id' | 'name' | 'logoUrl' | 'status'>[];
  /** The ticked companies' ids, in the order they were ticked. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** The primary company (one of `value`), or null when none is ticked. */
  primaryId: string | null;
  onPrimaryChange: (id: string | null) => void;
  /** Makes the fields' ids unique on the page ("nu" → "nu-primary"). */
  idPrefix: string;
  /** 'section': the legend in the dialog's section style (Edit user's "PROFILE", "ACCESS"). */
  variant?: 'field' | 'section';
}

/**
 * A person's companies (the New user and Edit user dialogs): a tick box per company and, once one is
 * ticked, "Primary company" — the one whose logo and name their emails carry. Ticking the first
 * company makes it primary; unticking the primary one makes the first one left primary.
 */
export function CompanyChecklist({ companies, value, onChange, primaryId, onPrimaryChange, idPrefix, variant = 'field' }: CompanyChecklistProps) {
  const shown = companies.filter((c) => c.status === 'ACTIVE' || value.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const ticked = shown.filter((c) => value.includes(c.id));

  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
    onChange(next);
    if (!primaryId || !next.includes(primaryId)) onPrimaryChange(next[0] ?? null);
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className={variant === 'section' ? 'mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-2' : 'mb-1.5 text-sm font-medium text-ink'}>Companies</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {shown.map((c) => (
            <label key={c.id} className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-line px-2.5 py-2 transition-colors hover:bg-ground [@media(pointer:coarse)]:min-h-11">
              <input type="checkbox" checked={value.includes(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 flex-none accent-brand" />
              <CompanyLogo company={c} size={20} />
              <span className="min-w-0 truncate text-sm text-ink">
                <bdi>{c.name}</bdi>
                {c.status === 'ARCHIVED' ? <span className="text-ink-2"> (archived)</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {ticked.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${idPrefix}-primary`}>Primary company</FieldLabel>
          <select
            id={`${idPrefix}-primary`}
            value={primaryId ?? ''}
            onChange={(e) => onPrimaryChange(e.target.value || null)}
            aria-describedby={`${idPrefix}-primary-hint`}
            className={fieldClass(false, '[@media(pointer:coarse)]:!min-h-11')}
          >
            {ticked.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p id={`${idPrefix}-primary-hint`} className="text-xs text-ink-2">Used for their emails: logo and name</p>
        </div>
      ) : null}
    </div>
  );
}
