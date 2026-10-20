import { useEffect, useId, useRef, useState } from 'react';
import { ProjectAvatar, type ProjectLook } from '../ProjectAvatar';

type FilterProject = ProjectLook & { id: string };

/**
 * Which projects the All projects board shows: a button ("Projects: all" / "Projects: 3 of 12")
 * opening a list of checkboxes. The board remembers the projects left out, so a new project shows.
 */
export function ProjectFilter({ projects, hidden, onChange }: { projects: FilterProject[]; hidden: ReadonlySet<string>; onChange: (hidden: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const shownCount = projects.filter((p) => !hidden.has(p.id)).length;
  const label = shownCount === projects.length ? 'Projects: all' : `Projects: ${shownCount} of ${projects.length}`;
  const listed = q.trim() ? projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : projects;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-brand/30 hover:bg-ground ${shownCount < projects.length ? 'border-brand/40 text-brand' : 'border-line text-ink'}`}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>
        {label}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Projects on the board"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
          className="absolute right-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-card"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
            <button type="button" onClick={() => onChange(new Set())} className="rounded px-1.5 py-1 text-xs font-semibold text-brand hover:bg-ground">Show all</button>
            <button type="button" onClick={() => onChange(new Set(projects.map((p) => p.id)))} className="rounded px-1.5 py-1 text-xs font-semibold text-ink-2 hover:bg-ground">Show none</button>
          </div>
          {projects.length > 8 ? (
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Find a project"
              placeholder="Find a project"
              className="mb-1.5 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
          ) : null}
          <ul className="max-h-72 overflow-y-auto">
            {listed.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-ink hover:bg-ground">
                  <input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-[rgb(var(--c-brand))]" />
                  <ProjectAvatar project={p} size="xs" />
                  <span dir="auto" className="min-w-0 flex-1 truncate">{p.name}</span>
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
