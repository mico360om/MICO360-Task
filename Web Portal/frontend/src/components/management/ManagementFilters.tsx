import { useEffect, useId, useRef, useState } from 'react';
import type { ManagementFilters as Filters, OptionProject } from '../../api/management';
import { SearchableSelect } from '../ui/SearchableSelect';
import { ProjectAvatar } from '../ProjectAvatar';
import { DEFAULT_STATUSES, PERIODS, PROJECT_STATUSES, STATUS_LABEL, isDefaultFilters } from '../../lib/management';

const CHIP =
  'relative flex min-h-8 cursor-pointer select-none items-center rounded-full border px-3 py-1 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] [@media(pointer:coarse)]:!min-h-11';

/** Which projects: "Projects: All" / "Projects: 2 chosen", opening a list of tick boxes. */
function ProjectPicker({ projects, chosen, onChange }: { projects: OptionProject[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = chosen.length === 0 ? 'Projects: All' : chosen.length === 1 ? `Projects: ${projects.find((p) => p.id === chosen[0])?.name ?? '1 chosen'}` : `Projects: ${chosen.length} chosen`;
  const listed = q.trim() ? projects.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())) : projects;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  return (
    <div ref={box} className="relative min-w-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-brand/30 hover:bg-ground [@media(pointer:coarse)]:!min-h-11 ${chosen.length ? 'border-brand/40 text-brand' : 'border-line text-ink'}`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
          <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        <span dir="auto" className="truncate">{label}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Projects to show"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
          className="absolute start-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-card"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
            <span className="text-xs text-ink-2">{chosen.length ? `${chosen.length} chosen` : 'All projects'}</span>
            <button type="button" onClick={() => onChange([])} disabled={chosen.length === 0} className="rounded px-1.5 py-1 text-xs font-semibold text-brand hover:bg-ground disabled:opacity-50">
              Show all
            </button>
          </div>
          {projects.length > 8 ? (
            <input
              type="search"
              value={q}
              dir="auto"
              onChange={(e) => setQ(e.target.value)}
              aria-label="Find a project"
              placeholder="Find a project"
              className="mb-1.5 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand"
            />
          ) : null}
          <ul className="max-h-72 overflow-y-auto">
            {listed.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-ink hover:bg-ground [@media(pointer:coarse)]:!min-h-11">
                  <input type="checkbox" checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} aria-label={p.name} className="h-4 w-4 accent-[rgb(var(--c-brand))]" />
                  <ProjectAvatar project={p} size="xs" />
                  <span dir="auto" className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="flex-none text-[11px] text-ink-3">{STATUS_LABEL[p.status]}</span>
                </label>
              </li>
            ))}
            {listed.length === 0 ? <li className="px-2 py-2 text-xs text-ink-3">No project matches.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The page's filters: projects, owner, project status (the ones still going unless chosen) and the
 * period (4, 12 or 26 weeks) — each change goes into the address.
 */
export function ManagementFilters({ filters, projects, owners, onChange }: { filters: Filters; projects: OptionProject[]; owners: { id: string; name: string }[]; onChange: (f: Filters) => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggleStatus = (s: Filters['statuses'][number]) => {
    const next = filters.statuses.includes(s) ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s];
    // At least one: taking the last one away goes back to the projects still going.
    set({ statuses: next.length ? PROJECT_STATUSES.filter((x) => next.includes(x)) : [...DEFAULT_STATUSES] });
  };
  return (
    <div className="card mb-4 flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ProjectPicker projects={projects} chosen={filters.projectIds} onChange={(projectIds) => set({ projectIds })} />
        <div className="w-full min-w-0 sm:w-56">
          <SearchableSelect
            ariaLabel="Owner"
            value={filters.ownerId ?? ''}
            onChange={(v) => set({ ownerId: v || null })}
            placeholder="Owner: Anyone"
            options={[{ value: '', label: 'Owner: Anyone' }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
          />
        </div>
        <fieldset className="flex min-w-0 items-center gap-1 rounded-lg border border-line p-0.5">
          <legend className="sr-only">Period</legend>
          {PERIODS.map((w) => (
            <label
              key={w}
              className={`relative flex min-h-8 cursor-pointer items-center rounded-md px-3 text-sm font-semibold transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] [@media(pointer:coarse)]:!min-h-11 ${
                filters.weeks === w ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:text-ink'
              }`}
            >
              <input type="radio" name="mgmt-period" className="sr-only" checked={filters.weeks === w} onChange={() => set({ weeks: w })} />
              {w} weeks
            </label>
          ))}
        </fieldset>
        {!isDefaultFilters(filters) ? (
          <button type="button" onClick={() => onChange({ projectIds: [], ownerId: null, statuses: [...DEFAULT_STATUSES], weeks: 12 })} className="tap rounded-lg px-2 text-sm font-semibold text-brand hover:underline">
            Clear filters
          </button>
        ) : null}
      </div>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="me-1 float-start text-xs font-semibold uppercase tracking-wide text-ink-3">Status</legend>
        {PROJECT_STATUSES.map((s) => {
          const on = filters.statuses.includes(s);
          return (
            <label key={s} className={`${CHIP} ${on ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink-2 hover:border-brand/30'}`}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleStatus(s)} />
              {STATUS_LABEL[s]}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
